from __future__ import annotations

import asyncio
import httpx
import pytest

from app.agent.graph.compression.circuit_breaker import CircuitBreaker, CircuitState
from app.mcp_server.clients.gateway import GatewayClient
from app.mcp_server.context import McpContext
from app.mcp_server.errors import McpToolError
from app.mcp_server import quota


def _ctx() -> McpContext:
    return McpContext(
        trace_id="trace-1",
        authorization="Bearer test",
        user_id="7",
        roles=["USER"],
        group_id="9",
    )


def test_gateway_retries_only_idempotent_post_and_forwards_key():
    seen: list[httpx.Request] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if len(seen) == 1:
            return httpx.Response(503, json={"code": 503, "msg": "busy"})
        return httpx.Response(200, json={"code": 0, "data": {"status": "pending", "jobId": 5}})

    async def scenario():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            gateway = GatewayClient(
                _ctx(),
                client=client,
                breaker=CircuitBreaker(cooldown_seconds=1, max_cooldown_seconds=2),
            )
            return await gateway.generate_image({"requestId": "design-run-1", "prompt": "x"})

    result = asyncio.run(scenario())
    assert result["jobId"] == 5
    assert len(seen) == 2
    assert all(request.headers["Idempotency-Key"] == "design-run-1" for request in seen)


def test_non_idempotent_post_does_not_retry_and_opens_breaker():
    calls = 0

    async def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(503, json={"code": 503, "msg": "down"})

    breaker = CircuitBreaker(cooldown_seconds=10, max_cooldown_seconds=20)
    async def scenario():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            gateway = GatewayClient(_ctx(), client=client, breaker=breaker)
            return await gateway.post("/unsafe", {"value": 1})

    with pytest.raises(McpToolError) as exc:
        asyncio.run(scenario())
    assert exc.value.status_code == 502
    assert calls == 1
    assert breaker.state is CircuitState.OPEN


def test_rate_limit_is_not_retried_or_recorded_as_dependency_failure():
    calls = 0

    async def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(429, headers={"Retry-After": "3600"})

    breaker = CircuitBreaker(cooldown_seconds=10, max_cooldown_seconds=20)

    async def scenario():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            gateway = GatewayClient(_ctx(), client=client, breaker=breaker)
            return await gateway.generate_image({"requestId": "design-run-2", "prompt": "x"})

    with pytest.raises(McpToolError) as exc:
        asyncio.run(scenario())
    assert exc.value.status_code == 429
    assert calls == 1
    assert breaker.state is CircuitState.CLOSED


def test_memory_quota_denial_does_not_partially_debit_group():
    async def scenario():
        quota._memory_buckets.clear()
        await quota._memory_consume("user", "unused", 1, 0, 1, 100)

        denied = await quota._memory_consume("user", "group", 1, 2, 1, 100)
        assert not denied.allowed
        assert denied.group_remaining == 2

        group_only = await quota._memory_consume("unlimited", "group", 0, 2, 2, 100)
        assert group_only.allowed
        assert group_only.group_remaining == 0

    asyncio.run(scenario())
