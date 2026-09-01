from __future__ import annotations

from app.mcp_server.context import McpContext
from app.mcp_server.errors import McpToolError
from app.mcp_server.schemas import ToolSpec


def enforce_policy(spec: ToolSpec, ctx: McpContext) -> None:
    if not ctx.user_id:
        raise McpToolError("Employee identity is required for this MCP tool.", status_code=401)

    roles = {role.upper() for role in ctx.roles}
    if spec.policy.required_role in {"employee", "user"} and not (roles & {"USER", "EMPLOYEE", "ADMIN"}):
        raise McpToolError("Current employee role cannot use this MCP tool.", status_code=403)
    if spec.policy.required_role == "admin" and "ADMIN" not in roles:
        raise McpToolError("Admin role is required for this MCP tool.", status_code=403)
    if spec.policy.required_group_role and ctx.group_role != spec.policy.required_group_role:
        raise McpToolError("Current group role cannot use this MCP tool.", status_code=403)
