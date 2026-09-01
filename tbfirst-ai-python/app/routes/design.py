from __future__ import annotations

from collections.abc import AsyncIterator
import logging

from fastapi import APIRouter, Header, HTTPException, Query, Request
from fastapi.responses import StreamingResponse

from app.agent.design.models import (
    ActionDecisionRequest,
    CreatePlanRequest,
    CreateProjectRequest,
    RegisterAssetRequest,
    UpdateBriefRequest,
)
from app.agent.design.repository import DesignRepository
from app.agent.design.service import build_plan, execute_run_stream
from app.config import get_settings
from app.mcp_server.context import context_from_request

router = APIRouter(prefix="/agent/design", tags=["design-agent"])
repository = DesignRepository()
logger = logging.getLogger(__name__)


def _enabled() -> None:
    if not get_settings().design_agent_enabled:
        raise HTTPException(status_code=404, detail="design agent is disabled")


async def _project_or_404(project_uuid: str, user_id: int):
    project = await repository.get_project(project_uuid, user_id)
    if not project:
        raise HTTPException(status_code=404, detail="design project not found")
    return project


@router.post("/projects")
async def create_project(
    req: CreateProjectRequest,
    request: Request,
    x_user_id: int = Header(..., alias="X-User-Id"),
):
    _enabled()
    ctx = context_from_request(request)
    group_id = int(ctx.group_id) if ctx.group_id and ctx.group_id.isdigit() else None
    project = await repository.create_project(
        user_id=x_user_id,
        group_id=group_id,
        brand_id=req.brand_id,
        session_uuid=req.session_uuid,
        title=req.title,
        brief=req.brief,
    )
    return project.model_dump(mode="json")


@router.get("/projects")
async def list_projects(
    x_user_id: int = Header(..., alias="X-User-Id"),
    limit: int = Query(default=50, ge=1, le=100),
):
    _enabled()
    projects = await repository.list_projects(x_user_id, limit=limit)
    return {"projects": [project.model_dump(mode="json") for project in projects]}


@router.get("/projects/{project_uuid}")
async def get_project(
    project_uuid: str,
    x_user_id: int = Header(..., alias="X-User-Id"),
):
    _enabled()
    project = await _project_or_404(project_uuid, x_user_id)
    artifacts = await repository.list_artifacts(project_uuid, x_user_id)
    pending = await repository.latest_open_run(project.id, x_user_id)
    pending_payload = None
    if pending:
        run, action = pending
        pending_payload = {
            "run": run.model_dump(mode="json"),
            "approval": {
                "action_uuid": action.action_uuid,
                "payload_hash": action.payload_hash,
                "risk_level": action.risk_level,
                "status": action.status,
                "expires_at": action.expires_at,
                "tool_name": action.payload.get("tool_name"),
            },
        }
    return {
        "project": project.model_dump(mode="json"),
        "artifacts": [artifact.model_dump(mode="json") for artifact in artifacts],
        "pending": pending_payload,
    }


@router.patch("/projects/{project_uuid}/brief")
async def update_brief(
    project_uuid: str,
    req: UpdateBriefRequest,
    x_user_id: int = Header(..., alias="X-User-Id"),
):
    _enabled()
    project = await _project_or_404(project_uuid, x_user_id)
    patch = req.model_dump(exclude_unset=True, exclude={"expected_version"})
    data = project.brief.model_dump(mode="json")
    data.update(patch)
    data["version"] = project.brief_version + 1
    data["status"] = "draft"
    brief = type(project.brief).model_validate(data).refresh_readiness()
    updated = await repository.update_brief(
        project_uuid,
        x_user_id,
        brief,
        expected_version=req.expected_version,
    )
    if not updated:
        raise HTTPException(status_code=409, detail="brief version changed; reload the project")
    return updated.model_dump(mode="json")


@router.post("/projects/{project_uuid}/plans")
async def create_plan(
    project_uuid: str,
    req: CreatePlanRequest,
    x_user_id: int = Header(..., alias="X-User-Id"),
):
    _enabled()
    project = await _project_or_404(project_uuid, x_user_id)
    try:
        run, action = await build_plan(
            repository,
            project=project,
            user_id=x_user_id,
            request=req,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {
        "run": run.model_dump(mode="json"),
        "approval": {
            "action_uuid": action.action_uuid,
            "payload_hash": action.payload_hash,
            "risk_level": action.risk_level,
            "status": action.status,
            "expires_at": action.expires_at,
            "tool_name": action.payload.get("tool_name"),
        },
    }


@router.post("/projects/{project_uuid}/actions/{action_uuid}/approve")
async def approve_action(
    project_uuid: str,
    action_uuid: str,
    req: ActionDecisionRequest,
    x_user_id: int = Header(..., alias="X-User-Id"),
):
    _enabled()
    project = await _project_or_404(project_uuid, x_user_id)
    action = await repository.decide_action(
        action_uuid=action_uuid,
        project_id=project.id,
        user_id=x_user_id,
        payload_hash=req.payload_hash,
        approve=True,
    )
    if not action or action.project_id != project.id:
        raise HTTPException(status_code=409, detail="approval is stale, expired, or already resolved")
    return action.model_dump(mode="json")


@router.post("/projects/{project_uuid}/actions/{action_uuid}/reject")
async def reject_action(
    project_uuid: str,
    action_uuid: str,
    req: ActionDecisionRequest,
    x_user_id: int = Header(..., alias="X-User-Id"),
):
    _enabled()
    project = await _project_or_404(project_uuid, x_user_id)
    action = await repository.decide_action(
        action_uuid=action_uuid,
        project_id=project.id,
        user_id=x_user_id,
        payload_hash=req.payload_hash,
        approve=False,
    )
    if not action or action.project_id != project.id:
        raise HTTPException(status_code=409, detail="approval is stale, expired, or already resolved")
    return action.model_dump(mode="json")


@router.post("/projects/{project_uuid}/runs/{run_id}/execute")
async def execute_run(
    project_uuid: str,
    run_id: int,
    request: Request,
    x_user_id: int = Header(..., alias="X-User-Id"),
):
    _enabled()
    project = await _project_or_404(project_uuid, x_user_id)
    run = await repository.get_run_for_user(run_id, x_user_id)
    action = await repository.action_for_run(run_id, x_user_id)
    if not run or run.project_id != project.id or not action:
        raise HTTPException(status_code=404, detail="design run not found")
    if action.status not in {"approved", "executing", "executed"}:
        raise HTTPException(status_code=409, detail="design run requires an approved action")
    ctx = context_from_request(request)
    if ctx.user_id != str(x_user_id) or not ctx.roles:
        raise HTTPException(status_code=403, detail="complete employee identity is required for design execution")

    async def stream() -> AsyncIterator[str]:
        async for event in execute_run_stream(
            repository,
            project=project,
            run=run,
            action=action,
            user_id=x_user_id,
            ctx=ctx,
        ):
            yield event
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/projects/{project_uuid}/artifacts")
async def list_artifacts(
    project_uuid: str,
    x_user_id: int = Header(..., alias="X-User-Id"),
):
    _enabled()
    await _project_or_404(project_uuid, x_user_id)
    artifacts = await repository.list_artifacts(project_uuid, x_user_id)
    return {"artifacts": [artifact.model_dump(mode="json") for artifact in artifacts]}


@router.post("/projects/{project_uuid}/assets")
async def register_asset(
    project_uuid: str,
    req: RegisterAssetRequest,
    x_user_id: int = Header(..., alias="X-User-Id"),
):
    _enabled()
    project = await _project_or_404(project_uuid, x_user_id)
    artifact = await repository.register_source_asset(
        project_id=project.id,
        role=req.role,
        url=req.url,
        provenance={"source": "design-agent-upload", "user_id": x_user_id},
    )
    return artifact.model_dump(mode="json")


@router.post("/projects/{project_uuid}/artifacts/{artifact_id}/select")
async def select_artifact(
    project_uuid: str,
    artifact_id: int,
    x_user_id: int = Header(..., alias="X-User-Id"),
):
    _enabled()
    artifact = await repository.select_artifact(project_uuid, x_user_id, artifact_id)
    if not artifact:
        raise HTTPException(status_code=404, detail="artifact not found")
    return artifact.model_dump(mode="json")


@router.post("/projects/{project_uuid}/finalize")
async def finalize_project(
    project_uuid: str,
    x_user_id: int = Header(..., alias="X-User-Id"),
):
    _enabled()
    project = await _project_or_404(project_uuid, x_user_id)
    was_completed = project.status == "completed"
    artifact = await repository.finalize_project(project_uuid, x_user_id)
    if not artifact:
        raise HTTPException(status_code=409, detail="select an artifact before finalizing")
    # Only explicit final acceptance promotes a design run into procedural memory.
    try:
        if was_completed:
            return artifact.model_dump(mode="json")
        from app.agent.memory.procedural import insert_workflow

        provenance = artifact.provenance or {}
        mcp_data = provenance.get("mcp_data") or {}
        sample_job_id = mcp_data.get("jobId")
        quality_score = (
            artifact.evaluation.overall_score
            if artifact.evaluation and artifact.evaluation.overall_score is not None
            else 0.7
        )
        await insert_workflow(
            user_id=x_user_id,
            group_id=project.group_id,
            name=f"设计定稿：{project.title}",
            phase_chain=[{
                "phase": "ecommerce_ad",
                "tool": provenance.get("tool") or artifact.tool_name,
                "artifact_id": artifact.id,
            }],
            sample_prompt="\n".join(filter(None, [
                project.brief.objective,
                project.brief.creative_direction,
            ])),
            sample_job_id=int(sample_job_id) if sample_job_id is not None else None,
            quality_score=quality_score,
        )
    except Exception as exc:
        logger.warning("final design workflow memory write skipped: %s", exc)
    return artifact.model_dump(mode="json")
