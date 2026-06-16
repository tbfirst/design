"""工具执行出口的"结果预算"（对照 CC §4.6/§4.8 的三级大结果限制）。

把 `context_future.md` 的 L1 从"压缩节点事后补救"前移到"工具一返回就预算"：
工具结果超过该工具 `ToolSpec.max_result_chars` → 立即落盘 + 返回 `[TOOL_RESULT_CACHED]`
占位符，复用 L1 同一套落盘 / `read_cached_tool_result` 找回基础设施（含 TTL / 容量淘汰）。

两级限制：
- **单结果**：`enforce_result_budget`，按工具维度的 `max_result_chars`（20K–200K）。
- **单轮聚合**：`enforce_turn_budget`，本轮所有工具结果累计上限
  `_MAX_TOOL_RESULTS_PER_TURN_CHARS`（200K，对齐 CC `MAX_TOOL_RESULTS_PER_MESSAGE_CHARS`），
  超限时从最大的几条开始强制落盘，避免并发多工具大结果瞬间撑爆单轮 context。

> 与 L1 的关系：L1 仍作为压缩兜底（处理历史里漏网的大消息），但日常大结果应在**出口**
> 就被预算掉，不再先污染 context 再压缩。
"""
from __future__ import annotations

import logging

from langchain_core.messages import ToolMessage

from app.agent.graph.compression.l1_tool_budget import (
    _PLACEHOLDER,
    _build_placeholder,
    _cache_path,
    _CACHE_DIR,
    _content_chars,
    _content_to_str,
    _evict,
)
from app.agent.graph.tools.registry import spec_of

logger = logging.getLogger(__name__)

# 单轮聚合上限：本轮所有工具结果累计字符数（对齐 CC MAX_TOOL_RESULTS_PER_MESSAGE_CHARS=200K）
_MAX_TOOL_RESULTS_PER_TURN_CHARS = 200_000


def _is_placeholder(content) -> bool:
    """内容是否已是 [TOOL_RESULT_CACHED] 占位符（避免对落盘结果二次落盘）。"""
    return isinstance(content, str) and content.startswith(_PLACEHOLDER)


def _offload(tool_call_id: str, content) -> str:
    """把完整内容写盘（含 TTL/容量淘汰），返回可经 read_cached_tool_result 找回的占位符。"""
    s = _content_to_str(content)
    try:
        _CACHE_DIR.mkdir(parents=True, exist_ok=True)
        _evict()
        _cache_path(tool_call_id).write_text(s, encoding="utf-8")
    except Exception as exc:  # noqa: BLE001 — 落盘失败不阻断主流程，仍返回占位符
        logger.warning("budget: 工具结果落盘失败 %s: %s", tool_call_id, exc)
    return _build_placeholder(tool_call_id, s)


def enforce_result_budget(tool_name: str, tool_call_id: str, content):
    """单结果出口预算：超过该工具 `max_result_chars` → 落盘 + 占位；否则原样返回（同一对象）。"""
    spec = spec_of(tool_name)
    if _is_placeholder(content) or _content_chars(content) <= spec.max_result_chars:
        return content
    logger.info(
        "budget: %s 结果 %d 字符超过预算 %d，落盘 tool_call_id=%s",
        tool_name, _content_chars(content), spec.max_result_chars, tool_call_id,
    )
    return _offload(tool_call_id, content)


def enforce_turn_budget(messages: list[ToolMessage]) -> list[ToolMessage]:
    """单轮聚合上限：本轮工具结果累计超 200K → 从最大的开始落盘，直到降到上限内。

    输入应是已逐条经过 `enforce_result_budget` 的 ToolMessage 列表（顺序即注入顺序）。
    返回等长同序列表，被进一步落盘的项替换 content 为占位符；不修改原对象。
    """
    out = list(messages)
    total = sum(_content_chars(m.content) for m in out)
    if total <= _MAX_TOOL_RESULTS_PER_TURN_CHARS:
        return out

    # 按内容大小降序逐条落盘，跳过已是占位符的项
    for i in sorted(range(len(out)), key=lambda j: _content_chars(out[j].content), reverse=True):
        if total <= _MAX_TOOL_RESULTS_PER_TURN_CHARS:
            break
        m = out[i]
        if _is_placeholder(m.content):
            continue
        before = _content_chars(m.content)
        placeholder = _offload(m.tool_call_id, m.content)
        out[i] = m.model_copy(update={"content": placeholder})
        total += len(placeholder) - before
    return out
