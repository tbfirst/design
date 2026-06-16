"""tools/envelope.py 单元测试：统一返回信封 tool_ok / tool_error。"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from app.agent.graph.tools.envelope import tool_error, tool_ok  # noqa: E402


def test_tool_ok_sets_ok_true_and_spreads_data():
    r = tool_ok({"hits": [1, 2], "query": "q"})
    assert r["ok"] is True
    assert r["hits"] == [1, 2]
    assert r["query"] == "q"


def test_tool_ok_empty():
    assert tool_ok() == {"ok": True}
    assert tool_ok(None) == {"ok": True}


def test_tool_error_shape():
    r = tool_error("web_search", "no_api_key", "missing key")
    assert r == {
        "ok": False,
        "tool": "web_search",
        "error_code": "no_api_key",
        "error": "missing key",
    }


def test_tool_error_carries_optional_data_for_backward_compat():
    r = tool_error("knowledge_search", "search_error", "boom", data={"hits": []})
    assert r["ok"] is False
    assert r["error_code"] == "search_error"
    assert r["hits"] == []  # 业务字段附加保留，向后兼容


def test_envelope_distinguishes_success_from_failure():
    ok = tool_ok({"hits": []})
    err = tool_error("t", "c", "m", data={"hits": []})
    # 同样 hits=[]，但模型可凭 ok 稳定区分成败
    assert ok["ok"] is True and err["ok"] is False
