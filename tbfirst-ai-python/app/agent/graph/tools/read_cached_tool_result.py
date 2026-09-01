"""读回 L1 压缩转存到磁盘的完整工具结果。

L1 结果预算会把超长 ToolMessage 写盘并在上下文里留下 [TOOL_RESULT_CACHED] 占位符
（含 tool_call_id）。本工具让模型能凭该 tool_call_id 取回被转存的完整原文，使 L1 落盘
真正"可找回"（否则占位符指向的磁盘内容无任何工具可读，等于白写）。
"""
from __future__ import annotations

import logging
from typing import Annotated

from langchain_core.tools import tool
from langgraph.prebuilt import InjectedState

from app.agent.graph.compression.circuit_breaker import get_breakers
from app.agent.graph.compression.l1_tool_budget import read_cached

logger = logging.getLogger(__name__)


@tool
async def read_cached_tool_result(
    tool_call_id: str,
    state: Annotated[dict, InjectedState],
) -> dict:
    """Retrieve the full content of a large tool result that was offloaded to disk by L1 compression.

    When a previous tool result was too large, it was cached to disk and replaced in the
    conversation by a placeholder line `[TOOL_RESULT_CACHED]` that carries its `tool_call_id`.
    Call this tool with that exact `tool_call_id` to read back the complete original content.

    Args:
        tool_call_id: the id shown in the [TOOL_RESULT_CACHED] placeholder.

    Returns: {"found": bool, "content": str, "chars": int}; on miss content is "" and found is False.
    """
    # 工具读回归 tool 类熔断器（按 session 隔离）：连续读盘失败则熔断，避免反复抖动
    cb = get_breakers(state.get("session_uuid", "")).tool
    try:
        cb.check()
    except RuntimeError as e:
        logger.warning("read_cached_tool_result: 熔断器开启，跳过: %s", e)
        return {"found": False, "content": "", "chars": 0, "error": str(e)}

    try:
        content = read_cached(tool_call_id)
    except Exception as e:
        cb.fail()
        logger.warning("read_cached_tool_result: 读回失败 %s: %s", tool_call_id, e)
        return {"found": False, "content": "", "chars": 0, "error": str(e)}

    # 读盘成功（即便文件不存在也算依赖正常，只是没命中）→ 复位熔断器
    cb.succeed()
    if content is None:
        return {"found": False, "content": "", "chars": 0}
    return {"found": True, "content": content, "chars": len(content)}
