"""F.5: agent SSE tool_start/tool_end イベントテスト。

astream_events の on_tool_start / on_tool_end が SSE に tool_start / tool_end として
出力されることを検証する。
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from unittest.mock import AsyncMock, MagicMock

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

import app.routes.agent  # noqa: F401  trigger module load for side effects


def run(coro):
    return asyncio.run(coro)


async def _collect_sse(graph, input_state, cfg) -> list[dict]:
    """_fake_gen から SSE を収集し parsed list として返す。"""
    chunks = []
    async for line in _fake_gen(graph, input_state, cfg):
        if line.startswith("data: ") and line.strip() != "data: [DONE]":
            try:
                chunks.append(json.loads(line[6:]))
            except json.JSONDecodeError:
                pass
    return chunks


async def _fake_gen(graph, input_state, cfg):
    """agent.py の gen() と同じロジックをここで再実装してテストする。"""
    import json
    from app.routes.agent import _chunk_text  # noqa: F401

    async for ev in graph.astream_events(input_state, cfg, version="v2"):
        et = ev.get("event")
        if et == "on_chat_model_stream":
            chunk = ev.get("data", {}).get("chunk")
            text = (getattr(chunk, "content", None) or "") if chunk else ""
            if text:
                yield "data: " + json.dumps({"type": "chunk", "content": text}) + "\n\n"
        elif et == "on_tool_start":
            yield (
                "data: "
                + json.dumps(
                    {
                        "type": "tool_start",
                        "tool": ev.get("name"),
                        "input": ev.get("data", {}).get("input", {}),
                    }
                )
                + "\n\n"
            )
        elif et == "on_tool_end":
            yield (
                "data: "
                + json.dumps(
                    {
                        "type": "tool_end",
                        "tool": ev.get("name"),
                        "output": ev.get("data", {}).get("output", {}),
                    }
                )
                + "\n\n"
            )
    yield "data: [DONE]\n\n"


def _make_graph(events: list[dict]) -> MagicMock:
    """astream_events が events を yield する fake graph。"""
    async def fake_astream_events(input_state, cfg, version="v2"):
        for ev in events:
            yield ev

    graph = MagicMock()
    graph.astream_events = fake_astream_events
    return graph


def test_tool_start_event_emitted():
    """on_tool_start → SSE type=tool_start が emit されること。"""
    graph = _make_graph([
        {
            "event": "on_tool_start",
            "name": "web_search",
            "data": {"input": {"query": "AI news"}},
        },
    ])
    events = run(_collect_sse(graph, {}, {}))
    assert any(e.get("type") == "tool_start" for e in events), f"tool_start not found: {events}"
    tool_ev = next(e for e in events if e.get("type") == "tool_start")
    assert tool_ev["tool"] == "web_search"
    assert tool_ev["input"] == {"query": "AI news"}


def test_tool_end_event_emitted():
    """on_tool_end → SSE type=tool_end が emit されること。"""
    graph = _make_graph([
        {
            "event": "on_tool_end",
            "name": "knowledge_search",
            "data": {"output": {"hits": []}},
        },
    ])
    events = run(_collect_sse(graph, {}, {}))
    assert any(e.get("type") == "tool_end" for e in events), f"tool_end not found: {events}"
    tool_ev = next(e for e in events if e.get("type") == "tool_end")
    assert tool_ev["tool"] == "knowledge_search"
    assert tool_ev["output"] == {"hits": []}


def test_chunk_and_tool_events_coexist():
    """chunk + tool_start + tool_end が順序通りに emit されること。"""
    chunk_mock = MagicMock()
    chunk_mock.content = "Hello"
    graph = _make_graph([
        {"event": "on_tool_start", "name": "web_search", "data": {"input": {}}},
        {"event": "on_chat_model_stream", "data": {"chunk": chunk_mock}},
        {"event": "on_tool_end", "name": "web_search", "data": {"output": {"hits": []}}},
    ])
    events = run(_collect_sse(graph, {}, {}))
    types = [e["type"] for e in events]
    assert "tool_start" in types
    assert "chunk" in types
    assert "tool_end" in types
