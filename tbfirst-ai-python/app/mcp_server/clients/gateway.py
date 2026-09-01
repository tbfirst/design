from __future__ import annotations

import asyncio
import logging
import threading
from typing import Any

import httpx

from app.agent.graph.compression.circuit_breaker import CircuitBreaker, CircuitOpenError
from app.config import get_settings
from app.mcp_server.context import McpContext
from app.mcp_server.errors import McpToolError

logger = logging.getLogger(__name__)

_shared_http_client: httpx.AsyncClient | None = None
_gateway_breaker: CircuitBreaker | None = None
_client_lock = threading.Lock()
_RETRYABLE_STATUS = {408, 502, 503, 504}


def _get_shared_client() -> httpx.AsyncClient:
    global _shared_http_client
    if _shared_http_client is None:
        with _client_lock:
            if _shared_http_client is None:
                settings = get_settings()
                timeout = httpx.Timeout(
                    settings.tbfirst_mcp_http_timeout_seconds,
                    connect=min(10.0, settings.tbfirst_mcp_http_timeout_seconds),
                )
                _shared_http_client = httpx.AsyncClient(
                    timeout=timeout,
                    limits=httpx.Limits(
                        max_connections=100,
                        max_keepalive_connections=20,
                        keepalive_expiry=30,
                    ),
                    trust_env=False,
                )
    return _shared_http_client


async def close_gateway_client() -> None:
    global _shared_http_client
    with _client_lock:
        client, _shared_http_client = _shared_http_client, None
    if client is not None:
        await client.aclose()


def _get_gateway_breaker() -> CircuitBreaker:
    global _gateway_breaker
    if _gateway_breaker is None:
        with _client_lock:
            if _gateway_breaker is None:
                settings = get_settings()
                _gateway_breaker = CircuitBreaker(
                    cooldown_seconds=settings.tbfirst_mcp_circuit_initial_open_seconds,
                    max_cooldown_seconds=settings.tbfirst_mcp_circuit_max_open_seconds,
                )
    return _gateway_breaker


class GatewayClient:
    def __init__(
        self,
        ctx: McpContext,
        *,
        client: httpx.AsyncClient | None = None,
        breaker: CircuitBreaker | None = None,
    ):
        settings = get_settings()
        self.base_url = settings.tbfirst_mcp_gateway_url.rstrip("/")
        self.ctx = ctx
        self.client = client or _get_shared_client()
        self.breaker = breaker or _get_gateway_breaker()
        self.retry_attempts = max(1, settings.tbfirst_mcp_retry_attempts)

    async def get(self, path: str) -> dict[str, Any]:
        return await self._request("GET", path)

    async def post(
        self,
        path: str,
        payload: dict[str, Any],
        *,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        return await self._request(
            "POST", path, json=payload, idempotency_key=idempotency_key
        )

    async def put(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        return await self._request("PUT", path, json=payload)

    async def upload_assets(self, data_uris: list[str], phase: str) -> list[str]:
        data = await self.post(
            "/api/image/mcp/image/upload-assets",
            {"dataUris": data_uris, "phase": phase},
        )
        urls = data.get("urls") if isinstance(data, dict) else None
        return [str(url) for url in (urls or [])]

    async def generate_image(self, payload: dict[str, Any]) -> dict[str, Any]:
        request_id = str(payload.get("requestId") or payload.get("request_id") or "").strip()
        return await self.post(
            "/api/image/mcp/image/generate",
            payload,
            idempotency_key=request_id or None,
        )

    async def get_image_job(self, job_id: int) -> dict[str, Any]:
        return await self.get(f"/api/image/mcp/image/jobs/{job_id}")

    async def _request(
        self,
        method: str,
        path: str,
        *,
        idempotency_key: str | None = None,
        **kwargs: Any,
    ) -> dict[str, Any]:
        headers = self._headers()
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key[:128]
        url = self.base_url + (path if path.startswith("/") else f"/{path}")
        retryable_method = method in {"GET", "HEAD", "OPTIONS"} or bool(idempotency_key)
        attempts = self.retry_attempts if retryable_method else 1

        try:
            self.breaker.check()
        except CircuitOpenError as exc:
            raise McpToolError(
                f"Design gateway is recovering; retry after {exc.retry_after_seconds:.1f}s.",
                status_code=503,
            ) from exc

        try:
            for attempt in range(attempts):
                try:
                    response = await self.client.request(
                        method, url, headers=headers, **kwargs
                    )
                except httpx.TransportError:
                    if attempt + 1 < attempts:
                        await asyncio.sleep(_backoff(attempt))
                        continue
                    raise

                if response.status_code in _RETRYABLE_STATUS and attempt + 1 < attempts:
                    await asyncio.sleep(_retry_delay(response, attempt))
                    continue
                if response.status_code == 429:
                    raise McpToolError(
                        "Design gateway rate limit reached; retry shortly.",
                        status_code=429,
                    )
                response.raise_for_status()
                payload = response.json()
                data = _unwrap(payload, path)
                self.breaker.succeed()
                return data
        except McpToolError as exc:
            if exc.status_code >= 500:
                self.breaker.fail()
            else:
                self.breaker.succeed()
            raise
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code >= 500:
                self.breaker.fail()
            else:
                self.breaker.succeed()
            raise McpToolError(
                f"Design gateway returned HTTP {exc.response.status_code}.",
                status_code=502 if exc.response.status_code >= 500 else exc.response.status_code,
            ) from exc
        except (httpx.TransportError, ValueError) as exc:
            self.breaker.fail()
            raise McpToolError("Design gateway is unavailable.", status_code=502) from exc

        self.breaker.fail()
        raise McpToolError("Design gateway request exhausted retries.", status_code=502)

    def _headers(self) -> dict[str, str]:
        settings = get_settings()
        headers = {
            "X-MCP-Client": self.ctx.client,
            "X-MCP-Request-Id": self.ctx.trace_id,
            "X-Internal-Token": settings.internal_token,
        }
        if self.ctx.user_id:
            headers["X-User-Id"] = self.ctx.user_id
        if self.ctx.username:
            headers["X-User-Name"] = self.ctx.username
        if self.ctx.roles:
            headers["X-User-Roles"] = ",".join(
                str(role) for role in self.ctx.roles if str(role).strip()
            )
        if self.ctx.group_id:
            headers["X-User-Group-Id"] = self.ctx.group_id
        if self.ctx.group_role:
            headers["X-User-Group-Role"] = self.ctx.group_role
        if self.ctx.authorization:
            headers["Authorization"] = self.ctx.authorization
        return headers


def _unwrap(payload: Any, path: str) -> dict[str, Any]:
    if isinstance(payload, dict) and "code" in payload:
        if payload.get("code") != 0:
            code = int(payload.get("code") or 502)
            raise McpToolError(
                str(payload.get("msg") or f"gateway call failed: {path}"),
                status_code=code if 400 <= code < 600 else 502,
            )
        data = payload.get("data")
        return data if isinstance(data, dict) else {"value": data}
    return payload if isinstance(payload, dict) else {"value": payload}


def _backoff(attempt: int) -> float:
    return min(2.0, 0.2 * (2 ** attempt))


def _retry_delay(response: httpx.Response, attempt: int) -> float:
    raw = response.headers.get("Retry-After")
    try:
        return min(5.0, max(0.05, float(raw))) if raw else _backoff(attempt)
    except ValueError:
        return _backoff(attempt)
