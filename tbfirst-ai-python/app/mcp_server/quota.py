"""Atomic user/group token-bucket quota for design tools."""
from __future__ import annotations

import asyncio
import math
import time
from dataclasses import dataclass

from app.common.redis.async_client import get_async_redis
from app.config import get_settings
from app.mcp_server.context import McpContext
from app.mcp_server.errors import McpToolError
from app.mcp_server.schemas import ToolSpec

_TOKEN_BUCKET_LUA = r"""
local t = redis.call('TIME')
local now = (tonumber(t[1]) * 1000) + math.floor(tonumber(t[2]) / 1000)
local period = tonumber(ARGV[1])
local cost = tonumber(ARGV[2])
local user_cap = tonumber(ARGV[3])
local group_cap = tonumber(ARGV[4])
local ttl = math.max(period * 2, 60000)

local function load_bucket(key, cap)
  if cap <= 0 then return cap, now end
  local values = redis.call('HMGET', key, 'tokens', 'updated_ms')
  local tokens = tonumber(values[1]) or cap
  local updated = tonumber(values[2]) or now
  local elapsed = math.max(0, now - updated)
  tokens = math.min(cap, tokens + (elapsed * cap / period))
  return tokens, now
end

local user_tokens, user_updated = load_bucket(KEYS[1], user_cap)
local group_tokens, group_updated = load_bucket(KEYS[2], group_cap)
local user_ok = user_cap <= 0 or user_tokens >= cost
local group_ok = group_cap <= 0 or group_tokens >= cost

if not user_ok or not group_ok then
  local retry_ms = 0
  if not user_ok then
    retry_ms = math.max(retry_ms, math.ceil((cost - user_tokens) * period / user_cap))
  end
  if not group_ok then
    retry_ms = math.max(retry_ms, math.ceil((cost - group_tokens) * period / group_cap))
  end
  return {0, math.floor(math.max(0, user_tokens)), math.floor(math.max(0, group_tokens)), retry_ms}
end

if user_cap > 0 then
  user_tokens = user_tokens - cost
  redis.call('HSET', KEYS[1], 'tokens', user_tokens, 'updated_ms', user_updated)
  redis.call('PEXPIRE', KEYS[1], ttl)
end
if group_cap > 0 then
  group_tokens = group_tokens - cost
  redis.call('HSET', KEYS[2], 'tokens', group_tokens, 'updated_ms', group_updated)
  redis.call('PEXPIRE', KEYS[2], ttl)
end
return {1, math.floor(math.max(0, user_tokens)), math.floor(math.max(0, group_tokens)), 0}
"""


@dataclass(frozen=True)
class QuotaDecision:
    allowed: bool
    user_remaining: int
    group_remaining: int
    retry_after_seconds: float = 0.0


@dataclass
class _MemoryBucket:
    tokens: float
    updated_at: float
    expires_at: float


_memory_buckets: dict[str, _MemoryBucket] = {}
_memory_lock = asyncio.Lock()
_MAX_MEMORY_BUCKETS = 4096


async def check_and_consume(spec: ToolSpec, ctx: McpContext) -> QuotaDecision:
    if not spec.policy.quota_type:
        return QuotaDecision(True, -1, -1)
    settings = get_settings()
    cost = max(1, int(spec.policy.quota_cost))
    period_seconds = max(60, settings.tbfirst_mcp_quota_period_seconds)
    user_cap = max(0, settings.tbfirst_mcp_user_daily_default)
    group_cap = max(0, settings.tbfirst_mcp_group_daily_default) if ctx.group_id else 0
    user_key = _key("user", ctx.user_id or "anonymous", spec.policy.quota_type)
    group_key = _key("group", ctx.group_id or "none", spec.policy.quota_type)

    try:
        decision = await _redis_consume(
            user_key, group_key, user_cap, group_cap, cost, period_seconds
        )
    except Exception:
        decision = await _memory_consume(
            user_key, group_key, user_cap, group_cap, cost, period_seconds
        )
    if not decision.allowed:
        raise McpToolError(
            "Design tool quota is temporarily exhausted; "
            f"retry after {math.ceil(decision.retry_after_seconds)}s.",
            status_code=429,
        )
    return decision


async def _redis_consume(
    user_key: str,
    group_key: str,
    user_cap: int,
    group_cap: int,
    cost: int,
    period_seconds: int,
) -> QuotaDecision:
    result = await get_async_redis().eval(
        _TOKEN_BUCKET_LUA,
        2,
        user_key,
        group_key,
        period_seconds * 1000,
        cost,
        user_cap,
        group_cap,
    )
    return QuotaDecision(
        allowed=bool(int(result[0])),
        user_remaining=int(result[1]),
        group_remaining=int(result[2]),
        retry_after_seconds=max(0.0, int(result[3]) / 1000),
    )


async def _memory_consume(
    user_key: str,
    group_key: str,
    user_cap: int,
    group_cap: int,
    cost: int,
    period_seconds: int,
) -> QuotaDecision:
    async with _memory_lock:
        now = time.monotonic()
        if len(_memory_buckets) > _MAX_MEMORY_BUCKETS:
            for key in [key for key, bucket in _memory_buckets.items() if bucket.expires_at <= now]:
                _memory_buckets.pop(key, None)
            while len(_memory_buckets) > _MAX_MEMORY_BUCKETS:
                _memory_buckets.pop(next(iter(_memory_buckets)))
        user_tokens = _refill_memory(user_key, user_cap, period_seconds, now)
        group_tokens = _refill_memory(group_key, group_cap, period_seconds, now)
        deficits = []
        if user_cap > 0 and user_tokens < cost:
            deficits.append((cost - user_tokens) * period_seconds / user_cap)
        if group_cap > 0 and group_tokens < cost:
            deficits.append((cost - group_tokens) * period_seconds / group_cap)
        if deficits:
            return QuotaDecision(
                False,
                max(0, math.floor(user_tokens)),
                max(0, math.floor(group_tokens)),
                max(deficits),
            )
        if user_cap > 0:
            _memory_buckets[user_key].tokens -= cost
            user_tokens -= cost
        if group_cap > 0:
            _memory_buckets[group_key].tokens -= cost
            group_tokens -= cost
        return QuotaDecision(
            True,
            max(0, math.floor(user_tokens)),
            max(0, math.floor(group_tokens)),
        )


def _refill_memory(key: str, capacity: int, period_seconds: int, now: float) -> float:
    if capacity <= 0:
        return 0.0
    bucket = _memory_buckets.get(key)
    if bucket is None or bucket.expires_at <= now:
        bucket = _MemoryBucket(float(capacity), now, now + period_seconds * 2)
        _memory_buckets[key] = bucket
        return bucket.tokens
    elapsed = max(0.0, now - bucket.updated_at)
    bucket.tokens = min(float(capacity), bucket.tokens + elapsed * capacity / period_seconds)
    bucket.updated_at = now
    bucket.expires_at = now + period_seconds * 2
    return bucket.tokens


def _key(scope: str, subject: str, quota_type: str) -> str:
    return f"tbfirst:mcp:quota:{scope}:{subject}:{quota_type}"
