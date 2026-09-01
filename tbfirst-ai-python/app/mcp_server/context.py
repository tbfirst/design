from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from fastapi import Request
from pydantic import BaseModel, Field

if TYPE_CHECKING:
    from mcp.server.fastmcp import Context


class McpContext(BaseModel):
    trace_id: str
    authorization: str | None = None
    user_id: str | None = None
    username: str | None = None
    roles: list[str] = Field(default_factory=list)
    group_id: str | None = None
    group_role: str | None = None
    client: str = "codex"


def context_from_request(request: Request) -> McpContext:
    headers = request.headers
    trace_id = headers.get("x-mcp-request-id") or headers.get("x-trace-id") or f"mcp-{uuid.uuid4().hex[:12]}"
    roles = [
        role.strip()
        for role in (headers.get("x-user-roles") or "").split(",")
        if role.strip()
    ]
    return McpContext(
        trace_id=trace_id,
        authorization=headers.get("authorization"),
        user_id=headers.get("x-user-id"),
        username=headers.get("x-user-name"),
        roles=roles,
        group_id=headers.get("x-user-group-id") or None,
        group_role=headers.get("x-user-group-role") or None,
        client=headers.get("x-mcp-client") or "codex",
    )


def context_from_fastmcp(ctx: "Context") -> McpContext:
    headers = {}
    try:
        request = ctx.request_context.request
        headers = getattr(request, "headers", {}) or {}
    except Exception:
        headers = {}
    trace_id = str(getattr(ctx, "request_id", None) or f"mcp-{uuid.uuid4().hex[:12]}")
    roles = [
        role.strip()
        for role in (headers.get("x-user-roles") or "").split(",")
        if role.strip()
    ]
    return McpContext(
        trace_id=headers.get("x-mcp-request-id") or headers.get("x-trace-id") or trace_id,
        authorization=headers.get("authorization"),
        user_id=headers.get("x-user-id"),
        username=headers.get("x-user-name"),
        roles=roles,
        group_id=headers.get("x-user-group-id") or None,
        group_role=headers.get("x-user-group-role") or None,
        client=headers.get("x-mcp-client") or "codex",
    )
