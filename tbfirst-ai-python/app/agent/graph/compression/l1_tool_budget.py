"""L1--结果预算（处理"单条消息过长"——信息无损）

对每次工具调用的结果设大小预算，所有命令输出超过一定长度应写磁盘（注意设置TTL定时清理），而非堆在 context，只把摘要放回上下文
"""
from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from typing import Sequence

from langchain_core.messages import RemoveMessage, ToolMessage

logger = logging.getLogger(__name__)

_LARGE_THRESHOLD = 20_000                   # 阈值（一个经验阈值，具体数值可根据实际情况调整）
_CACHE_DIR = Path(".cache/tool_results")    # 超过阈值就缓存到此磁盘路径
# 告诉 LLM："这里曾有一个工具调用，结果已被缓存，如果需要具体内容请另行请求"。使用方括号包裹的全大写格式，这是 LLM 上下文中的常见约定，便于模型识别和处理。
_PLACEHOLDER = "[TOOL_RESULT_CACHED]"       # context里占位文本（可找回）
_PREVIEW_CHARS = 300                        # 占位符中保留的原文预览长度（给模型留语义线索，避免多条缓存占位符长得一模一样）

# TTL 定时清理参数：写盘前顺手淘汰过期/超量文件，避免 .cache 无限增长撑爆磁盘。
_TTL_SECONDS = 86_400                       # 24h，超过此时长未访问的缓存文件视为过期
_MAX_CACHE_BYTES = 500 * 1024 * 1024        # 缓存目录总容量上限 500MB，超出按最旧优先淘汰


def _content_chars(content: str | list) -> int:
    """    计算内容的字符数    """
    # 如果内容是字符串，直接返回其长度
    if isinstance(content, str):
        return len(content)
    # 如果是列表，则对每个元素进行检查，如果是字符串则计算长度，如果是其他类型（如字典），则将其转换为 JSON 字符串后计算长度，并将所有元素的长度相加得到总长度。
    return sum(len(item) if isinstance(item, str)
               else len(json.dumps(item)) for item in content)


def _content_to_str(content: str | list) -> str:
    """    将内容转换为字符串    """
    # 内容是字符串则直接存
    if isinstance(content, str):
        return content
    # 内容是列表则转换为 JSON 字符串存，ensure_ascii=False 保持非 ASCII 字符的原样输出（如中文），而不是转义为 Unicode 码点。
    return json.dumps(content, ensure_ascii=False)


def _cache_path(tool_call_id: str) -> Path:
    """    工具调用结果在磁盘上的缓存文件路径（以 tool_call_id 命名）    """
    return _CACHE_DIR / f"{tool_call_id}.txt"


def _evict() -> None:
    """    TTL + 容量双阈值淘汰：先删过期文件，再按最旧优先把总量压到上限以内。每次写盘前调用，纯本地 IO。    """
    if not _CACHE_DIR.exists():
        return
    now = time.time()
    # 收集所有缓存文件及其 stat 信息，按修改时间从旧到新排序（最旧的先被淘汰）
    files = []
    # path.iterdir()返回的是 Path 对象生成器，每个 Path 对象代表 _CACHE_DIR 目录下的一个文件或子目录。
    # 遍历 Path 对象，筛选其中的文件，获取它们的修改时间和大小信息，存在 files 列表中。最后根据时间对 files 列表进行排序，以便后续的淘汰处理最旧的文件。
    for f in _CACHE_DIR.iterdir():
        if not f.is_file():
            continue
        try:
            # f.stat() 获取文件的状态信息，包括修改时间（st_mtime）和大小（st_size）
            st = f.stat()
        except OSError:
            continue
        files.append((f, st.st_mtime, st.st_size))
    files.sort(key=lambda x: x[1])

    # 第一遍：删除超过 TTL 的过期文件
    survivors = []
    for f, mtime, size in files:
        if now - mtime > _TTL_SECONDS:
            try:
                # f.unlink() 删除文件，missing_ok=True 表示如果文件不存在则不抛出异常（可能在之前的迭代中已经被删除了）
                f.unlink(missing_ok=True)
            except OSError as exc:
                logger.warning("l1: 淘汰过期缓存失败 %s: %s", f.name, exc)
        else:
            survivors.append((f, mtime, size))

    # 第二遍：若剩余总量仍超过容量上限，从最旧的开始继续删，直到降到上限以内
    total = sum(size for _, _, size in survivors)
    for f, _mtime, size in survivors:
        if total <= _MAX_CACHE_BYTES:
            break
        try:
            f.unlink(missing_ok=True)
            total -= size
        except OSError as exc:
            logger.warning("l1: 淘汰超量缓存失败 %s: %s", f.name, exc)


def read_cached(tool_call_id: str) -> str | None:
    """    凭 tool_call_id 从磁盘读回 L1 转存的完整工具结果；不存在或读失败返回 None。供 read_cached_tool_result 工具调用，让落盘内容真正"可找回"。    """
    path = _cache_path(tool_call_id)
    if not path.exists():
        return None
    try:
        # 读到即视为一次访问，刷新 mtime 以避免热点内容被 TTL 误删
        path.touch(exist_ok=True)
        return path.read_text(encoding="utf-8")
    except OSError as exc:
        logger.warning("l1: 读回缓存失败 %s: %s", tool_call_id, exc)
        return None


def _build_placeholder(tool_call_id: str, content_str: str) -> str:
    """    构造可找回的占位符：保留 tool_call_id、字符数、原文预览，并提示模型如何取回完整内容。    不写死成单一常量——否则多条缓存会塌缩成同一串文本，模型既分不清也取不回。    """
    preview = content_str[:_PREVIEW_CHARS].replace("\n", " ")
    return (
        f"{_PLACEHOLDER}\n"
        f"tool_call_id={tool_call_id}\n"
        f"chars={len(content_str)}\n"
        f"preview: {preview}…\n"
        f"(完整内容已转存磁盘，可用 read_cached_tool_result 工具凭 tool_call_id 取回)"
    )


def apply_l1(msgs: Sequence) -> tuple[list[ToolMessage], list[RemoveMessage]]:
    """  对每条 ToolMessage 内容进行检查，超过阈值，将其内容写入磁盘，在上下文中用占位符替代原消息。同时生成 RemoveMessage 来删除原消息。 """
    new_tools: list[ToolMessage] = []
    removes: list[RemoveMessage] = []

    for m in msgs:
        if not isinstance(m, ToolMessage):
            continue
        if _content_chars(m.content) <= _LARGE_THRESHOLD:
            continue

        # 获取工具调用 ID，tool_call_id 是 LangChain 自动生成的唯一标识
        tool_call_id = m.tool_call_id
        content_str = _content_to_str(m.content)
        try:
            # 创建缓存目录（如果不存在），写盘前先做 TTL/容量淘汰，再将工具调用结果写入以 tool_call_id 命名的文本文件中，编码为 UTF-8。
            _CACHE_DIR.mkdir(parents=True, exist_ok=True)
            _evict()
            _cache_path(tool_call_id).write_text(content_str, encoding="utf-8")
        except Exception as exc:
            logger.warning("l1: l1缓存工具调用结果失败 %s: %s", tool_call_id, exc)

        # 在上下文中添加一个新的 ToolMessage，内容为占位符（含 tool_call_id/字符数/预览，可经 read_cached_tool_result 找回），并保留原工具调用 ID。同时生成一个 RemoveMessage 来删除原消息。
        # RemoveMessage 是 LangChain/LangGraph 的特殊消息类型。
        # 本身不出现在最终对话中，而是作为"指令"告诉 reducer："从 messages 列表中移除 id 匹配的原消息"
        new_tools.append(
            ToolMessage(content=_build_placeholder(tool_call_id, content_str), tool_call_id=tool_call_id)
        )
        if m.id:
            removes.append(RemoveMessage(id=m.id))
    return new_tools, removes
