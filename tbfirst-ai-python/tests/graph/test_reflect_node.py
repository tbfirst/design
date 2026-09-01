"""B.5 / B.6: reflect_gate_node / inject_critique_node 测试。"""
from __future__ import annotations

import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

import pytest  # noqa: E402
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage  # noqa: E402

from app.agent.graph.compression.circuit_breaker import get_breakers  # noqa: E402
from app.agent.graph.nodes import inject_critique_node, reflect_gate_node  # noqa: E402


def run(coro):
    return asyncio.run(coro)


def _base_state(**overrides) -> dict:
    return {
        "messages": [],
        "user_id": 1,
        "session_uuid": "u" * 32,
        "basic_rules": "",
        "preferences": {},
        "retrieved_recall": [],
        "retrieved_workflow": [],
        "retrieved_shared": [],
        "phase": None,
        **overrides,
    }


def _image_state() -> dict:
    return _base_state(
        messages=[
            HumanMessage(content="生成一张图"),
            AIMessage(content="", tool_calls=[{"id": "tc1", "name": "image_gen", "args": {}}]),
            ToolMessage(content="data:image/png;base64,abc", tool_call_id="tc1"),
        ]
    )


def _patch_reflect_flag(monkeypatch, enabled: bool):
    from app.config import Settings
    fake = Settings.model_construct(
        agent_reflect_enabled=enabled,
        agent_plan_enabled=False,
        agent_reflexion_enabled=False,
        agent_vector_memory_enabled=False,
        gemini_api_key="fake",
    )
    # patch nodes.get_settings（reflect flag 在此检查）
    monkeypatch.setattr("app.agent.graph.nodes.get_settings", lambda: fake)
    # patch app.config.get_settings（evaluators 通过懒导入调用此函数）
    monkeypatch.setattr("app.config.get_settings", lambda: fake)
    try:
        from app.config import get_settings as _gs
        _gs.cache_clear()
    except AttributeError:
        pass


def _patch_evaluator(monkeypatch, return_value=(0.5, "色调不符")):
    """Patch evaluate_image/evaluate_text_rubric in nodes module to return fixed value."""
    async def fake_eval_image(*args, **kwargs):
        return return_value

    async def fake_eval_text(*args, **kwargs):
        return return_value

    monkeypatch.setattr("app.agent.graph.evaluators.evaluate_image", fake_eval_image)
    monkeypatch.setattr("app.agent.graph.evaluators.evaluate_text_rubric", fake_eval_text)


# ---------------------------------------------------------------------------
# B.5: reflect_gate_node
# ---------------------------------------------------------------------------


def test_reflect_gate_flag_off_returns_high_score(monkeypatch):
    """reflect flag 关 → 返回高分，不修改 messages。"""
    _patch_reflect_flag(monkeypatch, False)
    state = _image_state()
    original_len = len(state["messages"])
    result = run(reflect_gate_node(state))
    assert result.get("last_eval_score") == 1.0
    # messages 不在返回 dict 里（或为空）
    assert "messages" not in result or not result.get("messages")
    assert len(state["messages"]) == original_len  # 原 state 未变


def test_reflect_gate_no_artifact_returns_high_score(monkeypatch):
    """无产物（纯对话）→ 返回高分。"""
    _patch_reflect_flag(monkeypatch, True)
    state = _base_state(messages=[
        HumanMessage(content="你好"),
        AIMessage(content="你好！"),
    ])
    result = run(reflect_gate_node(state))
    assert result.get("last_eval_score") == 1.0


def test_reflect_gate_evaluator_exception_accept(monkeypatch):
    """评估器抛异常 → evaluator.fail() 被调用，返回 accept 高分，不上抛。"""
    _patch_reflect_flag(monkeypatch, True)

    async def raise_eval(*args, **kwargs):
        raise RuntimeError("评估服务不可用")

    monkeypatch.setattr("app.agent.graph.evaluators.evaluate_image", raise_eval)

    session = "u" * 32
    bs = get_breakers(session)
    bs.evaluator.reset()

    state = _image_state()
    result = run(reflect_gate_node(state))
    assert result.get("last_eval_score") == 1.0
    assert bs.evaluator.state.value == "open"


def test_reflect_gate_breaker_open_skips_eval(monkeypatch):
    """evaluator 熔断器 OPEN → 跳过评估，直接 accept。"""
    _patch_reflect_flag(monkeypatch, True)
    _patch_evaluator(monkeypatch, (0.3, "应熔断跳过"))

    session = "breaker-open-test-" + "x" * 14
    bs = get_breakers(session)
    bs.evaluator.reset()
    bs.evaluator.fail()

    state = _image_state()
    state["session_uuid"] = session
    result = run(reflect_gate_node(state))
    # 熔断后直接 accept，分数应为 1.0（不是 0.3）
    assert result.get("last_eval_score") == 1.0


def test_reflect_gate_low_score_returned(monkeypatch):
    """评估返回低分时，结果被写入 last_eval_score/_pending_critique。"""
    _patch_reflect_flag(monkeypatch, True)
    _patch_evaluator(monkeypatch, (0.4, "构图偏差"))

    session = "low-score-test-" + "x" * 17
    bs = get_breakers(session)
    bs.evaluator.reset()

    state = _image_state()
    state["session_uuid"] = session
    result = run(reflect_gate_node(state))
    assert result.get("last_eval_score") == pytest.approx(0.4)
    assert result.get("_pending_critique") == "构图偏差"
    # messages 不被修改
    assert "messages" not in result or not result.get("messages")


# ---------------------------------------------------------------------------
# B.6: inject_critique_node
# ---------------------------------------------------------------------------


def test_inject_critique_inserts_human_message():
    """inject_critique_node → messages 含以 [自检反馈] 开头的 HumanMessage。"""
    state = _base_state(last_eval_score=0.55, _pending_critique="色调偏暗", reflect_count=0)
    result = run(inject_critique_node(state))
    new_msgs = result.get("messages") or []
    assert len(new_msgs) == 1
    msg = new_msgs[0]
    assert type(msg).__name__ == "HumanMessage"
    assert msg.content.startswith("[自检反馈]")


def test_inject_critique_increments_reflect_count():
    """inject_critique_node → reflect_count 由 0 变 1。"""
    state = _base_state(last_eval_score=0.6, _pending_critique="待改进", reflect_count=0)
    result = run(inject_critique_node(state))
    assert result.get("reflect_count") == 1


def test_inject_critique_increments_from_nonzero():
    """inject_critique_node → reflect_count 从非零值递增。"""
    state = _base_state(last_eval_score=0.4, _pending_critique="问题2", reflect_count=1)
    result = run(inject_critique_node(state))
    assert result.get("reflect_count") == 2


def test_reflect_gate_exits_early_at_max_reflect(monkeypatch):
    """R2 fix：reflect_count >= MAX_REFLECT → 立即返回 {}，不触发 LLM 评估。

    返回 {} 而非 {last_eval_score:1.0}，保留上一轮真实分数供 route_after_save 判断。
    """
    _patch_reflect_flag(monkeypatch, True)

    import app.agent.graph.evaluators as eval_mod

    evaluator_called = []

    async def fake_latest_artifact(state):
        evaluator_called.append(True)
        return ("data:image/png;base64,abc", "image")

    monkeypatch.setattr(eval_mod, "latest_artifact", fake_latest_artifact)

    # reflect_count=2 == MAX_REFLECT=2 → 早退
    state = _base_state(reflect_count=2, last_eval_score=0.3)
    result = run(reflect_gate_node(state))
    # 返回空 dict，不覆盖 last_eval_score
    assert result == {}
    # latest_artifact（及后续 LLM 评估）不应被调用
    assert len(evaluator_called) == 0
