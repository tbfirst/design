"""V6.M2.E.8: L6 shared 单元测试。3 case。

shared.py 仅有 search_shared（无 insert），故直接给 FakeStore 预置文档行，
FakeCursor 复刻真实 SQL 的 collection / visibility / user / group 过滤，
search_shared 仅传入 query_embedding（不调 embed_text，故无需 mock embedding）。

case：
  1. test_search_returns_matching_collection — public 文档命中目标 collection → 返回
  2. test_collection_filter — 文档不在请求的 collections 内 → 空
  3. test_private_cross_user_isolation — private 文档归 user_A，user_B 查不到；public 仍可见
"""
from __future__ import annotations

import asyncio
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from app.agent.memory import shared  # noqa: E402


class FakeStore:
    """预置 knowledge_document(+chunk) 行；search 复刻 collection/visibility/scope 过滤。"""

    def __init__(self):
        self.rows: list[dict] = []
        self._next_id = 1
        self.default_score = 0.9

    def add(self, collection, title, chunk_text, visibility="public", user_id=None, group_id=None):
        did = self._next_id
        self._next_id += 1
        self.rows.append(
            {
                "document_id": did,
                "collection": collection,
                "title": title,
                "chunk_text": chunk_text,
                "visibility": visibility,
                "user_id": user_id,
                "group_id": group_id,
                "score": self.default_score,
            }
        )
        return did

    def search(self, cols, groups, user_id, limit):
        cols = set(cols or [])
        groups = set(groups or [])
        out = []
        for r in self.rows:
            if r["collection"] not in cols:
                continue
            vis = r["visibility"]
            visible = (
                vis == "public"
                or (vis == "group" and r["group_id"] is not None and r["group_id"] in groups)
                or (vis == "private" and r["user_id"] == user_id)
            )
            if not visible:
                continue
            out.append(r)
        out = sorted(out, key=lambda r: r["score"], reverse=True)[: int(limit)]
        return [
            {
                "document_id": r["document_id"],
                "collection": r["collection"],
                "title": r["title"],
                "chunk_text": r["chunk_text"],
                "score": r["score"],
            }
            for r in out
        ]


class FakeCursor:
    def __init__(self, store: FakeStore):
        self.store = store
        self._fetchall: list[dict] = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def execute(self, sql: str, params: tuple = ()):
        u = sql.upper()
        if "FROM AI.KNOWLEDGE_CHUNK" in u and "SELECT" in u:
            # (vec_lit, cols, groups, user_id, vec_lit, k)
            self._fetchall = self.store.search(params[1], params[2], params[3], params[5])

    async def fetchall(self):
        return self._fetchall


class FakeConn:
    def __init__(self, store: FakeStore):
        self._store = store

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    def cursor(self):
        return FakeCursor(self._store)

    async def commit(self):
        pass


def _setup(monkeypatch) -> FakeStore:
    store = FakeStore()

    async def fake_connect(dsn, row_factory=None):  # noqa: ARG001
        return FakeConn(store)

    monkeypatch.setattr(shared.psycopg.AsyncConnection, "connect", fake_connect)
    return store


_QVEC = [0.1] * 1024


def test_search_returns_matching_collection(monkeypatch):
    store = _setup(monkeypatch)
    store.add("brand-dna", "什么是品牌 DNA", "品牌 DNA 是…", visibility="public")

    hits = asyncio.run(
        shared.search_shared(
            user_id=1, group_ids=[], collections=["brand-dna"], query_embedding=_QVEC, k=3
        )
    )
    assert len(hits) == 1
    assert hits[0]["collection"] == "brand-dna"


def test_collection_filter(monkeypatch):
    """文档在 brand-dna，但请求 collections=['garment-taxonomy'] → 不返回。"""
    store = _setup(monkeypatch)
    store.add("brand-dna", "品牌 DNA", "…", visibility="public")

    hits = asyncio.run(
        shared.search_shared(
            user_id=1, group_ids=[], collections=["garment-taxonomy"], query_embedding=_QVEC, k=3
        )
    )
    assert hits == []


def test_private_cross_user_isolation(monkeypatch):
    """private 文档属 user_A(1)，user_B(2) 查不到；同 collection 的 public 文档 user_B 仍可见。"""
    store = _setup(monkeypatch)
    store.add("brand-dna", "user_A 私有", "私有内容", visibility="private", user_id=1)
    store.add("brand-dna", "公共基线", "公共内容", visibility="public")

    hits = asyncio.run(
        shared.search_shared(
            user_id=2, group_ids=[], collections=["brand-dna"], query_embedding=_QVEC, k=3
        )
    )
    titles = {h["title"] for h in hits}
    assert "user_A 私有" not in titles, "user_B 不应看到 user_A 的 private 文档"
    assert "公共基线" in titles, "public 文档对所有人可见"
