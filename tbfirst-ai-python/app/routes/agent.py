"""V6.M2.B.7: agent 路由。Sprint B 实现 POST /sessions + POST /chat (SSE)。
Sprint F 追加 GET /sessions、GET /sessions/{uuid}/messages、DELETE /sessions/{uuid}、GET /tools。"""
from __future__ import annotations

import json
import uuid as uuid_lib
from typing import Optional

import psycopg
from psycopg.rows import dict_row
from fastapi import APIRouter, Header, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from langchain_core.messages import HumanMessage

from app.config import get_settings


router = APIRouter(prefix="/agent", tags=["agent"])


def _dsn() -> str:
    return get_settings().computed_checkpoint_dsn


def _chunk_text(content) -> str:
    """LangChain/Gemini 流式 chunk.content 可能是 str，也可能是部件列表（含 dict，如
    function_call / text 块）。统一抽成纯文本：只取文本块，丢弃 tool-call 等非文本部件，
    避免前端收到对象渲染成 [object Object]。"""
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for p in content:
            if isinstance(p, str):
                parts.append(p)
            elif isinstance(p, dict):
                t = p.get("text")
                if isinstance(t, str):
                    parts.append(t)
        return "".join(parts)
    return str(content)


async def _session_must_belong_to(session_uuid: str, user_id: int) -> dict:
    """校验 session_uuid 归属当前 user_id；不匹配返回 404（防侧信道泄露 uuid 存在性，对应 R20）。"""
    async with await psycopg.AsyncConnection.connect(_dsn(), row_factory=dict_row) as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT id, user_id, scope, title, started_at FROM ai.session "
                "WHERE session_uuid = %s AND user_id = %s AND deleted = 0",
                (session_uuid, user_id),
            )
            row = await cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="session not found")
            return row


class CreateSessionRequest(BaseModel):
    scope: Optional[str] = Field(None, max_length=255)


class CreateSessionResponse(BaseModel):
    session_uuid: str


@router.post("/sessions", response_model=CreateSessionResponse)
async def create_session(
    req: CreateSessionRequest,
    x_user_id: int = Header(..., alias="X-User-Id"),
) -> CreateSessionResponse:
    sid = uuid_lib.uuid4().hex
    async with await psycopg.AsyncConnection.connect(_dsn()) as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "INSERT INTO ai.session (session_uuid, user_id, scope) VALUES (%s, %s, %s)",
                (sid, x_user_id, req.scope),
            )
            await conn.commit()
    return CreateSessionResponse(session_uuid=sid)


class ChatRequest(BaseModel):
    session_uuid: str = Field(..., min_length=8, max_length=64)
    message: str = Field(..., min_length=1, max_length=8000)
    brand_id: Optional[int] = None
    group_id: Optional[int] = None
    phase: Optional[str] = None


@router.post("/chat")
async def chat(
    req: ChatRequest,
    request: Request,
    x_user_id: int = Header(..., alias="X-User-Id"),
) -> StreamingResponse:
    # 1. 校验 session 归属（防越权，错配 → 404 不泄露 uuid 存在性）
    await _session_must_belong_to(req.session_uuid, x_user_id)

    # 2. 拿 graph（lifespan 注入；init 失败时为 None → SSE 错误流降级，避免 HTTP 503 导致 Java 代理崩溃）
    graph = getattr(request.app.state, "agent_graph", None)
    if graph is None:
        async def _graph_unavailable():
            yield 'data: {"type":"error","detail":"agent graph not ready — check server logs (langgraph packages may need pip install)"}\n\n'
            yield "data: [DONE]\n\n"
        return StreamingResponse(
            _graph_unavailable(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    # 3. 同步更新 session.last_active_at + 首次写 title（首条消息前 30 字）
    async with await psycopg.AsyncConnection.connect(_dsn()) as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "UPDATE ai.session SET last_active_at = NOW(), title = COALESCE(title, %s) "
                "WHERE session_uuid = %s",
                (req.message[:30], req.session_uuid),
            )
            await conn.commit()

    # 4. 跑 graph SSE
    cfg = {"configurable": {"thread_id": req.session_uuid}}
    input_state = {
        "messages": [HumanMessage(content=req.message)],
        "user_id": x_user_id,
        "group_id": req.group_id,
        "brand_id": req.brand_id,
        "session_uuid": req.session_uuid,
        "phase": req.phase,
    }

    async def gen():
        try:
            async for ev in graph.astream_events(input_state, cfg, version="v2"):
                et = ev.get("event")
                if et == "on_chat_model_stream":
                    chunk = ev.get("data", {}).get("chunk")
                    text = _chunk_text(getattr(chunk, "content", None)) if chunk else ""
                    if text:
                        yield (
                            "data: "
                            + json.dumps(
                                {"type": "chunk", "content": text},
                                ensure_ascii=False,
                            )
                            + "\n\n"
                        )
                elif et == "on_tool_start":
                    yield (
                        "data: "
                        + json.dumps(
                            {
                                "type": "tool_start",
                                "tool": ev.get("name"),
                                "input": ev.get("data", {}).get("input", {}),
                            },
                            ensure_ascii=False,
                        )
                        + "\n\n"
                    )
                elif et == "on_tool_end":
                    yield (
                        "data: "
                        + json.dumps(
                            {
                                "type": "tool_end",
                                "tool": ev.get("name"),
                                "output": ev.get("data", {}).get("output", {}),
                            },
                            ensure_ascii=False,
                        )
                        + "\n\n"
                    )
                elif et == "on_chain_end":
                    # 关键节点完成事件（可选透出，便于前端显示压缩/萃取/反思提示）
                    node = ev.get("name")
                    if node in ("compress_state", "extract_preferences"):
                        yield (
                            "data: "
                            + json.dumps(
                                {"type": "meta", "event": node},
                                ensure_ascii=False,
                            )
                            + "\n\n"
                        )
                    elif node == "reflect_gate":
                        # M2 Reflection：透出评估分数，便于前端显示自检状态
                        output = ev.get("data", {}).get("output") or {}
                        score = output.get("last_eval_score")
                        yield (
                            "data: "
                            + json.dumps(
                                {"type": "meta", "event": "reflect", "score": score},
                                ensure_ascii=False,
                            )
                            + "\n\n"
                        )
                    elif node == "plan_node":
                        # M3 Plan-Solve：透出生成的步骤列表
                        output = ev.get("data", {}).get("output") or {}
                        steps = output.get("plan") or []
                        yield (
                            "data: "
                            + json.dumps(
                                {"type": "meta", "event": "plan_created", "steps": steps},
                                ensure_ascii=False,
                            )
                            + "\n\n"
                        )
                    elif node == "replan_node":
                        # M3 Plan-Solve：透出重规划游标
                        output = ev.get("data", {}).get("output") or {}
                        cursor = output.get("plan_cursor")
                        yield (
                            "data: "
                            + json.dumps(
                                {"type": "meta", "event": "replan", "cursor": cursor},
                                ensure_ascii=False,
                            )
                            + "\n\n"
                        )
            # 末尾 sentinel
            yield "data: [DONE]\n\n"
        except Exception as e:
            yield (
                "data: "
                + json.dumps({"type": "error", "detail": str(e)}, ensure_ascii=False)
                + "\n\n"
            )

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# -----------------------------------------------------------------------------
# V6.M2.F.1: 会话列表 / 历史 / 删除（Gemini 风左侧栏数据源）
# -----------------------------------------------------------------------------


_MSG_ROLE = {"human": "user", "ai": "assistant", "system": "system"}


@router.get("/sessions")
async def list_sessions(
    x_user_id: int = Header(..., alias="X-User-Id"),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
) -> dict:
    """当前 user 的会话列表，按 last_active_at DESC 分页。"""
    async with await psycopg.AsyncConnection.connect(_dsn(), row_factory=dict_row) as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                SELECT session_uuid, title, scope, started_at, last_active_at
                FROM ai.session
                WHERE user_id = %s AND deleted = 0
                ORDER BY last_active_at DESC
                LIMIT %s OFFSET %s
                """,
                (x_user_id, int(limit), int(offset)),
            )
            rows = list(await cur.fetchall())
    return {"sessions": [_jsonify_row(r) for r in rows]}


@router.get("/sessions/{session_uuid}/messages")
async def get_session_messages(
    session_uuid: str,
    request: Request,
    x_user_id: int = Header(..., alias="X-User-Id"),
) -> dict:
    """通过 Checkpointer 拉该 thread 的历史 messages；先校验归属（错配 404）。"""
    await _session_must_belong_to(session_uuid, x_user_id)

    graph = getattr(request.app.state, "agent_graph", None)
    if graph is None:
        raise HTTPException(status_code=503, detail="agent graph not initialized")

    cfg = {"configurable": {"thread_id": session_uuid}}
    snap = await graph.aget_state(cfg)
    raw = (snap.values or {}).get("messages", []) if snap else []
    out = []
    for m in raw:
        role = _MSG_ROLE.get(getattr(m, "type", None) or "", "assistant")
        content = getattr(m, "content", "")
        if isinstance(content, list):
            content = " ".join(str(p) for p in content)
        out.append({"role": role, "content": content})
    return {"messages": out}


@router.delete("/sessions/{session_uuid}", status_code=204)
async def delete_session(
    session_uuid: str,
    request: Request,
    x_user_id: int = Header(..., alias="X-User-Id"),
) -> None:
    """软删会话（deleted=1）；尽力删 Checkpointer 中该 thread 的 state。错配 user → 404。"""
    await _session_must_belong_to(session_uuid, x_user_id)

    async with await psycopg.AsyncConnection.connect(_dsn()) as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "UPDATE ai.session SET deleted = 1 WHERE session_uuid = %s AND user_id = %s",
                (session_uuid, x_user_id),
            )
            await conn.commit()

    # Checkpointer thread 清理：adelete_thread 在新版 langgraph 可用；不可用则保留 state
    # 物理数据但路由已 404（_session_must_belong_to 过滤 deleted=1），不泄露。
    graph = getattr(request.app.state, "agent_graph", None)
    ckpt = getattr(graph, "checkpointer", None) if graph is not None else None
    if ckpt is not None and hasattr(ckpt, "adelete_thread"):
        try:
            await ckpt.adelete_thread(session_uuid)
        except Exception:
            pass


# -----------------------------------------------------------------------------
# V6.M2.E.7: GET /agent/tools — 工具元信息，供前端右侧 panel 渲染
# -----------------------------------------------------------------------------

# status: "stub"（纯占位，待 v6.M3）| "ready"（本 Sprint 已有实际行为）
_TOOLS_META = [
    {
        "name": "web_search",
        "label": "联网搜索",
        "description": "检索公网获取时效性信息（GeminiProvider googleSearch grounding）。",
        "status": "ready",
        "icon_hint": "globe",
    },
    {
        "name": "knowledge_search",
        "label": "知识库",
        "description": "检索共享知识库（品牌 DNA / 服装分类学 / 成功 prompt）。本 Sprint dense KNN。",
        "status": "ready",
        "icon_hint": "book",
    },
    {
        "name": "memory_inspector",
        "label": "记忆透视",
        "description": "查看助手记住的你的分层记忆（L4 偏好实时；L3/L5 v6.M3）。",
        "status": "ready",
        "icon_hint": "brain",
    },
    {
        "name": "image_gen",
        "label": "生图",
        "description": "由 prompt 出图，HTTP 回调 image service /image/generate。",
        "status": "ready",
        "icon_hint": "image",
    },
]


@router.get("/tools")
async def list_tools() -> dict:
    """返回 4 个 tool 的元信息（name/label/description/status/icon_hint）。"""
    return {"tools": _TOOLS_META}


# -----------------------------------------------------------------------------
# V6.M2.C.4: /profile/memory — L3/L4/L5 个人记忆 CRUD（Sprint C 只填 L4，L3/L5 留空数组）
# -----------------------------------------------------------------------------


from app.agent.memory.semantic import (  # noqa: E402  分段以保留 B.7 import 段独立
    delete_preference,
    list_preferences,
)


class ProfileMemoryResponse(BaseModel):
    preferences: list[dict]
    recall: list[dict]      # D.9 填
    procedural: list[dict]  # E.x 填


class UpdatePreferenceRequest(BaseModel):
    value: Optional[str] = Field(None, min_length=1, max_length=2000)
    user_locked: Optional[bool] = None


def _jsonify_row(row: dict) -> dict:
    """JSONB / NUMERIC / datetime 字段统一转为 JSON 友好类型，避免 FastAPI serialize 失败。"""
    from decimal import Decimal

    item = dict(row)
    for k, v in list(item.items()):
        if isinstance(v, Decimal):
            item[k] = float(v)
        elif hasattr(v, "isoformat"):
            item[k] = v.isoformat()
    return item


async def _list_recall(user_id: int, limit: int = 50) -> list[dict]:
    """L3：列出该用户的全部跨会话摘要（含已归档，供前端展示 + 恢复）。"""
    async with await psycopg.AsyncConnection.connect(_dsn(), row_factory=dict_row) as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                SELECT id, summary, quality_score, recall_count, last_recalled_at, archived
                FROM ai.session_summary
                WHERE user_id = %s
                ORDER BY archived ASC, COALESCE(last_recalled_at, create_time) DESC
                LIMIT %s
                """,
                (user_id, int(limit)),
            )
            rows = list(await cur.fetchall())
    return [_jsonify_row(r) for r in rows]


@router.get("/profile/memory", response_model=ProfileMemoryResponse)
async def get_profile_memory(
    x_user_id: int = Header(..., alias="X-User-Id"),
) -> ProfileMemoryResponse:
    prefs = await list_preferences(x_user_id)
    cleaned = [_jsonify_row(r) for r in prefs]
    recall = await _list_recall(x_user_id)
    return ProfileMemoryResponse(preferences=cleaned, recall=recall, procedural=[])


@router.put("/profile/memory/preference/{preference_id}")
async def update_preference_route(
    preference_id: int,
    req: UpdatePreferenceRequest,
    x_user_id: int = Header(..., alias="X-User-Id"),
) -> dict:
    if req.value is None and req.user_locked is None:
        raise HTTPException(status_code=400, detail="provide at least one of value / user_locked")

    async with await psycopg.AsyncConnection.connect(_dsn(), row_factory=dict_row) as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                UPDATE ai.user_preference
                SET value = COALESCE(%s, value),
                    user_locked = COALESCE(%s, user_locked),
                    update_time = NOW()
                WHERE id = %s AND user_id = %s
                RETURNING id, user_id, key, value, confidence, source_session_id,
                          evidence, user_locked, last_injected_at, create_time, update_time
                """,
                (req.value, req.user_locked, preference_id, x_user_id),
            )
            row = await cur.fetchone()
            await conn.commit()
    if not row:
        # 404 而非 403：错配 user_id 时不暴露 preference_id 是否存在（R20 侧信道）
        raise HTTPException(status_code=404, detail="preference not found")
    # Decimal / datetime 标准化
    from decimal import Decimal
    out = dict(row)
    for k, v in list(out.items()):
        if isinstance(v, Decimal):
            out[k] = float(v)
        if hasattr(v, "isoformat"):
            out[k] = v.isoformat()
    return out


@router.delete("/profile/memory/preference/{preference_id}", status_code=204)
async def delete_preference_route(
    preference_id: int,
    x_user_id: int = Header(..., alias="X-User-Id"),
) -> None:
    deleted = await delete_preference(x_user_id, preference_id)
    if not deleted:
        # 错配 user_id 时同样 404（R20）
        raise HTTPException(status_code=404, detail="preference not found")


class UpdateRecallRequest(BaseModel):
    archived: bool


@router.put("/profile/memory/recall/{summary_id}")
async def update_recall_route(
    summary_id: int,
    req: UpdateRecallRequest,
    x_user_id: int = Header(..., alias="X-User-Id"),
) -> dict:
    """L3 归档 / 恢复：归档后新会话不再召回该摘要；恢复后再次生效。"""
    async with await psycopg.AsyncConnection.connect(_dsn(), row_factory=dict_row) as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                UPDATE ai.session_summary
                SET archived = %s
                WHERE id = %s AND user_id = %s
                RETURNING id, summary, quality_score, recall_count, last_recalled_at, archived
                """,
                (req.archived, summary_id, x_user_id),
            )
            row = await cur.fetchone()
            await conn.commit()
    if not row:
        # 错配 user_id 时 404，不暴露 summary_id 是否存在（R20 侧信道）
        raise HTTPException(status_code=404, detail="summary not found")
    return _jsonify_row(row)
