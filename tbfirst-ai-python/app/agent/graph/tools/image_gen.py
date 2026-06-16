"""image_gen tool — HTTP 回调 /image/generate。"""
from __future__ import annotations

import logging
import os
from typing import Annotated

import httpx
from langchain_core.tools import tool
from langgraph.prebuilt import InjectedState

from app.agent.graph.tools.envelope import tool_error, tool_ok

logger = logging.getLogger(__name__)

_IMAGE_SERVICE_URL = os.getenv("IMAGE_SERVICE_URL", "")


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
    base_url = _IMAGE_SERVICE_URL
    if not base_url:
        logger.warning("image_gen: IMAGE_SERVICE_URL not configured, returning stub")
        return tool_error(
            "image_gen", "no_service_url", "IMAGE_SERVICE_URL not configured",
            data={"prompt": prompt, "status": "stub"},
        )

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{base_url}/image/generate",
                json={"prompt": prompt, "user_id": user_id},
            )
            resp.raise_for_status()
            data = resp.json()
            return tool_ok({
                "prompt": prompt,
                "job_id": data.get("job_id"),
                "status": "submitted",
            })
    except Exception as e:
        logger.warning("image_gen: request failed: %s", e)
        return tool_error("image_gen", "request_failed", str(e), data={"prompt": prompt})
