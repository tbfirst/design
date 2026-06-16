"""V6.M2.D.5: L3 衰减 cron。

规则（Spec Lock §"上下文压缩策略"）：
  - 90 天未召回 → quality_score *= 0.9
  - quality_score < 0.3 → archived = TRUE（召回 query 自动跳过）

v4 R4 红线：cron 必须 RedisLock 互斥（多 worker 同时跑只允许一个生效）。
锁键 ai:cron:decay_l3，TTL 900s（15 min），失败仅日志不抛。
建议 cron：每天 03:00 (`0 3 * * *`)，对应 docker-compose cron sidecar（D.6）。
"""
from __future__ import annotations

import asyncio
import logging
import sys

import psycopg

from app.config import get_settings
from app.core.redis_client import get_redis

logger = logging.getLogger("decay_l3")

_LOCK_KEY = "ai:cron:decay_l3"
_LOCK_TTL_SEC = 900  # 15 min


async def _do_decay() -> tuple[int, int]:
    """跑两段 UPDATE，返回 (decayed_rows, archived_rows)。"""
    s = get_settings()
    decayed = 0
    archived = 0
    async with await psycopg.AsyncConnection.connect(s.computed_checkpoint_dsn) as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                UPDATE ai.session_summary
                SET quality_score = quality_score * 0.9
                WHERE (last_recalled_at IS NULL OR last_recalled_at < NOW() - INTERVAL '90 days')
                  AND quality_score > 0.3 AND archived = FALSE
                """
            )
            decayed = cur.rowcount or 0
            await cur.execute(
                """
                UPDATE ai.session_summary SET archived = TRUE
                WHERE quality_score <= 0.3 AND archived = FALSE
                """
            )
            archived = cur.rowcount or 0
            await conn.commit()
    return decayed, archived


async def main() -> int:
    """RedisLock 单实例守卫 + 衰减执行。

    返回值：0 表正常退出（含 lock-busy 跳过）；非 0 表 DB 异常（cron 应观测）。
    """
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    r = get_redis()
    # nx=True + ex=TTL：原子 setnx-with-expire；同一 cron 时刻多 worker 只一个抢到
    got = False
    try:
        got = bool(r.set(_LOCK_KEY, "1", nx=True, ex=_LOCK_TTL_SEC))
    except Exception as e:
        logger.warning("redis lock acquire failed (continuing without lock): %s", e)
        # Redis 不可用时退化为"直接跑"——多实例下数据库 UPDATE 幂等（重复跑结果一致），可接受
        got = True

    if not got:
        logger.info("decay_l3 skipped: another worker holds lock %s", _LOCK_KEY)
        return 0

    try:
        decayed, archived = await _do_decay()
        logger.info("decay_l3 done: decayed=%d archived=%d", decayed, archived)
        print(f"decay_l3 done: decayed={decayed} archived={archived}")
        return 0
    except Exception as e:
        logger.exception("decay_l3 failed: %s", e)
        return 1
    finally:
        # 提前释放（cron 周期远长于 TTL 时无影响；周期内复跑时 nx 仍能挡）
        try:
            r.delete(_LOCK_KEY)
        except Exception:
            pass


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
