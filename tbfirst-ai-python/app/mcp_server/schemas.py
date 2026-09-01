from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class McpAsset(BaseModel):
    url: str
    asset_id: str | None = None
    type: str = "image"
    expires_at: str | None = None


class McpToolResult(BaseModel):
    ok: bool = True
    trace_id: str
    workflow: str
    assets: list[McpAsset] = Field(default_factory=list)
    summary: str
    warnings: list[str] = Field(default_factory=list)
    data: dict[str, Any] = Field(default_factory=dict)


class ToolPolicy(BaseModel):
    required_role: str = "employee"
    required_group_role: str | None = None
    quota_type: str | None = None
    cost_level: str = "low"
    uses_private_assets: bool = False
    writes_assets: bool = False
    requires_confirmation: bool = False


class ImageInput(BaseModel):
    url: str | None = None
    asset_id: str | None = None
    data_uri: str | None = None
    label: str | None = None


class ToolSpec(BaseModel):
    name: str
    description: str
    input_schema: dict[str, Any]
    output_schema: dict[str, Any]
    risk_level: str = "low"
    policy: ToolPolicy
