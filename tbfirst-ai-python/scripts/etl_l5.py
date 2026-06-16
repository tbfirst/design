"""V6.M2.E.4: L5 流程模板夜跑 ETL。

把"被收藏的成功生图任务"按 (user_id, phase) 聚成流程模板，写入 ai.workflow_template（L5）。
后续 retrieve_memories_node 即可按当前 phase + query 召回"这位用户/这个阶段常用的成功 prompt"。

⚠️ 规格 vs schema 偏差（已决策）：
  Spec 原文筛选条件含 `quality_score > 0.8`，但 image.generation_job **没有 quality_score 列**
  （见 infra/postgres/init.sql:156-176）。本 Sprint 不新增列（遵循"无需新列"决策 + R16），
  改用 `status = 'success'` 作为质量代理（成功产出 = 高质量近似），其余条件
  `saved = TRUE` / `last_access_at > NOW()-30d` / `deleted = 0` 保持不变。

简化聚类（Spec 明示"简化版：按 user_id + phase 聚"）：
  每个 (user_id, phase[, group_id]) 簇产出 1 条模板，sample_prompt 取簇内最近访问的那条。
  幂等：模板名定为 `auto:{phase}`，按 (user_id, name) 去重——已存在则跳过，避免夜跑累积重复。
  真正的"phase 链路聚类"（跨 phase 串成工作流）留 v6.M3。

v4 R4 红线：cron 必须 RedisLock 互斥。锁键 ai:cron:etl_l5，TTL 900s。
建议 cron：每天 02:00 (`0 2 * * *`)，对应 docker-compose cron-runner（E.4）。
"""
from __future__ import annotations

import asyncio
import logging
import sys

import psycopg
from psycopg.rows import dict_row

from app.config import get_settings
from app.core.redis_client import get_redis
from app.memory.procedural import insert_workflow

logger = logging.getLogger("etl_l5")

_LOCK_KEY = "ai:cron:etl_l5"
_LOCK_TTL_SEC = 900  # 15 min


async def _do_etl() -> int:
    """聚类 + 写模板；返回新插入的 template 行数。"""
    s = get_settings()
    inserted = 0
    async with await psycopg.AsyncConnection.connect(
        s.computed_checkpoint_dsn, row_factory=dict_row
    ) as conn:
        async with conn.cursor() as cur:
            # 1) 按 (user_id, phase, group_id) 聚类，每簇取最近访问的 prompt 作代表
            await cur.execute(
                """
                SELECT user_id, phase, group_id,
                       (array_agg(prompt ORDER BY last_access_at DESC NULLS LAST))[1] AS sample_prompt,
                       (array_agg(id ORDER BY last_access_at DESC NULLS LAST))[1] AS sample_job_id,
                       COUNT(*) AS cnt
                FROM image.generation_job
                WHERE saved = TRUE
                  AND status = 'success'
                  AND deleted = 0
                  AND last_access_at > NOW() - INTERVAL '30 days'
                  AND user_id IS NOT NULL
                  AND prompt IS NOT NULL
                GROUP BY user_id, phase, group_id
                """
            )
            clusters = list(await cur.fetchall())

            # 2) 已有 auto:* 模板名集合，去重避免夜跑累积
            await cur.execute(
                """
                SELECT user_id, name FROM ai.workflow_template
                WHERE name LIKE 'auto:%'
                """
            )
            existing = {(r["user_id"], r["name"]) for r in await cur.fetchall()}

    # 3) 逐簇 insert（insert_workflow 内部各自开连接 + 算 embedding）
    for c in clusters:
        phase = c.get("phase") or "unknown"
        name = f"auto:{phase}"
        if (c["user_id"], name) in existing:
            continue
        sample_prompt = c.get("sample_prompt") or ""
        if not sample_prompt.strip():
            continue
        await insert_workflow(
            user_id=c["user_id"],
            group_id=c.get("group_id"),
            name=name,
            phase_chain=[{"phase": phase}],
            sample_prompt=sample_prompt,
            sample_job_id=c.get("sample_job_id"),
            quality_score=0.8,
        )
        inserted += 1

    return inserted


async def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    r = get_redis()
    got = False
    try:
        got = bool(r.set(_LOCK_KEY, "1", nx=True, ex=_LOCK_TTL_SEC))
    except Exception as e:
        logger.warning("redis lock acquire failed (continuing without lock): %s", e)
        got = True

    if not got:
        logger.info("etl_l5 skipped: another worker holds lock %s", _LOCK_KEY)
        return 0

    try:
        inserted = await _do_etl()
        logger.info("etl_l5 done: inserted=%d", inserted)
        print(f"etl_l5 done: inserted={inserted}")
        return 0
    except Exception as e:
        logger.exception("etl_l5 failed: %s", e)
        return 1
    finally:
        try:
            r.delete(_LOCK_KEY)
        except Exception:
            pass


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
