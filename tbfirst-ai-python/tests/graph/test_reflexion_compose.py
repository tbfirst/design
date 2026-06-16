"""D.5: compose.py Reflexion 召回单列过往教训段测试。"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from app.agent.memory.compose import compose_system_prompt  # noqa: E402
from app.agent.prompts.builder import _DYNAMIC_BOUNDARY  # noqa: E402


def _static_prefix(prompt: str) -> str:
    sentinel = _DYNAMIC_BOUNDARY.strip()
    idx = prompt.find(sentinel)
    return prompt[:idx] if idx != -1 else prompt


def test_reflexion_recall_generates_lesson_section():
    """含 [REFLEXION] 的 recall → 输出含 [过往教训] 段。"""
    recall = [
        {"summary": "[REFLEXION] 任务：生成分镜\n反思：经过2轮，构图偏差", "id": 1},
    ]
    result = compose_system_prompt(retrieved_recall=recall)
    assert "[过往教训]" in result
    assert "[REFLEXION]" in result


def test_normal_recall_not_in_lesson_section():
    """普通 recall 不含 [REFLEXION] → 走 [历史回顾]，不出现 [过往教训]。"""
    recall = [
        {"summary": "用户喜欢冷色调风格", "id": 1},
    ]
    result = compose_system_prompt(retrieved_recall=recall)
    assert "[历史回顾]" in result
    assert "[过往教训]" not in result


def test_mixed_recall_separates_correctly():
    """混合 recall（有含 REFLEXION 的，也有普通的）→ 两段都出现。"""
    recall = [
        {"summary": "[REFLEXION] 任务：导出视频\n反思：色调不符", "id": 1},
        {"summary": "用户偏好写实风格", "id": 2},
    ]
    result = compose_system_prompt(retrieved_recall=recall)
    assert "[过往教训]" in result
    assert "[历史回顾]" in result


def test_no_recall_no_lesson_section():
    """无 recall → 既无 [过往教训] 也无 [历史回顾]，输出与基线一致。"""
    result = compose_system_prompt()
    assert "[过往教训]" not in result
    assert "[历史回顾]" not in result


def test_static_prefix_unchanged_with_reflexion_recall():
    """有 Reflexion recall 时，静态前缀仍不变（不变量 5）。"""
    without = compose_system_prompt()
    with_reflexion = compose_system_prompt(
        retrieved_recall=[{"summary": "[REFLEXION] lesson", "id": 1}]
    )
    assert _static_prefix(without) == _static_prefix(with_reflexion)
