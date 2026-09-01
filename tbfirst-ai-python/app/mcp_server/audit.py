from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from typing import Any

from app.config import get_settings
from app.mcp_server.context import McpContext
from app.mcp_server.errors import sanitize
from app.mcp_server.schemas import McpToolResult

logger = logging.getLogger("tbfirst.mcp.audit")


class AuditSpan:
    def __init__(self, tool: str, params: dict[str, Any], ctx: McpContext):
        self.tool = tool
        self.params = params
        self.ctx = ctx
        self.started = time.perf_counter()

    def success(self, result: McpToolResult) -> None:
        self._write("success", output={
            "workflow": result.workflow,
            "asset_count": len(result.assets),
            "assets": [asset.model_dump() for asset in result.assets],
            "warnings": result.warnings,
        })

    def failure(self, exc: Exception) -> None:
        self._write("failed", error=str(exc))

    def _write(self, status: str, *, output: dict[str, Any] | None = None, error: str | None = None) -> None:
        settings = get_settings()
        if not settings.tbfirst_mcp_audit_enabled:
            return
        record = {
            "trace_id": self.ctx.trace_id,
            "tool": self.tool,
            "status": status,
            "user_id": self.ctx.user_id,
            "username": self.ctx.username,
            "group_id": self.ctx.group_id,
            "client": self.ctx.client,
            "duration_ms": round((time.perf_counter() - self.started) * 1000, 2),
            "input": sanitize(self.params),
            "output": sanitize(output or {}),
            "error": sanitize(error) if error else None,
            "ts": int(time.time() * 1000),
        }
        logger.info("[MCP Audit] %s", json.dumps(record, ensure_ascii=False))
        path = Path(settings.tbfirst_mcp_audit_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(record, ensure_ascii=False) + "\n")


def start(tool: str, params: dict[str, Any], ctx: McpContext) -> AuditSpan:
    return AuditSpan(tool, params, ctx)
