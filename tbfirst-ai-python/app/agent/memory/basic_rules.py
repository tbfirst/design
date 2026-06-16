"""L1 基础规则加载器（PG ai.basic_rules）。"""
from __future__ import annotations
from typing import Optional
import psycopg
from psycopg.rows import dict_row
from app.config import get_settings

_DSN = None
def _dsn() -> str:
    global _DSN
    if _DSN is None:
        s = get_settings()
        _DSN = f"postgresql://{s.db_user}:{s.db_password}@{s.db_host}:{s.db_port}/{s.db_name}"
    return _DSN

async def load_basic_rules(user_id: int, brand_id: Optional[int] = None, group_id: Optional[int] = None) -> str:
    """加载基础规则，优先级 global < group < brand，同一 scope 内按 version 降序取最新。"""
    async with await psycopg.AsyncConnection.connect(_dsn(), row_factory=dict_row) as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                SELECT scope, category, body
                FROM ai.basic_rules
                WHERE is_active = TRUE AND (
                    (scope = 'global') OR
                    (scope = 'group' AND scope_ref_id = %s) OR
                    (scope = 'brand' AND scope_ref_id = %s)
                )
                ORDER BY
                    CASE scope WHEN 'global' THEN 0 WHEN 'group' THEN 1 ELSE 2 END,
                    category,
                    version DESC
                """,
                (group_id, brand_id),
            )
            rows = await cur.fetchall()
    if not rows:
        return ""
    parts = ["# 基础规则 (always-inject, immutable in dialog)"]
    for r in rows:
        parts.append(f"### [{r['scope']}/{r['category']}]\n{r['body']}")
    return "\n\n".join(parts)


async def list_basic_rules(scope: Optional[str] = None, scope_ref_id: Optional[int] = None, active_only: bool = True) -> list[dict]:
    async with await psycopg.AsyncConnection.connect(_dsn(), row_factory=dict_row) as conn:
        async with conn.cursor() as cur:
            sql = "SELECT * FROM ai.basic_rules WHERE 1=1"
            params: list = []
            if scope:
                sql += " AND scope = %s"
                params.append(scope)
            if scope_ref_id is not None:
                sql += " AND scope_ref_id = %s"
                params.append(scope_ref_id)
            if active_only:
                sql += " AND is_active = TRUE"
            sql += " ORDER BY scope, category, version DESC, id DESC"
            await cur.execute(sql, tuple(params))
            return list(await cur.fetchall())


async def upsert_basic_rules(scope: str, scope_ref_id: Optional[int], category: str, body: str, created_by: Optional[int]) -> int:
    async with await psycopg.AsyncConnection.connect(_dsn(), row_factory=dict_row) as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                UPDATE ai.basic_rules SET is_active = FALSE, update_time = NOW()
                WHERE scope = %s AND scope_ref_id IS NOT DISTINCT FROM %s AND category = %s AND is_active = TRUE
                """,
                (scope, scope_ref_id, category),
            )
            await cur.execute(
                "SELECT COALESCE(MAX(version), 0) + 1 AS v FROM ai.basic_rules WHERE scope=%s AND scope_ref_id IS NOT DISTINCT FROM %s AND category=%s",
                (scope, scope_ref_id, category),
            )
            next_version = (await cur.fetchone())["v"]
            await cur.execute(
                """
                INSERT INTO ai.basic_rules (scope, scope_ref_id, category, body, version, is_active, created_by)
                VALUES (%s, %s, %s, %s, %s, TRUE, %s)
                RETURNING id
                """,
                (scope, scope_ref_id, category, body, next_version, created_by),
            )
            new_id = (await cur.fetchone())["id"]
            await conn.commit()
            return new_id


async def soft_delete_basic_rules(basic_rule_id: int) -> None:
    async with await psycopg.AsyncConnection.connect(_dsn()) as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "UPDATE ai.basic_rules SET is_active = FALSE, update_time = NOW() WHERE id = %s",
                (basic_rule_id,),
            )
            await conn.commit()
