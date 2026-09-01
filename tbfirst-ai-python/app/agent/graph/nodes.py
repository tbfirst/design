""" LangGraph 节点定义。"""
from __future__ import annotations

import asyncio
import logging

from langchain_core.messages import SystemMessage

from app.config import get_settings
from app.db.pool import agent_db_connection
from app.agent.graph.compression import cascade_compress_node as compress_state_node
from app.agent.graph.state import AppState
from app.agent.memory.basic_rules import load_basic_rules
from app.agent.memory.recall import (
    mark_recalled,
    search_session_summary,
)
from app.agent.memory.session_memory import generate_session_memory, should_update
from app.agent.memory.semantic import (
    extract_preferences_from_messages,
    list_preferences,
    upsert_preference,
)
from app.agent.memory.procedural import search_workflow
from app.agent.memory.shared import search_shared
from app.services.embedding import embed_text

_L6_DEFAULT_COLLECTIONS = ["brand-dna", "garment-taxonomy", "success-prompts"]

logger = logging.getLogger(__name__)


async def load_basic_rules_node(state: AppState) -> dict:
    """L1：合并 global + group + brand 三段基础规则。"""
    body = await load_basic_rules(state["user_id"], state.get("brand_id"), state.get("group_id"))
    return {"basic_rules": body}


async def load_preferences_node(state: AppState) -> dict:
    """L4：按 user_id 全量拉用户偏好，更新 last_injected_at 为 NOW。"""
    rows = await list_preferences(state["user_id"])
    if rows:
        ids = [r["id"] for r in rows]
        try:
            async with agent_db_connection() as conn:
                async with conn.cursor() as cur:
                    await cur.execute(
                        "UPDATE ai.user_preference SET last_injected_at = NOW() WHERE id = ANY(%s)",
                        (ids,),
                    )
                    await conn.commit()
        except Exception as e:
            logger.warning("load_preferences_node: last_injected_at update failed: %s", e)
    prefs = {
        r["key"]: {
            "value": r["value"],
            "user_locked": bool(r.get("user_locked")),
            "confidence": float(r["confidence"]) if r.get("confidence") is not None else None,
        }
        for r in rows
    }
    return {"preferences": prefs}


async def extract_preferences_node(state: AppState) -> dict:
    """L4 萃取链：对 last_extract_at_msg_id 之后的新消息跑 Gemini 萃取，逐条 upsert。"""
    msgs = list(state.get("messages") or [])
    cur_len = len(msgs)
    last_idx = int(state.get("last_extract_at_msg_id") or 0)
    new_slice = msgs[last_idx:]
    if not new_slice:
        return {"last_extract_at_msg_id": cur_len}

    extracted = await extract_preferences_from_messages(new_slice)
    user_id = state["user_id"]
    for ex in extracted:
        try:
            await upsert_preference(
                user_id=user_id,
                key=ex["key"],
                value=ex["value"],
                confidence=float(ex["confidence"]),
                source_session_id=None,
                evidence={"snippet": ex.get("evidence", "")},
            )
        except Exception as e:
            logger.warning("extract_preferences_node: upsert failed key=%r err=%s", ex.get("key"), e)

    return {"last_extract_at_msg_id": cur_len}


async def compose_prompt_node(state: AppState) -> dict:
    """把静态层 + L1 + Session Memory + L4 + L3 + L5 + L6 拼到 system prompt。
    同时检查周期性 system-reminder 条件，满足时通过 PromptBuilder.append() 注入。
    """
    from app.agent.memory.compose import compose_system_prompt
    from app.agent.prompts.builder import PromptBuilder
    from app.agent.prompts.reminders import get_pending_reminders

    msgs = list(state.get("messages") or [])
    reminders = get_pending_reminders(msgs)

    builder = PromptBuilder()
    for reminder in reminders:
        builder.append(reminder)

    sys_prompt = compose_system_prompt(
        basic_rules=state.get("basic_rules"),
        preferences=state.get("preferences") or {},
        retrieved_recall=state.get("retrieved_recall") or [],
        retrieved_workflow=state.get("retrieved_workflow") or [],
        retrieved_shared=state.get("retrieved_shared") or [],
        session_memory=state.get("session_memory"),
        builder=builder,
        subgoal=state.get("_current_subgoal"),  # Phase D Plan-Solve 子目标注入
    )
    return {"_system_prompt_cached": sys_prompt}


async def update_session_memory_node(state: AppState) -> dict:
    """Session Memory 更新节点：消息数 >= 15 首次写入，之后每 10 条更新一次。"""
    msgs = list(state.get("messages") or [])
    msg_count = len(msgs)
    last_at = int(state.get("last_session_memory_at_msg_id") or 0)

    if not should_update(msg_count, last_at):
        return {}

    existing = state.get("session_memory") or ""
    new_memory = await generate_session_memory(msgs, existing)

    return {
        "session_memory": new_memory,
        "last_session_memory_at_msg_id": msg_count,
    }


async def llm_call_node(state: AppState) -> dict:
    """调用 Gemini text chain，bind 5 个 tool（含 read_cached_tool_result 读回 L1 落盘缓存）。

    当处于 Plan-Solve 模式时，_current_subgoal 由 execute_step 写入 state，但
    compose_prompt 已在图入口运行过，无法感知新值。此处直接从 state 读取并追加
    HumanMessage，确保每次 llm_call 都能看到当前子步骤目标。该消息不写回 state，
    仅在本次 ainvoke 的 msgs 列表中生效。
    """
    from langchain_core.messages import HumanMessage
    from langchain_google_genai import ChatGoogleGenerativeAI
    from app.config import get_settings
    from app.agent.graph.tools import ALL_TOOLS

    s = get_settings()
    llm = ChatGoogleGenerativeAI(
        model="gemini-3-flash-preview",
        google_api_key=s.gemini_api_key,
        temperature=0.7,
        convert_system_message_to_human=False,
    )
    if s.agent_vector_memory_enabled:
        llm = llm.bind_tools(ALL_TOOLS)
    sys_text = state.get("_system_prompt_cached") or "You are tbfirst assistant."
    msgs = [SystemMessage(content=sys_text)] + list(state["messages"])
    subgoal = state.get("_current_subgoal")
    if subgoal:
        msgs.append(HumanMessage(content=f"[当前步骤目标] {subgoal}"))
    resp = await llm.ainvoke(msgs)
    return {"messages": [resp]}


async def reflect_gate_node(state: AppState) -> dict:
    """对最近产物（图像 / 文本）评估，写 last_eval_score(最近一次评估分数) / _pending_critique(待注入的评估反馈)

    - reflect flag 关 或 无产物 → 高分 no-op（accept）
    - reflect_count >= MAX_REFLECT → 直接 accept，不再额外评估
    - evaluator 熔断器 OPEN → 跳过评估直接 accept
    - 评估异常 → evaluator.fail() 后 accept，绝不阻断主对话
    - 不修改 messages
    """
    from app.agent.graph.compression.circuit_breaker import get_breakers
    from app.agent.graph.edges import MAX_REFLECT
    from app.agent.graph.evaluators import evaluate_image, evaluate_text_rubric, latest_artifact

    # 未开启 reflect 功能直接 accept，不评估也不写分数
    if not get_settings().agent_reflect_enabled:
        return {"last_eval_score": 1.0, "_pending_critique": ""}

    # 已达上限则跳过评估，保留上一轮真实分数供 route_after_save 的 failure_signal 判断
    reflect_count = int(state.get("reflect_count") or 0)
    if reflect_count >= MAX_REFLECT:
        return {}

    # 获取最近产物，按 image > text 优先级评估；无产物直接 accept
    artifact, kind = latest_artifact(state)
    if not artifact:
        return {"last_eval_score": 1.0, "_pending_critique": ""}

    session = state.get("session_uuid")
    breakers = get_breakers(session)
    try:
        breakers.evaluator.check()
    except RuntimeError:
        # 熔断器 OPEN → 跳过评估，accept
        return {"last_eval_score": 1.0, "_pending_critique": ""}

    basic_rules = state.get("basic_rules") or ""
    try:
        # 评估异常不阻断主对话，记录失败后 accept；避免因评估接口问题导致整个对话流程受阻（不变量 3）
        if kind == "image":
            user_prompt = ""
            msgs = list(state.get("messages") or [])
            for m in reversed(msgs):
                if getattr(m, "type", None) in ("human", "user") or type(m).__name__ == "HumanMessage":
                    c = getattr(m, "content", "")
                    if isinstance(c, str) and c.strip():
                        user_prompt = c.strip()
                        break
            score, critique = await evaluate_image(artifact, basic_rules=basic_rules, prompt=user_prompt)
        else:
            score, critique = await evaluate_text_rubric(artifact, basic_rules=basic_rules)
    except Exception as e:
        logger.warning("reflect_gate_node: 评估异常（容错 accept）: %s", e)
        breakers.evaluator.fail()
        return {"last_eval_score": 1.0, "_pending_critique": ""}

    breakers.evaluator.succeed()
    return {"last_eval_score": score, "_pending_critique": critique}


async def inject_critique_node(state: AppState) -> dict:
    """把 _pending_critique 注入为 HumanMessage 自检反馈，reflect_count+1。"""
    from langchain_core.messages import HumanMessage

    score = state.get("last_eval_score") or 0.0
    critique = state.get("_pending_critique") or ""
    reflect_count = int(state.get("reflect_count") or 0)

    feedback = f"[自检反馈] 评分 {score:.2f}，需改进：{critique}"
    return {
        "messages": [HumanMessage(content=feedback)],
        "reflect_count": reflect_count + 1,
    }


async def save_state_node(state: AppState) -> dict:
    """No-op；Checkpointer 在节点出口自动持久化 state。"""
    return {}

# Plan-Solve 节点

_NODE_MAX_PLAN_STEPS = 12  # 与 edges.MAX_PLAN_STEPS 保持一致，防循环引用


def _planner_llm():
    """返回独立 planner LLM 实例（不绑 ALL_TOOLS，低 temperature 保证规划稳定）。"""
    from langchain_google_genai import ChatGoogleGenerativeAI
    s = get_settings()
    return ChatGoogleGenerativeAI(
        model="gemini-2.5-flash",
        google_api_key=s.gemini_api_key,
        temperature=0.2,
    )


async def plan_node(state: AppState) -> dict:
    """调用独立 planner LLM 生成结构化步骤列表。

    - planner 异常 → 降级 plan_mode="react"，绝不阻断主对话（不变量 3）
    - plan_cursor=0 / replan_count=0 / plan_mode="plan"
    """
    import json as _json
    from app.agent.prompts.planner import _PLAN_PROMPT
    from app.agent.graph.compression.circuit_breaker import CircuitOpenError, get_breakers

    # 未开启 plan 功能则降级 plan_mode="react"
    if not get_settings().agent_plan_enabled:
        return {"plan_mode": "react"}

    # 从最新 human message 提取用户请求
    msgs = list(state.get("messages") or [])
    user_request = ""
    for m in reversed(msgs):
        if getattr(m, "type", None) in ("human", "user") or type(m).__name__ == "HumanMessage":
            c = getattr(m, "content", "")
            if isinstance(c, str) and c.strip():
                user_request = c.strip()
                break

    session = state.get("session_uuid")
    planner_breaker = get_breakers(session).planner
    try:
        planner_breaker.check()
        llm = _planner_llm()
        prompt = _PLAN_PROMPT.format(user_request=user_request, max_steps=_NODE_MAX_PLAN_STEPS)
        resp = await llm.ainvoke(prompt)
        raw = getattr(resp, "content", "") or ""
        if isinstance(raw, list):
            raw = " ".join(str(p) for p in raw)
        raw = raw.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        steps = _json.loads(raw.strip())
        if not isinstance(steps, list):
            steps = []
        steps = [str(s) for s in steps[:_NODE_MAX_PLAN_STEPS]]
        if not steps:
            planner_breaker.succeed()
            return {"plan_mode": "react", "plan": [], "plan_cursor": 0, "replan_count": 0}
        planner_breaker.succeed()
        return {"plan": steps, "plan_cursor": 0, "replan_count": 0, "plan_mode": "plan"}
    except CircuitOpenError as e:
        logger.info("plan_node 跳过：%s", e)
        return {"plan": [], "plan_cursor": 0, "replan_count": 0, "plan_mode": "react"}
    except Exception as e:
        logger.warning("plan_node 失败（降级 react）: %s", e)
        planner_breaker.fail()
        return {"plan": [], "plan_cursor": 0, "replan_count": 0, "plan_mode": "react"}


async def execute_step(state: AppState) -> dict:
    """把当前步骤子目标写入 _current_subgoal，重置 reflect_count。

    不新写执行器——只注入子目标，然后回 llm_call 复用现有 ReAct 循环（不变量 1）。
    """
    plan = list(state.get("plan") or [])
    cursor = int(state.get("plan_cursor") or 0)
    subgoal = plan[cursor] if cursor < len(plan) else ""
    return {"_current_subgoal": subgoal, "reflect_count": 0}


async def replan_node(state: AppState) -> dict:
    """把近期 ToolMessage 喂给 planner，更新剩余步骤，plan_cursor+1。

    - 异常 → 仅递增 cursor，不阻断（不变量 3）
    - replan_count 计数，plan_cursor 递增
    """
    import json as _json
    from app.agent.prompts.planner import _REPLAN_PROMPT

    plan = list(state.get("plan") or [])
    cursor = int(state.get("plan_cursor") or 0)
    replan_count = int(state.get("replan_count") or 0)
    session = state.get("session_uuid")

    # 近期 ToolMessage 结果摘要
    msgs = list(state.get("messages") or [])
    recent_results = "\n".join(
        str(getattr(m, "content", ""))[:200]
        for m in msgs[-10:]
        if getattr(m, "type", None) == "tool" or type(m).__name__ == "ToolMessage"
    ) or "（无工具结果）"

    new_cursor = cursor + 1
    new_replan_count = replan_count + 1

    # 判定是否完成
    if new_cursor >= len(plan):
        return {"plan_cursor": len(plan), "replan_count": new_replan_count, "_current_subgoal": ""}

    from app.agent.graph.compression.circuit_breaker import CircuitOpenError, get_breakers
    planner_breaker = get_breakers(session).planner
    try:
        planner_breaker.check()
        llm = _planner_llm()
        prompt = _REPLAN_PROMPT.format(
            cursor=cursor,
            original_plan=_json.dumps(plan, ensure_ascii=False),
            recent_results=recent_results,
            max_steps=_NODE_MAX_PLAN_STEPS,
        )
        resp = await llm.ainvoke(prompt)
        raw = getattr(resp, "content", "") or ""
        if isinstance(raw, list):
            raw = " ".join(str(p) for p in raw)
        raw = raw.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        new_plan = _json.loads(raw.strip())
        if isinstance(new_plan, list) and new_plan:
            new_plan = [str(s) for s in new_plan[:_NODE_MAX_PLAN_STEPS]]
            planner_breaker.succeed()
            return {"plan": new_plan, "plan_cursor": new_cursor, "replan_count": new_replan_count}
        raise ValueError("planner returned an empty or invalid plan")
    except CircuitOpenError as e:
        logger.info("replan_node 跳过：%s", e)
    except Exception as e:
        logger.warning("replan_node 失败（保持 cursor 递增）: %s", e)
        planner_breaker.fail()

    return {"plan_cursor": new_cursor, "replan_count": new_replan_count}


async def reflexion_write_node(state: AppState) -> dict:
    """终态失败时将教训写入长期记忆（方案 A，复用 ai.session_summary）。

    触发条件：reflexion flag 开 且 reflect_count >= MAX_REFLECT 且 last_eval_score < _REFLECT_THRESHOLD
    写入格式：summary 以 '[REFLEXION]' 开头，quality_score=0.6
    否则（含 reflexion flag 关）→ no-op
    """
    from app.agent.graph.compression import _lookup_session_id
    from app.agent.graph.edges import MAX_REFLECT, _REFLECT_THRESHOLD
    from app.agent.memory.recall import insert_session_summary

    if not get_settings().agent_reflexion_enabled:
        return {}

    reflect_count = int(state.get("reflect_count") or 0)
    last_eval_score = float(state.get("last_eval_score") or 1.0)

    if reflect_count < MAX_REFLECT or last_eval_score >= _REFLECT_THRESHOLD:
        return {}

    # 组装教训文本
    pending_critique = state.get("_pending_critique") or ""
    msgs = list(state.get("messages") or [])
    user_request = ""
    for m in reversed(msgs):
        if getattr(m, "type", None) in ("human", "user") or type(m).__name__ == "HumanMessage":
            c = getattr(m, "content", "")
            if isinstance(c, str) and c.strip():
                user_request = c.strip()
                break

    lesson = (
        f"[REFLEXION] 任务：{user_request[:100]}\n"
        f"反思：经过 {reflect_count} 轮自检，评分 {last_eval_score:.2f}，"
        f"主要问题：{pending_critique or '未知'}"
    )

    user_id = state.get("user_id") or 0
    session_uuid = state.get("session_uuid") or ""
    raw_msg_range = {"start": 0, "end": len(msgs)}

    # R1 fix：从 DB 取真实 session_id，避免 FK 违约
    session_id = await _lookup_session_id(session_uuid, user_id)
    if session_id is None:
        logger.warning("reflexion_write_node: 无法解析 session_id，跳过写入（uuid=%r）", session_uuid)
        return {}

    try:
        await insert_session_summary(
            session_id=session_id,
            user_id=user_id,
            summary=lesson,
            raw_msg_range=raw_msg_range,
            quality_score=0.6,
        )
        logger.info("reflexion_write_node: 教训已写入长期记忆（score=%.2f）", last_eval_score)
    except Exception as e:
        logger.warning("reflexion_write_node: 写入失败（容错跳过）: %s", e)

    return {}


_EMPTY_RETRIEVAL = {"retrieved_recall": [], "retrieved_workflow": [], "retrieved_shared": []}


async def retrieve_memories_node(state: AppState) -> dict:
    """对最新一条 user message 跑 bge-m3 embed → 并行召回 L3 + L5 + L6。"""
    if not get_settings().agent_vector_memory_enabled:
        return dict(_EMPTY_RETRIEVAL)

    msgs = list(state.get("messages") or [])
    if not msgs:
        return dict(_EMPTY_RETRIEVAL)

    query_text: str = ""
    for m in reversed(msgs):
        role = getattr(m, "type", None) or getattr(m, "role", None)
        if role in ("human", "user"):
            c = getattr(m, "content", "")
            if isinstance(c, list):
                c = " ".join(str(p) for p in c)
            if isinstance(c, str) and c.strip():
                query_text = c.strip()
                break
    if not query_text:
        return dict(_EMPTY_RETRIEVAL)

    try:
        vec = await embed_text(query_text)
    except Exception as e:
        logger.warning("retrieve_memories_node: embed failed: %s", e)
        return dict(_EMPTY_RETRIEVAL)

    user_id = state["user_id"]
    group_id = state.get("group_id")
    group_ids = [group_id] if group_id is not None else []
    phase = state.get("phase")

    async def _l3():
        return await search_session_summary(
            user_id=user_id, query_embedding=vec, k=3, sim_threshold=0.78
        )

    async def _l5():
        return await search_workflow(
            user_id=user_id, group_ids=group_ids, phase=phase, query_embedding=vec, k=2
        )

    async def _l6():
        return await search_shared(
            user_id=user_id,
            group_ids=group_ids,
            collections=_L6_DEFAULT_COLLECTIONS,
            query_embedding=vec,
            k=3,
        )

    recall, workflow, shared = await asyncio.gather(
        _l3(), _l5(), _l6(), return_exceptions=True
    )

    def _ok(res, layer: str) -> list:
        if isinstance(res, Exception):
            logger.warning("retrieve_memories_node: %s search failed: %s", layer, res)
            return []
        return res or []

    recall = _ok(recall, "L3")
    workflow = _ok(workflow, "L5")
    shared = _ok(shared, "L6")

    if recall:
        try:
            await mark_recalled([r["id"] for r in recall])
        except Exception as e:
            logger.warning("retrieve_memories_node: mark_recalled failed: %s", e)

    return {
        "retrieved_recall": recall,
        "retrieved_workflow": workflow,
        "retrieved_shared": shared,
    }
