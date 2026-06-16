"""L3--Microcompact结构压缩

当 L2 历史裁剪仍无法将上下文压到目标范围时，对剩余的工具消息进行批量"结构压缩"——保留最近 N 个，其余全部替换为占位符
"""

from __future__ import annotations

import json
from typing import Sequence

from langchain_core.messages import RemoveMessage, ToolMessage

KEEP_RECENT = 5                     # 保留最近的 N 条 ToolMessage（经验值，具体数值可根据实际情况调整）
# 告诉 LLM："这里曾有一次工具调用返回，但具体内容已被压缩。如果你需要了解细节，请基于已有信息推断，或重新发起工具调用。"
_PLACEHOLDER = "[MICROCOMPACT]"     # context里占位文本（对比 L1 此处是不可找回）
_PREVIEW_CHARS = 200               # 占位符中保留的原文预览长度（给模型留语义线索，区分不同被压缩的工具结果）


def _content_to_str(content) -> str:
    """    将内容转换为字符串（list 内容转 JSON，保留中文原样）    """
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return json.dumps(content, ensure_ascii=False)
    return str(content)


def _build_placeholder(content_str: str) -> str:
    """    构造带预览/字符数的占位符（不写死成单一常量，避免多条压缩结果塌缩成同一串文本）。    L3 不可找回，故提示模型按需重新发起工具调用。    """
    preview = content_str[:_PREVIEW_CHARS].replace("\n", " ")
    return (
        f"{_PLACEHOLDER}\n"
        f"chars={len(content_str)}\n"
        f"preview: {preview}…\n"
        f"(原始内容已压缩且不可找回，需要时请基于已有信息推断或重新发起工具调用)"
    )


def apply_l3(msgs: Sequence) -> tuple[list[ToolMessage], list[RemoveMessage]]:
    """  保留最近特定数量的 ToolMessage 内容，其余使用 [MICROCOMPACT]替代，并生成 RemoveMessage 来删除原消息。 """
    # 与 l2 相同隐式依赖 LangGraph、整个 Agent 对话流程的时序性
    tool_msgs = [m for m in msgs if isinstance(m, ToolMessage)]
    total = len(tool_msgs)

    new_tools: list[ToolMessage] = []
    removes: list[RemoveMessage] = []

    for i, m in enumerate(tool_msgs):
        # 如果当前 ToolMessage 的索引小于 total - KEEP_RECENT，说明它不是最近的 N 条消息之一，需要被压缩处理。
        # 对于这些消息，若有 id，则建一个新的 ToolMessage，内容为带预览的占位符，tool_call_id（tool_call_id和原信息相同），加到 new_tools 列表中
        # 同时，创建一个 RemoveMessage 对象，id 与原消息相同，并添加到 removes 列表中，以便后续删除原消息。
        if i < total - KEEP_RECENT and getattr(m, "id", None):
            new_tools.append(
                ToolMessage(content=_build_placeholder(_content_to_str(m.content)), tool_call_id=m.tool_call_id)
            )
            removes.append(RemoveMessage(id=m.id))

    return new_tools, removes
