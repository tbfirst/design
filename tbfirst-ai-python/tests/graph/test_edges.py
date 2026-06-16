"""F.4: edges.py MAX_TURNS / tools_or_max_turns テスト。

tools_or_max_turns は async なので asyncio.run() で実行する。
"""
from __future__ import annotations

import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from langchain_core.messages import AIMessage, HumanMessage, ToolMessage  # noqa: E402

from app.agent.graph.edges import (  # noqa: E402
    MAX_REFLECT,
    MAX_TURNS,
    _MAX_TURNS_PIPELINE,
    _PIPELINE_PHASES,
    _REFLECT_THRESHOLD,
    max_turns_for,
    route_after_save,
    tools_or_max_turns,
)


def run(coro):
    return asyncio.run(coro)


def _ai_with_tools(tool_call_id: str = "tc1") -> AIMessage:
    return AIMessage(
        content="",
        tool_calls=[{"id": tool_call_id, "name": "web_search", "args": {"query": "test"}}],
    )


def _tool_msg(tool_call_id: str = "tc1") -> ToolMessage:
    return ToolMessage(content="result", tool_call_id=tool_call_id)


# ---------------------------------------------------------------------------
# tests
# ---------------------------------------------------------------------------


def test_max_turns_value_is_8():
    assert MAX_TURNS == 8


def test_no_tool_calls_returns_end():
    """最後のメッセージが tool_calls 無しの AIMessage → '__end__'。"""
    state = {
        "messages": [
            HumanMessage(content="hello"),
            AIMessage(content="Hi there"),
        ]
    }
    assert run(tools_or_max_turns(state)) == "__end__"


def test_has_tool_calls_under_limit_returns_tools():
    """tool_calls ありで轮次 < MAX_TURNS → 'tools'。"""
    msgs = [HumanMessage(content="search")]
    for i in range(3):
        msgs.append(_ai_with_tools(f"tc{i}"))
        msgs.append(_tool_msg(f"tc{i}"))
    # 最後に tool_calls を持つ AIMessage を追加（4 轮目）
    msgs.append(_ai_with_tools("tc_new"))

    state = {"messages": msgs}
    assert run(tools_or_max_turns(state)) == "tools"


def test_hit_max_turns_returns_max_turns_end():
    """tool 轮次が MAX_TURNS に達したら 'max_turns_end'。"""
    msgs = [HumanMessage(content="start")]
    for i in range(MAX_TURNS):
        msgs.append(_ai_with_tools(f"tc{i}"))
        msgs.append(_tool_msg(f"tc{i}"))
    # MAX_TURNS 回分の AI+Tool が終わった後、もう 1 回 tool_calls を持つ AI
    msgs.append(_ai_with_tools("tc_over"))

    state = {"messages": msgs}
    assert run(tools_or_max_turns(state)) == "max_turns_end"


def test_empty_messages_returns_end():
    """messages が空の場合は '__end__'。"""
    assert run(tools_or_max_turns({"messages": []})) == "__end__"


# ---------------------------------------------------------------------------
# A.3: max_turns_for 动态轮数
# ---------------------------------------------------------------------------


def test_max_turns_for_unknown_phase_fallback():
    """未知 phase → 兜底 MAX_TURNS=8。"""
    assert max_turns_for({"phase": None}) == MAX_TURNS
    assert max_turns_for({"phase": "unknown_phase"}) == MAX_TURNS
    assert max_turns_for({}) == MAX_TURNS


def test_max_turns_for_chat_phase():
    """chat phase → 4 轮。"""
    assert max_turns_for({"phase": "chat"}) == 4


def test_max_turns_for_pipeline_phase():
    """pipeline phase（storyboard/cinestitch 等）→ _MAX_TURNS_PIPELINE=12。"""
    for phase in _PIPELINE_PHASES:
        assert max_turns_for({"phase": phase}) == _MAX_TURNS_PIPELINE, f"phase={phase!r} 应返回 12"


def test_tools_or_max_turns_respects_pipeline_limit():
    """storyboard phase 时，MAX_TURNS（8）内仍可继续，须到 12 才 max_turns_end。"""
    msgs = [HumanMessage(content="生成分镜")]
    for i in range(MAX_TURNS):  # 8 轮
        msgs.append(_ai_with_tools(f"tc{i}"))
        msgs.append(_tool_msg(f"tc{i}"))
    msgs.append(_ai_with_tools("tc_still"))

    state = {"messages": msgs, "phase": "storyboard"}
    # 8 轮时 storyboard 还未到上限（12），应继续
    assert run(tools_or_max_turns(state)) == "tools"


# ---------------------------------------------------------------------------
# D.2: route_after_save Reflexion 触发
# ---------------------------------------------------------------------------


def _patch_reflexion_flag(monkeypatch, enabled: bool):
    from app.config import Settings
    fake = Settings.model_construct(
        agent_reflexion_enabled=enabled,
        agent_reflect_enabled=False,
        agent_plan_enabled=False,
        agent_vector_memory_enabled=False,
        gemini_api_key="fake",
    )
    monkeypatch.setattr("app.config.get_settings", lambda: fake)
    try:
        from app.config import get_settings as _gs
        _gs.cache_clear()
    except AttributeError:
        pass


def test_route_after_save_reflexion_on_failure(monkeypatch):
    """含否定词且 reflexion flag 开 → reflexion_write 分支。"""
    _patch_reflexion_flag(monkeypatch, True)
    state = {
        "messages": [HumanMessage(content="不对，重来")],
        "reflect_count": MAX_REFLECT,
        "last_eval_score": _REFLECT_THRESHOLD - 0.1,
        "last_compress_at_msg_id": None,
        "last_extract_at_msg_id": None,
    }
    assert run(route_after_save(state)) == "reflexion_write"


def test_route_after_save_reflexion_flag_off_original_branch(monkeypatch):
    """reflexion flag 关 → 原有分支不变（compress/extract/end）。"""
    _patch_reflexion_flag(monkeypatch, False)
    state = {
        "messages": [HumanMessage(content="不对，重来")],
        "reflect_count": MAX_REFLECT,
        "last_eval_score": 0.1,
        "last_compress_at_msg_id": None,
        "last_extract_at_msg_id": None,
    }
    result = run(route_after_save(state))
    assert result in ("compress", "extract", "end"), f"flag 关时应走原分支，实际: {result}"
