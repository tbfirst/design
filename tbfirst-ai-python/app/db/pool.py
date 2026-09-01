from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from psycopg import AsyncConnection
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from app.config import get_settings


_pool: AsyncConnectionPool | None = None
_pool_loop: asyncio.AbstractEventLoop | None = None
_open_lock: asyncio.Lock | None = None


def _new_pool() -> AsyncConnectionPool:
    settings = get_settings()
    return AsyncConnectionPool(
        conninfo=settings.computed_checkpoint_dsn,
        min_size=settings.agent_db_pool_min_size,
        max_size=settings.agent_db_pool_max_size,
        timeout=settings.agent_db_pool_timeout_seconds,
        kwargs={"row_factory": dict_row},
        open=False,
        name="agent-db",
    )


async def open_agent_db_pool() -> AsyncConnectionPool:
    """Open the process-wide pool lazily on the active event loop."""
    global _pool, _pool_loop, _open_lock

    loop = asyncio.get_running_loop()
    if _pool is None or _pool_loop is not loop:
        _pool = _new_pool()
        _pool_loop = loop
        _open_lock = asyncio.Lock()

    assert _open_lock is not None
    async with _open_lock:
        if _pool.closed:
            await _pool.open(wait=True)
    return _pool


@asynccontextmanager
async def agent_db_connection() -> AsyncIterator[AsyncConnection]:
    settings = get_settings()
    pool = await open_agent_db_pool()
    async with pool.connection(timeout=settings.agent_db_pool_timeout_seconds) as conn:
        yield conn


async def close_agent_db_pool() -> None:
    global _pool, _pool_loop, _open_lock

    pool = _pool
    _pool = None
    _pool_loop = None
    _open_lock = None
    if pool is not None and not pool.closed:
        await pool.close()
