from __future__ import annotations

import uuid
from typing import Any

import psycopg
from psycopg.types.json import Jsonb

from app.agent.design.models import (
    DesignAction,
    DesignArtifact,
    DesignBrief,
    DesignPlan,
    DesignProject,
    DesignRun,
)
from app.db.pool import agent_db_connection


def _project(row: dict[str, Any]) -> DesignProject:
    return DesignProject(
        **{key: row.get(key) for key in (
            "id", "project_uuid", "user_id", "group_id", "brand_id", "session_uuid",
            "title", "status", "brief_version", "selected_artifact_id", "create_time", "update_time",
        )},
        brief=DesignBrief.model_validate(row.get("brief_json") or {}),
    )


def _run(row: dict[str, Any]) -> DesignRun:
    return DesignRun(
        **{key: row.get(key) for key in (
            "id", "project_id", "request_id", "status", "plan_version", "generation_calls",
            "error_code", "create_time", "start_time", "end_time",
        )},
        plan=DesignPlan.model_validate(row.get("plan_json") or {}),
        cost=row.get("cost_json") or {},
    )


def _action(row: dict[str, Any]) -> DesignAction:
    return DesignAction(
        action_uuid=row["action_uuid"],
        project_id=row["project_id"],
        run_id=row["run_id"],
        action_type=row["action_type"],
        plan_version=row["plan_version"],
        payload_hash=row["payload_hash"],
        payload=row.get("payload_json") or {},
        risk_level=row["risk_level"],
        status=row["status"],
        expires_at=row.get("expires_at"),
    )


def _artifact(row: dict[str, Any]) -> DesignArtifact:
    payload = {
        key: row.get(key)
        for key in (
            "id", "project_id", "run_id", "shared_asset_id", "parent_artifact_id", "role",
            "kind", "revision", "url", "width", "height", "tool_name", "status", "create_time",
        )
    }
    payload["provenance"] = row.get("provenance_json") or {}
    payload["evaluation"] = row.get("evaluation_json")
    return DesignArtifact.model_validate(payload)


class DesignRepository:
    async def create_project(
        self,
        *,
        user_id: int,
        group_id: int | None,
        brand_id: int | None,
        session_uuid: str | None,
        title: str,
        brief: DesignBrief,
    ) -> DesignProject:
        project_uuid = uuid.uuid4().hex
        brief.refresh_readiness()
        async with agent_db_connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    """
                    INSERT INTO ai.design_project
                        (project_uuid, user_id, group_id, brand_id, session_uuid, title, status, brief_json, brief_version)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    RETURNING *
                    """,
                    (
                        project_uuid, user_id, group_id, brand_id, session_uuid, title,
                        "active" if brief.status == "ready" else "draft",
                        Jsonb(brief.model_dump(mode="json")), brief.version,
                    ),
                )
                row = await cur.fetchone()
                await conn.commit()
        return _project(row)

    async def list_projects(self, user_id: int, *, limit: int = 50) -> list[DesignProject]:
        async with agent_db_connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    """
                    SELECT * FROM ai.design_project
                    WHERE user_id = %s AND deleted = 0
                    ORDER BY update_time DESC LIMIT %s
                    """,
                    (user_id, limit),
                )
                rows = list(await cur.fetchall())
        return [_project(row) for row in rows]

    async def get_project(self, project_uuid: str, user_id: int) -> DesignProject | None:
        async with agent_db_connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "SELECT * FROM ai.design_project WHERE project_uuid = %s AND user_id = %s AND deleted = 0",
                    (project_uuid, user_id),
                )
                row = await cur.fetchone()
        return _project(row) if row else None

    async def update_brief(
        self,
        project_uuid: str,
        user_id: int,
        brief: DesignBrief,
        *,
        expected_version: int | None,
    ) -> DesignProject | None:
        brief.refresh_readiness()
        async with agent_db_connection() as conn:
            async with conn.cursor() as cur:
                params: list[Any] = [
                    Jsonb(brief.model_dump(mode="json")), brief.version,
                    "active" if brief.status == "ready" else "draft", project_uuid, user_id,
                ]
                version_clause = ""
                if expected_version is not None:
                    version_clause = " AND brief_version = %s"
                    params.append(expected_version)
                await cur.execute(
                    """
                    UPDATE ai.design_project
                    SET brief_json = %s, brief_version = %s, status = %s, update_time = NOW()
                    WHERE project_uuid = %s AND user_id = %s AND deleted = 0
                    """ + version_clause + " RETURNING *",
                    tuple(params),
                )
                row = await cur.fetchone()
                if row:
                    await cur.execute(
                        """
                        UPDATE ai.design_action
                        SET status = 'rejected', resolved_at = NOW()
                        WHERE project_id = %s AND status IN ('pending', 'approved')
                        """,
                        (row["id"],),
                    )
                    await cur.execute(
                        """
                        UPDATE ai.design_run
                        SET status = 'superseded', end_time = NOW()
                        WHERE project_id = %s AND status = 'waiting_approval'
                        """,
                        (row["id"],),
                    )
                await conn.commit()
        return _project(row) if row else None

    async def find_run_by_request(self, project_id: int, request_id: str) -> tuple[DesignRun, DesignAction] | None:
        async with agent_db_connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "SELECT * FROM ai.design_run WHERE project_id = %s AND request_id = %s",
                    (project_id, request_id),
                )
                run_row = await cur.fetchone()
                if not run_row:
                    return None
                await cur.execute(
                    "SELECT * FROM ai.design_action WHERE run_id = %s ORDER BY id DESC LIMIT 1",
                    (run_row["id"],),
                )
                action_row = await cur.fetchone()
        return (_run(run_row), _action(action_row)) if action_row else None

    async def create_run_and_action(
        self,
        *,
        project: DesignProject,
        request_id: str,
        plan: DesignPlan,
        payload: dict[str, Any],
        payload_hash: str,
    ) -> tuple[DesignRun, DesignAction]:
        existing = await self.find_run_by_request(project.id, request_id)
        if existing:
            return existing

        action_uuid = uuid.uuid4().hex
        duplicate = False
        async with agent_db_connection() as conn:
            async with conn.cursor() as cur:
                try:
                    await cur.execute(
                        """
                        INSERT INTO ai.design_run
                            (project_id, request_id, status, plan_json, plan_version, cost_json)
                        VALUES (%s, %s, 'waiting_approval', %s, %s, %s)
                        RETURNING *
                        """,
                        (
                            project.id, request_id, Jsonb(plan.model_dump(mode="json")), plan.version,
                            Jsonb({"level": plan.estimated_cost_level, "maxGenerationCalls": plan.max_generation_calls}),
                        ),
                    )
                    run_row = await cur.fetchone()
                    await cur.execute(
                        """
                        INSERT INTO ai.design_action
                            (action_uuid, project_id, run_id, action_type, plan_version, payload_hash,
                             payload_json, risk_level, status, expires_at)
                        VALUES (%s, %s, %s, 'approve_plan', %s, %s, %s, 'medium', 'pending', NOW() + INTERVAL '30 minutes')
                        RETURNING *
                        """,
                        (
                            action_uuid, project.id, run_row["id"], plan.version, payload_hash, Jsonb(payload),
                        ),
                    )
                    action_row = await cur.fetchone()
                    await cur.execute(
                        "UPDATE ai.design_project SET status = 'waiting_approval', update_time = NOW() WHERE id = %s",
                        (project.id,),
                    )
                    await conn.commit()
                except psycopg.errors.UniqueViolation:
                    await conn.rollback()
                    duplicate = True
        if duplicate:
            existing = await self.find_run_by_request(project.id, request_id)
            if existing:
                return existing
            raise RuntimeError("duplicate design request exists without an action")
        return _run(run_row), _action(action_row)

    async def get_action_for_user(self, action_uuid: str, user_id: int) -> DesignAction | None:
        async with agent_db_connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    """
                    SELECT a.* FROM ai.design_action a
                    JOIN ai.design_project p ON p.id = a.project_id
                    WHERE a.action_uuid = %s AND p.user_id = %s AND p.deleted = 0
                    """,
                    (action_uuid, user_id),
                )
                row = await cur.fetchone()
        return _action(row) if row else None

    async def decide_action(
        self,
        *,
        action_uuid: str,
        project_id: int,
        user_id: int,
        payload_hash: str,
        approve: bool,
    ) -> DesignAction | None:
        status = "approved" if approve else "rejected"
        async with agent_db_connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    """
                    UPDATE ai.design_action a
                    SET status = %s, actor_id = %s, resolved_at = NOW()
                    FROM ai.design_project p
                    WHERE a.project_id = p.id AND a.project_id = %s AND a.action_uuid = %s AND p.user_id = %s
                      AND a.payload_hash = %s AND a.status = 'pending' AND a.expires_at > NOW()
                    RETURNING a.*
                    """,
                    (status, user_id, project_id, action_uuid, user_id, payload_hash),
                )
                row = await cur.fetchone()
                if row and not approve:
                    await cur.execute(
                        "UPDATE ai.design_run SET status = 'rejected', end_time = NOW() WHERE id = %s",
                        (row["run_id"],),
                    )
                    await cur.execute(
                        "UPDATE ai.design_project SET status = 'active', update_time = NOW() WHERE id = %s",
                        (row["project_id"],),
                    )
                await conn.commit()
        return _action(row) if row else None

    async def get_run_for_user(self, run_id: int, user_id: int) -> DesignRun | None:
        async with agent_db_connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    """
                    SELECT r.* FROM ai.design_run r
                    JOIN ai.design_project p ON p.id = r.project_id
                    WHERE r.id = %s AND p.user_id = %s AND p.deleted = 0
                    """,
                    (run_id, user_id),
                )
                row = await cur.fetchone()
        return _run(row) if row else None

    async def latest_open_run(self, project_id: int, user_id: int) -> tuple[DesignRun, DesignAction] | None:
        async with agent_db_connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    """
                    SELECT r.* FROM ai.design_run r
                    JOIN ai.design_project p ON p.id = r.project_id
                    WHERE r.project_id = %s AND p.user_id = %s
                      AND r.status IN ('waiting_approval', 'running')
                    ORDER BY r.id DESC LIMIT 1
                    """,
                    (project_id, user_id),
                )
                run_row = await cur.fetchone()
                if not run_row:
                    return None
                await cur.execute(
                    "SELECT * FROM ai.design_action WHERE run_id = %s ORDER BY id DESC LIMIT 1",
                    (run_row["id"],),
                )
                action_row = await cur.fetchone()
        return (_run(run_row), _action(action_row)) if action_row else None

    async def action_for_run(self, run_id: int, user_id: int) -> DesignAction | None:
        async with agent_db_connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    """
                    SELECT a.* FROM ai.design_action a
                    JOIN ai.design_project p ON p.id = a.project_id
                    WHERE a.run_id = %s AND p.user_id = %s
                    ORDER BY a.id DESC LIMIT 1
                    """,
                    (run_id, user_id),
                )
                row = await cur.fetchone()
        return _action(row) if row else None

    async def claim_action(self, action_uuid: str, user_id: int) -> DesignAction | None:
        async with agent_db_connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    """
                    UPDATE ai.design_action a
                    SET status = 'executing'
                    FROM ai.design_project p
                    WHERE a.project_id = p.id AND a.action_uuid = %s AND p.user_id = %s
                      AND a.status = 'approved' AND a.expires_at > NOW()
                    RETURNING a.*
                    """,
                    (action_uuid, user_id),
                )
                row = await cur.fetchone()
                if row:
                    await cur.execute(
                        "UPDATE ai.design_run SET status = 'running', start_time = NOW() WHERE id = %s",
                        (row["run_id"],),
                    )
                    await cur.execute(
                        "UPDATE ai.design_project SET status = 'active', update_time = NOW() WHERE id = %s",
                        (row["project_id"],),
                    )
                await conn.commit()
        return _action(row) if row else None

    async def register_artifact(
        self,
        *,
        project_id: int,
        run_id: int,
        parent_artifact_id: int | None,
        url: str,
        tool_name: str,
        tool_input_hash: str,
        provenance: dict[str, Any],
        evaluation: dict[str, Any],
        width: int | None = None,
        height: int | None = None,
    ) -> DesignArtifact:
        async with agent_db_connection() as conn:
            async with conn.cursor() as cur:
                revision = 1
                role = "candidate"
                if parent_artifact_id:
                    await cur.execute(
                        "SELECT revision FROM ai.design_artifact WHERE id = %s AND project_id = %s",
                        (parent_artifact_id, project_id),
                    )
                    parent = await cur.fetchone()
                    if parent:
                        revision = int(parent["revision"]) + 1
                        role = "revision"
                await cur.execute(
                    """
                    INSERT INTO ai.design_artifact
                        (project_id, run_id, parent_artifact_id, role, kind, revision, url, width, height, tool_name,
                         tool_input_hash, provenance_json, evaluation_json, status)
                    VALUES (%s, %s, %s, %s, 'image', %s, %s, %s, %s, %s, %s, %s, %s, 'ready')
                    RETURNING *
                    """,
                    (
                        project_id, run_id, parent_artifact_id, role, revision, url, width, height, tool_name,
                        tool_input_hash, Jsonb(provenance), Jsonb(evaluation),
                    ),
                )
                row = await cur.fetchone()
                await cur.execute(
                    "UPDATE ai.design_project SET update_time = NOW() WHERE id = %s",
                    (project_id,),
                )
                await conn.commit()
        return _artifact(row)

    async def register_source_asset(
        self,
        *,
        project_id: int,
        role: str,
        url: str,
        provenance: dict[str, Any],
    ) -> DesignArtifact:
        async with agent_db_connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    """
                    INSERT INTO ai.design_artifact
                        (project_id, role, kind, revision, url, provenance_json, status)
                    VALUES (%s, %s, 'image', 1, %s, %s, 'ready')
                    ON CONFLICT DO NOTHING
                    RETURNING *
                    """,
                    (project_id, role, url, Jsonb(provenance)),
                )
                row = await cur.fetchone()
                if not row:
                    await cur.execute(
                        """
                        SELECT * FROM ai.design_artifact
                        WHERE project_id = %s AND role = %s AND url = %s
                        ORDER BY id DESC LIMIT 1
                        """,
                        (project_id, role, url),
                    )
                    row = await cur.fetchone()
                await cur.execute(
                    "UPDATE ai.design_project SET update_time = NOW() WHERE id = %s",
                    (project_id,),
                )
                await conn.commit()
        return _artifact(row)

    async def complete_run(self, *, run_id: int, action_uuid: str, generation_calls: int) -> None:
        async with agent_db_connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "UPDATE ai.design_action SET status = 'executed', resolved_at = NOW() WHERE action_uuid = %s",
                    (action_uuid,),
                )
                await cur.execute(
                    "UPDATE ai.design_run SET status = 'completed', generation_calls = %s, end_time = NOW() WHERE id = %s",
                    (generation_calls, run_id),
                )
                await cur.execute(
                    """
                    UPDATE ai.design_project SET status = 'active', update_time = NOW()
                    WHERE id = (SELECT project_id FROM ai.design_run WHERE id = %s)
                    """,
                    (run_id,),
                )
                await conn.commit()

    async def fail_run(self, *, run_id: int, action_uuid: str, error_code: str) -> None:
        async with agent_db_connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "UPDATE ai.design_action SET status = 'failed', resolved_at = NOW() WHERE action_uuid = %s",
                    (action_uuid,),
                )
                await cur.execute(
                    "UPDATE ai.design_run SET status = 'failed', error_code = %s, end_time = NOW() WHERE id = %s",
                    (error_code[:128], run_id),
                )
                await cur.execute(
                    """
                    UPDATE ai.design_project SET status = 'failed', update_time = NOW()
                    WHERE id = (SELECT project_id FROM ai.design_run WHERE id = %s)
                    """,
                    (run_id,),
                )
                await conn.commit()

    async def list_artifacts(self, project_uuid: str, user_id: int) -> list[DesignArtifact]:
        async with agent_db_connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    """
                    SELECT a.* FROM ai.design_artifact a
                    JOIN ai.design_project p ON p.id = a.project_id
                    WHERE p.project_uuid = %s AND p.user_id = %s AND p.deleted = 0
                    ORDER BY a.create_time ASC, a.id ASC
                    """,
                    (project_uuid, user_id),
                )
                rows = list(await cur.fetchall())
        return [_artifact(row) for row in rows]

    async def get_artifact(self, project_id: int, artifact_id: int, user_id: int) -> DesignArtifact | None:
        async with agent_db_connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    """
                    SELECT a.* FROM ai.design_artifact a
                    JOIN ai.design_project p ON p.id = a.project_id
                    WHERE a.project_id = %s AND a.id = %s AND p.user_id = %s AND p.deleted = 0
                    """,
                    (project_id, artifact_id, user_id),
                )
                row = await cur.fetchone()
        return _artifact(row) if row else None

    async def select_artifact(self, project_uuid: str, user_id: int, artifact_id: int) -> DesignArtifact | None:
        async with agent_db_connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    """
                    SELECT a.* FROM ai.design_artifact a
                    JOIN ai.design_project p ON p.id = a.project_id
                    WHERE a.id = %s AND p.project_uuid = %s AND p.user_id = %s AND p.deleted = 0
                      AND p.status <> 'completed'
                      AND a.role IN ('candidate', 'revision')
                      AND a.status IN ('ready', 'selected')
                    """,
                    (artifact_id, project_uuid, user_id),
                )
                row = await cur.fetchone()
                if not row:
                    return None
                await cur.execute(
                    "UPDATE ai.design_artifact SET status = 'ready' WHERE project_id = %s AND status = 'selected'",
                    (row["project_id"],),
                )
                await cur.execute("UPDATE ai.design_artifact SET status = 'selected' WHERE id = %s", (artifact_id,))
                await cur.execute(
                    "UPDATE ai.design_project SET selected_artifact_id = %s, update_time = NOW() WHERE id = %s",
                    (artifact_id, row["project_id"]),
                )
                await conn.commit()
        row["status"] = "selected"
        return _artifact(row)

    async def finalize_project(self, project_uuid: str, user_id: int) -> DesignArtifact | None:
        async with agent_db_connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    """
                    SELECT a.* FROM ai.design_project p
                    JOIN ai.design_artifact a ON a.id = p.selected_artifact_id
                    WHERE p.project_uuid = %s AND p.user_id = %s AND p.deleted = 0
                      AND a.role IN ('candidate', 'revision', 'final')
                    """,
                    (project_uuid, user_id),
                )
                row = await cur.fetchone()
                if not row:
                    return None
                await cur.execute(
                    "UPDATE ai.design_artifact SET status = 'final', role = 'final' WHERE id = %s",
                    (row["id"],),
                )
                await cur.execute(
                    "UPDATE ai.design_project SET status = 'completed', update_time = NOW() WHERE id = %s",
                    (row["project_id"],),
                )
                await conn.commit()
        row["status"] = "final"
        row["role"] = "final"
        return _artifact(row)
