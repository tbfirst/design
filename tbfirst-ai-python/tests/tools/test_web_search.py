"""F.3: web_search tool 单元测试。

验证：happy path（GeminiProvider mock）、provider 失败（返空 hits 不抛）。
"""
from __future__ import annotations

import asyncio
import importlib
import os
import sys
from unittest.mock import AsyncMock, MagicMock

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

importlib.import_module("app.agent.graph.tools.web_search")
ws_ns = sys.modules["app.agent.graph.tools.web_search"]
from app.agent.graph.tools.web_search import web_search  # noqa: E402


def run(coro):
    return asyncio.run(coro)


def _make_fake_resp(hits: list[dict]):
    """grounding_metadata.grounding_chunks を持つ fake resp を作る。"""
    chunks = []
    for h in hits:
        web = MagicMock()
        web.title = h.get("title")
        web.uri = h.get("uri")
        web.snippet = h.get("snippet")
        chunk = MagicMock()
        chunk.web = web
        chunks.append(chunk)

    meta = MagicMock()
    meta.grounding_chunks = chunks
    candidate = MagicMock()
    candidate.grounding_metadata = meta
    resp = MagicMock()
    resp.candidates = [candidate]
    return resp


def test_happy_path_returns_hits(monkeypatch: pytest.MonkeyPatch):
    """asyncio.to_thread mock が grounding_chunks を返す場合、hits に変換されること。"""
    fake_resp = _make_fake_resp([
        {"title": "Title A", "uri": "https://a.com", "snippet": "Snippet A"},
        {"title": "Title B", "uri": "https://b.com", "snippet": "Snippet B"},
    ])

    monkeypatch.setattr(ws_ns, "get_settings", lambda: MagicMock(gemini_api_key="test-key"))

    # Mock google.genai so the import in web_search doesn't fail
    google_mock = MagicMock()
    genai_mock = MagicMock()
    genai_mock.Client.return_value = MagicMock()
    google_mock.genai = genai_mock
    sys.modules["google"] = google_mock
    sys.modules["google.genai"] = genai_mock
    sys.modules["google.genai.types"] = MagicMock()

    # Mock asyncio.to_thread to return fake_resp synchronously
    async def fake_to_thread(fn, *args, **kwargs):
        return fake_resp

    monkeypatch.setattr(ws_ns.asyncio, "to_thread", fake_to_thread)

    result = run(web_search.ainvoke({"query": "latest AI news"}))

    assert result["ok"] is True
    assert "hits" in result
    assert result["query"] == "latest AI news"
    assert len(result["hits"]) == 2
    assert result["hits"][0]["title"] == "Title A"
    assert result["hits"][0]["uri"] == "https://a.com"


def test_provider_failure_returns_empty_hits(monkeypatch: pytest.MonkeyPatch):
    """Gemini provider が例外を投げても空 hits を返すこと（例外なし）。"""
    monkeypatch.setattr(ws_ns, "get_settings", lambda: MagicMock(gemini_api_key="test-key"))

    async def failing_to_thread(fn, *args, **kwargs):
        raise RuntimeError("connection refused")

    monkeypatch.setattr(ws_ns.asyncio, "to_thread", failing_to_thread)

    result = run(web_search.ainvoke({"query": "test"}))

    assert result["ok"] is False
    assert result["hits"] == []
    assert "error" in result
    assert result["query"] == "test"


def test_no_api_key_returns_empty(monkeypatch: pytest.MonkeyPatch):
    """GEMINI_API_KEY が未設定の場合、空 hits を返すこと。"""
    monkeypatch.setattr(ws_ns, "get_settings", lambda: MagicMock(gemini_api_key=""))

    result = run(web_search.ainvoke({"query": "test"}))

    assert result["ok"] is False
    assert result["hits"] == []
    assert "error" in result
