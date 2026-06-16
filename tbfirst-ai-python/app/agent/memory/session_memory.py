"""L2.5 Session Memory：compact 后仍存续的当前工作状态追踪器。"""
from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

SESSION_MEMORY_TRIGGER = 15      # 首次写入所需的消息数
SESSION_MEMORY_UPDATE_EVERY = 10  # 后续每 10 条消息更新一次

_TEMPLATE = """\
<!-- session_memory: auto-maintained, compact-resilient -->
## 当前工作状态

### 本次会话目标
{goal}

### 最近操作
{recent_actions}

### 待完成项
{pending_items}

### 关键决策
{key_decisions}"""

_UPDATE_PROMPT = """\
根据以下对话，更新当前工作状态摘要。严格按照模板格式输出，不要输出模板之外的任何文字。
每个字段限制在 3 条以内，每条不超过 50 字。

模板：
{template}

对话（最近 {n} 条）：
{messages_serialized}

已有摘要（如有）：
{existing}"""


def should_update(msg_count: int, last_at: int) -> bool:
    """ 判断是否需要更新 session memory """
    if msg_count < SESSION_MEMORY_TRIGGER:
        return False        # 消息太少
    if last_at == 0:
        return True         # 首次达到阈值，生成初始摘要
    return (msg_count - last_at) >= SESSION_MEMORY_UPDATE_EVERY     # 后续增量更新


def _serialize(messages: list[Any], limit: int = 20) -> str:
    """ 将消息列表序列化为文本，供 LLM 生成摘要使用 """
    parts = []
    for m in messages[-limit:]:
        # 获取对象的 type/role 属性。如果都获取不到，则赋予默认值 "msg"，这决定了是谁说了这句话（如 system、user、ai）。
        role = getattr(m, "type", None) or getattr(m, "role", None) or "msg"
        # 获取对象的 content 属性，content 字段是消息的主要内容
        content = getattr(m, "content", None)
        # 如果获取不到，并且对象是一个字典，则尝试从字典中获取 role/type 和 content 字段。
        if content is None and isinstance(m, dict):
            role = m.get("role") or m.get("type") or "msg"
            content = m.get("content", "")
        if isinstance(content, list):
            # 如果 content 是一个列表（可能是分段的文本），则将其拼接成一个字符串，段与段之间用空格分隔
            content = " ".join(str(p) for p in content)
        # 将每条消息格式化为 "[role] content" 的形式，并添加到 parts 列表中
        parts.append(f"[{role}] {content}")
    return "\n".join(parts)


async def generate_session_memory(messages: list[Any], existing: str = "") -> str:
    from app.config import get_settings

    s = get_settings()
    if not s.gemini_api_key:
        logger.info("无法生成 session memory，缺少 Gemini API Key")
        return existing     # 返回现有摘要（可能是空字符串）

    try:
        from langchain_google_genai import ChatGoogleGenerativeAI
    except Exception as e:
        logger.warning("生成 session memory 中，langchain_google_genai 包不可用 : %s", e)
        return existing

    empty_template = _TEMPLATE.format(
        goal="（待填写）",
        recent_actions="（待填写）",
        pending_items="（待填写）",
        key_decisions="（待填写）",
    )
    # 准备给 LLM 的提示词，包含模板、最近的消息（限制在20条以内）和已有的摘要（如果有的话）
    prompt = _UPDATE_PROMPT.format(
        template=empty_template,
        n=min(len(messages), 20),
        messages_serialized=_serialize(messages),
        existing=existing or "（无）",
    )

    try:
        llm = ChatGoogleGenerativeAI(
            model="gemini-2.5-flash",
            google_api_key=s.gemini_api_key,
            temperature=0.0,        # 要求严格按模板输出，减少自由发挥
        )
        # 异步调用 ainvoke，不阻塞事件循环，等待 LLM 返回结果
        resp = await llm.ainvoke(prompt)
        text = getattr(resp, "content", "") or ""
        if isinstance(text, list):
            text = " ".join(str(p) for p in text)
        return text.strip() if text.strip() else existing
    except Exception as e:
        logger.warning("生成 ession_memory: 大模型返回失败: %s", e)
        return existing   # 如果 LLM 返回空或纯空白，回退到已有摘要，避免丢失记忆
