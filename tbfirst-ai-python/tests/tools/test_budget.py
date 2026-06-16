"""tools/budget.py 单元测试：单结果出口预算 + 单轮聚合上限。

落盘目录通过 monkeypatch 重定向到 tmp_path，避免污染真实 .cache/tool_results。
"""
from __future__ import annotations

import os
import sys

import pytest
from langchain_core.messages import ToolMessage

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from app.agent.graph.compression import l1_tool_budget as l1  # noqa: E402
from app.agent.graph.tools import budget as bud  # noqa: E402
from app.agent.graph.tools.registry import spec_of  # noqa: E402


@pytest.fixture
def tmp_cache(tmp_path, monkeypatch):
    """把 budget 与 l1 的缓存目录都指向 tmp_path（两边引用须一致才能 round-trip）。"""
    d = tmp_path / "tool_results"
    monkeypatch.setattr(l1, "_CACHE_DIR", d)
    monkeypatch.setattr(bud, "_CACHE_DIR", d)
    return d


def test_under_budget_returns_unchanged(tmp_cache):
    content = "x" * 100  # 远小于任何工具阈值
    out = bud.enforce_result_budget("memory_inspector", "tc-small", content)
    assert out is content  # 同一对象，未落盘


def test_over_budget_offloads_and_recoverable(tmp_cache):
    cap = spec_of("memory_inspector").max_result_chars  # 40_000
    content = "y" * (cap + 5_000)
    out = bud.enforce_result_budget("memory_inspector", "tc-big", content)

    assert isinstance(out, str)
    assert out.startswith(l1._PLACEHOLDER)
    assert "tc-big" in out
    # 完整原文应可经 read_cached 凭 tool_call_id 找回
    assert l1.read_cached("tc-big") == content


def test_already_placeholder_not_reoffloaded(tmp_cache):
    placeholder = l1._build_placeholder("tc-x", "z" * 999_999)
    out = bud.enforce_result_budget("memory_inspector", "tc-x", placeholder)
    assert out is placeholder  # 占位符不再二次落盘


def test_turn_budget_caps_aggregate(tmp_cache):
    # 每条 90K < web_search 单结果阈值(100K) → 单结果预算不触发；3 条合计 270K > 200K
    msgs = [
        ToolMessage(content="a" * 90_000, tool_call_id="agg0", name="web_search"),
        ToolMessage(content="b" * 90_000, tool_call_id="agg1", name="web_search"),
        ToolMessage(content="c" * 90_000, tool_call_id="agg2", name="web_search"),
    ]
    out = bud.enforce_turn_budget(msgs)

    total = sum(bud._content_chars(m.content) for m in out)
    assert total <= bud._MAX_TOOL_RESULTS_PER_TURN_CHARS
    # 至少一条被落盘成占位符，且可找回
    placeholders = [m for m in out if bud._is_placeholder(m.content)]
    assert len(placeholders) >= 1
    assert l1.read_cached(placeholders[0].tool_call_id) is not None
    # 顺序与数量保持不变（FIFO）
    assert [m.tool_call_id for m in out] == ["agg0", "agg1", "agg2"]


def test_turn_budget_noop_when_under(tmp_cache):
    msgs = [ToolMessage(content="small", tool_call_id="s0", name="web_search")]
    out = bud.enforce_turn_budget(msgs)
    assert out[0].content == "small"
