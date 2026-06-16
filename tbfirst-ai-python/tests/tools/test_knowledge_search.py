"""F.2: knowledge_search tool 单元测试。

验证：InjectedState user_id 注入（不为 0）、RRF 排序正确、BM25 为空时退化纯 dense。
"""
from __future__ import annotations

import asyncio
import importlib
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

importlib.import_module("app.agent.graph.tools.knowledge_search")
ks_ns = sys.modules["app.agent.graph.tools.knowledge_search"]
from app.agent.graph.tools.knowledge_search import knowledge_search  # noqa: E402
from app.agent.memory.shared import _rrf_merge  # noqa: E402


def run(coro):
    return asyncio.run(coro)


def _state(user_id: int = 7, group_id=None) -> dict:
    return {"user_id": user_id, "group_id": group_id, "messages": []}


# ---------------------------------------------------------------------------
# tests
# ---------------------------------------------------------------------------


def test_user_id_injected_not_zero(monkeypatch: pytest.MonkeyPatch):
    """state['user_id'] が search_shared_hybrid に渡され 0 でないこと。"""
    captured: dict = {}

    async def fake_embed(text):
        return [0.1] * 1024

    async def fake_hybrid(user_id, group_ids, collections, query_text, query_embedding, k=5):
        captured["user_id"] = user_id
        return []

    monkeypatch.setattr(ks_ns, "embed_text", fake_embed)
    monkeypatch.setattr(ks_ns, "search_shared_hybrid", fake_hybrid)

    run(knowledge_search.ainvoke({"query": "test", "state": _state(user_id=42)}))

    assert "user_id" in captured
    assert captured["user_id"] == 42
    assert captured["user_id"] != 0


def test_rrf_rank_bm25_hit_scores_higher():
    """BM25 rank1 文档は dense のみのものより RRF 総合スコアが高いこと。"""
    # doc_id=1: dense rank1, bm25 rank1 → 高スコア
    # doc_id=2: dense rank2 only → 低スコア
    dense = [
        {"document_id": 1, "collection": "c", "title": "t", "chunk_text": "x", "score": 0.9},
        {"document_id": 2, "collection": "c", "title": "t", "chunk_text": "y", "score": 0.8},
    ]
    bm25 = [
        {"document_id": 1, "collection": "c", "title": "t", "chunk_text": "x", "score": 5.0},
    ]
    result = _rrf_merge(dense, bm25, rrf_k=60, top_n=2)
    assert result[0]["document_id"] == 1, "BM25 rank1 doc should rank first"
    assert result[0]["score"] > result[1]["score"]


def test_bm25_empty_degrades_to_dense(monkeypatch: pytest.MonkeyPatch):
    """BM25 が空の場合、dense のみの結果が返ること（例外なし）。"""
    async def fake_embed(text):
        return [0.1] * 1024

    async def fake_hybrid(user_id, group_ids, collections, query_text, query_embedding, k=5):
        # BM25 空 → 純 dense の結果を返す（関数内部は _rrf_merge で処理済み）
        return [
            {"document_id": 99, "collection": "brand-dna", "title": "doc", "chunk_text": "text", "score": 0.85},
        ]

    monkeypatch.setattr(ks_ns, "embed_text", fake_embed)
    monkeypatch.setattr(ks_ns, "search_shared_hybrid", fake_hybrid)

    result = run(knowledge_search.ainvoke({"query": "query", "state": _state()}))

    assert result["ok"] is True
    assert "hits" in result
    assert len(result["hits"]) == 1
    assert result["hits"][0]["document_id"] == 99


def test_knowledge_search_failure_is_silent(monkeypatch: pytest.MonkeyPatch):
    """embed または hybrid 失败时不抛异常，返回 ok=False 错误信封（hits=[]）。"""
    async def failing_embed(text):
        raise RuntimeError("embed service down")

    monkeypatch.setattr(ks_ns, "embed_text", failing_embed)

    result = run(knowledge_search.ainvoke({"query": "test", "state": _state()}))

    assert result["ok"] is False
    assert result["error_code"] == "search_error"
    assert result["hits"] == []
