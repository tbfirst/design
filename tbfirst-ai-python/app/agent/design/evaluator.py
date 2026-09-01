from __future__ import annotations

import base64
import io
import json
import logging
import threading
from functools import lru_cache
from pathlib import Path
from statistics import fmean
from typing import Any

import httpx
from PIL import Image

from app.agent.design.models import DesignBrief, EvaluationReport
from app.config import get_settings
from app.mcp_server.context import McpContext

logger = logging.getLogger(__name__)

_EVALUATOR_PROMPT_PATH = Path(__file__).resolve().parents[1] / "prompts" / "design" / "evaluator.md"
_asset_http_client: httpx.AsyncClient | None = None
_asset_client_lock = threading.Lock()


def _get_asset_http_client() -> httpx.AsyncClient:
    global _asset_http_client
    if _asset_http_client is None:
        with _asset_client_lock:
            if _asset_http_client is None:
                _asset_http_client = httpx.AsyncClient(
                    timeout=30.0,
                    follow_redirects=True,
                    limits=httpx.Limits(
                        max_connections=20,
                        max_keepalive_connections=10,
                        keepalive_expiry=30,
                    ),
                    trust_env=False,
                )
    return _asset_http_client


async def close_evaluator_client() -> None:
    global _asset_http_client
    with _asset_client_lock:
        client, _asset_http_client = _asset_http_client, None
    if client is not None:
        await client.aclose()


@lru_cache(maxsize=1)
def _vision_prompt() -> str:
    return _EVALUATOR_PROMPT_PATH.read_text(encoding="utf-8")


def _target_ratio(values: list[str]) -> float | None:
    for value in values:
        try:
            width, height = value.split(":", 1)
            ratio = float(width) / float(height)
            if ratio > 0:
                return ratio
        except (ValueError, ZeroDivisionError):
            continue
    return None


def _json_object(raw: str) -> dict[str, Any]:
    text = raw.strip()
    if text.startswith("```"):
        text = text.split("```", 2)[1]
        if text.startswith("json"):
            text = text[4:]
    data = json.loads(text.strip())
    if not isinstance(data, dict):
        raise ValueError("evaluator response must be a JSON object")
    return data


async def _load_image(url: str, ctx: McpContext) -> tuple[bytes, str, int, int]:
    settings = get_settings()
    resolved = url
    if url.startswith("/"):
        resolved = settings.tbfirst_mcp_gateway_url.rstrip("/") + url
    headers: dict[str, str] = {"X-Internal-Token": settings.internal_token}
    if ctx.authorization:
        headers["Authorization"] = ctx.authorization
    if ctx.user_id:
        headers["X-User-Id"] = ctx.user_id
    response = await _get_asset_http_client().get(resolved, headers=headers)
    response.raise_for_status()
    content = response.content
    if len(content) > settings.tbfirst_mcp_max_image_bytes:
        raise ValueError("artifact image exceeds evaluation size limit")
    mime = response.headers.get("content-type", "image/png").split(";", 1)[0]
    with Image.open(io.BytesIO(content)) as image:
        width, height = image.size
        if image.format:
            mime = Image.MIME.get(image.format, mime)
    return content, mime, width, height


async def _vision_dimensions(content: bytes, mime: str, brief: DesignBrief) -> dict[str, Any] | None:
    settings = get_settings()
    if not settings.gemini_api_key:
        return None
    from langchain_core.messages import HumanMessage
    from langchain_google_genai import ChatGoogleGenerativeAI

    prompt = _vision_prompt()
    replacements = {
        "{objective}": brief.objective or "未提供",
        "{direction}": brief.creative_direction or "未提供",
        "{constraints}": "；".join(brief.hard_constraints) or "无",
        "{audience}": brief.audience or "未提供",
        "{channel}": brief.channel or "未提供",
    }
    for marker, value in replacements.items():
        prompt = prompt.replace(marker, value)
    data_uri = f"data:{mime};base64,{base64.b64encode(content).decode('ascii')}"
    message = HumanMessage(content=[
        {"type": "text", "text": prompt},
        {"type": "image_url", "image_url": {"url": data_uri}},
    ])
    llm = ChatGoogleGenerativeAI(
        model="gemini-2.5-flash",
        google_api_key=settings.gemini_api_key,
        temperature=0.0,
    )
    response = await llm.ainvoke([message])
    raw = getattr(response, "content", "") or ""
    if isinstance(raw, list):
        raw = " ".join(str(part) for part in raw)
    return _json_object(str(raw))


async def evaluate_artifact(url: str, brief: DesignBrief, ctx: McpContext) -> tuple[EvaluationReport, int | None, int | None]:
    """Evaluate one persisted artifact; infrastructure failure is explicit `unknown`."""
    try:
        content, mime, width, height = await _load_image(url, ctx)
    except Exception as exc:
        logger.warning("design artifact preflight failed: %s", exc)
        return EvaluationReport(
            status="unknown",
            observations=[f"无法读取候选图：{type(exc).__name__}"],
            suggested_changes=["确认资产链接可访问后重新质检"],
        ), None, None

    hard_violations: list[str] = []
    observations = [f"图像尺寸 {width}x{height}"]
    target = _target_ratio(brief.aspect_ratios)
    if target and height:
        actual = width / height
        if abs(actual - target) / target > 0.04:
            hard_violations.append(
                f"宽高比不符合目标 {brief.aspect_ratios[0]}（实际约 {actual:.2f}:1）"
            )

    try:
        vision = await _vision_dimensions(content, mime, brief)
    except Exception as exc:
        logger.warning("design visual evaluation failed: %s", exc)
        vision = None

    if vision is None:
        return EvaluationReport(
            status="failed" if hard_violations else "needs_review",
            dimensions={"aspect_ratio": 0.0 if hard_violations else 1.0},
            hard_violations=hard_violations,
            observations=observations + ["视觉模型未配置或暂不可用，需人工确认设计质量"],
            suggested_changes=["按 brief 人工检查商品保真、文字可读性和品牌一致性"],
        ), width, height

    dimensions: dict[str, float | None] = {}
    for key, value in (vision.get("dimensions") or {}).items():
        if value is None:
            dimensions[str(key)] = None
            continue
        try:
            dimensions[str(key)] = max(0.0, min(1.0, float(value)))
        except (TypeError, ValueError):
            dimensions[str(key)] = None
    dimensions["aspect_ratio"] = 0.0 if hard_violations else 1.0
    hard_violations.extend(str(item) for item in (vision.get("hard_violations") or []))
    scores = [value for value in dimensions.values() if value is not None]
    overall = fmean(scores) if scores else None
    if hard_violations:
        status = "failed"
    elif overall is None:
        status = "unknown"
    elif overall >= 0.78:
        status = "passed"
    else:
        status = "needs_review"
    return EvaluationReport(
        status=status,
        overall_score=overall,
        dimensions=dimensions,
        hard_violations=hard_violations,
        observations=observations + [str(item) for item in (vision.get("observations") or [])],
        suggested_changes=[str(item) for item in (vision.get("suggested_changes") or [])],
    ), width, height
