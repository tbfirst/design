"""V6.M2.D.8: L3 recall 单元测试。3 case。

无 PG / bge-m3 依赖：
  - monkeypatch recall.embed_text → 返回固定向量（insert 用；search 直接收 query_embedding）
  - monkeypatch recall.psycopg.AsyncConnection.connect → 返回 FakeConn

FakeStore 是一个进程内的"假 ai.session_summary 表"：INSERT 写一行、SELECT 按
WHERE user_id=%s 过滤后返回。它复刻真实 SQL 传入的 user_id 参数，因此 cross-user
隔离不是靠断言 SQL 文本、而是靠"另一个 user_id 查不到"这条真实行为来验证。

score（1 - cosine 距离）本应由 pgvector 计算，假表里改用 default_score 预置，
这样 search_session_summary 内的 Python 阈值过滤（score < 0.78 丢弃）仍被真实执行。

case：
  1. test_insert_then_search_returns_row — insert(user=1) → search(user=1) 拿回该行
  2. test_below_threshold_not_returned — 行 score=0.5 < 0.78 → search 返回空
  3. test_cross_user_isolation — user_A(1) insert，user_B(2) search → 查不到
"""
from __future__ import annotations

import asyncio
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from app.agent.memory import recall  # noqa: E402


# -----------------------------------------------------------------------------
# 进程内假表 + 假 psycopg 连接
# -----------------------------------------------------------------------------


class FakeStore:
    """模拟 ai.session_summary：insert 写行，search 按 user_id 过滤 + 按 score 降序。"""

    def __init__(self, default_score: float = 0.9):
        self.rows: list[dict] = []
        self._next_id = 1
        self.default_score = default_score

    def insert(self, user_id: int, summary: str, quality_score: float) -> int:
        rid = self._next_id
        self._next_id += 1
        self.rows.append(
            {
                "id": rid,
                "user_id": int(user_id),
                "summary": summary,
                "quality_score": float(quality_score),
                "score": self.default_score,
                "archived": False,
            }
        )
        return rid

    def search(self, user_id: int, k: int) -> list[dict]:
        hits = [r for r in self.rows if r["user_id"] == int(user_id) and not r["archived"]]
        hits = sorted(hits, key=lambda r: r["score"], reverse=True)[: int(k)]
        return [
            {
                "id": r["id"],
                "summary": r["summary"],
                "quality_score": r["quality_score"],
                "score": r["score"],
            }
            for r in hits
        ]


class FakeCursor:
    def __init__(self, store: FakeStore):
        self.store = store
        self._fetchone: dict | None = None
        self._fetchall: list[dict] = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def execute(self, sql: str, params: tuple = ()):
        u = sql.upper()
        if "INSERT INTO AI.SESSION_SUMMARY" in u:
            # params: (session_id, user_id, summary, Json(range), vec_lit, quality)
            rid = self.store.insert(params[1], params[2], params[5])
            self._fetchone = {"id": rid}
        elif "FROM AI.SESSION_SUMMARY" in u and "SELECT" in u:
            # search: params (vec_lit, user_id, vec_lit, k)
            self._fetchall = self.store.search(params[1], params[3])

    async def fetchone(self):
        return self._fetchone

    async def fetchall(self):
        return self._fetchall


class FakeConn:
    def __init__(self, store: FakeStore):
        self._store = store
        self.committed = 0

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    def cursor(self):
        return FakeCursor(self._store)

    async def commit(self):
        self.committed += 1


def _setup(monkeypatch: pytest.MonkeyPatch, default_score: float = 0.9) -> FakeStore:
    """注入假向量 + 假连接（共享一个 FakeStore，跨多次 connect 持久）。"""
    store = FakeStore(default_score=default_score)

    async def fake_embed(text: str):  # noqa: ARG001
        return [0.1] * 1024

    monkeypatch.setattr(recall, "embed_text", fake_embed)

    async def fake_connect(dsn: str, row_factory=None):  # noqa: ARG001
        return FakeConn(store)

    monkeypatch.setattr(recall.psycopg.AsyncConnection, "connect", fake_connect)
    return store


_QVEC = [0.1] * 1024


# -----------------------------------------------------------------------------
# tests
# -----------------------------------------------------------------------------


def test_insert_then_search_returns_row(monkeypatch: pytest.MonkeyPatch):
    """insert(user=1) 返回 id → search(user=1) 拿回该行（score 0.9 ≥ 0.78）。"""
    _setup(monkeypatch, default_score=0.9)

    async def scenario():
        sid = await recall.insert_session_summary(
            session_id=10,
            user_id=1,
            summary="用户偏好冷色调，已确认 1:1 出图。",
            raw_msg_range={"from": 0, "to": 9},
            quality_score=0.7,
        )
        hits = await recall.search_session_summary(user_id=1, query_embedding=_QVEC)
        return sid, hits

    sid, hits = asyncio.run(scenario())
    assert sid == 1
    assert len(hits) == 1
    assert hits[0]["id"] == 1
    assert hits[0]["summary"].startswith("用户偏好冷色调")
    assert hits[0]["score"] >= 0.78


def test_below_threshold_not_returned(monkeypatch: pytest.MonkeyPatch):
    """行 score=0.5 < sim_threshold(0.78) → search_session_summary 的 Python 过滤丢弃 → 空。"""
    _setup(monkeypatch, default_score=0.5)

    async def scenario():
        await recall.insert_session_summary(
            session_id=10,
            user_id=1,
            summary="一段相关性很低的摘要。",
            raw_msg_range={"from": 0, "to": 9},
        )
        return await recall.search_session_summary(user_id=1, query_embedding=_QVEC)

    hits = asyncio.run(scenario())
    assert hits == []


def test_cross_user_isolation(monkeypatch: pytest.MonkeyPatch):
    """user_A(1) insert，user_B(2) search → WHERE user_id=2 过滤掉 user 1 的行 → 空。"""
    _setup(monkeypatch, default_score=0.9)

    async def scenario():
        await recall.insert_session_summary(
            session_id=10,
            user_id=1,
            summary="user_A 的私有摘要，不应被 user_B 召回。",
            raw_msg_range={"from": 0, "to": 9},
        )
        leaked = await recall.search_session_summary(user_id=2, query_embedding=_QVEC)
        own = await recall.search_session_summary(user_id=1, query_embedding=_QVEC)
        return leaked, own

    leaked, own = asyncio.run(scenario())
    assert leaked == [], "user_B 不应召回 user_A 的摘要"
    assert len(own) == 1, "user_A 自己仍能召回"


# -----------------------------------------------------------------------------
# F.1 list_session_summaries tests
# -----------------------------------------------------------------------------


class FakeStoreList:
    """模拟 ai.session_summary for list queries。"""

    def __init__(self):
        self.rows: list[dict] = []
        self._next_id = 1

    def insert(self, user_id: int, summary: str, quality_score: float) -> int:
        rid = self._next_id
        self._next_id += 1
        self.rows.append(
            {
                "id": rid,
                "user_id": int(user_id),
                "summary": summary,
                "quality_score": float(quality_score),
                "recall_count": 0,
                "last_recalled_at": None,
                "archived": False,
            }
        )
        return rid

    def list_rows(self, user_id: int, limit: int) -> list[dict]:
        rows = [r for r in self.rows if r["user_id"] == int(user_id)]
        return rows[:limit]


class FakeCursorList:
    def __init__(self, store: FakeStoreList):
        self.store = store
        self._fetchone: dict | None = None
        self._fetchall: list[dict] = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def execute(self, sql: str, params: tuple = ()):
        u = sql.upper()
        if "COALESCE" in u and "FROM AI.SESSION_SUMMARY" in u:
            # list query: params (user_id, limit)
            self._fetchall = [
                {
                    "id": r["id"],
                    "summary": r["summary"],
                    "quality_score": r["quality_score"],
                    "recall_count": r["recall_count"],
                    "last_recalled_at": r["last_recalled_at"],
                    "archived": r["archived"],
                }
                for r in self.store.list_rows(params[0], params[1])
            ]

    async def fetchone(self):
        return self._fetchone

    async def fetchall(self):
        return self._fetchall


class FakeConnList:
    def __init__(self, store: FakeStoreList):
        self._store = store

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    def cursor(self):
        return FakeCursorList(self._store)

    async def commit(self):
        pass


def _setup_list(monkeypatch: pytest.MonkeyPatch) -> FakeStoreList:
    store = FakeStoreList()

    async def fake_connect(dsn: str, row_factory=None):  # noqa: ARG001
        return FakeConnList(store)

    monkeypatch.setattr(recall.psycopg.AsyncConnection, "connect", fake_connect)
    return store


def test_list_session_summaries_empty(monkeypatch: pytest.MonkeyPatch):
    """no rows → list returns []."""
    _setup_list(monkeypatch)
    result = asyncio.run(recall.list_session_summaries(user_id=1))
    assert result == []


def test_list_session_summaries_returns_rows(monkeypatch: pytest.MonkeyPatch):
    """insert 2 rows → list returns both with correct field types."""
    store = _setup_list(monkeypatch)
    store.insert(user_id=1, summary="摘要一", quality_score=0.8)
    store.insert(user_id=1, summary="摘要二", quality_score=0.7)

    result = asyncio.run(recall.list_session_summaries(user_id=1))
    assert len(result) == 2
    row = result[0]
    assert isinstance(row["id"], int)
    assert isinstance(row["summary"], str)
    assert isinstance(row["quality_score"], float)
    assert isinstance(row["recall_count"], int)
    assert row["last_recalled_at"] is None
    assert isinstance(row["archived"], bool)


def test_list_session_summaries_user_isolation(monkeypatch: pytest.MonkeyPatch):
    """user_A rows not visible to user_B."""
    store = _setup_list(monkeypatch)
    store.insert(user_id=1, summary="user_A 摘要", quality_score=0.8)

    result_b = asyncio.run(recall.list_session_summaries(user_id=2))
    result_a = asyncio.run(recall.list_session_summaries(user_id=1))

    assert result_b == [], "user_B 不应看到 user_A 的摘要"
    assert len(result_a) == 1
