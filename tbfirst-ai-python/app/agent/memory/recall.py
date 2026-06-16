"""V6.M2.D.1: L3 回顾记忆（PG ai.session_summary + pgvector KNN）。"""
from __future__ import annotations

import logging
from typing import Optional, Sequence

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
    """将 Python 的浮点数序列转换成 pgvector 扩展能直接识别的字符串字面量格式,注意 pgvector 默认使用 6 位小数精度。"""
    return "[" + ",".join(f"{float(v):.6f}" for v in vec) + "]"


async def insert_session_summary(
    session_id: int,
    user_id: int,
    summary: str,
    raw_msg_range: dict,
    quality_score: float = 0.7,
) -> int:
    # 异步调用 Embedding 服务
    vec = await embed_text(summary)
    vec_lit = _vec_literal(vec)
    async with await psycopg.AsyncConnection.connect(_dsn(), row_factory=dict_row) as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                INSERT INTO ai.session_summary
                    (session_id, user_id, summary, raw_msg_range, embedding, quality_score)
                VALUES (%s, %s, %s, %s, %s::vector, %s)
                RETURNING id
                """,
                (session_id, user_id, summary, Json(raw_msg_range), vec_lit, float(quality_score)),
            )
            row = await cur.fetchone()
            await conn.commit()
            return int(row["id"])


async def search_session_summary(
    user_id: int,
    query_embedding: Sequence[float],
    k: int = 3,
    sim_threshold: float = 0.78,
) -> list[dict]:
    """基于 pgvector 的向量相似度搜索，返回符合条件的 session_summary 列表，包含 id, summary, quality_score, score 四个字段。"""
    if not query_embedding:
        return []
    vec_lit = _vec_literal(query_embedding)
    async with await psycopg.AsyncConnection.connect(_dsn(), row_factory=dict_row) as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                SELECT id, summary, quality_score,
                       1 - (embedding <=> %s::vector) AS score
                FROM ai.session_summary
                WHERE user_id = %s AND archived = FALSE
                ORDER BY embedding <=> %s::vector
                LIMIT %s
                """,
                (vec_lit, user_id, vec_lit, int(k)),
            )
            rows = list(await cur.fetchall())
    out: list[dict] = []
    for r in rows:
        try:
            score = float(r.get("score") or 0)
        except (TypeError, ValueError):
            continue
        if score < sim_threshold:
            continue
        out.append(
            {
                "id": int(r["id"]),
                "summary": r["summary"],
                "quality_score": float(r["quality_score"]) if r.get("quality_score") is not None else None,
                "score": score,
            }
        )
    return out


async def mark_recalled(summary_ids: Sequence[int]) -> None:
    """被检索到的 summary_id 可能存在无效或重复，过滤后批量更新该信息的被唤醒次数和最后一次被唤醒的时间。"""
    ids = [int(x) for x in summary_ids if x is not None]
    if not ids:
        return
    async with await psycopg.AsyncConnection.connect(_dsn()) as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                UPDATE ai.session_summary
                SET recall_count = recall_count + 1,
                    last_recalled_at = NOW()
                WHERE id = ANY(%s)
                """,
                (ids,),
            )
            await conn.commit()


async def list_session_summaries(user_id: int, limit: int = 50) -> list[dict]:
    async with await psycopg.AsyncConnection.connect(_dsn(), row_factory=dict_row) as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                SELECT id, summary, quality_score, recall_count,
                       last_recalled_at, archived
                FROM ai.session_summary
                WHERE user_id = %s
                ORDER BY archived ASC,
                         COALESCE(last_recalled_at, create_time) DESC
                LIMIT %s
                """,
                (int(user_id), int(limit)),
            )
            rows = list(await cur.fetchall())

    out: list[dict] = []
    for r in rows:
        out.append(
            {
                "id": int(r["id"]),
                "summary": r["summary"],
                "quality_score": float(r["quality_score"]) if r.get("quality_score") is not None else None,
                "recall_count": int(r["recall_count"]) if r.get("recall_count") is not None else 0,
                "last_recalled_at": r["last_recalled_at"].isoformat() if r.get("last_recalled_at") else None,
                "archived": bool(r["archived"]),
            }
        )
    return out
