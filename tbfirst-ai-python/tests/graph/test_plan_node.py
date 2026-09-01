"""C.4 / C.5 / C.6: plan_node / execute_step / replan_node 测试。"""
from __future__ import annotations

import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from langchain_core.messages import HumanMessage, ToolMessage  # noqa: E402
import pytest  # noqa: E402

from app.agent.graph.compression.circuit_breaker import get_breakers  # noqa: E402
from app.agent.graph.nodes import execute_step, plan_node, replan_node  # noqa: E402


def run(coro):
    return asyncio.run(coro)


@pytest.fixture(autouse=True)
def _reset_planner_breaker():
    breaker = get_breakers("u" * 32).planner
    breaker.reset()
    yield
    breaker.reset()


def _base_state(**overrides) -> dict:
    return {
        "messages": [HumanMessage(content="生成一套分镜然后导出视频")],
        "user_id": 1,
        "session_uuid": "u" * 32,
        "plan": [],
        "plan_cursor": 0,
        "replan_count": 0,
        "reflect_count": 0,
        **overrides,
    }


class _FakeLLMResp:
    def __init__(self, content: str):
        self.content = content


def _patch_plan_flag(monkeypatch, enabled: bool):
    from app.config import Settings
    fake = Settings.model_construct(
        agent_plan_enabled=enabled,
        agent_reflect_enabled=False,
        agent_reflexion_enabled=False,
        agent_vector_memory_enabled=False,
        gemini_api_key="fake",
    )
    monkeypatch.setattr("app.agent.graph.nodes.get_settings", lambda: fake)
    monkeypatch.setattr("app.config.get_settings", lambda: fake)
    try:
        from app.config import get_settings as _gs
        _gs.cache_clear()
    except AttributeError:
        pass


def _patch_planner_llm(monkeypatch, resp_content: str):
    """patch _planner_llm() 返回固定响应。"""
    import app.agent.graph.nodes as nodes_mod

    async def fake_invoke(prompt):
        return _FakeLLMResp(resp_content)

    class _FakeLLM:
        async def ainvoke(self, prompt):
            return await fake_invoke(prompt)

    monkeypatch.setattr(nodes_mod, "_planner_llm", lambda: _FakeLLM())


# ---------------------------------------------------------------------------
# C.4: plan_node
# ---------------------------------------------------------------------------


def test_plan_node_flag_off_returns_react(monkeypatch):
    """plan flag 关 → plan_mode='react'，不调用 LLM。"""
    _patch_plan_flag(monkeypatch, False)
    result = run(plan_node(_base_state()))
    assert result.get("plan_mode") == "react"


def test_plan_node_parses_steps(monkeypatch):
    """LLM 返回步骤 JSON → plan 非空、plan_cursor=0、plan_mode='plan'。"""
    _patch_plan_flag(monkeypatch, True)
    _patch_planner_llm(monkeypatch, '["步骤1：分析需求", "步骤2：生成分镜", "步骤3：导出视频"]')
    result = run(plan_node(_base_state()))
    assert result.get("plan_mode") == "plan"
    assert len(result.get("plan", [])) == 3
    assert result.get("plan_cursor") == 0
    assert result.get("replan_count") == 0


def test_plan_node_llm_exception_degrades(monkeypatch):
    """LLM 异常 → 降级 plan_mode='react'，不抛（不变量 3）。"""
    _patch_plan_flag(monkeypatch, True)
    import app.agent.graph.nodes as nodes_mod

    class _RaiseLLM:
        async def ainvoke(self, prompt):
            raise RuntimeError("LLM 不可用")

    monkeypatch.setattr(nodes_mod, "_planner_llm", lambda: _RaiseLLM())
    result = run(plan_node(_base_state()))
    assert result.get("plan_mode") == "react"


def test_plan_node_invalid_json_degrades(monkeypatch):
    """LLM 返回非 JSON → 降级 plan_mode='react'。"""
    _patch_plan_flag(monkeypatch, True)
    _patch_planner_llm(monkeypatch, "这不是 JSON 格式")
    result = run(plan_node(_base_state()))
    assert result.get("plan_mode") == "react"


# ---------------------------------------------------------------------------
# C.5: execute_step
# ---------------------------------------------------------------------------


def test_execute_step_sets_subgoal():
    """execute_step → _current_subgoal == plan[plan_cursor]。"""
    state = _base_state(plan=["步骤A", "步骤B", "步骤C"], plan_cursor=1, reflect_count=2)
    result = run(execute_step(state))
    assert result.get("_current_subgoal") == "步骤B"


def test_execute_step_resets_reflect_count():
    """execute_step → reflect_count 重置为 0。"""
    state = _base_state(plan=["步骤A", "步骤B"], plan_cursor=0, reflect_count=2)
    result = run(execute_step(state))
    assert result.get("reflect_count") == 0


def test_execute_step_cursor_zero():
    """execute_step cursor=0 → _current_subgoal == plan[0]。"""
    state = _base_state(plan=["首步骤"], plan_cursor=0)
    result = run(execute_step(state))
    assert result.get("_current_subgoal") == "首步骤"


# ---------------------------------------------------------------------------
# C.6: replan_node
# ---------------------------------------------------------------------------


def test_replan_node_increments_cursor_and_count(monkeypatch):
    """replan_node → plan_cursor+1、replan_count+1。"""
    _patch_planner_llm(monkeypatch, '["步骤A", "步骤B新", "步骤C新"]')
    state = _base_state(plan=["步骤A", "步骤B", "步骤C"], plan_cursor=0, replan_count=0)
    result = run(replan_node(state))
    assert result.get("plan_cursor") == 1
    assert result.get("replan_count") == 1


def test_replan_node_completes_when_cursor_reaches_end(monkeypatch):
    """cursor+1 >= len(plan) → plan_cursor 达到 len(plan)，任务完成。"""
    _patch_planner_llm(monkeypatch, '["步骤A", "步骤B"]')
    state = _base_state(plan=["步骤A", "步骤B"], plan_cursor=1, replan_count=0)
    result = run(replan_node(state))
    assert result.get("plan_cursor") == 2  # == len(plan)
    assert result.get("replan_count") == 1


def test_replan_node_updates_plan_from_llm(monkeypatch):
    """LLM 返回新步骤列表 → plan 被更新。"""
    _patch_planner_llm(monkeypatch, '["步骤A", "新步骤B", "新步骤C", "新步骤D"]')
    state = _base_state(
        plan=["步骤A", "步骤B", "步骤C"],
        plan_cursor=0,
        replan_count=0,
        messages=[
            HumanMessage(content="继续"),
            ToolMessage(content="工具执行完毕", tool_call_id="tc1"),
        ],
    )
    result = run(replan_node(state))
    assert result.get("plan") is not None
    assert len(result["plan"]) == 4


def test_replan_node_exception_still_increments(monkeypatch):
    """LLM 异常 → cursor 仍递增，不抛异常（不变量 3）。"""
    import app.agent.graph.nodes as nodes_mod

    class _RaiseLLM:
        async def ainvoke(self, prompt):
            raise RuntimeError("规划失败")

    monkeypatch.setattr(nodes_mod, "_planner_llm", lambda: _RaiseLLM())
    state = _base_state(plan=["步骤A", "步骤B", "步骤C"], plan_cursor=0, replan_count=1)
    result = run(replan_node(state))
    assert result.get("plan_cursor") == 1
    assert result.get("replan_count") == 2
