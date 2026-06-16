"""tools/registry.py 单元测试：ToolSpec 注册表 + fail-closed 默认。"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from app.agent.graph.tools.registry import TOOL_SPECS, ToolSpec, spec_of  # noqa: E402


def test_unregistered_tool_is_fail_closed():
    s = spec_of("brand_new_tool_not_registered")
    assert s.name == "brand_new_tool_not_registered"
    assert s.is_read_only is False        # 默认非只读
    assert s.is_concurrency_safe is False  # 默认不可并发
    assert s.max_result_chars == 50_000    # 默认 CC DEFAULT_MAX_RESULT_SIZE_CHARS
    assert s.prompt_file is None


def test_all_five_tools_registered():
    assert set(TOOL_SPECS) == {
        "web_search",
        "knowledge_search",
        "memory_inspector",
        "image_gen",
        "read_cached_tool_result",
    }


def test_read_only_tools_are_concurrency_safe():
    for name in ("web_search", "knowledge_search", "memory_inspector", "read_cached_tool_result"):
        s = spec_of(name)
        assert s.is_read_only is True
        assert s.is_concurrency_safe is True


def test_image_gen_is_side_effecting_and_serial():
    s = spec_of("image_gen")
    assert s.is_read_only is False
    assert s.is_concurrency_safe is False  # 出图有副作用 → 写独占串行


def test_spec_is_frozen():
    s = spec_of("web_search")
    assert isinstance(s, ToolSpec)
    try:
        s.is_read_only = False  # type: ignore[misc]
        raised = False
    except Exception:
        raised = True
    assert raised, "ToolSpec 应为 frozen，不可变更安全语义"
