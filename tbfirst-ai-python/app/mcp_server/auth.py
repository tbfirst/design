from __future__ import annotations

import base64
import json
import time
from typing import Any

from app.config import get_settings
from app.mcp_server.context import McpContext
from app.mcp_server.errors import McpToolError


def apply_employee_mapping(ctx: McpContext) -> McpContext:
    settings = get_settings()
    if ctx.user_id:
        return ctx
    if settings.tbfirst_mcp_auth_mode.lower() != "token":
        if settings.tbfirst_mcp_require_employee_mapping:
            raise McpToolError("MCP employee identity is required.", status_code=401)
        return ctx

    token = _extract_bearer(ctx.authorization)
    if not token:
        raise McpToolError("MCP bearer token is required.", status_code=401)

    mapping = _load_token_map(settings.tbfirst_mcp_token_map)
    employee = mapping.get(token)
    if employee is None and settings.tbfirst_mcp_token_secret:
        employee = _decode_self_contained_token(token, settings.tbfirst_mcp_token_secret)
    if employee is None:
        raise McpToolError("MCP bearer token is invalid or has no employee mapping.", status_code=401)
    _reject_expired(employee)

    ctx.user_id = str(employee.get("user_id") or employee.get("userId") or "")
    ctx.username = str(employee.get("username") or ctx.username or "")
    roles = employee.get("roles") or ["USER"]
    ctx.roles = roles if isinstance(roles, list) else [str(roles)]
    ctx.group_id = str(employee.get("group_id") or employee.get("groupId") or "") or None
    ctx.group_role = str(employee.get("group_role") or employee.get("groupRole") or "") or None
    downstream_token = employee.get("tbfirst_bearer_token") or employee.get("tbfirstBearerToken")
    downstream_auth = employee.get("authorization") or employee.get("Authorization")
    if downstream_auth:
        ctx.authorization = str(downstream_auth)
    elif downstream_token:
        ctx.authorization = f"Bearer {downstream_token}"
    if not ctx.user_id:
        raise McpToolError("MCP employee mapping is missing user_id.", status_code=401)
    return ctx


def _extract_bearer(auth_header: str | None) -> str | None:
    if not auth_header:
        return None
    prefix = "Bearer "
    return auth_header[len(prefix):].strip() if auth_header.startswith(prefix) else None


def _load_token_map(raw: str) -> dict[str, dict[str, Any]]:
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def _decode_self_contained_token(token: str, secret: str) -> dict[str, Any] | None:
    try:
        prefix, payload = token.split(".", 1)
        if prefix != secret:
            return None
        padded = payload + "=" * (-len(payload) % 4)
        data = json.loads(base64.urlsafe_b64decode(padded.encode("ascii")))
    except Exception:
        return None
    return data if isinstance(data, dict) else None


def _reject_expired(employee: dict[str, Any]) -> None:
    exp = employee.get("exp")
    if exp is None:
        exp = employee.get("expires_at") or employee.get("expiresAt")
    if exp is None:
        return
    try:
        expires_at = float(exp)
    except (TypeError, ValueError):
        return
    if expires_at > 10_000_000_000:
        expires_at = expires_at / 1000
    if time.time() >= expires_at:
        raise McpToolError("MCP bearer token is expired.", status_code=401)
