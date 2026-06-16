"""B.1: BreakerSet evaluator/planner 熔断字段测试。"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

import pytest  # noqa: E402

from app.agent.graph.compression.circuit_breaker import (  # noqa: E402
    BreakerSet,
    CircuitBreaker,
    get_breakers,
)

SESSION = "u" * 32


def _fresh_breakers() -> BreakerSet:
    """每个测试用新 session key 确保无状态污染。"""
    import random, string
    key = "".join(random.choices(string.ascii_lowercase, k=32))
    return get_breakers(key)


def test_evaluator_field_is_circuit_breaker():
    """get_breakers 返回的 BreakerSet.evaluator 是 CircuitBreaker 实例。"""
    bs = _fresh_breakers()
    assert isinstance(bs.evaluator, CircuitBreaker)


def test_planner_field_is_circuit_breaker():
    """get_breakers 返回的 BreakerSet.planner 是 CircuitBreaker 实例。"""
    bs = _fresh_breakers()
    assert isinstance(bs.planner, CircuitBreaker)


def test_evaluator_three_failures_then_check_raises():
    """evaluator 失败三次后 check() 抛 RuntimeError。"""
    bs = _fresh_breakers()
    bs.evaluator.fail()
    bs.evaluator.fail()
    bs.evaluator.fail()
    with pytest.raises(RuntimeError):
        bs.evaluator.check()


def test_evaluator_reset_clears_open_state():
    """evaluator reset() 后 check() 不抛。"""
    bs = _fresh_breakers()
    bs.evaluator.fail()
    bs.evaluator.fail()
    bs.evaluator.fail()
    bs.evaluator.reset()
    bs.evaluator.check()  # should not raise


def test_evaluator_does_not_affect_compress():
    """evaluator 熔断不影响 compress 熔断器（相互隔离）。"""
    bs = _fresh_breakers()
    bs.evaluator.fail()
    bs.evaluator.fail()
    bs.evaluator.fail()
    bs.compress.check()  # compress 未熔断，不应抛
