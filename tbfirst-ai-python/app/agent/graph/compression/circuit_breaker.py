"""Time-driven circuit breakers used by optional Agent subsystems.

The breaker deliberately does not count failures. A dependency failure opens the
circuit immediately, elapsed time moves it toward HALF_OPEN, and exactly one
probe decides whether it closes or reopens with a longer cooldown.

State is isolated per session and per capability. The in-process registry is
bounded and thread-safe; deployments that need cross-worker breaker state should
also protect shared upstreams at the gateway layer.
"""

from __future__ import annotations

import contextvars
import threading
import time
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass, field
from enum import Enum


class CircuitState(str, Enum):
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"


class CircuitOpenError(RuntimeError):
    def __init__(self, retry_after_seconds: float, state: CircuitState):
        self.retry_after_seconds = max(0.0, retry_after_seconds)
        self.state = state
        super().__init__(
            f"circuit is {state.value}; retry after {self.retry_after_seconds:.2f}s"
        )


@dataclass
class CircuitBreaker:
    cooldown_seconds: float = 15.0
    max_cooldown_seconds: float = 120.0
    clock: Callable[[], float] = field(default=time.monotonic, repr=False, compare=False)
    _state: CircuitState = field(default=CircuitState.CLOSED, init=False, repr=False)
    _opened_until: float = field(default=0.0, init=False, repr=False)
    _active_cooldown: float = field(default=0.0, init=False, repr=False)
    _generation: int = field(default=0, init=False, repr=False)
    _permit: contextvars.ContextVar[tuple[int, bool] | None] = field(
        default_factory=lambda: contextvars.ContextVar("circuit_permit", default=None),
        init=False,
        repr=False,
    )
    _lock: threading.RLock = field(default_factory=threading.RLock, init=False, repr=False)

    def __post_init__(self) -> None:
        if self.cooldown_seconds <= 0:
            raise ValueError("cooldown_seconds must be positive")
        if self.max_cooldown_seconds < self.cooldown_seconds:
            raise ValueError("max_cooldown_seconds must be >= cooldown_seconds")
        self._active_cooldown = self.cooldown_seconds

    @property
    def state(self) -> CircuitState:
        with self._lock:
            return self._state

    @property
    def retry_after_seconds(self) -> float:
        with self._lock:
            if self._state is CircuitState.CLOSED:
                return 0.0
            return max(0.0, self._opened_until - self.clock())

    def available(self) -> bool:
        """Return readiness without acquiring the HALF_OPEN probe."""
        with self._lock:
            if self._state is CircuitState.CLOSED:
                return True
            if self._state is CircuitState.OPEN:
                return self.clock() >= self._opened_until
            return False

    def check(self) -> None:
        """Acquire permission for one dependency call.

        CLOSED requests pass. Once OPEN cooldown expires, the first caller owns
        the HALF_OPEN probe and concurrent callers continue to fail fast.
        """
        with self._lock:
            now = self.clock()
            if self._state is CircuitState.CLOSED:
                self._permit.set((self._generation, False))
                return
            if self._state is CircuitState.OPEN and now >= self._opened_until:
                self._state = CircuitState.HALF_OPEN
                self._permit.set((self._generation, True))
                return
            retry_after = max(0.0, self._opened_until - now)
            raise CircuitOpenError(retry_after, self._state)

    def fail(self) -> None:
        """Open immediately; a failed probe applies bounded time backoff."""
        permit = self._permit.get()
        self._permit.set(None)
        with self._lock:
            if permit is not None and permit[0] != self._generation:
                return
            is_probe = permit[1] if permit is not None else self._state is CircuitState.HALF_OPEN
            if self._state is CircuitState.OPEN:
                return
            if is_probe and self._state is CircuitState.HALF_OPEN:
                self._active_cooldown = min(
                    self.max_cooldown_seconds,
                    max(self.cooldown_seconds, self._active_cooldown * 2),
                )
            elif self._state is CircuitState.CLOSED:
                self._active_cooldown = self.cooldown_seconds
            else:
                return
            self._state = CircuitState.OPEN
            self._opened_until = self.clock() + self._active_cooldown
            self._generation += 1

    def succeed(self) -> None:
        permit = self._permit.get()
        self._permit.set(None)
        with self._lock:
            if permit is None or permit[0] != self._generation:
                return
            if permit[1] and self._state is CircuitState.HALF_OPEN:
                self._close_locked()

    def reset(self) -> None:
        """Force the administrative/test state back to CLOSED."""
        self._permit.set(None)
        with self._lock:
            self._close_locked()

    def _close_locked(self) -> None:
        self._state = CircuitState.CLOSED
        self._opened_until = 0.0
        self._active_cooldown = self.cooldown_seconds
        self._generation += 1


@dataclass
class BreakerSet:
    compress: CircuitBreaker = field(default_factory=CircuitBreaker)
    tool: CircuitBreaker = field(default_factory=CircuitBreaker)
    dependency: CircuitBreaker = field(default_factory=CircuitBreaker)
    evaluator: CircuitBreaker = field(default_factory=CircuitBreaker)
    planner: CircuitBreaker = field(default_factory=CircuitBreaker)


_registry: OrderedDict[str, BreakerSet] = OrderedDict()
_MAX_SESSIONS = 1024
_registry_lock = threading.RLock()


def get_breakers(session_key: str | None) -> BreakerSet:
    """Return a bounded, LRU-refreshed breaker set for one Agent session."""
    key = session_key or "_default_"
    with _registry_lock:
        existing = _registry.pop(key, None)
        if existing is not None:
            _registry[key] = existing
            return existing
        if len(_registry) >= _MAX_SESSIONS:
            _registry.popitem(last=False)
        created = BreakerSet()
        _registry[key] = created
        return created


async def get_breakers_async(session_key: str | None) -> BreakerSet:
    return get_breakers(session_key)
