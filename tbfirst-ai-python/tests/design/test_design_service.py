from __future__ import annotations

import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from app.agent.design.models import (  # noqa: E402
    CreatePlanRequest,
    DesignAction,
    DesignArtifact,
    DesignBrief,
    DesignPlan,
    DesignProject,
    DesignRun,
    EvaluationReport,
)
from app.agent.design.service import build_plan, execute_run_stream  # noqa: E402
from app.agent.design.tools import canonical_hash  # noqa: E402
from app.mcp_server.context import McpContext  # noqa: E402
from app.mcp_server.schemas import McpAsset, McpToolResult  # noqa: E402


def run(coro):
    return asyncio.run(coro)


def project() -> DesignProject:
    brief = DesignBrief(
        objective="为新品香水制作电商首屏广告",
        product_images=["https://assets.example/product.png"],
        reference_images=["https://assets.example/reference.png"],
        creative_direction="克制、现代、浅灰背景",
        aspect_ratios=["3:4"],
    ).refresh_readiness()
    return DesignProject(
        id=7,
        project_uuid="p" * 32,
        user_id=11,
        title="香水广告",
        status="active",
        brief=brief,
        brief_version=3,
    )


class FakeRepository:
    def __init__(self):
        self.payload = None
        self.completed = False
        self.failed = False
        self.failure_code = None
        self.artifacts: list[DesignArtifact] = []

    async def create_run_and_action(self, *, project, request_id, plan, payload, payload_hash):
        self.payload = payload
        run_obj = DesignRun(
            id=21,
            project_id=project.id,
            request_id=request_id,
            status="waiting_approval",
            plan=plan,
            plan_version=plan.version,
        )
        action = DesignAction(
            action_uuid="a" * 32,
            project_id=project.id,
            run_id=run_obj.id,
            action_type="approve_plan",
            plan_version=plan.version,
            payload_hash=payload_hash,
            payload=payload,
            risk_level="medium",
            status="approved",
        )
        return run_obj, action

    async def get_artifact(self, project_id, artifact_id, user_id):
        return DesignArtifact(
            id=artifact_id,
            project_id=project_id,
            role="candidate",
            revision=1,
            url="https://assets.example/candidate.png",
            status="selected",
        )

    async def claim_action(self, action_uuid, user_id):
        return self.action

    async def register_artifact(self, **kwargs):
        artifact = DesignArtifact(
            id=100 + len(self.artifacts),
            project_id=kwargs["project_id"],
            run_id=kwargs["run_id"],
            parent_artifact_id=kwargs["parent_artifact_id"],
            role="revision" if kwargs["parent_artifact_id"] else "candidate",
            revision=2 if kwargs["parent_artifact_id"] else 1,
            url=kwargs["url"],
            width=kwargs["width"],
            height=kwargs["height"],
            tool_name=kwargs["tool_name"],
            provenance=kwargs["provenance"],
            evaluation=kwargs["evaluation"],
            status="ready",
        )
        self.artifacts.append(artifact)
        return artifact

    async def complete_run(self, **kwargs):
        self.completed = True

    async def fail_run(self, **kwargs):
        self.failed = True
        self.failure_code = kwargs.get("error_code")


def test_brief_readiness_requires_objective_and_product():
    assert DesignBrief().refresh_readiness().unknown_fields == ["objective", "product_images"]
    brief = DesignBrief(objective="广告", product_images=["/img/product.png"]).refresh_readiness()
    assert brief.status == "ready"
    assert brief.unknown_fields == []


def test_canonical_hash_is_order_independent_for_objects():
    assert canonical_hash({"a": 1, "b": 2}) == canonical_hash({"b": 2, "a": 1})


def test_initial_plan_uses_adimage_and_binds_approval_payload():
    repo = FakeRepository()
    run_obj, action = run(build_plan(
        repo,
        project=project(),
        user_id=11,
        request=CreatePlanRequest(request_id="request-123", candidate_count=2),
    ))
    assert run_obj.plan.brief_version == 3
    assert action.payload["tool_name"] == "tbfirst_create_adimage_set"
    assert action.payload["params"]["count"] == 2
    assert action.payload["params"]["product_images"] == ["https://assets.example/product.png"]
    assert action.payload_hash == canonical_hash(action.payload)


def test_revision_plan_keeps_parent_and_uses_refine_tool():
    repo = FakeRepository()
    _, action = run(build_plan(
        repo,
        project=project(),
        user_id=11,
        request=CreatePlanRequest(
            request_id="request-456",
            candidate_count=1,
            revision_of_artifact_id=55,
            revision_instruction="保留商品，只改浅灰背景",
        ),
    ))
    assert action.payload["tool_name"] == "tbfirst_image_phase2_refine"
    assert action.payload["parent_artifact_id"] == 55
    assert action.payload["params"]["reference_images"] == ["https://assets.example/candidate.png"]


def test_execute_stream_registers_artifact_after_approved_claim(monkeypatch):
    import app.agent.design.service as service

    repo = FakeRepository()
    project_obj = project()
    plan = DesignPlan(
        brief_version=3,
        steps=[],
        candidate_count=1,
        max_generation_calls=1,
    )
    run_obj = DesignRun(
        id=21,
        project_id=project_obj.id,
        request_id="request-789",
        status="waiting_approval",
        plan=plan,
        plan_version=1,
    )
    payload = {
        "tool_name": "tbfirst_create_adimage_set",
        "params": {"product_images": project_obj.brief.product_images, "count": 1},
        "parent_artifact_id": None,
        "brief_version": 3,
    }
    action = DesignAction(
        action_uuid="a" * 32,
        project_id=project_obj.id,
        run_id=run_obj.id,
        action_type="approve_plan",
        plan_version=1,
        payload_hash=canonical_hash(payload),
        payload=payload,
        risk_level="medium",
        status="approved",
    )
    repo.action = action

    async def fake_tool(name, params, ctx):
        return McpToolResult(
            trace_id="trace-1",
            workflow="adimage_set",
            assets=[McpAsset(url="https://assets.example/result.png")],
            summary="generated",
        )

    async def fake_eval(url, brief, ctx):
        return EvaluationReport(status="passed", overall_score=0.9), 900, 1200

    monkeypatch.setattr(service, "execute_design_tool", fake_tool)
    monkeypatch.setattr(service, "evaluate_artifact", fake_eval)

    async def collect():
        return [event async for event in execute_run_stream(
            repo,
            project=project_obj,
            run=run_obj,
            action=action,
            user_id=11,
            ctx=McpContext(trace_id="trace-1", user_id="11", roles=["USER"]),
        )]

    events = run(collect())
    assert repo.completed is True
    assert repo.failed is False
    assert len(repo.artifacts) == 1
    assert repo.artifacts[0].width == 900
    payloads = [json.loads(event.removeprefix("data: ").strip()) for event in events]
    assert all(payload["request_id"] == "request-789" for payload in payloads)
    assert all(payload["run_id"] == 21 for payload in payloads)
    assert any('"type": "artifact_created"' in event for event in events)
    assert any('"type": "run_completed"' in event for event in events)


def test_execute_stream_rejects_stale_brief_before_tool_call(monkeypatch):
    import app.agent.design.service as service

    repo = FakeRepository()
    project_obj = project()
    plan = DesignPlan(brief_version=2, steps=[])
    run_obj = DesignRun(
        id=22,
        project_id=project_obj.id,
        request_id="request-stale",
        status="waiting_approval",
        plan=plan,
        plan_version=1,
    )
    payload = {
        "tool_name": "tbfirst_create_adimage_set",
        "params": {"product_images": project_obj.brief.product_images},
        "parent_artifact_id": None,
        "brief_version": 2,
    }
    action = DesignAction(
        action_uuid="s" * 32,
        project_id=project_obj.id,
        run_id=run_obj.id,
        action_type="approve_plan",
        plan_version=1,
        payload_hash=canonical_hash(payload),
        payload=payload,
        risk_level="medium",
        status="approved",
    )
    repo.action = action

    async def forbidden_tool(*args, **kwargs):
        raise AssertionError("stale approval must not execute a tool")

    monkeypatch.setattr(service, "execute_design_tool", forbidden_tool)

    async def collect():
        return [event async for event in execute_run_stream(
            repo,
            project=project_obj,
            run=run_obj,
            action=action,
            user_id=11,
            ctx=McpContext(trace_id="trace-2", user_id="11", roles=["USER"]),
        )]

    events = run(collect())
    assert repo.failed is True
    assert repo.completed is False
    assert any("旧计划授权失效" in event for event in events)


def test_execute_stream_persists_payload_hash_mismatch():
    repo = FakeRepository()
    project_obj = project()
    run_obj = DesignRun(
        id=23,
        project_id=project_obj.id,
        request_id="request-tampered",
        status="waiting_approval",
        plan=DesignPlan(brief_version=3, steps=[]),
        plan_version=1,
    )
    action = DesignAction(
        action_uuid="t" * 32,
        project_id=project_obj.id,
        run_id=run_obj.id,
        action_type="approve_plan",
        plan_version=1,
        payload_hash="not-the-real-hash",
        payload={"brief_version": 3},
        risk_level="medium",
        status="approved",
    )

    async def collect():
        return [event async for event in execute_run_stream(
            repo,
            project=project_obj,
            run=run_obj,
            action=action,
            user_id=11,
            ctx=McpContext(trace_id="trace-3", user_id="11", roles=["USER"]),
        )]

    events = run(collect())
    assert repo.failed is True
    assert repo.failure_code == "ApprovalPayloadMismatch"
    assert any("payload hash mismatch" in event for event in events)


def test_execute_stream_releases_claim_when_stream_is_closed(monkeypatch):
    import app.agent.design.service as service

    repo = FakeRepository()
    project_obj = project()
    run_obj = DesignRun(
        id=24,
        project_id=project_obj.id,
        request_id="request-cancelled",
        status="waiting_approval",
        plan=DesignPlan(brief_version=3, steps=[]),
        plan_version=1,
    )
    payload = {
        "tool_name": "tbfirst_create_adimage_set",
        "params": {"product_images": project_obj.brief.product_images},
        "parent_artifact_id": None,
        "brief_version": 3,
    }
    action = DesignAction(
        action_uuid="c" * 32,
        project_id=project_obj.id,
        run_id=run_obj.id,
        action_type="approve_plan",
        plan_version=1,
        payload_hash=canonical_hash(payload),
        payload=payload,
        risk_level="medium",
        status="approved",
    )
    repo.action = action

    async def forbidden_tool(*args, **kwargs):
        raise AssertionError("stream closes before the tool starts")

    monkeypatch.setattr(service, "execute_design_tool", forbidden_tool)

    async def close_after_claim():
        stream = execute_run_stream(
            repo,
            project=project_obj,
            run=run_obj,
            action=action,
            user_id=11,
            ctx=McpContext(trace_id="trace-4", user_id="11", roles=["USER"]),
        )
        await anext(stream)  # run_started
        await anext(stream)  # tool_started, action is now claimed
        await stream.aclose()

    run(close_after_claim())
    assert repo.failed is True
    assert repo.failure_code == "ClientDisconnected"
