"""周期性 system-reminder 注入（仿 CC 的 TODO_REMINDER_TURNS 机制）。

当满足特定条件时（最近 N 轮内无工具调用时触发提醒），向 system prompt 动态层末尾追加 <system-reminder> 段。
Reminder 不影响静态层 / prompt cache，仅在动态边界之后注入。
"""
from __future__ import annotations

from typing import Any

# 最近 N 轮内无工具调用时触发提醒，此为阈值
TOOL_IDLE_TURNS = 10


def _has_tool_activity(message: Any) -> bool:
    """判断消息是否涉及工具调用或工具返回。"""
    msg_type = getattr(message, "type", None)
    if msg_type in ("tool", "function"):
        return True
    # AIMessage 带 tool_calls 字段
    tool_calls = getattr(message, "tool_calls", None)
    return bool(tool_calls)


def get_pending_reminders(messages: list[Any]) -> list[str]:
    """
    根据当前会话状态，返回应注入动态层的 system-reminder 列表。

    当前规则：
    - 最近 TOOL_IDLE_TURNS 条消息内无任何工具活动 → 注入工具使用提醒
    """
    if len(messages) < TOOL_IDLE_TURNS:
        return []

    # 获取最近 TOOL_IDLE_TURNS 条消息
    recent = messages[-TOOL_IDLE_TURNS:]

    if any(_has_tool_activity(m) for m in recent):
        return []

    return [
        f"<system-reminder>"
        f"你已超过 {TOOL_IDLE_TURNS} 轮未使用任何工具。"
        f"若用户在询问品牌知识或设计参考，请使用 knowledge_search；"
        f"若在讨论时效性信息，请使用 web_search；"
        f"若用户询问自己的记忆或偏好，请使用 memory_inspector。"
        f"</system-reminder>"
    ]
