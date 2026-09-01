from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator


ProjectStatus = Literal["draft", "active", "waiting_approval", "completed", "failed"]
ActionStatus = Literal["pending", "approved", "executing", "executed", "rejected", "failed"]
ArtifactStatus = Literal["creating", "ready", "failed", "selected", "final"]


class DesignBrief(BaseModel):
    objective: str = Field(default="", max_length=4000)
    deliverable: Literal["ecommerce_ad"] = "ecommerce_ad"
    product_images: list[str] = Field(default_factory=list, max_length=4)
    reference_images: list[str] = Field(default_factory=list, max_length=4)
    audience: str | None = Field(default=None, max_length=500)
    channel: str | None = Field(default=None, max_length=100)
    aspect_ratios: list[str] = Field(default_factory=lambda: ["3:4"], max_length=3)
    creative_direction: str | None = Field(default=None, max_length=2000)
    copywriting: dict[str, str] = Field(default_factory=dict)
    hard_constraints: list[str] = Field(default_factory=list, max_length=20)
    acceptance_criteria: list[str] = Field(default_factory=list, max_length=20)
    unknown_fields: list[str] = Field(default_factory=list)
    status: Literal["draft", "ready", "approved"] = "draft"
    version: int = Field(default=1, ge=1)

    @field_validator("product_images", "reference_images")
    @classmethod
    def validate_image_refs(cls, values: list[str]) -> list[str]:
        cleaned = [str(value).strip() for value in values if str(value).strip()]
        for value in cleaned:
            if not (
                value.startswith("http://")
                or value.startswith("https://")
                or value.startswith("/img/")
                or value.startswith("/static/")
            ):
                raise ValueError("image references must be HTTP(S), /img/, or /static/ URLs")
        return cleaned

    def refresh_readiness(self) -> "DesignBrief":
        missing: list[str] = []
        if not self.objective.strip():
            missing.append("objective")
        if not self.product_images:
            missing.append("product_images")
        if not self.aspect_ratios:
            missing.append("aspect_ratios")
        self.unknown_fields = missing
        if self.status != "approved":
            self.status = "ready" if not missing else "draft"
        return self


class DesignStep(BaseModel):
    id: str
    kind: Literal["analyze", "generate", "evaluate", "revise", "deliver"]
    title: str
    tool_name: str | None = None
    input_refs: list[str] = Field(default_factory=list)
    acceptance_criteria: list[str] = Field(default_factory=list)
    status: Literal["pending", "running", "done", "failed", "skipped"] = "pending"


class DesignPlan(BaseModel):
    version: int = Field(default=1, ge=1)
    brief_version: int = Field(ge=1)
    steps: list[DesignStep]
    max_generation_calls: int = Field(default=1, ge=1, le=4)
    candidate_count: int = Field(default=2, ge=1, le=3)
    estimated_cost_level: Literal["low", "medium", "high"] = "medium"


class EvaluationReport(BaseModel):
    status: Literal["passed", "needs_review", "failed", "unknown"]
    overall_score: float | None = Field(default=None, ge=0, le=1)
    dimensions: dict[str, float | None] = Field(default_factory=dict)
    hard_violations: list[str] = Field(default_factory=list)
    observations: list[str] = Field(default_factory=list)
    suggested_changes: list[str] = Field(default_factory=list)
    evaluator_version: str = "design-mvp-v1"


class DesignProject(BaseModel):
    id: int
    project_uuid: str
    user_id: int
    group_id: int | None = None
    brand_id: int | None = None
    session_uuid: str | None = None
    title: str
    status: ProjectStatus
    brief: DesignBrief
    brief_version: int
    selected_artifact_id: int | None = None
    create_time: datetime | None = None
    update_time: datetime | None = None


class DesignArtifact(BaseModel):
    id: int
    project_id: int
    run_id: int | None = None
    shared_asset_id: int | None = None
    parent_artifact_id: int | None = None
    role: Literal["source", "reference", "candidate", "revision", "final"]
    kind: Literal["image", "layout", "text"] = "image"
    revision: int = 1
    url: str | None = None
    width: int | None = None
    height: int | None = None
    tool_name: str | None = None
    provenance: dict[str, Any] = Field(default_factory=dict)
    evaluation: EvaluationReport | None = None
    status: ArtifactStatus
    create_time: datetime | None = None


class DesignAction(BaseModel):
    action_uuid: str
    project_id: int
    run_id: int
    action_type: str
    plan_version: int
    payload_hash: str
    payload: dict[str, Any]
    risk_level: str
    status: ActionStatus
    expires_at: datetime | None = None


class DesignRun(BaseModel):
    id: int
    project_id: int
    request_id: str
    status: str
    plan: DesignPlan
    plan_version: int
    generation_calls: int = 0
    cost: dict[str, Any] = Field(default_factory=dict)
    error_code: str | None = None
    create_time: datetime | None = None
    start_time: datetime | None = None
    end_time: datetime | None = None


class CreateProjectRequest(BaseModel):
    title: str = Field(default="未命名设计", min_length=1, max_length=200)
    session_uuid: str | None = Field(default=None, max_length=64)
    brand_id: int | None = None
    brief: DesignBrief = Field(default_factory=DesignBrief)


class UpdateBriefRequest(BaseModel):
    objective: str | None = Field(default=None, max_length=4000)
    product_images: list[str] | None = Field(default=None, max_length=4)
    reference_images: list[str] | None = Field(default=None, max_length=4)
    audience: str | None = Field(default=None, max_length=500)
    channel: str | None = Field(default=None, max_length=100)
    aspect_ratios: list[str] | None = Field(default=None, max_length=3)
    creative_direction: str | None = Field(default=None, max_length=2000)
    copywriting: dict[str, str] | None = None
    hard_constraints: list[str] | None = Field(default=None, max_length=20)
    acceptance_criteria: list[str] | None = Field(default=None, max_length=20)
    expected_version: int | None = Field(default=None, ge=1)


class CreatePlanRequest(BaseModel):
    request_id: str = Field(min_length=8, max_length=64)
    candidate_count: int = Field(default=2, ge=1, le=3)
    revision_of_artifact_id: int | None = None
    revision_instruction: str | None = Field(default=None, max_length=2000)


class ActionDecisionRequest(BaseModel):
    payload_hash: str = Field(min_length=32, max_length=128)


class RegisterAssetRequest(BaseModel):
    url: str
    role: Literal["source", "reference"]

    @field_validator("url")
    @classmethod
    def validate_url(cls, value: str) -> str:
        cleaned = value.strip()
        DesignBrief.validate_image_refs([cleaned])
        return cleaned
