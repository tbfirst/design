"""自定义工具执行节点：并发调度（只读并行 / 写独占）+ 出口预算。

替代 `ToolNode(ALL_TOOLS)` 作为 ReAct 图的 "tools" 节点。对照 CC `StreamingToolExecutor`
（§4.5）的调度规则，按 `ToolSpec.is_concurrency_safe` 把单条 AI 消息里的多个 tool_calls 分区：

- **并发安全（只读且无共享可变状态）** → 并行执行，受 `_MAX_TOOL_CONCURRENCY` 上限限流；
- **其余（有副作用 / fail-closed 默认）** → 串行独占，避免并发写竞态、避免 image_gen 连环出图烧配额。

实现策略：复用 stock `ToolNode` 做单个 tool_call 的实际执行（保留 InjectedState 注入、
错误兜底、dict→ToolMessage 序列化），本层只接管"调度 + 结果预算"，每个 tool_call 单独走
一次 `ToolNode.ainvoke`（公有接口，不依赖其私有内部，跨 langgraph 版本稳健）。
结果按 tool_calls 原始顺序（FIFO）写回，保证确定性。
"""
from __future__ import annotations

import asyncio
import logging
import os

from langchain_core.messages import AIMessage, ToolMessage
from langgraph.prebuilt import ToolNode

from app.agent.graph.tools.budget import enforce_result_budget, enforce_turn_budget
from app.agent.graph.tools.registry import spec_of

logger = logging.getLogger(__name__)

# 并发安全工具的并行上限（对齐 CC MAX_TOOL_USE_CONCURRENCY=10 思路），env 可配
_MAX_TOOL_CONCURRENCY = max(1, int(os.getenv("AGENT_MAX_TOOL_CONCURRENCY", "8")))


def _last_ai_with_tool_calls(messages) -> AIMessage | None:
    """从后往前找最后一条含 tool_calls 的 AI 消息（tools 节点入口即它）。"""
    for m in reversed(messages):
        if isinstance(m, AIMessage) and getattr(m, "tool_calls", None):
            return m
    return None


def make_tool_executor_node(tools):
    """构造 tools 节点：按 ToolSpec 分区并发 + 出口预算。返回 async 节点函数。"""
    tool_node = ToolNode(tools)

    async def _run_one(state: dict, prefix: list, call: dict, config) -> ToolMessage:
        """单个 tool_call：经 stock ToolNode 执行（含 InjectedState），再套单结果预算。

        sub_state 保留这条 AI 消息之前的完整历史（prefix），末尾换成只含本 call 的
        单调用 AI 消息——ToolNode 只读最后一条 tool_calls，其余历史供 InjectedState 消费。
        """
        sub_ai = AIMessage(content="", tool_calls=[call])
        sub_state = {**state, "messages": [*prefix, sub_ai]}
        out = await tool_node.ainvoke(sub_state, config)
        msgs = out["messages"] if isinstance(out, dict) else out
        tm: ToolMessage = msgs[0]
        # 单结果出口预算：用 call 的权威 name（不依赖 tm.name 可能为 None）
        content = enforce_result_budget(call["name"], call["id"], tm.content)
        if content is not tm.content:
            tm = tm.model_copy(update={"content": content})
        return tm

    async def tool_executor(state: dict, config=None) -> dict:
        messages = state.get("messages") or []
        ai = _last_ai_with_tool_calls(messages)
        if ai is None:
            return {"messages": []}
        calls = list(ai.tool_calls)
        # 这条 AI 消息之前的历史（按 identity 定位，容忍其后无尾随消息的常态）
        ai_idx = next((i for i, m in enumerate(messages) if m is ai), len(messages) - 1)
        prefix = list(messages[:ai_idx])

        # 分区：并发安全 → 并行；其余 → 写独占串行
        read_safe = [i for i, c in enumerate(calls) if spec_of(c["name"]).is_concurrency_safe]
        exclusive = [i for i, c in enumerate(calls) if not spec_of(c["name"]).is_concurrency_safe]

        results: dict[int, ToolMessage] = {}

        # 并行批：信号量限流到 _MAX_TOOL_CONCURRENCY（excess 排队）
        if read_safe:
            sem = asyncio.Semaphore(_MAX_TOOL_CONCURRENCY)

            async def _bounded(i: int) -> None:
                async with sem:
                    results[i] = await _run_one(state, prefix, calls[i], config)

            await asyncio.gather(*[_bounded(i) for i in read_safe])

        # 独占批：严格串行，绝不与他者重叠
        for i in exclusive:
            results[i] = await _run_one(state, prefix, calls[i], config)

        if exclusive:
            logger.debug(
                "tool_executor: %d 并行只读 + %d 独占写（cap=%d）",
                len(read_safe), len(exclusive), _MAX_TOOL_CONCURRENCY,
            )

        # FIFO 重排 + 单轮聚合上限兜底
        ordered = [results[i] for i in range(len(calls))]
        return {"messages": enforce_turn_budget(ordered)}

    return tool_executor
