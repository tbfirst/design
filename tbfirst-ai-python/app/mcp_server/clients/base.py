from __future__ import annotations

from typing import Any

import httpx


class JsonHttpClient:
    def __init__(self, base_url: str, *, timeout: float = 120.0, headers: dict[str, str] | None = None):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.headers = headers or {}

    async def get(self, path: str) -> dict[str, Any]:
        return await self.request("GET", path)

    async def post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        return await self.request("POST", path, json=payload)

    async def request(self, method: str, path: str, **kwargs: Any) -> dict[str, Any]:
        url = self.base_url + (path if path.startswith("/") else f"/{path}")
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.request(method, url, headers=self.headers, **kwargs)
        response.raise_for_status()
        payload = response.json()
        return payload if isinstance(payload, dict) else {"value": payload}
