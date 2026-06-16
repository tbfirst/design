"""L4--Autocompact语义摘要

当上下文即将爆满（≥95%）时，调用 LLM 模型对整个历史进行语义摘要，用一条 AI 消息替代所有历史消息
"""
from __future__ import annotations

import logging
from typing import Sequence

from langchain_core.messages import AIMessage, RemoveMessage

from app.agent.memory.recall import insert_session_summary

logger = logging.getLogger(__name__)

_L4_SYSTEM = """你是一个专业的对话历史压缩助手。
你的任务是将用户与AI助手之间的对话历史压缩为结构化的会话摘要。
摘要必须保留所有对后续对话有价值的信息，删除冗余的寒暄和重复内容。
请严格按照要求的9个章节输出摘要。"""

_L4_USER = """请将以下对话历史压缩为结构化摘要，包含9个章节：

1. 【用户身份与偏好】用户的技术背景、使用习惯、明确偏好
2. 【会话目标】本次会话的主要目标和任务
3. 【明确请求】用户提出的具体需求和要求
4. 【关键决策】重要的技术决策和方案选择
5. 【已完成工作】已经完成的操作、任务、实现的功能
6. 【失败案例】失败的尝试及原因（用于避免重复错误）
7. 【技术约束】发现的技术限制、API限制、环境约束
8. 【待解决问题】尚未解决的问题和待办事项
9. 【其他重要信息】其他对后续对话有价值的信息

对话历史：
{block}

请输出结构化摘要（每个章节标题后跟内容，无内容的章节写"无"）："""


def _serialize_msgs(msgs: Sequence) -> str:
    """    将消息列表序列化为文本块，格式为每条消息一行，格式：[role] {content}，供 LLM 进行摘要。   """
    lines = []
    for m in msgs:
        role = getattr(m, "type", None) or getattr(m, "role", None) or "msg"
        content = getattr(m, "content", "") or ""
        if isinstance(content, list):
            content = " ".join(str(p) for p in content)
        lines.append(f"[{role}] {content}")
    return "\n".join(lines)


async def apply_l4(
    msgs: Sequence,
    state: dict,
    gemini_api_key: str,
    session_id: int | None,
    user_id: int,
) -> list:
    """交给 LLM 摘要整个对话历史，返回一条新的 AIMessage 以及删除原消息的 RemoveMessage 列表。"""
    block = _serialize_msgs(msgs)
    try:
        # 此处使用 Gemini 进行摘要（可替换为其他模型），需要异步调用模型接口，因此 apply_l4 定义为 async 函数。
        from langchain_google_genai import ChatGoogleGenerativeAI
        from langchain_core.messages import SystemMessage, HumanMessage

        llm = ChatGoogleGenerativeAI(
            model="gemini-2.0-flash",
            google_api_key=gemini_api_key,
            temperature=0.0,
        )
        resp = await llm.ainvoke([
            SystemMessage(content=_L4_SYSTEM),
            HumanMessage(content=_L4_USER.format(block=block)),
        ])
        # 摘要结果必须是纯文本字符串，不能包含任何结构化格式（如 JSON、Markdown 等），以确保能直接作为 AIMessage 的内容使用。
        summary = getattr(resp, "content", "") or ""
        if isinstance(summary, list):
            summary = " ".join(str(p) for p in summary)
        summary = (summary or "").strip()
    except Exception as e:
        logger.warning("l4: 大模型摘要失败: %s", e)
        raise

    if not summary:
        raise ValueError("l4: 大模型返回了空摘要")

    # 将摘要存入数据库，关联 session_id 和 user_id，以便后续查询和分析
    if session_id is not None:
        try:
            await insert_session_summary(
                session_id=session_id,
                user_id=user_id,
                summary=summary,
                raw_msg_range={"from": 0, "to": len(msgs)},     # L4 是对全量历史做摘要，所以范围是 0 到 N
            )
        except Exception as e:
            logger.warning("l4: 摘要写入数据库失败: %s", e)

    removes = [RemoveMessage(id=m.id) for m in msgs if getattr(m, "id", None)]
    summary_msg = AIMessage(content=f"[会话历史摘要] {summary}")
    return removes + [summary_msg]
