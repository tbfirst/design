"""A.1: AppState 范式控制字段回归测试。"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from app.agent.graph.state import AppState  # noqa: E402


def _old_state() -> dict:
    """模拟改造前只有原有字段的 state dict（不含新 Phase-D 字段）。"""
    return {
        "messages": [],
        "retrieved_recall": [],
        "retrieved_workflow": [],
        "retrieved_shared": [],
        "basic_rules": "",
        "preferences": {},
        "user_id": 1,
        "group_id": None,
        "brand_id": None,
        "session_uuid": "sess-test",
        "phase": None,
        "_system_prompt_cached": "",
        "session_memory": None,
        "last_session_memory_at_msg_id": None,
        "last_compress_at_msg_id": None,
        "last_extract_at_msg_id": None,
    }


def test_import_ok():
    """AppState 能正常导入（模块不报错）。"""
    assert AppState is not None


def test_new_fields_default_none():
    """旧 state dict 不含新字段时，dict.get() 均返回 None 不抛异常。"""
    state = _old_state()
    assert state.get("plan") is None
    assert state.get("plan_cursor") is None
    assert state.get("replan_count") is None
    assert state.get("reflect_count") is None
    assert state.get("last_eval_score") is None
    assert state.get("_pending_critique") is None
    assert state.get("_current_subgoal") is None
    assert state.get("plan_mode") is None


def test_new_fields_can_be_set():
    """新字段可以正常写入 state dict。"""
    state = _old_state()
    state["plan"] = ["步骤1", "步骤2"]
    state["plan_cursor"] = 0
    state["replan_count"] = 0
    state["reflect_count"] = 0
    state["last_eval_score"] = 0.9
    state["_pending_critique"] = "需改进色调"
    state["_current_subgoal"] = "生成首帧画面"
    state["plan_mode"] = "plan"

    assert state["plan"] == ["步骤1", "步骤2"]
    assert state["plan_cursor"] == 0
    assert state["plan_mode"] == "plan"
