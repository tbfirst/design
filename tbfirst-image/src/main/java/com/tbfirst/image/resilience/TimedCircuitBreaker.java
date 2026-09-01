package com.tbfirst.image.resilience;

import java.time.Duration;
import java.util.Objects;
import java.util.function.LongSupplier;
import java.util.function.Predicate;
import java.util.function.Supplier;

/**
 * Time-driven CLOSED/OPEN/HALF_OPEN circuit breaker.
 *
 * <p>No request or failure counters are kept. A classified upstream failure opens
 * immediately, elapsed time admits one probe, and the probe either closes the
 * circuit or reopens it with bounded time backoff.</p>
 */
public final class TimedCircuitBreaker {

    public enum State { CLOSED, OPEN, HALF_OPEN }

    public static final class CircuitOpenException extends RuntimeException {
        private final Duration retryAfter;
        private final State state;

        private CircuitOpenException(State state, Duration retryAfter) {
            super("upstream circuit is " + state + ", retry after " + retryAfter.toMillis() + "ms");
            this.state = state;
            this.retryAfter = retryAfter;
        }

        public Duration getRetryAfter() {
            return retryAfter;
        }

        public State getState() {
            return state;
        }
    }

    private final long initialOpenNanos;
    private final long maxOpenNanos;
    private final Predicate<Throwable> recordFailure;
    private final LongSupplier nanoTime;

    private volatile State state = State.CLOSED;
    private long openUntilNanos;
    private long activeOpenNanos;
    private long generation;
    private final ThreadLocal<Permit> currentPermit = new ThreadLocal<>();

    private record Permit(long generation, boolean probe) {}

    public TimedCircuitBreaker(
            Duration initialOpenDuration,
            Duration maxOpenDuration,
            Predicate<Throwable> recordFailure) {
        this(initialOpenDuration, maxOpenDuration, recordFailure, System::nanoTime);
    }

    public TimedCircuitBreaker(
            Duration initialOpenDuration,
            Duration maxOpenDuration,
            Predicate<Throwable> recordFailure,
            LongSupplier nanoTime) {
        Objects.requireNonNull(initialOpenDuration, "initialOpenDuration");
        Objects.requireNonNull(maxOpenDuration, "maxOpenDuration");
        this.recordFailure = Objects.requireNonNull(recordFailure, "recordFailure");
        this.nanoTime = Objects.requireNonNull(nanoTime, "nanoTime");
        this.initialOpenNanos = initialOpenDuration.toNanos();
        this.maxOpenNanos = maxOpenDuration.toNanos();
        if (initialOpenNanos <= 0 || maxOpenNanos < initialOpenNanos) {
            throw new IllegalArgumentException("open durations must be positive and max >= initial");
        }
        this.activeOpenNanos = initialOpenNanos;
    }

    public <T> T execute(Supplier<T> supplier) {
        Permit permit = acquirePermit();
        try {
            T result = supplier.get();
            onSuccess(permit);
            return result;
        } catch (RuntimeException | Error error) {
            if (recordFailure.test(error)) {
                onFailure(permit);
            } else {
                onSuccess(permit);
            }
            throw error;
        }
    }

    public State getState() {
        return state;
    }

    public synchronized Duration getRetryAfter() {
        if (state == State.CLOSED) {
            return Duration.ZERO;
        }
        return Duration.ofNanos(Math.max(0, openUntilNanos - nanoTime.getAsLong()));
    }

    public synchronized boolean isAvailable() {
        return state == State.CLOSED || (state == State.OPEN && nanoTime.getAsLong() >= openUntilNanos);
    }

    public void acquirePermission() {
        currentPermit.set(acquirePermit());
    }

    private synchronized Permit acquirePermit() {
        long now = nanoTime.getAsLong();
        if (state == State.CLOSED) {
            return new Permit(generation, false);
        }
        if (state == State.OPEN && now >= openUntilNanos) {
            state = State.HALF_OPEN;
            return new Permit(generation, true);
        }
        throw new CircuitOpenException(
                state,
                Duration.ofNanos(Math.max(0, openUntilNanos - now))
        );
    }

    public void onSuccess() {
        Permit permit = currentPermit.get();
        currentPermit.remove();
        if (permit != null) {
            onSuccess(permit);
        }
    }

    private synchronized void onSuccess(Permit permit) {
        if (permit.generation() != generation) {
            return;
        }
        if (permit.probe() && state == State.HALF_OPEN) {
            state = State.CLOSED;
            openUntilNanos = 0;
            activeOpenNanos = initialOpenNanos;
            generation++;
        }
    }

    public void onFailure() {
        Permit permit = currentPermit.get();
        currentPermit.remove();
        if (permit == null) {
            onAdministrativeFailure();
        } else {
            onFailure(permit);
        }
    }

    private synchronized void onFailure(Permit permit) {
        if (permit.generation() != generation || state == State.OPEN) {
            return;
        }
        if (permit.probe() && state == State.HALF_OPEN) {
            activeOpenNanos = activeOpenNanos >= maxOpenNanos / 2
                    ? maxOpenNanos
                    : Math.min(maxOpenNanos, Math.max(initialOpenNanos, activeOpenNanos * 2));
        } else if (state == State.CLOSED) {
            activeOpenNanos = initialOpenNanos;
        } else {
            return;
        }
        openNow();
    }

    private synchronized void onAdministrativeFailure() {
        if (state == State.OPEN) {
            return;
        }
        if (state == State.HALF_OPEN) {
            activeOpenNanos = activeOpenNanos >= maxOpenNanos / 2
                    ? maxOpenNanos
                    : Math.min(maxOpenNanos, Math.max(initialOpenNanos, activeOpenNanos * 2));
        } else {
            activeOpenNanos = initialOpenNanos;
        }
        openNow();
    }

    private void openNow() {
        state = State.OPEN;
        openUntilNanos = nanoTime.getAsLong() + activeOpenNanos;
        generation++;
    }
}
