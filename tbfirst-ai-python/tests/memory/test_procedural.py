"""V6.M2.E.8: L5 procedural 单元测试。3 case。

无 PG / bge-m3：monkeypatch `procedural.embed_text`（insert 用）+
`procedural.psycopg.AsyncConnection.connect`（有状态 FakeStore，复刻
`WHERE user_id=%s OR (group_id IS NOT NULL AND group_id=ANY(%s))` 的 scope）。

case：
  1. test_insert_then_search_returns_row — insert(user=1) → search(user=1) 拿回
  2. test_cross_user_private_isolation — user_A 私有（group_id=None），user_B search 查不到
  3. test_phase_filter — 只返回 phase_chain 命中目标 phase 的模板（验证 _phase_in_chain 后过滤）
"""
from __future__ import annotations

import asyncio
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from app.agent.memory import procedural  # noqa: E402


class FakeStore:
    def __init__(self, default_score: float = 0.9):
        self.rows: list[dict] = []
        self._next_id = 1
        self.default_score = default_score

    def insert(self, user_id, group_id, name, phase_chain, sample_prompt, quality):
        rid = self._next_id
        self._next_id += 1
        self.rows.append(
            {
                "id": rid,
                "user_id": user_id,
                "group_id": group_id,
                "name": name,
                "phase_chain": phase_chain,
                "sample_prompt": sample_prompt,
                "quality_score": float(quality),
                "score": self.default_score,
            }
        )
        return rid

    def search(self, user_id, groups, limit):
        groups = set(groups or [])
        hits = [
            r
            for r in self.rows
            if r["user_id"] == user_id or (r["group_id"] is not None and r["group_id"] in groups)
        ]
        hits = sorted(hits, key=lambda r: r["score"], reverse=True)[: int(limit)]
        return [
            {
                "id": r["id"],
                "name": r["name"],
                "phase_chain": r["phase_chain"],
                "sample_prompt": r["sample_prompt"],
                "quality_score": r["quality_score"],
                "score": r["score"],
            }
            for r in hits
        ]


class FakeCursor:
    def __init__(self, store: FakeStore):
        self.store = store
        self._fetchone = None
        self._fetchall: list[dict] = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def execute(self, sql: str, params: tuple = ()):
        u = sql.upper()
        if "INSERT INTO AI.WORKFLOW_TEMPLATE" in u:
            # (user_id, group_id, name, Json(phase_chain), sample_prompt, sample_job_id, vec_lit, quality)
            pc = params[3]
            pc = getattr(pc, "obj", pc)  # 解 psycopg Json 包装
            rid = self.store.insert(params[0], params[1], params[2], pc, params[4], params[7])
            self._fetchone = {"id": rid}
        elif "FROM AI.WORKFLOW_TEMPLATE" in u and "SELECT" in u:
            # (vec_lit, user_id, groups, vec_lit, fetch_k)
            self._fetchall = self.store.search(params[1], params[2], params[4])

    async def fetchone(self):
        return self._fetchone

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


def _setup(monkeypatch, default_score: float = 0.9) -> FakeStore:
    store = FakeStore(default_score=default_score)

    async def fake_embed(text):  # noqa: ARG001
        return [0.1] * 1024

    monkeypatch.setattr(procedural, "embed_text", fake_embed)

    async def fake_connect(dsn, row_factory=None):  # noqa: ARG001
        return FakeConn(store)

    monkeypatch.setattr(procedural.psycopg.AsyncConnection, "connect", fake_connect)
    return store


_QVEC = [0.1] * 1024


def test_insert_then_search_returns_row(monkeypatch):
    _setup(monkeypatch)

    async def scenario():
        wid = await procedural.insert_workflow(
            user_id=1,
            group_id=None,
            name="auto:phase1",
            phase_chain=[{"phase": "phase1"}],
            sample_prompt="亚麻连衣裙，冷色调，1:1。",
            quality_score=0.8,
        )
        hits = await procedural.search_workflow(
            user_id=1, group_ids=[], phase=None, query_embedding=_QVEC, k=2
        )
        return wid, hits

    wid, hits = asyncio.run(scenario())
    assert wid == 1
    assert len(hits) == 1
    assert hits[0]["name"] == "auto:phase1"


def test_cross_user_private_isolation(monkeypatch):
    """user_A 私有模板（group_id=None），user_B（不同 user，无共享 group）查不到。"""
    _setup(monkeypatch)

    async def scenario():
        await procedural.insert_workflow(
            user_id=1, group_id=None, name="auto:phase1",
            phase_chain=[{"phase": "phase1"}], sample_prompt="私有流程", quality_score=0.8,
        )
        leaked = await procedural.search_workflow(
            user_id=2, group_ids=[], phase=None, query_embedding=_QVEC, k=2
        )
        own = await procedural.search_workflow(
            user_id=1, group_ids=[], phase=None, query_embedding=_QVEC, k=2
        )
        return leaked, own

    leaked, own = asyncio.run(scenario())
    assert leaked == []
    assert len(own) == 1


def test_phase_filter(monkeypatch):
    """两条不同 phase 的模板，按 phase=phase3 检索只返回命中那条。"""
    _setup(monkeypatch)

    async def scenario():
        await procedural.insert_workflow(
            user_id=1, group_id=None, name="auto:phase1",
            phase_chain=[{"phase": "phase1"}], sample_prompt="phase1 流程", quality_score=0.8,
        )
        await procedural.insert_workflow(
            user_id=1, group_id=None, name="auto:phase3",
            phase_chain=[{"phase": "phase3"}], sample_prompt="phase3 流程", quality_score=0.8,
        )
        return await procedural.search_workflow(
            user_id=1, group_ids=[], phase="phase3", query_embedding=_QVEC, k=2
        )

    hits = asyncio.run(scenario())
    assert len(hits) == 1
    assert hits[0]["name"] == "auto:phase3"


# -----------------------------------------------------------------------------
# F.1 list_workflows tests
# -----------------------------------------------------------------------------


class FakeStoreListWF:
    def __init__(self):
        self.rows: list[dict] = []
        self._next_id = 1

    def insert(self, user_id, group_id, name, phase_chain, quality_score):
        rid = self._next_id
        self._next_id += 1
        self.rows.append(
            {
                "id": rid,
                "user_id": user_id,
                "group_id": group_id,
                "name": name,
                "phase_chain": phase_chain,
                "sample_prompt": "",
                "quality_score": float(quality_score),
            }
        )
        return rid

    def list_rows(self, user_id, group_ids, limit):
        gids = set(int(g) for g in (group_ids or []))
        rows = [
            r
            for r in self.rows
            if r["user_id"] == user_id
            or (r["group_id"] is not None and r["group_id"] in gids)
        ]
        rows = sorted(rows, key=lambda r: r["quality_score"], reverse=True)
        return rows[:limit]


class FakeCursorListWF:
    def __init__(self, store: FakeStoreListWF):
        self.store = store
        self._fetchall: list[dict] = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def execute(self, sql: str, params: tuple = ()):
        u = sql.upper()
        if "QUALITY_SCORE DESC" in u and "FROM AI.WORKFLOW_TEMPLATE" in u:
            # list query: params (user_id, group_ids, limit)
            rows = self.store.list_rows(params[0], params[1], params[2])
            self._fetchall = [
                {
                    "id": r["id"],
                    "name": r["name"],
                    "phase_chain": r["phase_chain"],
                    "sample_prompt": r["sample_prompt"],
                    "quality_score": r["quality_score"],
                }
                for r in rows
            ]

    async def fetchone(self):
        return None

    async def fetchall(self):
        return self._fetchall


class FakeConnListWF:
    def __init__(self, store: FakeStoreListWF):
        self._store = store

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    def cursor(self):
        return FakeCursorListWF(self._store)

    async def commit(self):
        pass


def _setup_list_wf(monkeypatch) -> FakeStoreListWF:
    store = FakeStoreListWF()

    async def fake_connect(dsn, row_factory=None):  # noqa: ARG001
        return FakeConnListWF(store)

    monkeypatch.setattr(procedural.psycopg.AsyncConnection, "connect", fake_connect)
    return store


def test_list_workflows_user_private(monkeypatch):
    """user 私有 workflow → list 返回正确字段。"""
    store = _setup_list_wf(monkeypatch)
    store.insert(
        user_id=1, group_id=None,
        name="my-flow", phase_chain=[{"phase": "phase1"}], quality_score=0.8,
    )

    result = asyncio.run(procedural.list_workflows(user_id=1))
    assert len(result) == 1
    row = result[0]
    assert isinstance(row["id"], int)
    assert row["name"] == "my-flow"
    assert isinstance(row["quality_score"], float)


def test_list_workflows_group_shared(monkeypatch):
    """group 共享 workflow → user 通过 group_ids 可见。"""
    store = _setup_list_wf(monkeypatch)
    store.insert(
        user_id=99, group_id=10,
        name="group-flow", phase_chain=[], quality_score=0.9,
    )

    result = asyncio.run(procedural.list_workflows(user_id=1, group_ids=[10]))
    assert len(result) == 1
    assert result[0]["name"] == "group-flow"


def test_list_workflows_no_cross_user(monkeypatch):
    """user_A 私有 workflow，user_B（无共享 group）查不到。"""
    store = _setup_list_wf(monkeypatch)
    store.insert(
        user_id=1, group_id=None,
        name="user-a-flow", phase_chain=[], quality_score=0.8,
    )

    result_b = asyncio.run(procedural.list_workflows(user_id=2))
    result_a = asyncio.run(procedural.list_workflows(user_id=1))

    assert result_b == [], "user_B 不应看到 user_A 的 workflow"
    assert len(result_a) == 1
