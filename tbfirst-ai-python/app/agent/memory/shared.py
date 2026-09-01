"""V6.M2.E.2: L6 共享知识（PG ai.knowledge_document + ai.knowledge_chunk）。"""
from __future__ import annotations

import logging
from typing import Optional, Sequence

from app.db.pool import agent_db_connection

logger = logging.getLogger(__name__)

def _vec_literal(vec: Sequence[float]) -> str:
    return "[" + ",".join(f"{float(v):.6f}" for v in vec) + "]"


async def search_shared(
    user_id: int,
    group_ids: Optional[Sequence[int]],
    collections: Optional[Sequence[str]],
    query_embedding: Sequence[float],
    k: int = 3,
) -> list[dict]:
    if not query_embedding or not collections:
        return []
    vec_lit = _vec_literal(query_embedding)
    groups = [int(g) for g in (group_ids or [])]
    cols = [str(c) for c in collections]
    async with agent_db_connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                SELECT d.id AS document_id, d.collection, d.title,
                       c.chunk_text,
                       1 - (c.embedding <=> %s::vector) AS score
                FROM ai.knowledge_chunk c
                JOIN ai.knowledge_document d ON d.id = c.document_id
                WHERE d.deleted = 0
                  AND d.collection = ANY(%s)
                  AND (
                        d.visibility = 'public'
                     OR (d.visibility = 'group' AND d.group_id = ANY(%s))
                     OR (d.visibility = 'private' AND d.user_id = %s)
                  )
                ORDER BY c.embedding <=> %s::vector
                LIMIT %s
                """,
                (vec_lit, cols, groups, user_id, vec_lit, int(k)),
            )
            rows = list(await cur.fetchall())

    out: list[dict] = []
    for r in rows:
        try:
            score = float(r.get("score") or 0)
        except (TypeError, ValueError):
            score = 0.0
        out.append(
            {
                "document_id": int(r["document_id"]),
                "collection": r.get("collection"),
                "title": r.get("title"),
                "chunk_text": r.get("chunk_text"),
                "score": score,
            }
        )
    return out


def _rrf_merge(
    dense: list[dict],
    bm25: list[dict],
    rrf_k: int = 60,
    top_n: int = 5,
) -> list[dict]:
    rrf_scores: dict[int, float] = {}
    items: dict[int, dict] = {}
    for rank, item in enumerate(dense, 1):
        doc_id = item["document_id"]
        rrf_scores[doc_id] = rrf_scores.get(doc_id, 0.0) + 1.0 / (rrf_k + rank)
        items.setdefault(doc_id, item)
    for rank, item in enumerate(bm25, 1):
        doc_id = item["document_id"]
        rrf_scores[doc_id] = rrf_scores.get(doc_id, 0.0) + 1.0 / (rrf_k + rank)
        items.setdefault(doc_id, item)
    sorted_ids = sorted(rrf_scores, key=lambda d: rrf_scores[d], reverse=True)
    return [
        {**items[doc_id], "score": rrf_scores[doc_id]}
        for doc_id in sorted_ids[:top_n]
    ]


async def search_shared_hybrid(
    user_id: int,
    group_ids: Optional[Sequence[int]],
    collections: Optional[Sequence[str]],
    query_text: str,
    query_embedding: Sequence[float],
    k: int = 5,
) -> list[dict]:
    if not query_embedding or not collections:
        return []
    vec_lit = _vec_literal(query_embedding)
    groups = [int(g) for g in (group_ids or [])]
    cols = [str(c) for c in collections]

    scope_sql = """
        d.deleted = 0
        AND d.collection = ANY(%s)
        AND (
              d.visibility = 'public'
           OR (d.visibility = 'group' AND d.group_id = ANY(%s))
           OR (d.visibility = 'private' AND d.user_id = %s)
        )
    """

    async with agent_db_connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                f"""
                SELECT d.id AS document_id, d.collection, d.title, c.chunk_text,
                       1 - (c.embedding <=> %s::vector) AS score
                FROM ai.knowledge_chunk c
                JOIN ai.knowledge_document d ON d.id = c.document_id
                WHERE {scope_sql}
                ORDER BY c.embedding <=> %s::vector
                LIMIT 20
                """,
                (vec_lit, cols, groups, user_id, vec_lit),
            )
            dense_rows = list(await cur.fetchall())

            bm25_rows: list[dict] = []
            if query_text:
                try:
                    await cur.execute(
                        f"""
                        SELECT d.id AS document_id, d.collection, d.title, c.chunk_text,
                               ts_rank(c.tsv, plainto_tsquery('simple', %s)) AS score
                        FROM ai.knowledge_chunk c
                        JOIN ai.knowledge_document d ON d.id = c.document_id
                        WHERE {scope_sql}
                          AND c.tsv @@ plainto_tsquery('simple', %s)
                        ORDER BY score DESC
                        LIMIT 20
                        """,
                        (query_text, cols, groups, user_id, query_text),
                    )
                    bm25_rows = list(await cur.fetchall())
                except Exception as e:
                    logger.warning("search_shared_hybrid BM25 failed (degrading to dense): %s", e)

    def _normalize(rows: list[dict]) -> list[dict]:
        out = []
        for r in rows:
            try:
                score = float(r.get("score") or 0)
            except (TypeError, ValueError):
                score = 0.0
            out.append(
                {
                    "document_id": int(r["document_id"]),
                    "collection": r.get("collection"),
                    "title": r.get("title"),
                    "chunk_text": r.get("chunk_text"),
                    "score": score,
                }
            )
        return out

    return _rrf_merge(_normalize(dense_rows), _normalize(bm25_rows), top_n=int(k))
