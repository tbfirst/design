"""V6.M3.D.2: /admin/wiki — L6 知識庫 CRUD（ADMIN/GROUP_LEADER 限定）。"""
from __future__ import annotations

import logging
from typing import Optional

import psycopg
from psycopg.rows import dict_row
from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, Field

from app.config import get_settings
from app.agent.memory.shared import _vec_literal
from app.routes.admin.basic_rules import _require_admin
from app.services.embedding import embed_text

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/agent/admin/wiki", tags=["agent-admin-wiki"])


def _dsn() -> str:
    return get_settings().computed_checkpoint_dsn


def _split_chunks(content: str, max_chars: int = 500) -> list[str]:
    """段落単位で分割し、max_chars を超えた段落はさらに分割する。"""
    paragraphs = [p.strip() for p in content.split("\n\n") if p.strip()]
    chunks: list[str] = []
    for para in paragraphs:
        if len(para) <= max_chars:
            chunks.append(para)
        else:
            for i in range(0, len(para), max_chars):
                chunks.append(para[i : i + max_chars])
    return chunks or [content[:max_chars]]


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------


class IngestRequest(BaseModel):
    collection: str = Field(..., min_length=1, max_length=100)
    title: str = Field(..., min_length=1, max_length=500)
    content: str = Field(..., min_length=1)
    visibility: str = Field("public", pattern="^(public|group|private)$")
    group_id: Optional[int] = None
    user_id: Optional[int] = None


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("/")
async def list_documents(
    collection: Optional[str] = Query(None),
    limit: int = Query(20, ge=1, le=200),
    offset: int = Query(0, ge=0),
    x_user_role: Optional[str] = Header(None, alias="X-User-Roles"),
) -> dict:
    _require_admin(x_user_role)
    async with await psycopg.AsyncConnection.connect(_dsn(), row_factory=dict_row) as conn:
        async with conn.cursor() as cur:
            if collection:
                await cur.execute(
                    """
                    SELECT id, collection, title, visibility, deleted, create_time
                    FROM ai.knowledge_document
                    WHERE collection = %s AND deleted = 0
                    ORDER BY create_time DESC LIMIT %s OFFSET %s
                    """,
                    (collection, int(limit), int(offset)),
                )
            else:
                await cur.execute(
                    """
                    SELECT id, collection, title, visibility, deleted, create_time
                    FROM ai.knowledge_document
                    WHERE deleted = 0
                    ORDER BY create_time DESC LIMIT %s OFFSET %s
                    """,
                    (int(limit), int(offset)),
                )
            rows = list(await cur.fetchall())
    return {"documents": [_jsonify(r) for r in rows]}


@router.post("/", status_code=201)
async def ingest_document(
    req: IngestRequest,
    x_user_role: Optional[str] = Header(None, alias="X-User-Roles"),
    x_user_id: Optional[int] = Header(None, alias="X-User-Id"),
) -> dict:
    _require_admin(x_user_role)

    # Compute chunks and embeddings BEFORE opening the DB connection (B1/B2)
    chunks = _split_chunks(req.content)
    try:
        embeddings = [await embed_text(c) for c in chunks]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"embedding failed: {e}")

    async with await psycopg.AsyncConnection.connect(_dsn(), row_factory=dict_row) as conn:
        try:
            async with conn.cursor() as cur:
                # Insert document (F-01: added body column)
                await cur.execute(
                    """
                    INSERT INTO ai.knowledge_document
                        (collection, body, title, visibility, group_id, user_id, deleted)
                    VALUES (%s, %s, %s, %s, %s, %s, 0)
                    RETURNING id
                    """,
                    (
                        req.collection,
                        req.content,
                        req.title,
                        req.visibility,
                        req.group_id,
                        req.user_id or x_user_id,
                    ),
                )
                row = await cur.fetchone()
                doc_id = int(row["id"])

                # Insert chunks using pre-computed embeddings (F-02: added ordinal)
                for idx, (chunk_text, vec) in enumerate(zip(chunks, embeddings), start=1):
                    vec_lit = _vec_literal(vec)
                    await cur.execute(
                        """
                        INSERT INTO ai.knowledge_chunk (document_id, ordinal, chunk_text, embedding, tsv)
                        VALUES (%s, %s, %s, %s::vector, to_tsvector('simple', %s))
                        """,
                        (doc_id, idx, chunk_text, vec_lit, chunk_text),
                    )

                await conn.commit()
        except Exception as e:
            await conn.rollback()
            logger.warning("wiki ingest failed, rolled back: %s", e)
            raise HTTPException(status_code=500, detail=f"ingest failed: {e}")

    return {"document_id": doc_id, "chunks": len(chunks)}


@router.put("/{doc_id}")
async def rebuild_document(
    doc_id: int,
    req: IngestRequest,
    x_user_role: Optional[str] = Header(None, alias="X-User-Roles"),
) -> dict:
    _require_admin(x_user_role)

    # Compute chunks and embeddings BEFORE opening the DB connection (B1/B2)
    chunks = _split_chunks(req.content)
    embeddings = [await embed_text(c) for c in chunks]

    async with await psycopg.AsyncConnection.connect(_dsn(), row_factory=dict_row) as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT id FROM ai.knowledge_document WHERE id = %s AND deleted = 0",
                (int(doc_id),),
            )
            if not await cur.fetchone():
                await conn.rollback()
                raise HTTPException(status_code=404, detail="document not found")

        try:
            async with conn.cursor() as cur:
                # Delete old chunks
                await cur.execute(
                    "DELETE FROM ai.knowledge_chunk WHERE document_id = %s", (int(doc_id),)
                )
                # Update document meta
                await cur.execute(
                    "UPDATE ai.knowledge_document SET title=%s, visibility=%s, body=%s WHERE id=%s",
                    (req.title, req.visibility, req.content, int(doc_id)),
                )
                # Insert chunks using pre-computed embeddings (F-02: added ordinal)
                for idx, (chunk_text, vec) in enumerate(zip(chunks, embeddings), start=1):
                    vec_lit = _vec_literal(vec)
                    await cur.execute(
                        """
                        INSERT INTO ai.knowledge_chunk (document_id, ordinal, chunk_text, embedding, tsv)
                        VALUES (%s, %s, %s, %s::vector, to_tsvector('simple', %s))
                        """,
                        (int(doc_id), idx, chunk_text, vec_lit, chunk_text),
                    )
                await conn.commit()
        except HTTPException:
            raise
        except Exception as e:
            await conn.rollback()
            logger.warning("wiki rebuild failed, rolled back: %s", e)
            raise HTTPException(status_code=500, detail=f"rebuild failed: {e}")

    return {"document_id": doc_id, "chunks": len(chunks)}


@router.delete("/{doc_id}", status_code=204)
async def soft_delete_document(
    doc_id: int,
    x_user_role: Optional[str] = Header(None, alias="X-User-Roles"),
) -> None:
    _require_admin(x_user_role)

    async with await psycopg.AsyncConnection.connect(_dsn()) as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "UPDATE ai.knowledge_document SET deleted = 1 WHERE id = %s AND deleted = 0",
                (int(doc_id),),
            )
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="document not found")
            await conn.commit()


def _jsonify(row: dict) -> dict:
    from decimal import Decimal
    out = dict(row)
    for k, v in list(out.items()):
        if isinstance(v, Decimal):
            out[k] = float(v)
        elif hasattr(v, "isoformat"):
            out[k] = v.isoformat()
    return out
