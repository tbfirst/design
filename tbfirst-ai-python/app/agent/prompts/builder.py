"""分层 pompt 构建器，支持 section 级覆盖。

优先级（高 → 低）：override > coordinator > custom > default
append 层在所有 section 后无条件追加，不参与覆盖逻辑。

典型用法：
  builder = PromptBuilder()
  # compose_system_prompt() 内部调用 set_default()
  builder.set_custom("basic_rules", "## 品牌定制规则\\n...")
  builder.set_override("identity", "特殊模式：你是内容安全审核员。")
  result = compose_system_prompt(basic_rules="...", builder=builder)
"""
from __future__ import annotations

import logging
from functools import lru_cache
from pathlib import Path

logger = logging.getLogger(__name__)

# 提示词来源，优先级数值越小越高
_LAYER_PRIORITY: dict[str, int] = {
    "override": 0,          # 临时拼接的提示词，强制覆盖
    "coordinator": 1,       # 平台侧协调内容
    "custom": 2,            # 品牌/群组定制内容
    "default": 3,           # 系统默认拼出来的内容
}

# 动态层的 section 顺序，与 compose_system_prompt() 的拼接语义一致
_DYNAMIC_SECTION_ORDER = [
    "basic_rules",
    "session_memory",
    "preferences",
    "reflexion_lessons",  # Phase D M4 Reflexion：过往教训段（比 recall 提权，优先展示）
    "recall",
    "workflow",
    "shared",
    # 设计任务的结构化真相源。普通 Agent 不设置这些 section，因此行为不变。
    "design_policy",
    "project_brief",
    "brand_rules",
    "artifact_context",
    "design_plan",
    "approval_context",
    "current_step",
    "subgoal",   # Phase D Plan-Solve：当前步骤子目标（仅动态层，在边界之后）
]

# Path(__file__)：当前文件（system_prompt.py）的路径。.parent.parent：向上退两级目录
# 最终指向两个存放静态提示词文本片段的目录：
# app/agent/prompts/sections/ （内部存放当前agent的身份）和 app/agent/prompts/tools/ （内部存放当前agent的工具描述）
_SECTIONS_DIR = Path(__file__).parent.parent / "prompts" / "sections"
_TOOLS_DIR = Path(__file__).parent.parent / "prompts" / "tools"

# 工具描述文件的固定加载顺序，与 ALL_TOOLS 顺序对齐，确保 LLM 看到的工具列表与后端实际注册的工具一致
_TOOL_FILES = [
    "web_search.md",
    "knowledge_search.md",
    "memory_inspector.md",
    "image_gen.md",
    "read_cached_tool_result.md",
]

# 动态边界哨兵（仿cc设计）
_DYNAMIC_BOUNDARY = "\n<!-- dynamic boundary: content below changes per request -->\n"


@lru_cache(maxsize=8)
def _load_section(name: str) -> str:
    """从 prompts/sections/ 加载 section 文件，进程内缓存，重启后生效。"""
    path = _SECTIONS_DIR / name
    if not path.exists():
        logger.warning("section file missing: %s", path)
        return ""
    return path.read_text(encoding="utf-8").strip()


@lru_cache(maxsize=1)
def _load_tool_prompts() -> str:
    """从 prompts/tools/ 加载工具描述，进程内缓存，重启后生效。"""
    parts = []
    for fname in _TOOL_FILES:
        path = _TOOLS_DIR / fname
        if path.exists():
            parts.append(path.read_text(encoding="utf-8").strip())
    return "\n\n".join(parts)


def _section(name: str, content: str) -> str:
    """带名字的 section 包装，便于 debug 和 token 审计。"""
    # 简单来说就是在内容前后添加一个 HTML 注释，标明这是哪个 section 的内容，方便后续查看和分析
    return f"<!-- section:{name} -->\n{content}"


class PromptBuilder:
    """Section 级 prompt 构建器。

    每个 section 可在不同 layer 注册内容；build() 时对每个 section 取最高优先级的
    非空内容。静态层（identity / tools）若未被覆盖，自动从文件加载。
    """

    def __init__(self) -> None:
        # section_name -> {layer -> content}
        self._registry: dict[str, dict[str, str]] = {}  # 各 section 在各层的内容
        self._appended: list[str] = []  # 不参与覆盖逻辑的追加内容（如 system-reminder）

    # ── 注册 API ────────────────────────────────────────────────────────────

    def _set(self, section: str, content: str, layer: str) -> "PromptBuilder":
        if layer not in _LAYER_PRIORITY:
            raise ValueError(
                f"Unknown layer {layer!r}. Valid: {list(_LAYER_PRIORITY)}"
            )
        self._registry.setdefault(section, {})[layer] = content
        return self

    # 当前只有 compose.py 中用到 set_default，其他层暂未使用  todo 后续若仍然未使用可进行删减
    def set_default(self, section: str, content: str) -> "PromptBuilder":
        """标准默认层，由 compose_system_prompt() 填充各数据源内容。"""
        return self._set(section, content, "default")

    def set_custom(self, section: str, content: str) -> "PromptBuilder":
        """品牌 / 群组级定制层，可覆盖 default。"""
        return self._set(section, content, "custom")

    def set_coordinator(self, section: str, content: str) -> "PromptBuilder":
        """平台协调层（管理员），仅次于 override。"""
        return self._set(section, content, "coordinator")

    def set_override(self, section: str, content: str) -> "PromptBuilder":
        """强制覆盖层，优先级最高，覆盖所有其他层。"""
        return self._set(section, content, "override")

    def append(self, content: str) -> "PromptBuilder":
        """在所有 section 后追加（system-reminder 等），不参与覆盖逻辑。"""
        if content.strip():
            self._appended.append(content)
        return self

    # ── 查询 API ────────────────────────────────────────────────────────────

    def resolve(self, section: str) -> str:
        """返回该 section 最高优先级的非空内容，无内容返回空字符串。"""
        layers = self._registry.get(section, {})
        for layer in sorted(_LAYER_PRIORITY, key=lambda l: _LAYER_PRIORITY[l]):
            content = layers.get(layer, "")
            if content:
                return content
        return ""

    def effective_layer(self, section: str) -> str | None:
        """返回当前生效的 layer 名称（用于调试）。"""
        layers = self._registry.get(section, {})
        for layer in sorted(_LAYER_PRIORITY, key=lambda l: _LAYER_PRIORITY[l]):
            if layers.get(layer, ""):
                return layer
        return None

    # ── 构建 ────────────────────────────────────────────────────────────────

    def build(self) -> str:
        parts: list[str] = []

        # 静态层（prompt cache 友好：总在最前，内容极少变化）
        # 从当前 section 最高优先级的非空内容中加载当前身份和工具描述，或从指定文件中加载当前身份和工具描述。保证不覆盖时行为与旧版一致
        identity = self.resolve("identity") or _load_section("identity.md")
        tools = self.resolve("tools") or _load_tool_prompts()
        if identity:
            parts.append(_section("identity", identity))
        if tools:
            parts.append(_section("tools", tools))

        # 动态边界哨兵
        parts.append(_DYNAMIC_BOUNDARY)

        # 动态层（按 _DYNAMIC_SECTION_ORDER 顺序，每个 section 取最高优先级）
        for sec in _DYNAMIC_SECTION_ORDER:
            content = self.resolve(sec)
            if content:
                parts.append(_section(sec, content))

        # 追加内容（system-reminder 等，无 section 包装）
        parts.extend(self._appended)

        result = "\n\n".join(p for p in parts if p.strip())
        logger.debug(
            "PromptBuilder.build: layers=%s appended=%d chars=%d (~%d tokens)",
            {s: self.effective_layer(s) for s in self._registry},
            len(self._appended),
            len(result),
            len(result) // 4,
            )
        return result
