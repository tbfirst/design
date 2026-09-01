from __future__ import annotations

import asyncio
import hashlib
import time
import uuid
from dataclasses import dataclass
from enum import Enum
from threading import Lock

from app.common.redis.async_client import get_async_redis
from app.config import get_settings


_ACQUIRE_LUA = r"""
local request_state = redis.call('GET', KEYS[1])
local lock_owner = redis.call('GET', KEYS[2])

if request_state == 'completed' then
  return {2, 0}
end
if request_state and string.sub(request_state, 1, 8) == 'running:' then
  if lock_owner then
    return {3, math.max(0, redis.call('PTTL', KEYS[2]))}
  end
  redis.call('DEL', KEYS[1])
end
if lock_owner then
  return {4, math.max(0, redis.call('PTTL', KEYS[2]))}
end

redis.call('SET', KEYS[2], ARGV[1], 'PX', ARGV[2])
redis.call('SET', KEYS[1], 'running:' .. ARGV[1], 'PX', ARGV[3])
return {1, tonumber(ARGV[2])}
"""

_RENEW_LUA = r"""
if redis.call('GET', KEYS[1]) == 'running:' .. ARGV[1]
   and redis.call('GET', KEYS[2]) == ARGV[1] then
  redis.call('PEXPIRE', KEYS[1], ARGV[3])
  redis.call('PEXPIRE', KEYS[2], ARGV[2])
  return 1
end
return 0
"""

_FINISH_LUA = r"""
if redis.call('GET', KEYS[2]) == ARGV[1] then
  redis.call('DEL', KEYS[2])
end
if redis.call('GET', KEYS[1]) == 'running:' .. ARGV[1] then
  if ARGV[2] == '1' then
    redis.call('SET', KEYS[1], 'completed', 'PX', ARGV[3])
  else
    redis.call('DEL', KEYS[1])
  end
end
return 1
"""


class ExecutionStatus(str, Enum):
    ACQUIRED = "acquired"
    DUPLICATE_COMPLETED = "duplicate_completed"
    DUPLICATE_RUNNING = "duplicate_running"
    SESSION_BUSY = "session_busy"


@dataclass(frozen=True)
class ExecutionDecision:
    status: ExecutionStatus
    retry_after_seconds: float = 0.0


@dataclass
class _MemoryEntry:
    value: str
    expires_at: float


_memory_requests: dict[str, _MemoryEntry] = {}
_memory_sessions: dict[str, _MemoryEntry] = {}
_memory_lock = Lock()
_MAX_MEMORY_REQUESTS = 4096


class ExecutionLease:
    def __init__(
        self,
        *,
        request_key: str,
        session_key: str,
        owner: str,
        lease_seconds: int,
        dedupe_seconds: int,
        backend: str,
    ) -> None:
        self.request_key = request_key
        self.session_key = session_key
        self.owner = owner
        self.lease_seconds = lease_seconds
        self.dedupe_seconds = dedupe_seconds
        self.backend = backend

    async def keep_alive(self, stop: asyncio.Event) -> None:
        interval = max(1.0, self.lease_seconds / 3)
        while not stop.is_set():
            try:
                await asyncio.wait_for(stop.wait(), timeout=interval)
            except TimeoutError:
                await self._renew()

    async def finish(self, *, completed: bool) -> None:
        if self.backend == "redis":
            try:
                await get_async_redis().eval(
                    _FINISH_LUA,
                    2,
                    self.request_key,
                    self.session_key,
                    self.owner,
                    "1" if completed else "0",
                    self.dedupe_seconds * 1000,
                )
                return
            except Exception:
                return
        _memory_finish(self, completed=completed)

    async def _renew(self) -> None:
        if self.backend == "redis":
            try:
                await get_async_redis().eval(
                    _RENEW_LUA,
                    2,
                    self.request_key,
                    self.session_key,
                    self.owner,
                    self.lease_seconds * 1000,
                    self.dedupe_seconds * 1000,
                )
            except Exception:
                return
        else:
            _memory_renew(self)


async def acquire_execution(
    *,
    user_id: int,
    session_uuid: str,
    request_id: str,
) -> tuple[ExecutionDecision, ExecutionLease | None]:
    settings = get_settings()
    lease_seconds = max(15, settings.agent_execution_lease_seconds)
    dedupe_seconds = max(lease_seconds * 2, settings.agent_request_dedupe_seconds)
    request_key, session_key = _keys(user_id, session_uuid, request_id)
    owner = uuid.uuid4().hex

    try:
        raw = await get_async_redis().eval(
            _ACQUIRE_LUA,
            2,
            request_key,
            session_key,
            owner,
            lease_seconds * 1000,
            dedupe_seconds * 1000,
        )
        code, retry_ms = int(raw[0]), int(raw[1])
        decision = _decision(code, retry_ms)
        backend = "redis"
    except Exception:
        decision = _memory_acquire(
            request_key,
            session_key,
            owner,
            lease_seconds,
            dedupe_seconds,
        )
        backend = "memory"

    if decision.status is not ExecutionStatus.ACQUIRED:
        return decision, None
    return decision, ExecutionLease(
        request_key=request_key,
        session_key=session_key,
        owner=owner,
        lease_seconds=lease_seconds,
        dedupe_seconds=dedupe_seconds,
        backend=backend,
    )


def _keys(user_id: int, session_uuid: str, request_id: str) -> tuple[str, str]:
    session_digest = hashlib.sha256(f"{user_id}:{session_uuid}".encode()).hexdigest()
    request_digest = hashlib.sha256(
        f"{user_id}:{session_uuid}:{request_id}".encode()
    ).hexdigest()
    return f"agent:request:{request_digest}", f"agent:session:{session_digest}"


def _decision(code: int, retry_ms: int) -> ExecutionDecision:
    statuses = {
        1: ExecutionStatus.ACQUIRED,
        2: ExecutionStatus.DUPLICATE_COMPLETED,
        3: ExecutionStatus.DUPLICATE_RUNNING,
        4: ExecutionStatus.SESSION_BUSY,
    }
    return ExecutionDecision(statuses.get(code, ExecutionStatus.SESSION_BUSY), retry_ms / 1000)


def _memory_acquire(
    request_key: str,
    session_key: str,
    owner: str,
    lease_seconds: int,
    dedupe_seconds: int,
) -> ExecutionDecision:
    now = time.monotonic()
    with _memory_lock:
        _trim_memory(now)
        request = _live(_memory_requests, request_key, now)
        session = _live(_memory_sessions, session_key, now)
        if request and request.value == "completed":
            return ExecutionDecision(ExecutionStatus.DUPLICATE_COMPLETED)
        if request and request.value.startswith("running:"):
            if session:
                return ExecutionDecision(
                    ExecutionStatus.DUPLICATE_RUNNING,
                    max(0.0, session.expires_at - now),
                )
            _memory_requests.pop(request_key, None)
        if session:
            return ExecutionDecision(
                ExecutionStatus.SESSION_BUSY,
                max(0.0, session.expires_at - now),
            )
        _memory_sessions[session_key] = _MemoryEntry(owner, now + lease_seconds)
        _memory_requests[request_key] = _MemoryEntry(
            f"running:{owner}", now + dedupe_seconds
        )
    return ExecutionDecision(ExecutionStatus.ACQUIRED, float(lease_seconds))


def _memory_renew(lease: ExecutionLease) -> None:
    now = time.monotonic()
    with _memory_lock:
        session = _live(_memory_sessions, lease.session_key, now)
        request = _live(_memory_requests, lease.request_key, now)
        if session and session.value == lease.owner and request and request.value == f"running:{lease.owner}":
            session.expires_at = now + lease.lease_seconds
            request.expires_at = now + lease.dedupe_seconds


def _memory_finish(lease: ExecutionLease, *, completed: bool) -> None:
    now = time.monotonic()
    with _memory_lock:
        session = _memory_sessions.get(lease.session_key)
        if session and session.value == lease.owner:
            _memory_sessions.pop(lease.session_key, None)
        request = _memory_requests.get(lease.request_key)
        if request and request.value == f"running:{lease.owner}":
            if completed:
                _memory_requests[lease.request_key] = _MemoryEntry(
                    "completed", now + lease.dedupe_seconds
                )
            else:
                _memory_requests.pop(lease.request_key, None)


def _live(entries: dict[str, _MemoryEntry], key: str, now: float) -> _MemoryEntry | None:
    entry = entries.get(key)
    if entry and entry.expires_at <= now:
        entries.pop(key, None)
        return None
    return entry


def _trim_memory(now: float) -> None:
    for entries in (_memory_requests, _memory_sessions):
        for key in [key for key, entry in entries.items() if entry.expires_at <= now]:
            entries.pop(key, None)
        while len(entries) > _MAX_MEMORY_REQUESTS:
            entries.pop(next(iter(entries)))
