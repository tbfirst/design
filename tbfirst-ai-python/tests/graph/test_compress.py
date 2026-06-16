"""V6.M2.D.7 → V6.Compress: compress_state_node 单元测试（V6.Compress 级联版）。

V6.Compress 将 compress_state_node 替换为 cascade_compress_node（L1-L4 级联）：
  - 触发条件从消息数改为字符比例（≥60% of 400k）
  - L1: >20k chars ToolMessage → 缓存并替换为占位
  - L2: 历史裁剪（pair-aware RemoveMessage）
  - L3/L4: 高水位级联

case（与 V6.M2 保持同名、保持 spirit，更新实现）：
  1. test_no_compress_under_threshold — 小消息 → 比例 << 0.60 → return {}
  2. test_compress_triggers_at_21 — 超阈值消息 → L1 触发 → messages 字段非空
  3. test_compress_idempotent — 比例 < 0.60 → 始终 return {}（比例守护）
  4. test_input_token_reduction_at_least_50pct — 大 ToolMessage → L1 压缩节省 ≥ 50%
"""
from __future__ import annotations

import asyncio
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from langchain_core.messages import AIMessage, HumanMessage, RemoveMessage, ToolMessage  # noqa: E402

from app.agent.graph import nodes  # noqa: E402
import app.agent.graph.compression as compression_ns  # noqa: E402


# -----------------------------------------------------------------------------
# helpers
# -----------------------------------------------------------------------------

_SMALL = 100       # chars per message — well below L1 threshold
_LARGE = 25_000    # chars per message — exceeds L1 20k threshold


def _small_msgs(n: int):
    """n 条小消息，字符总量远低于 60% 水位。"""
    out = []
    for i in range(n):
        cls = HumanMessage if i % 2 == 0 else AIMessage
        out.append(cls(content="X" * _SMALL, id=f"m{i}"))
    return out


def _large_tool_msgs(n: int):
    """n 条 ToolMessage，每条 _LARGE 字符，可触发 L1。"""
    out = []
    for i in range(n):
        out.append(ToolMessage(content="T" * _LARGE, tool_call_id=f"tc{i}", id=f"t{i}"))
    return out


def _setup_mocks(monkeypatch):
    """重置该 session 的熔断器（防止跨测试 OPEN 状态污染）。"""
    from app.agent.graph.compression.circuit_breaker import get_breakers
    bs = get_breakers("u" * 32)
    bs.compress.reset()
    bs.dependency.reset()
    bs.tool.reset()


def _state(messages, **extra):
    s = {"messages": messages, "user_id": 1, "session_uuid": "u" * 32}
    s.update(extra)
    return s


# -----------------------------------------------------------------------------
# tests
# -----------------------------------------------------------------------------


def test_no_compress_under_threshold(monkeypatch):
    """小消息（字符比例 << 0.60）→ 不压缩，return {}。"""
    _setup_mocks(monkeypatch)
    # 18 messages × 100 chars = 1800 chars << 240,000 (60% of 400k)
    out = asyncio.run(nodes.compress_state_node(_state(_small_msgs(18))))
    assert out == {}


def test_compress_triggers_at_21(monkeypatch):
    """超阈值消息 → cascade 触发 → messages 字段包含 RemoveMessage。"""
    _setup_mocks(monkeypatch)
    # 10 large ToolMessages × 25000 chars = 250,000 chars > 240,000 (60%)
    msgs = _large_tool_msgs(10)
    out = asyncio.run(nodes.compress_state_node(_state(msgs)))

    assert "messages" in out, "cascade should return messages dict"
    removes = [m for m in out["messages"] if isinstance(m, RemoveMessage)]
    assert len(removes) > 0, "cascade L1 should produce RemoveMessages"
    assert out.get("last_compress_at_msg_id") == len(msgs)


def test_compress_idempotent(monkeypatch):
    """字符比例不足时（< 0.60）始终 return {}，无法重复触发。"""
    _setup_mocks(monkeypatch)
    # 即使消息数 > 25，字符数少 → 比例守护有效
    out = asyncio.run(
        nodes.compress_state_node(_state(_small_msgs(25), last_compress_at_msg_id=20))
    )
    assert out == {}


def test_input_token_reduction_at_least_50pct(monkeypatch):
    """L1 压缩后，ToolMessage 字符总量较压缩前降 ≥ 50%。

    构造 10 条大 ToolMessage（各 25k chars），L1 将其替换为 '[TOOL_RESULT_CACHED]'（16 chars），
    压缩前 250k 字符 → 压缩后 160 字符，节省 99.9% >> 50%。
    """
    _setup_mocks(monkeypatch)

    msgs = _large_tool_msgs(10)
    original_chars = sum(len(m.content) for m in msgs)

    out = asyncio.run(nodes.compress_state_node(_state(msgs)))

    assert "messages" in out
    removes = [m for m in out["messages"] if isinstance(m, RemoveMessage)]
    new_tools = [m for m in out["messages"] if isinstance(m, ToolMessage)]

    removed_ids = {r.id for r in removes}
    survivors = [m for m in msgs if m.id not in removed_ids]
    compressed_chars = (
        sum(len(m.content) for m in survivors)
        + sum(len(m.content) for m in new_tools)
    )

    reduction = 1 - compressed_chars / original_chars
    assert reduction >= 0.5, f"token 节省应 ≥ 50%，实际 {reduction:.1%}"
