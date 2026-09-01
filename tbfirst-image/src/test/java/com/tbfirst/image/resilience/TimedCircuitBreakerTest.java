package com.tbfirst.image.resilience;

import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicLong;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class TimedCircuitBreakerTest {

    @Test
    void opensImmediatelyAndAllowsOnlyOneProbeAfterTimeElapses() {
        AtomicLong clock = new AtomicLong();
        TimedCircuitBreaker breaker = new TimedCircuitBreaker(
                Duration.ofSeconds(5), Duration.ofSeconds(20), error -> true, clock::get);

        assertThrows(IllegalStateException.class, () -> breaker.execute(() -> {
            throw new IllegalStateException("down");
        }));
        assertEquals(TimedCircuitBreaker.State.OPEN, breaker.getState());
        assertThrows(TimedCircuitBreaker.CircuitOpenException.class, () -> breaker.execute(() -> "blocked"));

        clock.addAndGet(Duration.ofSeconds(5).toNanos());
        breaker.acquirePermission();
        assertEquals(TimedCircuitBreaker.State.HALF_OPEN, breaker.getState());
        assertThrows(TimedCircuitBreaker.CircuitOpenException.class, breaker::acquirePermission);

        breaker.onSuccess();
        assertEquals(TimedCircuitBreaker.State.CLOSED, breaker.getState());
    }

    @Test
    void unclassifiedClientErrorDoesNotOpenCircuit() {
        TimedCircuitBreaker breaker = new TimedCircuitBreaker(
                Duration.ofSeconds(5), Duration.ofSeconds(20), error -> false);
        assertThrows(IllegalArgumentException.class, () -> breaker.execute(() -> {
            throw new IllegalArgumentException("bad request");
        }));
        assertEquals(TimedCircuitBreaker.State.CLOSED, breaker.getState());
    }

    @Test
    void failedProbeBacksOffByTimeWithoutFailureCounters() {
        AtomicLong clock = new AtomicLong();
        TimedCircuitBreaker breaker = new TimedCircuitBreaker(
                Duration.ofSeconds(5), Duration.ofSeconds(8), error -> true, clock::get);
        breaker.onFailure();
        clock.addAndGet(Duration.ofSeconds(5).toNanos());
        breaker.acquirePermission();
        breaker.onFailure();
        assertEquals(Duration.ofSeconds(8), breaker.getRetryAfter());
    }

    @Test
    void staleConcurrentSuccessCannotCloseNewlyOpenedCircuit() throws Exception {
        TimedCircuitBreaker breaker = new TimedCircuitBreaker(
                Duration.ofSeconds(5), Duration.ofSeconds(20), error -> true);
        CountDownLatch bothStarted = new CountDownLatch(2);
        CountDownLatch failureRecorded = new CountDownLatch(1);

        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var staleSuccess = executor.submit(() -> breaker.execute(() -> {
                bothStarted.countDown();
                await(bothStarted);
                await(failureRecorded);
                return "late success";
            }));
            var failure = executor.submit(() -> {
                try {
                    breaker.execute(() -> {
                        bothStarted.countDown();
                        await(bothStarted);
                        throw new IllegalStateException("down");
                    });
                } finally {
                    failureRecorded.countDown();
                }
            });

            assertEquals("late success", staleSuccess.get());
            assertThrows(Exception.class, failure::get);
        }
        assertEquals(TimedCircuitBreaker.State.OPEN, breaker.getState());
    }

    private static void await(CountDownLatch latch) {
        try {
            latch.await();
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(error);
        }
    }
}
