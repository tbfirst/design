"""统一 system prompt 拼接器。

只负责数据摄取：从 state 取各层内容，填入 PromptBuilder 注册表。
静态层组装、边界哨兵、文件加载等逻辑均在 builder.py。
"""
from __future__ import annotations

import logging
from typing import Any, Iterable, Mapping

logger = logging.getLogger(__name__)

def _pref_value(v: Any) -> tuple[str, bool]:
    # Mapping是一个抽象基类，表示类似字典的映射类型
    if isinstance(v, Mapping):
        # 可能是一个简单的值，也可能是一个包含更多信息的字典（如值和锁定状态）
        return str(v.get("value", "")), bool(v.get("user_locked"))
    return str(v), False


def compose_system_prompt(
        *,
        basic_rules: str | None = None,
        preferences: Mapping[str, Any] | None = None,
        retrieved_recall: Iterable[Mapping[str, Any]] | None = None,
        retrieved_workflow: Iterable[Mapping[str, Any]] | None = None,
        retrieved_shared: Iterable[Mapping[str, Any]] | None = None,
        session_memory: str | None = None,
        builder: Any | None = None,
        subgoal: str | None = None,
) -> str:
    from app.agent.prompts.builder import PromptBuilder

    b: PromptBuilder = builder if builder is not None else PromptBuilder()

    # 1、基础规则层：来自 DB 的全局/品牌/群组规则
    if basic_rules:
        b.set_default("basic_rules", basic_rules)

    # 2、Session Memory：compact 后仍存续的工作状态追踪器
    if session_memory:
        b.set_default("session_memory", session_memory)

    # 3、用户偏好层（L4）：用户主动设定的稳定信号，优先级高于 KNN 召回
    if preferences:
        lines = ["[用户偏好]"]
        for k, v in preferences.items():
            value, locked = _pref_value(v)
            suffix = " (锁定)" if locked else ""
            lines.append(f"- {k}: {value}{suffix}")
        if len(lines) > 1:
            b.set_default("preferences", "\n".join(lines))

    # 4、历史回顾层（L3）：KNN 召回的跨会话摘要
    # Phase D M4：以 [REFLEXION] 开头的项单列为「过往教训」段，其余保留在 recall 段
    recall_list = list(retrieved_recall or [])
    reflexion_items = []
    normal_recall_items = []
    for r in recall_list:
        summary = str(r.get("summary", "")).strip()
        if summary.startswith("[REFLEXION]"):
            reflexion_items.append(summary)
        elif summary:
            normal_recall_items.append(summary)

    if reflexion_items:
        lesson_lines = ["[过往教训]"]
        for lesson in reflexion_items[:3]:
            lesson_lines.append(f"- {lesson}")
        b.set_default("reflexion_lessons", "\n".join(lesson_lines))

    if normal_recall_items:
        lines = ["[历史回顾]"]
        for summary in normal_recall_items[:3]:
            lines.append(f"- {summary}")
        if len(lines) > 1:
            b.set_default("recall", "\n".join(lines))

    # 5、相似流程模板层（L5）
    wf_list = list(retrieved_workflow or [])
    if wf_list:
        lines = ["[相似流程模板]"]
        for w in wf_list[:2]:
            name = str(w.get("name") or "(unnamed)")
            sample = str(w.get("sample_prompt") or "")[:120]
            lines.append(f"- {name}: {sample}")
        if len(lines) > 1:
            b.set_default("workflow", "\n".join(lines))

    # 6、灵感来源层（L6）
    shared_list = list(retrieved_shared or [])
    if shared_list:
        lines = ["[灵感来源]"]
        for s in shared_list[:3]:
            title = str(s.get("title") or "")
            chunk = str(s.get("chunk_text") or "")[:120]
            lines.append(f"- {title}: {chunk}")
        if len(lines) > 1:
            b.set_default("shared", "\n".join(lines))

    # 7、当前步骤子目标（Phase D Plan-Solve 注入，仅动态层）
    if subgoal:
        b.set_default("subgoal", f"[当前步骤目标]\n{subgoal}")

    return b.build()
