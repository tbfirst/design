"""image_gen tool — HTTP 回调 /image/generate。"""
from __future__ import annotations

import hashlib
import logging
from typing import Annotated

from langchain_core.tools import tool
from langgraph.prebuilt import InjectedState

from app.agent.graph.tools.envelope import tool_error, tool_ok
from app.mcp_server.clients.gateway import GatewayClient
from app.mcp_server.context import McpContext

logger = logging.getLogger(__name__)

@tool
async def image_gen(
    prompt: str,
    state: Annotated[dict, InjectedState],
) -> dict:
    """Generate an image from a text prompt.

    Args:
        prompt: the image generation prompt.

    Returns: {"ok": bool, "prompt": ..., "job_id": ..., "status": "submitted"}.
    """
    user_id: int = state["user_id"]
    session_uuid = str(state.get("session_uuid") or "unknown")
    request_id = str(state.get("request_id") or "untracked")
    digest = hashlib.sha256(
        f"{user_id}:{session_uuid}:{request_id}:{prompt}".encode("utf-8")
    ).hexdigest()
    generation_request_id = f"agent:{digest}"
    ctx = McpContext(
        trace_id=request_id,
        user_id=str(user_id),
        group_id=str(state["group_id"]) if state.get("group_id") is not None else None,
        client="agent",
    )

    try:
        data = await GatewayClient(ctx).generate_image({
            "requestId": generation_request_id,
            "prompt": prompt,
            "phase": state.get("phase") or "phase3",
            "count": 1,
        })
        return tool_ok({
            "prompt": prompt,
            "job_id": data.get("jobId") or data.get("job_id"),
            "status": data.get("status") or "submitted",
        })
    except Exception as e:
        logger.warning("image_gen: request failed: %s", e)
        return tool_error("image_gen", "request_failed", str(e), data={"prompt": prompt})
