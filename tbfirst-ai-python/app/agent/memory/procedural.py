"""V6.M2.E.1: L5 流程记忆（PG ai.workflow_template + pgvector KNN）。"""
from __future__ import annotations

import logging
from typing import Any, Optional, Sequence

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Json

from app.config import get_settings
from app.services.embedding import embed_text

logger = logging.getLogger(__name__)

_DSN: Optional[str] = None


def _dsn() -> str:
    global _DSN
    if _DSN is None:
        s = get_settings()
        _DSN = (
            f"postgresql://{s.db_user}:{s.db_password}@{s.db_host}:{s.db_port}/{s.db_name}"
        )
    return _DSN


def _vec_literal(vec: Sequence[float]) -> str:
    return "[" + ",".join(f"{float(v):.6f}" for v in vec) + "]"


def _phase_in_chain(phase_chain: Any, phase: str) -> bool:
    if not isinstance(phase_chain, list):
        return False
    for step in phase_chain:
        if isinstance(step, dict) and step.get("phase") == phase:
            return True
    return False


async def insert_workflow(
    user_id: Optional[int],
    group_id: Optional[int],
    name: str,
    phase_chain: Any,
    sample_prompt: str,
    sample_job_id: Optional[int] = None,
    quality_score: float = 0.7,
) -> int:
    vec = await embed_text(sample_prompt or name or "")
    vec_lit = _vec_literal(vec)
    async with await psycopg.AsyncConnection.connect(_dsn(), row_factory=dict_row) as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                INSERT INTO ai.workflow_template
                    (user_id, group_id, name, phase_chain, sample_prompt,
                     sample_job_id, embedding, quality_score)
                VALUES (%s, %s, %s, %s, %s, %s, %s::vector, %s)
                RETURNING id
                """,
                (
                    user_id,
                    group_id,
                    name,
                    Json(phase_chain),
                    sample_prompt,
                    sample_job_id,
                    vec_lit,
                    float(quality_score),
                ),
            )
            row = await cur.fetchone()
            await conn.commit()
            return int(row["id"])


async def search_workflow(
    user_id: int,
    group_ids: Optional[Sequence[int]],
    phase: Optional[str],
    query_embedding: Sequence[float],
    k: int = 2,
) -> list[dict]:
    if not query_embedding:
        return []
    vec_lit = _vec_literal(query_embedding)
    groups = [int(g) for g in (group_ids or [])]
    fetch_k = int(k) * 4 if phase else int(k)
    async with await psycopg.AsyncConnection.connect(_dsn(), row_factory=dict_row) as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                SELECT id, name, phase_chain, sample_prompt, quality_score,
                       1 - (embedding <=> %s::vector) AS score
                FROM ai.workflow_template
                WHERE (user_id = %s OR (group_id IS NOT NULL AND group_id = ANY(%s)))
                ORDER BY embedding <=> %s::vector
                LIMIT %s
                """,
                (vec_lit, user_id, groups, vec_lit, fetch_k),
            )
            rows = list(await cur.fetchall())

    out: list[dict] = []
    for r in rows:
        if phase and not _phase_in_chain(r.get("phase_chain"), phase):
            continue
        try:
            score = float(r.get("score") or 0)
        except (TypeError, ValueError):
            score = 0.0
        out.append(
            {
                "id": int(r["id"]),
                "name": r.get("name"),
                "phase_chain": r.get("phase_chain"),
                "sample_prompt": r.get("sample_prompt"),
                "quality_score": float(r["quality_score"]) if r.get("quality_score") is not None else None,
                "score": score,
            }
        )
        if len(out) >= int(k):
            break
    return out


async def list_workflows(
    user_id: int,
    group_ids: Optional[Sequence[int]] = None,
    limit: int = 50,
) -> list[dict]:
    groups = [int(g) for g in (group_ids or [])]
    async with await psycopg.AsyncConnection.connect(_dsn(), row_factory=dict_row) as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                SELECT id, name, phase_chain, sample_prompt, quality_score
                FROM ai.workflow_template
                WHERE (user_id = %s OR group_id = ANY(%s))
                ORDER BY quality_score DESC, create_time DESC
                LIMIT %s
                """,
                (int(user_id), groups, int(limit)),
            )
            rows = list(await cur.fetchall())

    out: list[dict] = []
    for r in rows:
        out.append(
            {
                "id": int(r["id"]),
                "name": r.get("name"),
                "phase_chain": r.get("phase_chain"),
                "sample_prompt": r.get("sample_prompt"),
                "quality_score": float(r["quality_score"]) if r.get("quality_score") is not None else None,
            }
        )
    return out
