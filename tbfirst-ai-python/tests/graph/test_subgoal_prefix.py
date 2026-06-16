"""C.1 / C.2 / C.3: subgoal 注入及静态前缀不变量测试。

测试三件事：
  1. compose_system_prompt 传 subgoal → 输出含 [当前步骤目标]（C.1）
  2. 不传 subgoal → 输出与 _DYNAMIC_BOUNDARY 前静态前缀字节完全一致（C.2 不变量 5）
  3. state 含 _current_subgoal → compose_prompt_node 透传 subgoal（C.3）
"""
from __future__ import annotations

import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from app.agent.memory.compose import compose_system_prompt  # noqa: E402
from app.agent.prompts.builder import _DYNAMIC_BOUNDARY  # noqa: E402


def run(coro):
    return asyncio.run(coro)


def _static_prefix(prompt: str) -> str:
    """提取 _DYNAMIC_BOUNDARY 之前的静态前缀。"""
    sentinel = _DYNAMIC_BOUNDARY.strip()
    idx = prompt.find(sentinel)
    if idx == -1:
        return prompt
    return prompt[:idx]


# ---------------------------------------------------------------------------
# C.1: compose_system_prompt subgoal 参数
# ---------------------------------------------------------------------------


def test_compose_with_subgoal_contains_marker():
    """传入 subgoal 时，输出含 [当前步骤目标] 标记。"""
    result = compose_system_prompt(subgoal="生成主角特写镜头")
    assert "[当前步骤目标]" in result
    assert "生成主角特写镜头" in result


def test_compose_without_subgoal_no_marker():
    """不传 subgoal 时，输出不含 [当前步骤目标] 标记。"""
    result = compose_system_prompt()
    assert "[当前步骤目标]" not in result


def test_subgoal_appears_after_dynamic_boundary():
    """subgoal 段必须出现在 _DYNAMIC_BOUNDARY 之后（在动态层）。"""
    result = compose_system_prompt(subgoal="步骤1：生成分镜")
    sentinel = _DYNAMIC_BOUNDARY.strip()
    boundary_pos = result.find(sentinel)
    subgoal_pos = result.find("[当前步骤目标]")
    assert boundary_pos != -1, "_DYNAMIC_BOUNDARY 未找到"
    assert subgoal_pos != -1, "[当前步骤目标] 未找到"
    assert subgoal_pos > boundary_pos, "subgoal 应在 _DYNAMIC_BOUNDARY 之后"


# ---------------------------------------------------------------------------
# C.2: _DYNAMIC_BOUNDARY 前静态前缀不变量（不变量 5）
# ---------------------------------------------------------------------------


def test_static_prefix_unchanged_with_subgoal():
    """有/无 subgoal 时，_DYNAMIC_BOUNDARY 前的静态前缀字节完全一致。"""
    without = compose_system_prompt()
    with_sg = compose_system_prompt(subgoal="步骤：生成主色调")
    prefix_without = _static_prefix(without)
    prefix_with = _static_prefix(with_sg)
    assert prefix_without == prefix_with, (
        f"静态前缀字节不一致！\n"
        f"无 subgoal 前缀长度: {len(prefix_without)}\n"
        f"有 subgoal 前缀长度: {len(prefix_with)}"
    )


def test_static_prefix_unchanged_with_different_subgoal():
    """不同 subgoal 值时，静态前缀字节不变。"""
    sg1 = compose_system_prompt(subgoal="步骤1")
    sg2 = compose_system_prompt(subgoal="步骤2：完全不同的内容")
    assert _static_prefix(sg1) == _static_prefix(sg2)


# ---------------------------------------------------------------------------
# C.3: compose_prompt_node 透传 _current_subgoal
# ---------------------------------------------------------------------------


def test_compose_prompt_node_passes_subgoal(monkeypatch):
    """state 含 _current_subgoal → compose_prompt_node 将其透传给 compose_system_prompt。"""
    from app.agent.graph.nodes import compose_prompt_node
    import app.agent.memory.compose as compose_mod

    captured = {}

    def fake_compose(**kwargs):
        captured.update(kwargs)
        return "prompt result"

    # nodes.py 内部懒导入 compose_system_prompt，需 patch 原始模块属性
    monkeypatch.setattr(compose_mod, "compose_system_prompt", fake_compose)

    state = {
        "messages": [],
        "user_id": 1,
        "session_uuid": "u" * 32,
        "_current_subgoal": "当前步骤：生成首帧",
        "basic_rules": None,
        "preferences": {},
        "retrieved_recall": [],
        "retrieved_workflow": [],
        "retrieved_shared": [],
        "session_memory": None,
    }
    run(compose_prompt_node(state))
    assert captured.get("subgoal") == "当前步骤：生成首帧"


def test_compose_prompt_node_no_subgoal(monkeypatch):
    """state 不含 _current_subgoal → compose_system_prompt 的 subgoal 参数为 None。"""
    from app.agent.graph.nodes import compose_prompt_node
    import app.agent.memory.compose as compose_mod

    captured = {}

    def fake_compose(**kwargs):
        captured.update(kwargs)
        return "prompt result"

    monkeypatch.setattr(compose_mod, "compose_system_prompt", fake_compose)

    state = {
        "messages": [],
        "user_id": 1,
        "session_uuid": "u" * 32,
        "basic_rules": None,
        "preferences": {},
        "retrieved_recall": [],
        "retrieved_workflow": [],
        "retrieved_shared": [],
        "session_memory": None,
    }
    run(compose_prompt_node(state))
    assert captured.get("subgoal") is None
