"""V6.M2.D.4: 测试 app/memory/compose.py 统一 system prompt 拼接器。

4 case：
  1. test_compose_all_empty — 全空入参 → 静态基础层（身份 + 工具描述）作为完整输出
  2. test_compose_system_prompt_structure — 静态层 < 动态边界 < L1 < L4 < L3 < L5 < L6
  3. test_compose_all_filled — 5 层全填 → 段落顺序 + 截断生效
  4. test_compose_partial — 仅 L1+L4 → L3/L5/L6 段缺席
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from app.agent.memory.compose import compose_system_prompt  # noqa: E402


def test_compose_all_empty():
    """全部入参缺省 → 静态基础层（身份 + 工具描述）作为完整输出。"""
    out = compose_system_prompt()
    assert "tbfirst 创意助手" in out          # identity.md 加载成功
    assert "knowledge_search" in out         # tools/*.md 加载成功
    assert "<!-- dynamic boundary" in out    # 动态边界哨兵存在

    out2 = compose_system_prompt(
        basic_rules="",
        preferences={},
        retrieved_recall=[],
        retrieved_workflow=[],
        retrieved_shared=[],
    )
    assert out == out2


def test_compose_system_prompt_structure():
    """验证 section 顺序：静态层 < 动态边界 < L1 < L4 < L3 < L5 < L6。"""
    out = compose_system_prompt(
        basic_rules="品牌：极简主义",
        preferences={"style": "极简"},
        retrieved_recall=[{"summary": "历史摘要A"}],
        retrieved_workflow=[{"name": "模板X", "sample_prompt": "示例"}],
        retrieved_shared=[{"title": "文档Y", "chunk_text": "内容"}],
    )
    static_pos = out.index("tbfirst 创意助手")
    boundary_pos = out.index("<!-- dynamic boundary")
    l1_pos = out.index("品牌：极简主义")
    l4_pos = out.index("<!-- section:preferences -->")
    l3_pos = out.index("[历史回顾]")
    l5_pos = out.index("[相似流程模板]")
    l6_pos = out.index("[灵感来源]")

    assert static_pos < boundary_pos, "静态层必须在动态边界前"
    assert boundary_pos < l1_pos, "L1 必须在动态边界后"
    assert l1_pos < l4_pos, "L4 必须在 L1 后"
    assert l4_pos < l3_pos, "L3 必须在 L4 后（偏好优先级高于召回）"
    assert l3_pos < l5_pos
    assert l5_pos < l6_pos

    # 工具描述存在
    assert "何时用" in out
    assert "<!-- section:identity" in out    # section 包装存在


def test_compose_all_filled():
    """5 层全填 → 严格顺序 L1 → L4 → L3 → L5 → L6 + 截断生效。"""
    basic_rules = "# 基础规则\n### [global/safety]\n禁止真人脸"
    preferences = {
        "color_preference": {"value": "冷色调", "user_locked": True, "confidence": 0.9},
        "audience": {"value": "25-35 女性", "user_locked": False, "confidence": 0.8},
    }
    # L3 5 条，应只取前 3
    recall = [
        {"summary": f"摘要 {i}", "score": 0.9 - i * 0.01} for i in range(5)
    ]
    # L5 3 条，应只取前 2
    workflow = [
        {"name": f"模板{i}", "sample_prompt": "p" * 200} for i in range(3)
    ]
    # L6 4 条，应只取前 3
    shared = [
        {"title": f"文档{i}", "chunk_text": "c" * 200} for i in range(4)
    ]

    out = compose_system_prompt(
        basic_rules=basic_rules,
        preferences=preferences,
        retrieved_recall=recall,
        retrieved_workflow=workflow,
        retrieved_shared=shared,
    )

    # 顺序断言：L1 → L4 → L3 → L5 → L6
    idx_l1 = out.find("基础规则")
    idx_l4 = out.find("<!-- section:preferences -->")
    idx_l3 = out.find("[历史回顾]")
    idx_l5 = out.find("[相似流程模板]")
    idx_l6 = out.find("[灵感来源]")
    assert idx_l1 >= 0 and idx_l4 > idx_l1
    assert idx_l4 < idx_l3, "L4 偏好必须在 L3 历史回顾之前"
    assert idx_l3 < idx_l5
    assert idx_l5 < idx_l6

    # L4 锁定标记
    assert "color_preference: 冷色调 (锁定)" in out
    assert "audience: 25-35 女性\n" in out + "\n"  # 非锁定无 (锁定) 后缀

    # L3 截断到 3 条
    assert "摘要 0" in out and "摘要 1" in out and "摘要 2" in out
    assert "摘要 3" not in out and "摘要 4" not in out

    # L5 截断到 2 条 + sample_prompt 截 120 字
    assert "模板0" in out and "模板1" in out
    assert "模板2" not in out
    # 200 字 sample_prompt 应被截到 120 字
    assert "p" * 121 not in out  # 不应出现连续 121 个 p

    # L6 截断到 3 条 + chunk_text 截 120 字
    assert "文档0" in out and "文档1" in out and "文档2" in out
    assert "文档3" not in out


def test_compose_partial():
    """仅 L1 + L4 → L3 / L5 / L6 段不出现。"""
    out = compose_system_prompt(
        basic_rules="# 基础规则 A",
        preferences={"tone": "正式"},  # 裸字符串 value（非富 dict）
        retrieved_recall=[],
        retrieved_workflow=None,
        retrieved_shared=None,
    )

    assert "基础规则 A" in out
    assert "[用户偏好]" in out
    assert "tone: 正式" in out  # 裸字符串无锁定后缀
    assert "[历史回顾]" not in out
    assert "[相似流程模板]" not in out
    assert "[灵感来源]" not in out
