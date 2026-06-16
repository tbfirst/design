"""F.2: memory_inspector tool 单元测试。

验证：全层返回、user_id 注入正确（不为 0）、L3 失败静默。
"""
from __future__ import annotations

import asyncio
import importlib
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

# __init__.py が `memory_inspector` 名を StructuredTool で上書きするため、
# sys.modules から実モジュールオブジェクトを取得する。
importlib.import_module("app.agent.graph.tools.memory_inspector")
mi_ns = sys.modules["app.agent.graph.tools.memory_inspector"]
from app.agent.graph.tools.memory_inspector import memory_inspector  # noqa: E402


def run(coro):
    return asyncio.run(coro)


def _state(user_id: int = 42) -> dict:
    return {"user_id": user_id, "messages": []}


def test_all_layers_returned(monkeypatch: pytest.MonkeyPatch):
    """全 3 層が返ること（空でも構わない）。"""

    async def fake_recalls(user_id):
        return [{"id": 1, "summary": "s1", "quality_score": 0.8, "recall_count": 2, "archived": False}]

    async def fake_prefs(user_id):
        return [{"key": "style", "value": "cold", "confidence": 0.9}]

    async def fake_workflows(user_id, group_ids=None, limit=50):
        return [{"id": 10, "name": "auto:phase1", "quality_score": 0.7}]

    monkeypatch.setattr(mi_ns, "list_session_summaries", fake_recalls)
    monkeypatch.setattr(mi_ns, "list_preferences", fake_prefs)
    monkeypatch.setattr(mi_ns, "list_workflows", fake_workflows)

    result = run(memory_inspector.ainvoke({"state": _state(user_id=5)}))

    assert result["ok"] is True
    assert "L3_recall" in result
    assert "L4_preferences" in result
    assert "L5_workflow" in result
    assert len(result["L3_recall"]) == 1
    assert len(result["L4_preferences"]) == 1
    assert len(result["L5_workflow"]) == 1


def test_user_id_injected_correctly(monkeypatch: pytest.MonkeyPatch):
    """state['user_id'] が各 list 関数に渡されること（0 ではない）。"""
    captured: dict = {}

    async def fake_recalls(user_id):
        captured["recall_uid"] = user_id
        return []

    async def fake_prefs(user_id):
        captured["pref_uid"] = user_id
        return []

    async def fake_workflows(user_id, group_ids=None, limit=50):
        captured["wf_uid"] = user_id
        return []

    monkeypatch.setattr(mi_ns, "list_session_summaries", fake_recalls)
    monkeypatch.setattr(mi_ns, "list_preferences", fake_prefs)
    monkeypatch.setattr(mi_ns, "list_workflows", fake_workflows)

    run(memory_inspector.ainvoke({"state": _state(user_id=99)}))

    assert captured["recall_uid"] == 99, "user_id must not be 0"
    assert captured["pref_uid"] == 99
    assert captured["wf_uid"] == 99


def test_l3_failure_is_silent(monkeypatch: pytest.MonkeyPatch):
    """L3 list 失败时不抛异常，返回空列表。"""

    async def failing_recalls(user_id):
        raise RuntimeError("DB unavailable")

    async def fake_prefs(user_id):
        return []

    async def fake_workflows(user_id, group_ids=None, limit=50):
        return []

    monkeypatch.setattr(mi_ns, "list_session_summaries", failing_recalls)
    monkeypatch.setattr(mi_ns, "list_preferences", fake_prefs)
    monkeypatch.setattr(mi_ns, "list_workflows", fake_workflows)

    result = run(memory_inspector.ainvoke({"state": _state()}))

    assert result["ok"] is True
    assert result["L3_recall"] == []
    assert "L4_preferences" in result
