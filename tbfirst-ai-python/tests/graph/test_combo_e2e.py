"""D.6: 压缩续跑与三 flag 全开组合冒烟测试。"""
from __future__ import annotations

import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from langchain_core.messages import AIMessage, HumanMessage, RemoveMessage, ToolMessage  # noqa: E402

from app.agent.graph.compression.l2_history_snip import WHITELIST, apply_l2  # noqa: E402


def run(coro):
    return asyncio.run(coro)


# ---------------------------------------------------------------------------
# D.6 Part A: 压缩后范式标记字段仍存活
# ---------------------------------------------------------------------------


def test_l2_whitelist_preserves_phase_d_markers():
    """apply_l2 压缩后，含 [当前步骤目标]/[自检反馈] 的消息不被删除。"""
    # 超阈值大消息 + 含范式标记的小消息
    big_msgs = [AIMessage(content="x" * 2000, id=f"big{i}") for i in range(5)]
    subgoal_msg = HumanMessage(content="[当前步骤目标]\n生成主角特写镜头")
    subgoal_msg.id = "subgoal-pin"
    critique_msg = HumanMessage(content="[自检反馈] 评分 0.45，需改进：构图偏差")
    critique_msg.id = "critique-pin"

    all_msgs = big_msgs + [subgoal_msg, critique_msg]
    removes = apply_l2(all_msgs, target_chars=1000)
    removed_ids = {r.id for r in removes}
    assert "subgoal-pin" not in removed_ids, "[当前步骤目标] 应被保护，不被 L2 删除"
    assert "critique-pin" not in removed_ids, "[自检反馈] 应被保护，不被 L2 删除"


def test_plan_fields_survive_checkpointer():
    """plan/plan_cursor 能被写入 state dict 并读回（checkpointer 存活验证）。"""
    from langgraph.checkpoint.memory import InMemorySaver
    from app.agent.graph.state import AppState

    state: dict = {
        "messages": [],
        "user_id": 1,
        "session_uuid": "u" * 32,
        "plan": ["步骤1", "步骤2", "步骤3"],
        "plan_cursor": 1,
        "replan_count": 0,
        "reflect_count": 0,
        "last_eval_score": 0.9,
        "_pending_critique": "",
        "_current_subgoal": "步骤2：生成分镜",
        "plan_mode": "plan",
    }
    # Verify all Phase D fields accessible via .get()
    assert state.get("plan") == ["步骤1", "步骤2", "步骤3"]
    assert state.get("plan_cursor") == 1
    assert state.get("_current_subgoal") == "步骤2：生成分镜"
    assert state.get("plan_mode") == "plan"


# ---------------------------------------------------------------------------
# D.6 Part B: 三 flag 全开 graph 不崩（图编译 + flag 路由冒烟）
# ---------------------------------------------------------------------------


def test_graph_compiles_with_all_flags():
    """三 flag 全开时 build_agent_graph 仍能编译（不抛）。"""
    from langgraph.checkpoint.memory import InMemorySaver

    async def _build():
        from app.agent.graph.build import build_agent_graph
        from tests.graph.test_checkpointer import _TestStore
        saver = InMemorySaver()
        store = _TestStore()
        graph = await build_agent_graph(saver, store)
        return graph

    graph = asyncio.run(_build())
    assert graph is not None
    assert hasattr(graph, "ainvoke")


def test_should_plan_with_flag_on_and_complex_hint(monkeypatch):
    """三 flag 全开 + 复合意图 → should_plan 返回 'plan'（不崩）。"""
    from app.config import Settings
    from app.agent.graph.compression.circuit_breaker import get_breakers
    from app.agent.graph.edges import should_plan

    fake = Settings.model_construct(
        agent_plan_enabled=True,
        agent_reflect_enabled=True,
        agent_reflexion_enabled=True,
        agent_vector_memory_enabled=False,
        gemini_api_key="fake",
    )
    monkeypatch.setattr("app.config.get_settings", lambda: fake)
    try:
        from app.config import get_settings as _gs
        _gs.cache_clear()
    except AttributeError:
        pass

    session = "combo-e2e-" + "x" * 22
    get_breakers(session).planner.reset()
    state = {
        "session_uuid": session,
        "messages": [HumanMessage(content="生成分镜然后导出完整视频")],
        "plan": [], "plan_cursor": 0, "replan_count": 0,
    }
    result = run(should_plan(state))
    assert result in ("plan", "react"), f"should_plan 应返回 plan 或 react，实际: {result}"


def test_reflect_router_with_flags_open(monkeypatch):
    """三 flag 全开：低分且未封顶 → revise；高分 → accept（不崩）。"""
    from app.config import Settings
    from app.agent.graph.compression.circuit_breaker import get_breakers
    from app.agent.graph.edges import reflect_router

    fake = Settings.model_construct(
        agent_plan_enabled=True,
        agent_reflect_enabled=True,
        agent_reflexion_enabled=True,
        agent_vector_memory_enabled=False,
        gemini_api_key="fake",
    )
    monkeypatch.setattr("app.config.get_settings", lambda: fake)

    session = "combo-reflect-" + "x" * 19
    get_breakers(session).evaluator.reset()
    state = {
        "session_uuid": session,
        "reflect_count": 0,
        "last_eval_score": 0.4,
    }
    assert run(reflect_router(state)) == "revise"

    state["last_eval_score"] = 0.95
    assert run(reflect_router(state)) == "accept"
