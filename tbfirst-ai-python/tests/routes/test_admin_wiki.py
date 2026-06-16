"""F.5: admin_wiki 単元テスト。

鉴权 403 / ADMIN 200 / create embeds chunks / 软删。
"""
from __future__ import annotations

import asyncio
import os
import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

import app.routes.admin.wiki as wiki_module  # noqa: E402
from app.routes.admin.wiki import (  # noqa: E402
    _split_chunks,
    soft_delete_document,
    list_documents,
    ingest_document,
)
from app.routes.admin.basic_rules import _require_admin  # noqa: E402
from fastapi import HTTPException  # noqa: E402


def run(coro):
    return asyncio.run(coro)


# ---------------------------------------------------------------------------
# _require_admin tests
# ---------------------------------------------------------------------------


def test_require_admin_raises_403_for_no_role():
    with pytest.raises(HTTPException) as exc:
        _require_admin(None)
    assert exc.value.status_code == 403


def test_require_admin_raises_403_for_user_role():
    with pytest.raises(HTTPException) as exc:
        _require_admin("USER")
    assert exc.value.status_code == 403


def test_require_admin_passes_for_admin():
    _require_admin("ADMIN")  # should not raise


def test_require_admin_passes_for_group_leader():
    _require_admin("GROUP_LEADER")


def test_require_admin_case_insensitive():
    _require_admin("admin")


# ---------------------------------------------------------------------------
# _split_chunks tests
# ---------------------------------------------------------------------------


def test_split_chunks_short_content():
    chunks = _split_chunks("Hello world", max_chars=500)
    assert chunks == ["Hello world"]


def test_split_chunks_paragraphs():
    content = "Para one.\n\nPara two.\n\nPara three."
    chunks = _split_chunks(content, max_chars=500)
    assert len(chunks) == 3


# ---------------------------------------------------------------------------
# ingest_document (DB mocked)
# ---------------------------------------------------------------------------


class FakeCursorWiki:
    def __init__(self):
        self._next_id = 100
        self.rowcount = 1
        self.executed = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def execute(self, sql, params=None):
        self.executed.append((sql.strip()[:50], params))

    async def fetchone(self):
        return {"id": self._next_id}

    async def fetchall(self):
        return []


class FakeConnWiki:
    def __init__(self):
        self._cursor = FakeCursorWiki()
        self.committed = 0
        self.rolled_back = 0

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    def cursor(self):
        return self._cursor

    async def commit(self):
        self.committed += 1

    async def rollback(self):
        self.rolled_back += 1


def _patch_db(monkeypatch) -> FakeConnWiki:
    conn = FakeConnWiki()

    async def fake_connect(dsn, row_factory=None):
        return conn

    monkeypatch.setattr(wiki_module.psycopg.AsyncConnection, "connect", fake_connect)
    return conn


def test_ingest_document_creates_chunks(monkeypatch: pytest.MonkeyPatch):
    """POST / → document + chunks が DB に書かれ、commit されること。"""
    _patch_db(monkeypatch)

    async def fake_embed(text):
        return [0.1] * 1024

    monkeypatch.setattr(wiki_module, "embed_text", fake_embed)

    from app.routes.admin.wiki import IngestRequest
    req = IngestRequest(
        collection="brand-dna",
        title="Test Doc",
        content="Paragraph one.\n\nParagraph two.",
    )

    result = run(ingest_document(req, x_user_role="ADMIN", x_user_id=1))

    assert result["document_id"] == 100
    assert result["chunks"] == 2


def test_ingest_document_embed_failure_rolls_back(monkeypatch: pytest.MonkeyPatch):
    """embed が失敗したら 500 が返り、DB には何も書かれないこと。
    embed は DB 接続より前に実行されるため rollback は発生しないが commit も発生しない。"""
    conn = _patch_db(monkeypatch)

    async def failing_embed(text):
        raise RuntimeError("embed service down")

    monkeypatch.setattr(wiki_module, "embed_text", failing_embed)

    from app.routes.admin.wiki import IngestRequest
    req = IngestRequest(collection="c", title="t", content="content")

    with pytest.raises(HTTPException) as exc:
        run(ingest_document(req, x_user_role="ADMIN", x_user_id=1))

    assert exc.value.status_code == 500
    assert conn.committed == 0  # DB never written — embed fails before DB opens


def test_soft_delete_requires_admin(monkeypatch: pytest.MonkeyPatch):
    """非 ADMIN は 403 を返すこと。"""
    with pytest.raises(HTTPException) as exc:
        run(soft_delete_document(doc_id=1, x_user_role="USER"))
    assert exc.value.status_code == 403
