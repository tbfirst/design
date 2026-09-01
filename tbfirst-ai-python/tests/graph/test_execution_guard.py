from __future__ import annotations

import asyncio

import pytest

import app.agent.execution_guard as guard
from app.agent.execution_guard import ExecutionStatus, acquire_execution


class _UnavailableRedis:
    async def eval(self, *_args, **_kwargs):
        raise ConnectionError("redis unavailable")


@pytest.fixture(autouse=True)
def _clear_memory_guard(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(guard, "get_async_redis", lambda: _UnavailableRedis())
    guard._memory_requests.clear()
    guard._memory_sessions.clear()
    yield
    guard._memory_requests.clear()
    guard._memory_sessions.clear()


def test_serializes_session_and_deduplicates_completed_request():
    async def scenario():
        first, lease = await acquire_execution(
            user_id=7, session_uuid="session-123", request_id="request-123"
        )
        assert first.status is ExecutionStatus.ACQUIRED
        assert lease is not None

        duplicate, duplicate_lease = await acquire_execution(
            user_id=7, session_uuid="session-123", request_id="request-123"
        )
        assert duplicate.status is ExecutionStatus.DUPLICATE_RUNNING
        assert duplicate_lease is None

        busy, busy_lease = await acquire_execution(
            user_id=7, session_uuid="session-123", request_id="request-456"
        )
        assert busy.status is ExecutionStatus.SESSION_BUSY
        assert busy_lease is None

        await lease.finish(completed=True)
        replay, replay_lease = await acquire_execution(
            user_id=7, session_uuid="session-123", request_id="request-123"
        )
        assert replay.status is ExecutionStatus.DUPLICATE_COMPLETED
        assert replay_lease is None

    asyncio.run(scenario())


def test_failed_request_releases_session_for_retry():
    async def scenario():
        _, lease = await acquire_execution(
            user_id=7, session_uuid="session-123", request_id="request-123"
        )
        assert lease is not None
        await lease.finish(completed=False)

        retry, retry_lease = await acquire_execution(
            user_id=7, session_uuid="session-123", request_id="request-123"
        )
        assert retry.status is ExecutionStatus.ACQUIRED
        assert retry_lease is not None
        await retry_lease.finish(completed=False)

    asyncio.run(scenario())
