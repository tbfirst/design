from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from typing import Any

from app.agent.design.evaluator import evaluate_artifact
from app.agent.design.models import (
    CreatePlanRequest,
    DesignAction,
    DesignPlan,
    DesignProject,
    DesignRun,
    DesignStep,
)
from app.agent.design.repository import DesignRepository
from app.agent.design.tools import canonical_hash, execute_design_tool
from app.mcp_server.context import McpContext

logger = logging.getLogger(__name__)


def _event(event_type: str, *, project_uuid: str, run: DesignRun, sequence: int, **payload: Any) -> str:
    data = {
        "type": event_type,
        "request_id": run.request_id,
        "project_uuid": project_uuid,
        "run_id": run.id,
        "sequence": sequence,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        **payload,
    }
    return "data: " + json.dumps(data, ensure_ascii=False, default=str) + "\n\n"


async def build_plan(
    repository: DesignRepository,
    *,
    project: DesignProject,
    user_id: int,
    request: CreatePlanRequest,
) -> tuple[DesignRun, DesignAction]:
    brief = project.brief.refresh_readiness()
    if brief.unknown_fields:
        missing = ", ".join(brief.unknown_fields)
        raise ValueError(f"brief is incomplete: {missing}")

    parent_artifact_id = request.revision_of_artifact_id
    if parent_artifact_id:
        parent = await repository.get_artifact(project.id, parent_artifact_id, user_id)
        if not parent or not parent.url:
            raise ValueError("revision source artifact was not found")
        if not request.revision_instruction:
            raise ValueError("revision_instruction is required for a revision")
        tool_name = "tbfirst_image_phase2_refine"
        params = {
            "prompt": request.revision_instruction,
            "reference_images": [parent.url],
            "product_images": brief.product_images,
            "count": request.candidate_count,
            "aspect_ratio": brief.aspect_ratios[0],
            "style": brief.creative_direction,
            "brand_notes": "；".join(brief.hard_constraints),
            "copywriting": brief.copywriting,
        }
        title = "基于选中作品生成修订版本"
    else:
        tool_name = "tbfirst_create_adimage_set"
        params = {
            "product_images": brief.product_images,
            "template_image": brief.reference_images[0] if brief.reference_images else None,
            "count": request.candidate_count,
            "aspect_ratio": brief.aspect_ratios[0],
            "style": brief.creative_direction or brief.objective,
            "brand_notes": "；".join(brief.hard_constraints),
            "copywriting": brief.copywriting,
        }
        title = "生成电商广告候选"

    plan = DesignPlan(
        version=1,
        brief_version=project.brief_version,
        candidate_count=request.candidate_count,
        max_generation_calls=1,
        estimated_cost_level="medium",
        steps=[
            DesignStep(id="generate", kind="generate", title=title, tool_name=tool_name),
            DesignStep(id="evaluate", kind="evaluate", title="检查比例、品牌和商品保真"),
            DesignStep(id="deliver", kind="deliver", title="展示候选并等待用户选择"),
        ],
    )
    payload = {
        "tool_name": tool_name,
        "params": params,
        "parent_artifact_id": parent_artifact_id,
        "brief_version": project.brief_version,
        "max_generation_calls": 1,
    }
    return await repository.create_run_and_action(
        project=project,
        request_id=request.request_id,
        plan=plan,
        payload=payload,
        payload_hash=canonical_hash(payload),
    )


async def execute_run_stream(
    repository: DesignRepository,
    *,
    project: DesignProject,
    run: DesignRun,
    action: DesignAction,
    user_id: int,
    ctx: McpContext,
) -> AsyncIterator[str]:
    sequence = 1
    yield _event("run_started", project_uuid=project.project_uuid, run=run, sequence=sequence)

    if canonical_hash(action.payload) != action.payload_hash:
        yield _event(
            "run_failed", project_uuid=project.project_uuid, run=run, sequence=sequence + 1,
            error="approval payload hash mismatch",
        )
        return

    if int(action.payload.get("brief_version") or 0) != project.brief_version:
        await repository.fail_run(
            run_id=run.id,
            action_uuid=action.action_uuid,
            error_code="StaleBriefVersion",
        )
        yield _event(
            "run_failed", project_uuid=project.project_uuid, run=run, sequence=sequence + 1,
            error="Brief 已更新，旧计划授权失效，请重新生成计划",
        )
        return

    claimed = await repository.claim_action(action.action_uuid, user_id)
    if not claimed:
        refreshed = await repository.get_run_for_user(run.id, user_id)
        if refreshed and refreshed.status == "completed":
            yield _event(
                "run_completed", project_uuid=project.project_uuid, run=run, sequence=sequence + 1,
                idempotent_replay=True,
            )
            return
        yield _event(
            "run_failed", project_uuid=project.project_uuid, run=run, sequence=sequence + 1,
            error="run is not approved or approval has expired",
        )
        return

    payload = claimed.payload
    tool_name = str(payload["tool_name"])
    params = dict(payload.get("params") or {})
    parent_artifact_id = payload.get("parent_artifact_id")
    tool_input_hash = canonical_hash({"tool": tool_name, "params": params})
    sequence += 1
    yield _event(
        "tool_started", project_uuid=project.project_uuid, run=run, sequence=sequence,
        tool=tool_name,
    )

    try:
        result = await execute_design_tool(tool_name, params, ctx)
        sequence += 1
        yield _event(
            "tool_completed", project_uuid=project.project_uuid, run=run, sequence=sequence,
            tool=tool_name, summary=result.summary, warnings=result.warnings,
        )

        artifacts = []
        for asset in result.assets:
            report, width, height = await evaluate_artifact(asset.url, project.brief, ctx)
            artifact = await repository.register_artifact(
                project_id=project.id,
                run_id=run.id,
                parent_artifact_id=parent_artifact_id,
                url=asset.url,
                tool_name=tool_name,
                tool_input_hash=tool_input_hash,
                provenance={
                    "trace_id": result.trace_id,
                    "workflow": result.workflow,
                    "tool": tool_name,
                    "params_hash": canonical_hash(params),
                    "mcp_data": result.data,
                    "width": width,
                    "height": height,
                },
                evaluation=report.model_dump(mode="json"),
                width=width,
                height=height,
            )
            artifacts.append(artifact)
            sequence += 1
            yield _event(
                "artifact_created", project_uuid=project.project_uuid, run=run, sequence=sequence,
                artifact=artifact.model_dump(mode="json"),
            )
            sequence += 1
            yield _event(
                "evaluation_completed", project_uuid=project.project_uuid, run=run, sequence=sequence,
                artifact_id=artifact.id, evaluation=report.model_dump(mode="json"),
            )

        if not artifacts:
            raise RuntimeError("design tool completed without persisted assets")
        await repository.complete_run(run_id=run.id, action_uuid=action.action_uuid, generation_calls=1)
        sequence += 1
        yield _event(
            "run_completed", project_uuid=project.project_uuid, run=run, sequence=sequence,
            artifact_ids=[artifact.id for artifact in artifacts],
        )
    except Exception as exc:
        logger.exception("design run failed: run_id=%s", run.id)
        await repository.fail_run(
            run_id=run.id,
            action_uuid=action.action_uuid,
            error_code=type(exc).__name__,
        )
        sequence += 1
        yield _event(
            "run_failed", project_uuid=project.project_uuid, run=run, sequence=sequence,
            error=str(exc),
        )
