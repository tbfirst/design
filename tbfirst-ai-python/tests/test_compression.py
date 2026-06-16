"""Unit tests for Sprint V6.Compress cascade compression modules."""
from __future__ import annotations

import pytest
from langchain_core.messages import AIMessage, RemoveMessage, ToolMessage

from app.agent.graph.compression.l1_tool_budget import apply_l1
from app.agent.graph.compression.l2_history_snip import apply_l2


def test_l1_large_tool_message():
    """apply_l1 should cache >20000 char ToolMessage and return RemoveMessage + replacement."""
    msg = ToolMessage(content="x" * 25000, tool_call_id="t1", id="m1")
    new_tools, removes = apply_l1([msg])

    remove_ids = [r.id for r in removes]
    assert "m1" in remove_ids, f"Expected RemoveMessage(id='m1') in removes, got {remove_ids}"
    assert len(new_tools) == 1
    assert "[TOOL_RESULT_CACHED]" in new_tools[0].content
    assert new_tools[0].tool_call_id == "t1"


def test_l1_small_tool_message_skipped():
    """apply_l1 should not touch ToolMessages <= 20000 chars."""
    msg = ToolMessage(content="x" * 100, tool_call_id="t2", id="m2")
    new_tools, removes = apply_l1([msg])
    assert removes == []
    assert new_tools == []


def test_l2_pair_delete():
    """apply_l2 should delete AIMessage + paired ToolMessage together."""
    ai = AIMessage(content="", tool_calls=[{"id": "tc1", "name": "x", "args": {}}], id="a1")
    tm = ToolMessage(tool_call_id="tc1", id="t1", content="data")
    removes = apply_l2([ai, tm], target_chars=0)

    ids = [r.id for r in removes]
    assert "a1" in ids, f"Expected 'a1' in removes, got {ids}"
    assert "t1" in ids, f"Expected 't1' in removes, got {ids}"


def test_l2_no_remove_when_below_target():
    """apply_l2 should not remove anything if already below target."""
    ai = AIMessage(content="hello", id="a1")
    removes = apply_l2([ai], target_chars=1_000_000)
    assert removes == []


def test_l2_removes_oldest_first():
    """apply_l2 removes from the oldest messages first."""
    msgs = [AIMessage(content="a" * 1000, id=f"m{i}") for i in range(5)]
    removes = apply_l2(msgs, target_chars=2000)
    ids = [r.id for r in removes]
    # Should remove m0, m1, m2 (3 x 1000 = 3000 removed, 5000-3000=2000 <= 2000)
    assert "m0" in ids
    assert "m1" in ids
    assert "m4" not in ids
