from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from app.config import get_settings
from app.mcp_server import audit, quota
from app.mcp_server.auth import apply_employee_mapping
from app.mcp_server.context import McpContext
from app.mcp_server.policy import enforce_policy
from app.mcp_server.schemas import McpToolResult, ToolPolicy, ToolSpec
from app.mcp_server.workflows import p0

WorkflowFn = Callable[[dict[str, Any], McpContext], Awaitable[McpToolResult]]


def _image_schema(*, require_product: bool = False) -> dict[str, Any]:
    required = ["product_images"] if require_product else ["prompt"]
    return {
        "type": "object",
        "required": required,
        "properties": {
            "prompt": {"type": "string"},
            "product_images": {"type": "array", "items": {"type": "string"}},
            "template_image": {"type": "string"},
            "reference_images": {"type": "array", "items": {"type": "string"}},
            "count": {"type": "integer", "minimum": 1, "maximum": 3},
            "aspect_ratio": {"type": "string"},
            "style": {"type": "string"},
            "brand_notes": {"type": "string"},
            "copywriting": {"type": "object"},
        },
    }


_IMAGE_POLICY = ToolPolicy(
    quota_type="image_generation",
    cost_level="medium",
    uses_private_assets=True,
    writes_assets=True,
)

_SPECS = {
    "tbfirst_check_workspace": ToolSpec(
        name="tbfirst_check_workspace",
        description="Check whether the authenticated tbfirst image workspace is reachable.",
        input_schema={"type": "object", "properties": {}},
        output_schema={"type": "object"},
        risk_level="low",
        policy=ToolPolicy(),
    ),
    "tbfirst_create_adimage_set": ToolSpec(
        name="tbfirst_create_adimage_set",
        description="Create ecommerce ad candidates from approved product assets and design constraints.",
        input_schema=_image_schema(require_product=True),
        output_schema={"type": "object"},
        risk_level="medium",
        policy=_IMAGE_POLICY,
    ),
    "tbfirst_image_phase2_refine": ToolSpec(
        name="tbfirst_image_phase2_refine",
        description="Refine an approved candidate while preserving its product identity.",
        input_schema=_image_schema(),
        output_schema={"type": "object"},
        risk_level="medium",
        policy=_IMAGE_POLICY,
    ),
    "tbfirst_image_phase2_color": ToolSpec(
        name="tbfirst_image_phase2_color",
        description="Adjust candidate color and texture while preserving geometry.",
        input_schema=_image_schema(),
        output_schema={"type": "object"},
        risk_level="medium",
        policy=_IMAGE_POLICY,
    ),
    "tbfirst_image_phase3_banner": ToolSpec(
        name="tbfirst_image_phase3_banner",
        description="Generate an ecommerce banner from approved design inputs.",
        input_schema=_image_schema(),
        output_schema={"type": "object"},
        risk_level="medium",
        policy=_IMAGE_POLICY,
    ),
}

_WORKFLOWS: dict[str, WorkflowFn] = {
    "tbfirst_check_workspace": p0.check_workspace,
    "tbfirst_create_adimage_set": p0.create_adimage_set,
    "tbfirst_image_phase2_refine": lambda params, ctx: p0.image_generate_phase(params, ctx, fixed_phase="phase2"),
    "tbfirst_image_phase2_color": lambda params, ctx: p0.image_generate_phase(params, ctx, fixed_phase="phase2Color"),
    "tbfirst_image_phase3_banner": lambda params, ctx: p0.image_generate_phase(params, ctx, fixed_phase="phase3"),
}


def enabled_tool_names() -> set[str]:
    configured = {name.strip() for name in get_settings().tbfirst_mcp_enabled_tools.split(",") if name.strip()}
    return configured & set(_SPECS)


def list_tools() -> list[ToolSpec]:
    enabled = enabled_tool_names()
    return [spec for name, spec in _SPECS.items() if name in enabled]


async def call_tool(name: str, params: dict[str, Any], ctx: McpContext) -> McpToolResult:
    if name not in enabled_tool_names():
        raise ValueError(f"Design tool is not enabled: {name}")
    spec = _SPECS[name]
    mapped = apply_employee_mapping(ctx)
    enforce_policy(spec, mapped)
    span = audit.start(name, params or {}, mapped)
    try:
        await quota.check_and_consume(spec, mapped)
        result = await _WORKFLOWS[name](params or {}, mapped)
        span.success(result)
        return result
    except Exception as exc:
        span.failure(exc)
        raise
