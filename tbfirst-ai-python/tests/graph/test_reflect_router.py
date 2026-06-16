"""B.7: reflect_router 测试。"""
from __future__ import annotations

import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from app.agent.graph.compression.circuit_breaker import get_breakers  # noqa: E402
from app.agent.graph.edges import MAX_REFLECT, _REFLECT_THRESHOLD, reflect_router  # noqa: E402


def run(coro):
    return asyncio.run(coro)


def _state(**kwargs) -> dict:
    return {
        "session_uuid": "u" * 32,
        "reflect_count": 0,
        "last_eval_score": 1.0,
        **kwargs,
    }


def _patch_flag(monkeypatch, enabled: bool):
    from app.config import Settings
    fake = Settings.model_construct(
        agent_reflect_enabled=enabled,
        agent_plan_enabled=False,
        agent_reflexion_enabled=False,
        agent_vector_memory_enabled=False,
        gemini_api_key="fake",
    )
    monkeypatch.setattr("app.config.get_settings", lambda: fake)
    try:
        from app.config import get_settings as _gs
        _gs.cache_clear()
    except AttributeError:
        pass


# ---------------------------------------------------------------------------
# 4 个 accept 触发条件 + 1 个 revise 条件
# ---------------------------------------------------------------------------


def test_accept_when_flag_off(monkeypatch):
    """条件1：reflect flag 关 → accept。"""
    _patch_flag(monkeypatch, False)
    result = run(reflect_router(_state(last_eval_score=0.3, reflect_count=0)))
    assert result == "accept"


def test_accept_when_reflect_count_at_limit(monkeypatch):
    """条件2：reflect_count >= MAX_REFLECT → accept（硬上限）。"""
    _patch_flag(monkeypatch, True)
    result = run(reflect_router(_state(last_eval_score=0.3, reflect_count=MAX_REFLECT)))
    assert result == "accept"


def test_accept_when_score_above_threshold(monkeypatch):
    """条件3：last_eval_score >= _REFLECT_THRESHOLD → accept。"""
    _patch_flag(monkeypatch, True)
    result = run(reflect_router(_state(last_eval_score=_REFLECT_THRESHOLD, reflect_count=0)))
    assert result == "accept"


def test_accept_when_evaluator_breaker_open(monkeypatch):
    """条件4：evaluator 熔断器 OPEN → accept。"""
    _patch_flag(monkeypatch, True)
    session = "reflect-router-open-" + "x" * 13
    bs = get_breakers(session)
    bs.evaluator.reset()
    bs.evaluator.fail()
    bs.evaluator.fail()
    bs.evaluator.fail()  # OPEN
    result = run(reflect_router(_state(last_eval_score=0.3, reflect_count=0, session_uuid=session)))
    assert result == "accept"
    bs.evaluator.reset()


def test_revise_when_conditions_unmet(monkeypatch):
    """低分 + flag 开 + 未封顶 + 熔断器 CLOSED → revise。"""
    _patch_flag(monkeypatch, True)
    session = "reflect-router-revise-" + "x" * 10
    bs = get_breakers(session)
    bs.evaluator.reset()
    result = run(reflect_router(_state(
        last_eval_score=0.5,
        reflect_count=0,
        session_uuid=session,
    )))
    assert result == "revise"


def test_max_reflect_constant():
    """MAX_REFLECT 常量值等于 2（硬预算不变量 4）。"""
    assert MAX_REFLECT == 2
