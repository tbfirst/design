"""Time-driven three-state circuit breaker tests."""
from __future__ import annotations

import os
import sys
import asyncio

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

import pytest  # noqa: E402

from app.agent.graph.compression.circuit_breaker import (  # noqa: E402
    BreakerSet,
    CircuitBreaker,
    CircuitOpenError,
    CircuitState,
    get_breakers,
)


class FakeClock:
    def __init__(self) -> None:
        self.now = 100.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


def test_breaker_set_keeps_capabilities_isolated():
    breakers = BreakerSet()
    breakers.evaluator.fail()
    assert breakers.evaluator.state is CircuitState.OPEN
    assert breakers.compress.state is CircuitState.CLOSED


def test_failure_opens_immediately_without_counter():
    clock = FakeClock()
    breaker = CircuitBreaker(cooldown_seconds=10, clock=clock)
    breaker.fail()
    assert breaker.state is CircuitState.OPEN
    assert not hasattr(breaker, "_failures")
    with pytest.raises(CircuitOpenError) as exc:
        breaker.check()
    assert exc.value.retry_after_seconds == pytest.approx(10)


def test_elapsed_time_allows_exactly_one_half_open_probe():
    clock = FakeClock()
    breaker = CircuitBreaker(cooldown_seconds=10, clock=clock)
    breaker.fail()
    clock.advance(10)

    assert breaker.available()
    breaker.check()
    assert breaker.state is CircuitState.HALF_OPEN
    with pytest.raises(CircuitOpenError):
        breaker.check()

    breaker.succeed()
    assert breaker.state is CircuitState.CLOSED
    breaker.check()


def test_failed_probe_reopens_with_bounded_time_backoff():
    clock = FakeClock()
    breaker = CircuitBreaker(
        cooldown_seconds=5,
        max_cooldown_seconds=12,
        clock=clock,
    )
    breaker.fail()
    clock.advance(5)
    breaker.check()
    breaker.fail()
    assert breaker.retry_after_seconds == pytest.approx(10)

    clock.advance(10)
    breaker.check()
    breaker.fail()
    assert breaker.retry_after_seconds == pytest.approx(12)


def test_reset_closes_open_breaker():
    breaker = CircuitBreaker()
    breaker.fail()
    breaker.reset()
    assert breaker.state is CircuitState.CLOSED
    breaker.check()


def test_stale_concurrent_success_cannot_close_newly_opened_circuit():
    breaker = CircuitBreaker(cooldown_seconds=10)
    first_failed = asyncio.Event()

    async def failing_call():
        breaker.check()
        breaker.fail()
        first_failed.set()

    async def stale_success():
        breaker.check()
        await first_failed.wait()
        breaker.succeed()

    async def scenario():
        await asyncio.gather(stale_success(), failing_call())

    asyncio.run(scenario())
    assert breaker.state is CircuitState.OPEN


def test_registry_returns_stable_breaker_set_per_session():
    first = get_breakers("breaker-session-a")
    second = get_breakers("breaker-session-a")
    other = get_breakers("breaker-session-b")
    assert first is second
    assert first is not other
