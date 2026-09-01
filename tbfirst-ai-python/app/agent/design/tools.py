from __future__ import annotations

import hashlib
import json
from typing import Any

from app.mcp_server.context import McpContext
from app.mcp_server.schemas import McpToolResult


DESIGN_TOOL_ALLOWLIST = {
    "tbfirst_check_workspace",
    "tbfirst_create_adimage_set",
    "tbfirst_image_phase3_banner",
    "tbfirst_image_phase2_refine",
    "tbfirst_image_phase2_color",
}


def canonical_hash(value: Any) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def enabled_design_tools() -> dict[str, Any]:
    from app.mcp_server.registry import list_tools

    return {spec.name: spec for spec in list_tools() if spec.name in DESIGN_TOOL_ALLOWLIST}


async def execute_design_tool(name: str, params: dict[str, Any], ctx: McpContext) -> McpToolResult:
    from app.mcp_server.registry import call_tool

    specs = enabled_design_tools()
    if name not in specs:
        raise ValueError(f"design tool is not enabled: {name}")
    if not ctx.user_id or not ctx.roles:
        raise PermissionError("complete employee identity is required for design tools")
    return await call_tool(name, params, ctx)
