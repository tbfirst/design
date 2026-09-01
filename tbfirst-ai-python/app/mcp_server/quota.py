from __future__ import annotations

from datetime import datetime, timedelta

import redis.asyncio as redis

from app.config import get_settings
from app.mcp_server.context import McpContext
from app.mcp_server.errors import McpToolError
from app.mcp_server.schemas import ToolSpec

_MEMORY_COUNTS: dict[str, int] = {}


async def check_and_consume(spec: ToolSpec, ctx: McpContext) -> None:
    if not spec.policy.quota_type:
        return
    settings = get_settings()
    user_key = _key("user", ctx.user_id or "anonymous", spec.policy.quota_type)
    await _increment_or_reject(user_key, settings.tbfirst_mcp_user_daily_default)
    if ctx.group_id:
        group_key = _key("group", ctx.group_id, spec.policy.quota_type)
        await _increment_or_reject(group_key, settings.tbfirst_mcp_group_daily_default)


async def _increment_or_reject(key: str, limit: int) -> None:
    if limit <= 0:
        return
    try:
        current = await _redis_increment(key)
    except Exception:
        current = _memory_increment(key)
    if current > limit:
        raise McpToolError(f"MCP daily quota exceeded for {key}.", status_code=429)


async def _redis_increment(key: str) -> int:
    settings = get_settings()
    client = redis.Redis(
        host=settings.redis_host,
        port=settings.redis_port,
        db=settings.redis_db,
        decode_responses=True,
        socket_connect_timeout=0.5,
        socket_timeout=0.5,
    )
    try:
        value = await client.incr(key)
        if value == 1:
            await client.expire(key, _seconds_until_tomorrow())
        return int(value)
    finally:
        await client.aclose()


def _memory_increment(key: str) -> int:
    _MEMORY_COUNTS[key] = _MEMORY_COUNTS.get(key, 0) + 1
    return _MEMORY_COUNTS[key]


def _key(scope: str, subject: str, quota_type: str) -> str:
    day = datetime.now().strftime("%Y%m%d")
    return f"tbfirst:mcp:quota:{scope}:{subject}:{quota_type}:{day}"


def _seconds_until_tomorrow() -> int:
    now = datetime.now()
    tomorrow = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return max(60, int((tomorrow - now).total_seconds()))
