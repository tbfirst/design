"""工具契约元数据注册表（对照 CC `Tool<I,O,P>` 的安全语义，轻量版）。

不引入重型 Tool 类，用一个 frozen dataclass `ToolSpec` 把"安全语义 + 结果预算 +
prompt 文件"挂到每个工具名上，作为并发调度（Phase 3）、结果预算（Phase 2）、
prompt 拼接（builder）的单一事实来源。

**fail-closed 默认**：未显式登记的工具一律走最保守默认（非只读、不可并发、50K 预算）。
这复刻 CC `buildTool` 的失败不对称性——新增工具忘记登记只会"过度保守"
（多一次串行 / 多一次落盘），不会引入并发写竞态或撑爆 context。
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ToolSpec:
    """单个工具的契约元数据。默认值即 fail-closed 的最保守语义。"""

    name: str
    is_read_only: bool = False           # 默认假定有副作用（写库/发请求/出图）
    is_concurrency_safe: bool = False    # 默认不可并发（只读且无共享可变状态才置 True）
    max_result_chars: int = 50_000       # 单结果落盘阈值（对齐 CC DEFAULT_MAX_RESULT_SIZE_CHARS）
    prompt_file: str | None = None       # prompts/tools/<x>.md（供 builder 静态层拼接）


# 单一事实来源：每个工具一条。新增工具必须在此登记，否则 spec_of() 走最保守默认。
TOOL_SPECS: dict[str, ToolSpec] = {
    "web_search": ToolSpec(
        "web_search",
        is_read_only=True,
        is_concurrency_safe=True,
        max_result_chars=100_000,
        prompt_file="web_search.md",
    ),
    "knowledge_search": ToolSpec(
        "knowledge_search",
        is_read_only=True,
        is_concurrency_safe=True,
        max_result_chars=60_000,
        prompt_file="knowledge_search.md",
    ),
    "memory_inspector": ToolSpec(
        "memory_inspector",
        is_read_only=True,
        is_concurrency_safe=True,
        max_result_chars=40_000,
        prompt_file="memory_inspector.md",
    ),
    "read_cached_tool_result": ToolSpec(
        "read_cached_tool_result",
        is_read_only=True,
        is_concurrency_safe=True,
        max_result_chars=200_000,
        prompt_file="read_cached_tool_result.md",
    ),
    # image_gen 有副作用（提交出图任务）→ 保守默认：非只读、不可并发
    "image_gen": ToolSpec(
        "image_gen",
        is_read_only=False,
        is_concurrency_safe=False,
        max_result_chars=20_000,
        prompt_file="image_gen.md",
    ),
}


def spec_of(name: str) -> ToolSpec:
    """返回工具的契约元数据；未登记的工具走 fail-closed 最保守默认。"""
    return TOOL_SPECS.get(name) or ToolSpec(name)
