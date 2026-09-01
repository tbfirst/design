"""C.7 / C.8: should_plan / plan_router / replan_router / after_reflect_accept 测试。"""
from __future__ import annotations

import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from langchain_core.messages import HumanMessage  # noqa: E402

from app.agent.graph.compression.circuit_breaker import get_breakers  # noqa: E402
from app.agent.graph.edges import (  # noqa: E402
    MAX_PLAN_STEPS,
    MAX_REPLAN,
    after_reflect_accept,
    plan_router,
    replan_router,
    should_plan,
)


def run(coro):
    return asyncio.run(coro)


def _state(**kw) -> dict:
    return {"session_uuid": "u" * 32, **kw}


def _patch_plan_flag(monkeypatch, enabled: bool):
    from app.config import Settings
    fake = Settings.model_construct(
        agent_plan_enabled=enabled,
        agent_reflect_enabled=False,
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
# C.7: should_plan
# ---------------------------------------------------------------------------


def test_should_plan_flag_off_returns_react(monkeypatch):
    """plan flag 关 → react。"""
    _patch_plan_flag(monkeypatch, False)
    state = _state(messages=[HumanMessage(content="生成图片然后导出")])
    assert run(should_plan(state)) == "react"


def test_should_plan_complex_hint_returns_plan(monkeypatch):
    """含"然后/流水线"等复合意图 → plan。"""
    _patch_plan_flag(monkeypatch, True)
    for hint in ["然后", "再", "接着", "整条流程", "流水线", "一键", "全流程"]:
        state = _state(messages=[HumanMessage(content=f"先做分析{hint}生成图片")])
        session = "plan-hint-" + hint.encode().hex()[:22]
        state["session_uuid"] = session
        get_breakers(session).planner.reset()
        assert run(should_plan(state)) == "plan", f"hint={hint!r} 应返回 plan"


def test_should_plan_short_task_returns_react(monkeypatch):
    """短任务（无复合意图词）→ react。"""
    _patch_plan_flag(monkeypatch, True)
    session = "short-task-" + "x" * 21
    get_breakers(session).planner.reset()
    state = _state(messages=[HumanMessage(content="生成一张猫的图片")], session_uuid=session)
    assert run(should_plan(state)) == "react"


def test_should_plan_pipeline_phase_returns_plan(monkeypatch):
    """pipeline phase (storyboard) → plan，无需关键词。"""
    _patch_plan_flag(monkeypatch, True)
    session = "pipeline-phase-" + "x" * 17
    get_breakers(session).planner.reset()
    state = _state(messages=[HumanMessage(content="做点事情")], phase="storyboard", session_uuid=session)
    assert run(should_plan(state)) == "plan"


def test_should_plan_breaker_open_returns_react(monkeypatch):
    """planner 熔断器 OPEN → react（不变量 3）。"""
    _patch_plan_flag(monkeypatch, True)
    session = "plan-breaker-open-" + "x" * 14
    bs = get_breakers(session)
    bs.planner.reset()
    bs.planner.fail()
    state = _state(
        messages=[HumanMessage(content="生成分镜然后导出视频")],
        session_uuid=session,
    )
    assert run(should_plan(state)) == "react"
    bs.planner.reset()


# ---------------------------------------------------------------------------
# C.8: plan_router
# ---------------------------------------------------------------------------


def test_plan_router_execute_when_cursor_lt_len():
    """cursor < len(plan) → execute。"""
    assert run(plan_router(_state(plan=["A", "B", "C"], plan_cursor=0))) == "execute"
    assert run(plan_router(_state(plan=["A", "B", "C"], plan_cursor=2))) == "execute"


def test_plan_router_done_when_cursor_at_end():
    """cursor >= len(plan) → done。"""
    assert run(plan_router(_state(plan=["A", "B"], plan_cursor=2))) == "done"
    assert run(plan_router(_state(plan=[], plan_cursor=0))) == "done"


# ---------------------------------------------------------------------------
# C.8: replan_router
# ---------------------------------------------------------------------------


def test_replan_router_done_when_replan_count_at_limit():
    """replan_count >= MAX_REPLAN → done（硬预算不变量 4）。"""
    state = _state(plan=["A", "B", "C"], plan_cursor=1, replan_count=MAX_REPLAN)
    assert run(replan_router(state)) == "done"


def test_replan_router_done_when_plan_exceeds_max_steps():
    """plan 超 MAX_PLAN_STEPS 步 → done。"""
    over_plan = [f"步骤{i}" for i in range(MAX_PLAN_STEPS + 1)]
    state = _state(plan=over_plan, plan_cursor=1, replan_count=0)
    assert run(replan_router(state)) == "done"


def test_replan_router_done_when_cursor_at_end():
    """cursor >= len(plan) → done。"""
    state = _state(plan=["A", "B"], plan_cursor=2, replan_count=0)
    assert run(replan_router(state)) == "done"


def test_replan_router_continue_normal():
    """正常情况 → continue。"""
    state = _state(plan=["A", "B", "C"], plan_cursor=1, replan_count=0)
    assert run(replan_router(state)) == "continue"


# ---------------------------------------------------------------------------
# C.8: after_reflect_accept
# ---------------------------------------------------------------------------


def test_after_reflect_accept_plan_mode_returns_replan(monkeypatch):
    """plan_mode='plan' + flag 开 + plan 非空 → replan。"""
    _patch_plan_flag(monkeypatch, True)
    assert run(after_reflect_accept(_state(plan_mode="plan", plan=["A", "B"]))) == "replan"


def test_after_reflect_accept_react_mode_returns_save(monkeypatch):
    """plan_mode='react' / None → save。"""
    _patch_plan_flag(monkeypatch, True)
    assert run(after_reflect_accept(_state(plan_mode="react"))) == "save"
    assert run(after_reflect_accept(_state())) == "save"


def test_after_reflect_accept_stale_plan_mode_returns_save(monkeypatch):
    """R4 fix：plan_mode='plan' 但 plan 列表为空 → 上轮残留，应路由 save 不触发 replan。"""
    _patch_plan_flag(monkeypatch, True)
    assert run(after_reflect_accept(_state(plan_mode="plan", plan=[]))) == "save"
    assert run(after_reflect_accept(_state(plan_mode="plan"))) == "save"


def test_after_reflect_accept_flag_off_returns_save(monkeypatch):
    """R4 fix：plan flag 关时 plan_mode='plan' 残留不触发 replan。"""
    _patch_plan_flag(monkeypatch, False)
    assert run(after_reflect_accept(_state(plan_mode="plan", plan=["A", "B"]))) == "save"


# ---------------------------------------------------------------------------
# 常量值（硬预算不变量 4）
# ---------------------------------------------------------------------------


def test_max_plan_steps_constant():
    assert MAX_PLAN_STEPS == 12


def test_max_replan_constant():
    assert MAX_REPLAN == 3


# ---------------------------------------------------------------------------
# D.4: planner 熔断降级
# ---------------------------------------------------------------------------


def test_plan_node_exception_calls_planner_fail(monkeypatch):
    """plan_node 异常 → 降级 react 且 planner.fail() 被调用，不上抛（不变量 3）。"""
    from langchain_core.messages import HumanMessage as HM
    from app.config import Settings
    import app.agent.graph.nodes as nodes_mod

    # 直接 patch nodes 模块里的 get_settings
    fake = Settings.model_construct(
        agent_plan_enabled=True,
        agent_reflect_enabled=False,
        agent_reflexion_enabled=False,
        agent_vector_memory_enabled=False,
        gemini_api_key="fake",
    )
    monkeypatch.setattr(nodes_mod, "get_settings", lambda: fake)

    class _RaiseLLM:
        async def ainvoke(self, prompt):
            raise RuntimeError("规划失败")

    monkeypatch.setattr(nodes_mod, "_planner_llm", lambda: _RaiseLLM())

    session = "planner-fail-test2-" + "x" * 13
    bs = get_breakers(session)
    bs.planner.reset()

    state = {
        "messages": [HM(content="生成分镜然后导出")],
        "user_id": 1,
        "session_uuid": session,
        "plan": [], "plan_cursor": 0, "replan_count": 0,
    }
    result = run(nodes_mod.plan_node(state))
    assert result.get("plan_mode") == "react"
    assert bs.planner.state.value == "open"


def test_should_plan_breaker_open_after_failure(monkeypatch):
    """planner breaker 打开后 should_plan 返回 react（降级生效）。"""
    _patch_plan_flag(monkeypatch, True)
    session = "planner-3fail-" + "x" * 18
    bs = get_breakers(session)
    bs.planner.reset()
    bs.planner.fail()

    state = _state(
        messages=[HumanMessage(content="生成分镜然后导出视频")],
        session_uuid=session,
    )
    assert run(should_plan(state)) == "react"
    bs.planner.reset()
