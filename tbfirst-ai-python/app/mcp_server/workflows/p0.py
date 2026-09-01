from __future__ import annotations

import asyncio
import json
from typing import Any

from app.config import get_settings
from app.mcp_server.assets import normalize_image, normalize_images
from app.mcp_server.clients.gateway import GatewayClient
from app.mcp_server.context import McpContext
from app.mcp_server.schemas import McpAsset, McpToolResult


_ALLOWED_IMAGE_PHASES = {"phase2", "phase2Color", "phase3"}


async def check_workspace(params: dict[str, Any], ctx: McpContext) -> McpToolResult:
    warnings: list[str] = []
    try:
        data = await GatewayClient(ctx).get("/api/image/mcp/workspace")
    except Exception as exc:
        warnings.append(f"image check failed: {exc}")
        data = {"status": "unavailable"}
    return McpToolResult(
        ok=not warnings,
        trace_id=ctx.trace_id,
        workflow="workspace_check",
        summary="tbfirst design workspace is reachable." if not warnings else "Design workspace is unavailable.",
        warnings=warnings,
        data={"image": data},
    )


async def create_adimage_set(params: dict[str, Any], ctx: McpContext) -> McpToolResult:
    product_images = normalize_images(
        params.get("product_images") or params.get("productImages"),
        field_name="product_images",
    )
    if not product_images:
        raise ValueError("product_images is required")
    style = str(params.get("style") or "premium ecommerce hero advertisement").strip()
    brand_notes = str(params.get("brand_notes") or params.get("brandNotes") or "").strip()
    copywriting = params.get("copywriting") or {}
    prompt_parts = [style]
    if brand_notes:
        prompt_parts.append(f"Brand constraints: {brand_notes}")
    if copywriting:
        prompt_parts.append("Copywriting: " + json.dumps(copywriting, ensure_ascii=False))
    forwarded = {
        **params,
        "prompt": "\n".join(prompt_parts),
        "product_images": product_images,
    }
    result = await image_generate_phase(forwarded, ctx, fixed_phase="phase3")
    result.workflow = "adimage_set"
    result.summary = f"Generated {len(result.assets)} ecommerce ad candidate(s)."
    return result


async def image_generate_phase(
    params: dict[str, Any],
    ctx: McpContext,
    *,
    fixed_phase: str | None = None,
) -> McpToolResult:
    phase = fixed_phase or str(params.get("phase") or "").strip()
    if phase not in _ALLOWED_IMAGE_PHASES:
        raise ValueError(f"phase must be one of: {', '.join(sorted(_ALLOWED_IMAGE_PHASES))}")
    prompt = str(params.get("prompt") or "").strip()
    if not prompt:
        raise ValueError("prompt is required")
    if len(prompt) > get_settings().tbfirst_mcp_max_prompt_chars:
        raise ValueError("prompt exceeds design tool limit")

    reference_images = normalize_images(
        params.get("reference_images") or params.get("referenceImages"),
        field_name="reference_images",
    )
    product_images = normalize_images(
        params.get("product_images") or params.get("productImages"),
        field_name="product_images",
    )
    template_image = params.get("template_image") or params.get("templateImage")
    if template_image:
        template_image = normalize_image(template_image, field_name="template_image")
    count = _bounded_int(
        params.get("count"),
        default=1,
        minimum=1,
        maximum=min(4, get_settings().tbfirst_mcp_max_images_per_call),
    )
    payload = {
        "requestId": params.get("request_id") or params.get("requestId"),
        "prompt": prompt,
        "phase": phase,
        "model": params.get("model") or "gemini-3.1-flash-image",
        "productImages": product_images,
        "templateImage": template_image,
        "referenceImages": reference_images,
        "referenceLabels": _list(params.get("reference_labels") or params.get("referenceLabels")),
        "style": params.get("style"),
        "brandNotes": params.get("brand_notes") or params.get("brandNotes"),
        "copywriting": params.get("copywriting") or {},
        "count": count,
        "aspectRatio": params.get("aspect_ratio") or params.get("aspectRatio") or "3:4",
        "imageSize": params.get("image_size") or params.get("imageSize") or "1K",
        "phaseConfig": params.get("phase_config") or params.get("phaseConfig") or {},
        "extra": params.get("extra") or {},
    }
    gateway = GatewayClient(ctx)
    response = await gateway.generate_image(payload)
    final = await _await_image_response(gateway, response)
    urls = [str(url) for url in (final.get("urls") or []) if str(url).strip()]
    status = str(final.get("status") or "unknown").lower()
    return McpToolResult(
        ok=status != "failed",
        trace_id=ctx.trace_id,
        workflow=f"image_{phase}",
        assets=[McpAsset(url=url) for url in urls],
        summary=f"tbfirst-image {phase} completed with {len(urls)} image asset(s).",
        warnings=[] if urls else ["Image phase completed without persisted image URLs."],
        data={
            "phase": phase,
            "status": final.get("status"),
            "jobId": final.get("jobId"),
            "rawResponse": final.get("rawResponse"),
            "pollPath": final.get("pollPath"),
        },
    )


async def _await_image_response(gateway: GatewayClient, response: dict[str, Any]) -> dict[str, Any]:
    status = str(response.get("status") or "").lower()
    job_id = response.get("jobId")
    if status != "pending" or not job_id:
        return response
    deadline = asyncio.get_running_loop().time() + max(10, get_settings().tbfirst_mcp_tool_timeout_seconds)
    last = response
    while asyncio.get_running_loop().time() < deadline:
        await asyncio.sleep(2.5)
        last = await gateway.get_image_job(int(job_id))
        if str(last.get("status") or "").lower() in {"success", "failed"}:
            return last
    raise TimeoutError(f"Image job {job_id} did not finish before the design tool timeout.")


def _list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value] if value.strip() else []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    return []


def _bounded_int(value: Any, *, default: int, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = default
    return max(minimum, min(maximum, parsed))
