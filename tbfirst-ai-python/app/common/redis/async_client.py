"""Shared asyncio Redis client for request-path coordination."""
from __future__ import annotations

import redis.asyncio as redis

from app.config import get_settings

_client: redis.Redis | None = None


def get_async_redis() -> redis.Redis:
    global _client
    if _client is None:
        settings = get_settings()
        _client = redis.Redis(
            host=settings.redis_host,
            port=settings.redis_port,
            db=settings.redis_db,
            decode_responses=True,
            socket_connect_timeout=0.5,
            socket_timeout=1.0,
            health_check_interval=30,
            max_connections=50,
        )
    return _client


async def close_async_redis() -> None:
    global _client
    client, _client = _client, None
    if client is not None:
        await client.aclose()
