from __future__ import annotations

from typing import Any

import httpx

from app.config import get_settings
from app.mcp_server.context import McpContext


class GatewayClient:
    def __init__(self, ctx: McpContext):
        settings = get_settings()
        self.base_url = settings.tbfirst_mcp_gateway_url.rstrip("/")
        self.ctx = ctx

    async def get(self, path: str) -> dict[str, Any]:
        return await self._request("GET", path)

    async def post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        return await self._request("POST", path, json=payload)

    async def put(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        return await self._request("PUT", path, json=payload)

    async def upload_assets(self, data_uris: list[str], phase: str) -> list[str]:
        data = await self.post("/api/image/mcp/image/upload-assets", {"dataUris": data_uris, "phase": phase})
        urls = data.get("urls") if isinstance(data, dict) else None
        return [str(url) for url in (urls or [])]

    async def generate_image(self, payload: dict[str, Any]) -> dict[str, Any]:
        return await self.post("/api/image/mcp/image/generate", payload)

    async def get_image_job(self, job_id: int) -> dict[str, Any]:
        return await self.get(f"/api/image/mcp/image/jobs/{job_id}")

    async def _request(self, method: str, path: str, **kwargs: Any) -> dict[str, Any]:
        headers = self._headers()
        url = self.base_url + (path if path.startswith("/") else f"/{path}")
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.request(method, url, headers=headers, **kwargs)
        resp.raise_for_status()
        payload = resp.json()
        if isinstance(payload, dict) and {"code", "data"}.issubset(payload.keys()):
            if payload.get("code") != 0:
                raise RuntimeError(payload.get("msg") or f"gateway call failed: {path}")
            data = payload.get("data")
            return data if isinstance(data, dict) else {"value": data}
        return payload if isinstance(payload, dict) else {"value": payload}

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
            headers["X-User-Roles"] = ",".join(str(role) for role in self.ctx.roles if str(role).strip())
        if self.ctx.group_id:
            headers["X-User-Group-Id"] = self.ctx.group_id
        if self.ctx.group_role:
            headers["X-User-Group-Role"] = self.ctx.group_role
        if self.ctx.authorization:
            headers["Authorization"] = self.ctx.authorization
        return headers
