"""
级联压缩器，包含 L1-L4 四个级别的压缩方法，本身不实现具体压缩算法，而是编排 L1-L4 四个子模块的调用时机和顺序，
四级压缩不是同时执行的，而是渐进式级联，由字符数占比触发
"""

from __future__ import annotations

import json
import logging

import psycopg
from psycopg.rows import dict_row

from langchain_core.messages import RemoveMessage

from app.config import get_settings
from app.agent.graph.state import AppState
from app.agent.graph.compression.circuit_breaker import get_breakers
from app.agent.graph.compression.l1_tool_budget import apply_l1
from app.agent.graph.compression.l2_history_snip import apply_l2
from app.agent.graph.compression.l3_microcompact import apply_l3
from app.agent.graph.compression.l4_autocompact import apply_l4

logger = logging.getLogger(__name__)

# 设置硬上限阈值以及触发压缩的上下文字符数占比阈值，超过这个比例才会执行对应级别的压缩方法
MAX_CONTEXT_CHARS = 400_000
L1_TRIGGER_RATIO = 0.60
L2_TRIGGER_RATIO = 0.75
L3_TRIGGER_RATIO = 0.85
L4_TRIGGER_RATIO = 0.95
# L2 的"目标"比例独立于"触发"比例：触发=0.75 但要压到 0.60 才停，留出回旋空间，
# 否则压到刚好踩触发线、下一条消息立刻再次触发，造成压缩抖动。
L2_TARGET_RATIO = 0.60


def _get_chars(m) -> int:
    """    计算内容的字符数（同 l1、l2）    """
    content = getattr(m, "content", "") or ""
    if isinstance(content, str):
        return len(content)
    return sum(len(item) if isinstance(item, str) else len(json.dumps(item)) for item in content)


def _ratio(msg_list) -> float:
    """    计算当前消息列表的总字符数占上下文硬上限的比例    """
    return sum(_get_chars(m) for m in msg_list) / MAX_CONTEXT_CHARS


def _simulate(msgs, removes, new_msgs):
    """    模拟压缩结果：根据要删除的消息 ID 列表，从原消息列表中过滤掉这些消息，同时将新的消息添加到结果列表中，返回新的消息列表    """
    # 提取要删除的 id
    remove_ids = {r.id
                  for r in removes
                  if r.id}
    # 提取要保留的信息，即过滤掉 msgs 中要删除的 id 的消息
    result = [m
              for m in msgs
              if getattr(m, "id", None) not in remove_ids]
    # 将新的消息添加到结果列表中
    result.extend(new_msgs)
    return result


def _dsn() -> str:
    """    构建 PostgreSQL 数据库连接字符串    """
    s = get_settings()
    return f"postgresql://{s.db_user}:{s.db_password}@{s.db_host}:{s.db_port}/{s.db_name}"


async def _lookup_session_id(session_uuid: str, user_id: int) -> int | None:
    """    根据 session_uuid 和 user_id 从数据库中查询对应的 session_id    """
    if not session_uuid:
        return None
    try:
        async with await psycopg.AsyncConnection.connect(_dsn(), row_factory=dict_row) as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "SELECT id FROM ai.session WHERE session_uuid = %s AND user_id = %s AND deleted = 0",
                    (session_uuid, user_id),
                )
                row = await cur.fetchone()
                return int(row["id"]) if row else None
    except Exception as e:
        logger.warning("_lookup_session_id 查询session_id失败 uuid=%r: %s", session_uuid, e)
        return None


def _post_compress_count(msgs: list, all_changes: list) -> int:
    """    在原始消息列表上应用 all_changes（删除 RemoveMessage 指向的 id + 新增其余消息），得到压缩后的消息条数。    用于把 last_compress_at_msg_id 复位成压缩后的真实条数，而非压缩前的旧值。    """
    remove_ids = {c.id
                  for c in all_changes
                  if isinstance(c, RemoveMessage) and c.id}
    added = sum(1
               for c in all_changes
               if not isinstance(c, RemoveMessage))
    survivors = sum(1
                   for m in msgs
                   if getattr(m, "id", None) not in remove_ids)
    return survivors + added


async def cascade_compress_node(state: AppState) -> dict:
    """L1-L4 渐进式级联压缩节点。"""
    msgs = list(state.get("messages") or [])
    ratio = _ratio(msgs)
    if ratio < L1_TRIGGER_RATIO:
        return {}

    # 熔断器按 session 维度隔离：单会话失败不拖垮其它并发用户
    session_uuid = state.get("session_uuid", "")
    breakers = get_breakers(session_uuid)
    compress_cb = breakers.compress
    dependency_cb = breakers.dependency

    # 检查熔断器状态
    try:
        compress_cb.check()
    except RuntimeError as e:
        logger.warning("cascade_compress: 熔断器处于开启状态，跳过: %s", e)
        return {}

    all_changes: list = []

    try:
        new_tools1, removes1 = apply_l1(msgs)
        # LangGraph 的 add_messages reducer 按列表顺序处理
        # 先删除、再插入，避免瞬态的"新旧消息共存"导致的重复计算和不一致问题（如 L3 可能再次压缩掉 L1 刚添加的占位消息）
        all_changes.extend(removes1)
        all_changes.extend(new_tools1)
        current_msgs = _simulate(msgs, removes1, new_tools1)
        ratio = _ratio(current_msgs)

        if ratio >= L2_TRIGGER_RATIO:
            # 触发用 L2_TRIGGER_RATIO，但目标压到 L2_TARGET_RATIO（更低），留出回旋空间防抖动
            target = int(MAX_CONTEXT_CHARS * L2_TARGET_RATIO)
            removes2 = apply_l2(current_msgs, target_chars=target)
            all_changes.extend(removes2)
            current_msgs = _simulate(current_msgs, removes2, [])
            ratio = _ratio(current_msgs)

        if ratio >= L3_TRIGGER_RATIO:
            new_tools3, removes3 = apply_l3(current_msgs)
            all_changes.extend(removes3)
            all_changes.extend(new_tools3)
            current_msgs = _simulate(current_msgs, removes3, new_tools3)
            ratio = _ratio(current_msgs)

        if ratio >= L4_TRIGGER_RATIO:
            s = get_settings()
            if s.gemini_api_key:
                # L4 走外部依赖（Gemini + DB），单独用 dependency 熔断器保护
                try:
                    dependency_cb.check()
                except RuntimeError as e:
                    logger.warning("cascade_compress: dependency 熔断器开启，跳过 L4，保留 L1-L3 变更: %s", e)
                else:
                    try:
                        user_id = state["user_id"]
                        session_id = await _lookup_session_id(session_uuid, user_id)
                        # L4 摘要基于已被 L1/L3 压过的 current_msgs（占位符替代大文本，更省 token），
                        # 但删除指令仍覆盖全部原始消息，确保 L1/L3 已转存的大消息也被一并清除。
                        l4_results = await apply_l4(
                            current_msgs, state, s.gemini_api_key, session_id, user_id
                        )
                        # L4 是"全量替换"：清空 L1-L3 的累积变更，改为"删除全部原始消息 + 仅保留 LLM 摘要"
                        summary_only = [c for c in l4_results if not isinstance(c, RemoveMessage)]
                        all_changes.clear()
                        all_changes.extend(
                            RemoveMessage(id=m.id) for m in msgs if getattr(m, "id", None)
                        )
                        all_changes.extend(summary_only)
                        dependency_cb.reset()
                    except Exception as e:
                        # L4（外部依赖）失败：记 dependency 熔断器，但保留已算好的 L1-L3 变更，不前功尽弃
                        dependency_cb.fail()
                        logger.warning("cascade_compress: L4 失败，保留 L1-L3 变更: %s", e)

        if not all_changes:
            # 没有任何实际压缩动作，但流程本身正常 → 复位主熔断器
            compress_cb.reset()
            return {}
        # L1-L3（及可选 L4）流程未抛异常 → 复位主熔断器
        compress_cb.reset()
        return {"messages": all_changes, "last_compress_at_msg_id": _post_compress_count(msgs, all_changes)}

    # 降级异常处理
    except Exception as e:
        # 1、记录错误次数，触发熔断器，防止短时间内重复执行压缩导致更多异常
        compress_cb.fail()
        # 2、直接降级到 L2 的激进版本：不计算 ratio，直接从最早的消息开始成对删除 AI-Tool 消息，直到总字符数降到 45% 的目标范围内
        logger.warning("cascade_compress: 错误, 直接降级到 l2 激进版: %s", e)
        target = int(MAX_CONTEXT_CHARS * 0.45)
        removes = apply_l2(msgs, target_chars=target)
        # 消息少，但是每条消息都非常大，可能导致 L2 也无法删除足够的消息来降到目标范围内
        if not removes:
            logger.warning("cascade_compress: 降级到 l2 激进版失败，消息数过少，每条消息都过大")
            return {}
        return {"messages": removes, "last_compress_at_msg_id": _post_compress_count(msgs, removes)}
