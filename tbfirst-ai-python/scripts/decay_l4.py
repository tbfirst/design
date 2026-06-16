"""V6.M2.D.6: L4 月度衰减 cron。

规则（Spec Lock §"上下文压缩策略"）：
  - user_locked=false 且 90 天未注入（last_injected_at < NOW - 90d 或 NULL）→ confidence *= 0.95
  - confidence < 0.5 的偏好不删，由查询层（list_preferences / load_preferences_node）
    自然降序排到尾巴；用户在 /profile/memory 仍可手动锁定恢复。
    本 Sprint 不引新列；遵循 spec "无需新列" 决策。

v4 R4 红线：cron 必须 RedisLock 互斥。锁键 ai:cron:decay_l4，TTL 900s。
建议 cron：每月 1 号 04:00 (`0 4 1 * *`)，对应 cron/crontab.txt + docker-compose cron-runner。
"""
from __future__ import annotations

import asyncio
import logging
import sys

import psycopg

from app.config import get_settings
from app.core.redis_client import get_redis

logger = logging.getLogger("decay_l4")

_LOCK_KEY = "ai:cron:decay_l4"
_LOCK_TTL_SEC = 900


async def _do_decay() -> int:
    """对长期未注入的非锁定偏好做一次 confidence *= 0.95；返回 decayed rowcount。"""
    s = get_settings()
    decayed = 0
    async with await psycopg.AsyncConnection.connect(s.computed_checkpoint_dsn) as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                UPDATE ai.user_preference
                SET confidence = confidence * 0.95,
                    update_time = NOW()
                WHERE user_locked = FALSE
                  AND (last_injected_at IS NULL OR last_injected_at < NOW() - INTERVAL '90 days')
                  AND confidence > 0
                """
            )
            decayed = cur.rowcount or 0
            await conn.commit()
    return decayed


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
        logger.info("decay_l4 skipped: another worker holds lock %s", _LOCK_KEY)
        return 0

    try:
        decayed = await _do_decay()
        logger.info("decay_l4 done: decayed=%d", decayed)
        print(f"decay_l4 done: decayed={decayed}")
        return 0
    except Exception as e:
        logger.exception("decay_l4 failed: %s", e)
        return 1
    finally:
        try:
            r.delete(_LOCK_KEY)
        except Exception:
            pass


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
