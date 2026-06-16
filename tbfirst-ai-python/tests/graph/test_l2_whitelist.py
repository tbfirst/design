"""C.10: l2_history_snip WHITELIST 追加范式标记测试。"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from langchain_core.messages import AIMessage, HumanMessage, ToolMessage  # noqa: E402

from app.agent.graph.compression.l2_history_snip import WHITELIST, apply_l2  # noqa: E402


def _msg(content: str, mid: str = "m1") -> HumanMessage:
    m = HumanMessage(content=content)
    m.id = mid
    return m


def test_whitelist_contains_phase_d_markers():
    """WHITELIST 包含 [自检反馈] 和 [当前步骤目标]（C.10 要求）。"""
    assert "[自检反馈]" in WHITELIST
    assert "[当前步骤目标]" in WHITELIST


def test_self_check_message_pinned_not_deleted():
    """含 [自检反馈] 的消息在 apply_l2 中被 _pinned，不被删除。"""
    from app.agent.graph.compression.l2_history_snip import _pinned

    msg = HumanMessage(content="[自检反馈] 评分 0.50，需改进：构图偏差")
    msg.id = "pinned-critique"
    assert _pinned(msg), "[自检反馈] 消息应被 _pinned 保护"

    # 放到超阈值消息列表中，确认不被删除
    big_msg = AIMessage(content="x" * 5000, id="big1")
    msgs = [big_msg, msg]
    removes = apply_l2(msgs, target_chars=100)
    removed_ids = {r.id for r in removes}
    assert "pinned-critique" not in removed_ids, "[自检反馈] 消息不应被 L2 删除"


def test_subgoal_message_pinned_not_deleted():
    """含 [当前步骤目标] 的消息在 apply_l2 中被 _pinned，不被删除。"""
    from app.agent.graph.compression.l2_history_snip import _pinned

    msg = HumanMessage(content="[当前步骤目标]\n生成分镜首帧")
    msg.id = "pinned-subgoal"
    assert _pinned(msg), "[当前步骤目标] 消息应被 _pinned 保护"

    big_msg = AIMessage(content="y" * 5000, id="big2")
    msgs = [big_msg, msg]
    removes = apply_l2(msgs, target_chars=100)
    removed_ids = {r.id for r in removes}
    assert "pinned-subgoal" not in removed_ids, "[当前步骤目标] 消息不应被 L2 删除"


def test_existing_l2_behavior_unchanged():
    """普通大消息仍可被 L2 删除（现有行为不变）。"""
    big = AIMessage(content="z" * 5000, id="big3")
    small = HumanMessage(content="短消息", id="small1")
    small.id = "small1"
    removes = apply_l2([big, small], target_chars=100)
    removed_ids = {r.id for r in removes}
    assert "big3" in removed_ids, "普通大消息应被 L2 删除"
