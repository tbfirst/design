"""L2--历史裁剪（处理"消息数量过多"——信息有损但保留结构）

当总字符数仍然超标时，按"可删除性"评分挑选低价值消息成对删除（pair-aware），
并用 WHITELIST 护栏保护硬约束/摘要/置顶等高价值消息不被误删。
"""

from __future__ import annotations

import json
from typing import Sequence

from langchain_core.messages import AIMessage, RemoveMessage, ToolMessage

# 护栏白名单：内容命中任一关键词的消息视为"置顶"，可删除性恒为 -1，永不删除。
# 覆盖：硬约束原文、失败路径、待办/目标/验收、Claude 风摘要结构标记、L4 摘要标签。
WHITELIST = [
    "禁止", "不要", "不能", "必须", "硬约束",
    "失败路径", "不要再走", "已验证不通",
    "TODO", "当前目标", "验收标准",
    "Primary Request", "Pending Tasks",
    "[PINNED", "[SUMMARY", "[会话历史摘要]",
    "[自检反馈]",      # Reflection 注入标记（不删）
    "[当前步骤目标]",  # Plan-Solve 子目标标记（不删）
]


def _content_chars(content: str | list) -> int:
    """    计算内容的字符数（同 l1）    """
    if isinstance(content, str):
        return len(content)
    return sum(len(item) if isinstance(item, str) else len(json.dumps(item)) for item in content)


def _total_chars(msgs: Sequence) -> int:
    """    计算消息列表中所有消息内容的总字符数    """
    # getattr 防御性获取，即使消息对象没有 content 属性也不会报错，默认返回空字符串
    return sum(_content_chars(getattr(m, "content", "") or "") for m in msgs)


def _pinned(msg) -> bool:
    """    内容命中 WHITELIST 任一关键词 → 置顶消息，受护栏保护不可删除    """
    return any(kw in str(getattr(msg, "content", "") or "") for kw in WHITELIST)


def _deletability(msg, idx: int, total: int) -> float:
    """    计算单条消息的"可删除性"评分（越高越该删）；置顶消息恒为 -1。

    四个维度加权：
      - age：越靠前（越旧）越可删
      - size：越大越可删（腾出更多空间）
      - role：ToolMessage > AIMessage > HumanMessage（用户原话最该保留）
      - raw：含原始工具输出特征（stdout/grep 等）的更可删
    """
    if _pinned(msg):
        return -1.0
    age = (total - idx) / total if total else 0.0
    size = min(_content_chars(getattr(msg, "content", "") or "") / 8000, 1.0)
    type_ = type(msg).__name__
    role_w = {"ToolMessage": 0.8, "AIMessage": 0.3, "HumanMessage": 0.1}.get(type_, 0.5)
    is_raw = any(k in str(getattr(msg, "content", "") or "")
                 for k in ["[TOOL_RESULT", "stdout", "stderr", "grep:"])
    raw_w = 0.8 if is_raw else 0.2
    return age * 0.3 + size * 0.3 + role_w * 0.2 + raw_w * 0.2


def _build_pair_map(msgs: Sequence) -> dict[str, str]:
    """    建立 tool_call_id → AI 消息 id 的反向索引，以便在删除工具消息时能找到对应的 AI 消息一起删除    """
    # 正向索引（AI → Tool）很容易：从 AI 消息遍历 tool_calls 即可
    # 反向索引（Tool → AI）需要该映射：当从某条 ToolMessage 开始删除时，能快速找到发起它的 AIMessage
    tc_to_ai: dict[str, str] = {}
    for m in msgs:
        # 只处理带有工具调用请求的 AI 消息
        if isinstance(m, AIMessage) and m.tool_calls:
            for tc in m.tool_calls:
                # tool_calls 中的元素可能是 dict 或 ToolCall 对象。字典：用 .get("id") 取 ID；对象：用 getattr 获取 id 属性。
                tc_id = tc.get("id") if isinstance(tc, dict) else getattr(tc, "id", None)
                if tc_id and m.id:
                    # 在 tc_to_ai 字典中建立映射关系，key 是工具调用 ID，value 是 AI 消息 ID
                    tc_to_ai[tc_id] = m.id
    return tc_to_ai


def _tc_ids_of(ai_msg) -> list[str]:
    """    取一条 AIMessage 发起的所有 tool_call_id    """
    out: list[str] = []
    for tc in (ai_msg.tool_calls or []):
        tc_id = tc.get("id") if isinstance(tc, dict) else getattr(tc, "id", None)
        if tc_id:
            out.append(tc_id)
    return out


def apply_l2(msgs: Sequence, target_chars: int) -> list[RemoveMessage]:
    """    按可删除性评分挑选低价值消息，成对删除完整的 AI-Tool 交互回合，直到总字符数降到目标范围内，返回 RemoveMessage 列表（l2 纯删除）    """
    current = _total_chars(msgs)
    if current <= target_chars:
        return []

    total = len(msgs)
    # 过滤出带有 id 属性的消息，并建立 id → 消息对象 的映射，以便后续根据 ID 快速获取消息内容和属性
    id_to_msg = {m.id: m
                 for m in msgs
                 if getattr(m, "id", None)}
    tc_to_ai = _build_pair_map(msgs)
    # 正向映射：tool_call_id → 对应 ToolMessage 的 id 列表（预计算，避免删除时反复全表扫描）
    tc_to_tool_ids: dict[str, list[str]] = {}
    for m in msgs:
        if isinstance(m, ToolMessage) and m.tool_call_id and getattr(m, "id", None):
            tc_to_tool_ids.setdefault(m.tool_call_id, []).append(m.id)

    def _gather_pair(m) -> set[str]:
        """    收集与消息 m 必须成对删除的完整回合 id 集合（AI + 其全部 ToolMessage）。    AIMessage.tool_calls[].id 与对应 ToolMessage.tool_call_id 必须同进同出，否则 API 结构非法。    """
        ids: set[str] = {m.id}
        if isinstance(m, AIMessage) and m.tool_calls:
            # 当前是 AI 消息：正向找到它发起的所有 ToolMessage 一并删除
            for tc_id in _tc_ids_of(m):
                ids.update(tc_to_tool_ids.get(tc_id, []))
        elif isinstance(m, ToolMessage) and m.tool_call_id:
            # 当前是 Tool 消息：反向找到发起它的 AI 消息，再把该 AI 名下的所有 ToolMessage 都带上
            ai_id = tc_to_ai.get(m.tool_call_id)
            if ai_id:
                ids.add(ai_id)
                ai_msg = id_to_msg.get(ai_id)
                if isinstance(ai_msg, AIMessage):
                    for tc_id in _tc_ids_of(ai_msg):
                        ids.update(tc_to_tool_ids.get(tc_id, []))
        return ids

    # 按可删除性从高到低排序索引；置顶消息(-1)自然排到最后
    order = sorted(range(total), key=lambda i: -_deletability(msgs[i], i, total))

    removes: list[RemoveMessage] = []       # 最终要返回的 RemoveMessage 列表
    scheduled: set[str] = set()             # 已经计划删除的消息 ID 集合，避免重复删除同一消息

    for i in order:
        if current <= target_chars:
            break
        m = msgs[i]
        # 排序后一旦遇到置顶消息(可删除性<0)，说明后面全是置顶/受保护消息，直接停止
        if _deletability(m, i, total) < 0:
            break
        mid = getattr(m, "id", None)
        if not mid or mid in scheduled:
            continue

        ids_to_remove = _gather_pair(m)
        # 护栏：成对回合中只要有一条命中白名单，整对都跳过，绝不为删一条低价值消息而连带删掉置顶消息
        if any(_pinned(id_to_msg[x]) for x in ids_to_remove if x in id_to_msg):
            continue

        for x in ids_to_remove:
            if x in scheduled:
                continue
            msg = id_to_msg.get(x)
            if msg is not None:
                # 实时递减总字符数，每删一条消息，立即从 current 扣除其长度，驱动循环终止条件
                current -= _content_chars(getattr(msg, "content", "") or "")
            # 生成 RemoveMessage 来删除该消息 ID，并将其 ID 加入已计划删除集合
            removes.append(RemoveMessage(id=x))
            scheduled.add(x)

    return removes
