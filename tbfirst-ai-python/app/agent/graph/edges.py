""" LangGraph 条件边。"""
from __future__ import annotations

import re
from typing import Any


# 触发 L4 偏好萃取的关键词水印（用户说出"记住/以后都/默认/不要再"等意图固化短语）
_EXTRACT_KEYWORDS = re.compile(r"记住|以后都|默认|不要再")
# 距上次萃取超过 N 条新消息时，也触发萃取
_EXTRACT_WATERMARK_DELTA = 5

# 消息总字符数超过此阈值的 60% 时触发压缩（防止少量超长消息绕过消息数阈值）
MAX_CONTEXT_CHARS = 400_000
L1_TRIGGER_RATIO = 0.60

# 消息数阈值：超过 20 条且距上次压缩已产生 10 条新消息时触发压缩
_COMPRESS_THRESHOLD = 20
_COMPRESS_BATCH = 10


async def should_extract(state: dict) -> str:
    """判断是否触发 L4 偏好萃取（extract_preferences 节点）。

    触发条件（满足其一即可）：
    1. 距上次萃取已累积超过 _EXTRACT_WATERMARK_DELTA 条新消息
    2. 最后一条消息含偏好意图关键词（"记住"/"以后都"等）
    """
    msgs: list[Any] = state.get("messages") or []
    cur_len = len(msgs)
    last_extract = int(state.get("last_extract_at_msg_id") or 0)

    if cur_len - last_extract > _EXTRACT_WATERMARK_DELTA:
        return "extract"

    if msgs:
        last = msgs[-1]
        content = getattr(last, "content", None)
        if content is None and isinstance(last, dict):
            content = last.get("content", "")
        if isinstance(content, list):
            content = " ".join(str(p) for p in content)
        if isinstance(content, str) and _EXTRACT_KEYWORDS.search(content):
            return "extract"

    return "end"


async def should_compress(state: dict) -> str:
    """判断是否触发 L2→L3 压缩（compress_state 节点）。

    触发条件（优先级从高到低）：
    1. 消息总字符数超过 MAX_CONTEXT_CHARS × L1_TRIGGER_RATIO（字符数触发，防超长消息）
    2. 消息数超过 _COMPRESS_THRESHOLD 且距上次压缩已产生 _COMPRESS_BATCH 条新消息
    """
    msgs: list[Any] = state.get("messages") or []

    # 统计消息总字符数（content 可能是 str 也可能是 list[dict]）
    total_chars = sum(
        len(getattr(m, "content", "") or "")
        if isinstance(getattr(m, "content", ""), str)
        else sum(len(item) if isinstance(item, str) else len(str(item)) for item in (getattr(m, "content", "") or []))
        for m in msgs
    )
    if total_chars >= MAX_CONTEXT_CHARS * L1_TRIGGER_RATIO:
        return "compress"

    cur_len = len(msgs)
    if cur_len <= _COMPRESS_THRESHOLD:
        return "skip"
    last_compress = int(state.get("last_compress_at_msg_id") or 0)
    if last_compress + _COMPRESS_BATCH > cur_len:
        return "skip"
    return "compress"


# Plan-Solve 常量
MAX_PLAN_STEPS = 12   # 单次计划最大步骤数（硬预算不变量 4）
MAX_REPLAN = 3        # 最多重规划次数

# 复合意图触发词（用户说出需要多步协作的信号）
_COMPLEX_HINT = re.compile(r"然后|再|接着|整条流程|流水线|一键|全流程")

# ReAct 工具调用轮数上限（兜底默认值）
MAX_TURNS = 8

# 按 phase 定制轮数：chat 轻交互给 4 轮即可；流水线 phase 给 12 轮支撑多步骤
_MAX_TURNS_BY_PHASE: dict[str, int] = {"chat": 4}
_MAX_TURNS_PIPELINE = 12
# 出图/分镜流水线 phase 集合——这些 phase 需要更多工具调用轮数
_PIPELINE_PHASES: frozenset[str] = frozenset({"storyboard", "cinestitch", "image_pipeline", "video"})


def max_turns_for(state: dict) -> int:
    """根据当前 phase 返回动态工具调用轮数上限。

    - pipeline phase（分镜/视频等）→ _MAX_TURNS_PIPELINE（12）
    - chat phase → _MAX_TURNS_BY_PHASE["chat"]（4）
    - 未知 / None → MAX_TURNS（8，兜底）
    """
    phase = state.get("phase")
    if phase in _PIPELINE_PHASES:
        return _MAX_TURNS_PIPELINE
    return _MAX_TURNS_BY_PHASE.get(phase, MAX_TURNS)


async def tools_or_max_turns(state: dict) -> str:
    """llm_call 后判断下一步：继续调工具 / 强制结束 / 正常结束。（React实现）

    返回值：
    - "tools"：最后一条 AI 消息含 tool_calls，且调用轮数未达上限 → 继续 ReAct 循环
    - "max_turns_end"：工具调用轮数 ≥ max_turns_for(state) → 强制结束，进入 save_state
    - "__end__"：最后一条 AI 消息无 tool_calls → 正常结束，进入 save_state
    """
    msgs: list[Any] = state.get("messages") or []

    # 找最后一条 AI 消息
    last_ai = None
    # reversed 是 Python 内置函数，返回一个反向迭代器，用于从后往前遍历 msgs 列表
    for m in reversed(msgs):
        if getattr(m, "type", None) == "ai" or type(m).__name__ == "AIMessage":
            last_ai = m
            break

    # 如果没有找到 AI 消息，或者最后一条 AI 消息没有 tool_calls 属性，则认为工具调用结束，进入正常结束分支
    if last_ai is None or not getattr(last_ai, "tool_calls", None):
        return "__end__"

    # 统计历史上已有多少轮工具调用
    tool_turns = sum(
        1
        for m in msgs
        if (getattr(m, "type", None) == "ai" or type(m).__name__ == "AIMessage")
        and getattr(m, "tool_calls", None)
    )

    if tool_turns >= max_turns_for(state):
        return "max_turns_end"
    return "tools"


async def should_plan(state: dict) -> str:
    """compose_prompt 后决策：复杂任务走 Plan-Solve 路径；简单任务直接 ReAct。

    返回：
    - "plan"：plan flag 开 且（复合意图关键词 或 phase ∈ _PIPELINE_PHASES）
    - "react"：plan flag 关 / planner 熔断器 OPEN / 简单请求
    """
    from app.config import get_settings
    from app.agent.graph.compression.circuit_breaker import get_breakers

    if not get_settings().agent_plan_enabled:
        return "react"

    # planner 熔断器 OPEN → 强制 react（不变量 3）
    session = state.get("session_uuid")
    try:
        get_breakers(session).planner.check()
    except RuntimeError:
        return "react"

    # 判断是否是自定义的白名单的阶段 {"storyboard", "cinestitch", "image_pipeline", "video"}
    phase = state.get("phase")
    if phase in _PIPELINE_PHASES:
        return "plan"

    msgs: list[Any] = state.get("messages") or []
    last_human = ""
    for m in reversed(msgs):
        if getattr(m, "type", None) in ("human", "user") or type(m).__name__ == "HumanMessage":
            c = getattr(m, "content", "")
            if isinstance(c, str) and c.strip():
                last_human = c.strip()
                break
    # 如果用户最后一次信息中包含自定义的复合意图关键词，则走 Plan-Solve
    if last_human and _COMPLEX_HINT.search(last_human):
        return "plan"

    return "react"


# Reflection 常量
_REFLECT_THRESHOLD = 0.8
MAX_REFLECT = 2


async def plan_router(state: dict) -> str:
    """plan_node 后：cursor < len(plan) → execute；否则 done（计划为空也走 done）。"""
    plan = list(state.get("plan") or [])
    cursor = int(state.get("plan_cursor") or 0)
    # 如果 state 中定义的计划列表非空且游标未越界（即当前的计划列表未执行完），则继续执行下一步；否则认为计划已完成
    if cursor < len(plan):
        return "execute"
    return "done"


async def replan_router(state: dict) -> str:
    """replan_node 后：超预算 / 完成 → done；否则 continue。"""
    plan = list(state.get("plan") or [])
    cursor = int(state.get("plan_cursor") or 0)
    replan_count = int(state.get("replan_count") or 0)

    # 重规划次数已达上限，进入 done 分支
    if replan_count >= MAX_REPLAN:
        return "done"
    # 当前计划步骤数超过预算上限，进入 done 分支
    if len(plan) > MAX_PLAN_STEPS:
        return "done"
    # 当前计划已完成（游标越界或计划列表为空），进入 done 分支
    if cursor >= len(plan):
        return "done"
    return "continue"


async def after_reflect_accept(state: dict) -> str:
    """reflect_router accept 后的分叉：plan 模式 → replan / 否则 → save。

    防止跨轮 plan_mode 污染。除了检查 state.plan_mode，还要确认
    agent_plan_enabled flag 当前仍开启且 plan 列表非空，避免上一轮 plan 模式残留
    的 plan_mode="plan" 在下一轮 react 路径中错误触发 replan_node。
    """
    from app.config import get_settings

    # 如果当前处于 plan 模式，则进入 replan 分支；否则进入 save 分支。
    # 注意这里要同时满足 plan_mode="plan"、agent_plan_enabled flag 开启、plan 列表非空三个条件，
    # 才能认为真正处于 plan 模式，避免 plan_mode 污染导致的误判。
    plan_mode = state.get("plan_mode")
    if (
        plan_mode == "plan"
        and get_settings().agent_plan_enabled
        and list(state.get("plan") or [])  # plan 列表必须非空才算真正处于 plan 模式
    ):
        return "replan"
    return "save"


async def reflect_router(state: dict) -> str:
    """reflect_gate_node 后决策：是否需要 revise 还是 accept。

    返回：
    - "accept"：reflect flag 关 / 已达 MAX_REFLECT 上限 / 评分 ≥ 阈值 / 熔断器 OPEN
    - "revise"：评分 < 阈值且尚有余额，触发 inject_critique → llm_call 再试
    """
    from app.config import get_settings
    from app.agent.graph.compression.circuit_breaker import get_breakers

    if not get_settings().agent_reflect_enabled:
        return "accept"

    reflect_count = int(state.get("reflect_count") or 0)
    if reflect_count >= MAX_REFLECT:
        return "accept"

    score = float(state.get("last_eval_score") or 1.0)
    if score >= _REFLECT_THRESHOLD:
        return "accept"

    session = state.get("session_uuid")
    try:
        get_breakers(session).evaluator.check()
    except RuntimeError:
        return "accept"

    return "revise"


# Reflexion 触发词（用户表达否定/重来信号）
_NEGATIVE_KEYWORDS = re.compile(r"不对|重来|不是这个|换一个")


async def route_after_save(state: dict) -> str:
    """save_state 后的分叉路由：先判断是否 Reflexion，再判断压缩/萃取，否则结束。

    Reflexion 触发条件（reflexion flag 开 且 满足其一）：
    1. 终态失败信号：reflect_count >= MAX_REFLECT 且 last_eval_score < _REFLECT_THRESHOLD
    2. 最新消息含否定关键词（用户主动说"重来/不对"等）
    flag 关时保持原有 compress/extract/end 分支不变（不变量 2）。
    """
    from app.config import get_settings

    # reflexion flag 开启
    if get_settings().agent_reflexion_enabled:
        reflect_count = int(state.get("reflect_count") or 0)
        last_eval_score = float(state.get("last_eval_score") or 1.0)
        # 当反思次数已达上限且评估分数低于阈值时，认为进入了反思的终态失败信号，触发 reflexion_write；否则继续判断是否有否定关键词
        failure_signal = (reflect_count >= MAX_REFLECT and last_eval_score < _REFLECT_THRESHOLD)

        negative_signal = False
        if not failure_signal:
            msgs: list[Any] = state.get("messages") or []
            for m in reversed(msgs):
                if getattr(m, "type", None) in ("human", "user") or type(m).__name__ == "HumanMessage":
                    c = getattr(m, "content", "")
                    # 是否包含自定义的 Reflexion 触发词
                    if isinstance(c, str) and _NEGATIVE_KEYWORDS.search(c):
                        negative_signal = True
                    break

        if failure_signal or negative_signal:
            return "reflexion_write"

    # 触发 Reflexion 的条件不满足，判断是否需要压缩
    if (await should_compress(state)) == "compress":
        return "compress"
    # 不需要压缩，判断是否需要萃取偏好
    if (await should_extract(state)) == "extract":
        return "extract"
    return "end"
