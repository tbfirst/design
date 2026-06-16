"""tools/executor.py 单元测试：只读并行 / 写独占 + FIFO + 并发上限 + 出口预算。

用 fake @tool（命名对齐真实 registry：knowledge_search=并发安全、image_gen=写独占），
通过共享计数器观测并发峰值，验证调度规则。
"""
from __future__ import annotations

import asyncio
import os
import sys

import pytest
from langchain_core.messages import AIMessage
from langchain_core.tools import tool

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from app.agent.graph.compression import l1_tool_budget as l1  # noqa: E402
from app.agent.graph.tools import budget as bud  # noqa: E402
from app.agent.graph.tools import executor as ex  # noqa: E402


def run(coro):
    return asyncio.run(coro)


def _cfg() -> dict:
    """构造含 Runtime 的最小 config（模拟真实图节点收到的 config，供 ToolNode 内部使用）。"""
    from langgraph.runtime import Runtime  # noqa: PLC0415

    return {"configurable": {"__pregel_runtime": Runtime()}}


class _Tracker:
    def __init__(self) -> None:
        self.active = 0
        self.peak = 0
        self.in_exclusive = False
        self.exclusive_overlap = False


def _call(name: str, tcid: str, **args) -> dict:
    return {"name": name, "args": args, "id": tcid, "type": "tool_call"}


def _ai(calls) -> AIMessage:
    return AIMessage(content="", tool_calls=calls)


# ── 调度：只读并行 / 写独占 ──────────────────────────────────────────────────

def test_read_parallel_write_serial_and_fifo():
    """2 个 knowledge_search 并行、1 个 image_gen 独占串行；结果按 FIFO 顺序。"""
    tr = _Tracker()

    @tool
    async def knowledge_search(q: str) -> dict:
        """read-safe fake"""
        tr.active += 1
        tr.peak = max(tr.peak, tr.active)
        if tr.in_exclusive:
            tr.exclusive_overlap = True
        await asyncio.sleep(0.05)
        tr.active -= 1
        return {"ok": True, "q": q}

    @tool
    async def image_gen(prompt: str) -> dict:
        """write fake"""
        if tr.active > 0:  # 启动时若已有他者在跑 → 违反独占
            tr.exclusive_overlap = True
        tr.in_exclusive = True
        tr.active += 1
        tr.peak = max(tr.peak, tr.active)
        await asyncio.sleep(0.05)
        tr.active -= 1
        tr.in_exclusive = False
        return {"ok": True, "prompt": prompt}

    node = ex.make_tool_executor_node([knowledge_search, image_gen])
    calls = [
        _call("knowledge_search", "k1", q="a"),
        _call("knowledge_search", "k2", q="b"),
        _call("image_gen", "i1", prompt="p"),
    ]
    state = {"messages": [_ai(calls)], "user_id": 1}
    out = run(node(state, _cfg()))

    msgs = out["messages"]
    # FIFO：顺序与数量与原始 tool_calls 一致
    assert [m.tool_call_id for m in msgs] == ["k1", "k2", "i1"]
    # 两个只读检索并行（峰值至少 2）
    assert tr.peak >= 2
    # image_gen 独占：从未与任何其他工具重叠
    assert tr.exclusive_overlap is False


def test_concurrency_cap_serializes_read_safe(monkeypatch):
    """上限设为 1 时，并发安全工具被信号量串行化（峰值=1）。"""
    monkeypatch.setattr(ex, "_MAX_TOOL_CONCURRENCY", 1)
    tr = _Tracker()

    @tool
    async def knowledge_search(q: str) -> dict:
        """read-safe fake"""
        tr.active += 1
        tr.peak = max(tr.peak, tr.active)
        await asyncio.sleep(0.02)
        tr.active -= 1
        return {"ok": True, "q": q}

    node = ex.make_tool_executor_node([knowledge_search])
    calls = [_call("knowledge_search", f"k{i}", q=str(i)) for i in range(4)]
    out = run(node({"messages": [_ai(calls)], "user_id": 1}, _cfg()))

    assert len(out["messages"]) == 4
    assert tr.peak == 1  # 限流到 1 → 无并发


def test_no_tool_calls_returns_empty():
    @tool
    async def knowledge_search(q: str) -> dict:
        """noop"""
        return {"ok": True}

    node = ex.make_tool_executor_node([knowledge_search])
    out = run(node({"messages": [AIMessage(content="hi")], "user_id": 1}, _cfg()))
    assert out == {"messages": []}


# ── 出口预算集成 ────────────────────────────────────────────────────────────

def test_large_result_offloaded_at_exit(tmp_path, monkeypatch):
    """单结果超过该工具 max_result_chars → 在 tools 节点出口即落盘成占位符。"""
    d = tmp_path / "tool_results"
    monkeypatch.setattr(l1, "_CACHE_DIR", d)
    monkeypatch.setattr(bud, "_CACHE_DIR", d)

    big = "x" * 80_000  # image_gen 阈值 20K → 必落盘

    @tool
    async def image_gen(prompt: str) -> str:
        """returns oversized payload"""
        return big

    node = ex.make_tool_executor_node([image_gen])
    calls = [_call("image_gen", "huge1", prompt="p")]
    out = run(node({"messages": [_ai(calls)], "user_id": 1}, _cfg()))

    m = out["messages"][0]
    assert isinstance(m.content, str)
    assert m.content.startswith(l1._PLACEHOLDER)
    # 完整原文可经 read_cached 找回
    assert l1.read_cached("huge1") == big
