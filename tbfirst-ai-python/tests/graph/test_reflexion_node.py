"""D.1: reflexion_write_node 测试。"""
from __future__ import annotations

import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from langchain_core.messages import HumanMessage  # noqa: E402

from app.agent.graph.nodes import reflexion_write_node  # noqa: E402


def run(coro):
    return asyncio.run(coro)


def _base_state(**kw) -> dict:
    return {
        "messages": [HumanMessage(content="生成一套分镜")],
        "user_id": 1,
        "session_uuid": "u" * 32,
        "reflect_count": 0,
        "last_eval_score": 1.0,
        "_pending_critique": "",
        **kw,
    }


def _patch_reflexion_flag(monkeypatch, enabled: bool):
    from app.config import Settings
    fake = Settings.model_construct(
        agent_reflexion_enabled=enabled,
        agent_reflect_enabled=False,
        agent_plan_enabled=False,
        agent_vector_memory_enabled=False,
        gemini_api_key="fake",
    )
    monkeypatch.setattr("app.agent.graph.nodes.get_settings", lambda: fake)
    monkeypatch.setattr("app.config.get_settings", lambda: fake)
    try:
        from app.config import get_settings as _gs
        _gs.cache_clear()
    except AttributeError:
        pass


def _patch_lookup(monkeypatch, session_id: int = 42):
    """monkeypatch _lookup_session_id，绕过真实 DB 连接。"""
    import app.agent.graph.compression as compress_mod

    async def fake_lookup(session_uuid, user_id):
        return session_id

    monkeypatch.setattr(compress_mod, "_lookup_session_id", fake_lookup)


def _patch_insert(monkeypatch):
    """monkeypatch insert_session_summary，捕获调用参数。"""
    import app.agent.memory.recall as recall_mod

    calls = []

    async def fake_insert(session_id, user_id, summary, raw_msg_range, quality_score=0.7):
        calls.append({
            "session_id": session_id,
            "user_id": user_id,
            "summary": summary,
            "raw_msg_range": raw_msg_range,
            "quality_score": quality_score,
        })
        return 1

    monkeypatch.setattr(recall_mod, "insert_session_summary", fake_insert)
    return calls


# ---------------------------------------------------------------------------
# D.1 tests
# ---------------------------------------------------------------------------


def test_reflexion_flag_off_noop(monkeypatch):
    """reflexion flag 关 → no-op，不调用 insert_session_summary。"""
    _patch_reflexion_flag(monkeypatch, False)
    calls = _patch_insert(monkeypatch)
    result = run(reflexion_write_node(_base_state(reflect_count=2, last_eval_score=0.3)))
    assert result == {}
    assert len(calls) == 0


def test_reflexion_noop_when_score_ok(monkeypatch):
    """score >= threshold → no-op（未触发失败条件）。"""
    _patch_reflexion_flag(monkeypatch, True)
    calls = _patch_insert(monkeypatch)
    result = run(reflexion_write_node(_base_state(reflect_count=2, last_eval_score=0.9)))
    assert result == {}
    assert len(calls) == 0


def test_reflexion_noop_when_count_below_max(monkeypatch):
    """reflect_count < MAX_REFLECT → no-op（未封顶）。"""
    _patch_reflexion_flag(monkeypatch, True)
    calls = _patch_insert(monkeypatch)
    result = run(reflexion_write_node(_base_state(reflect_count=1, last_eval_score=0.3)))
    assert result == {}
    assert len(calls) == 0


def test_reflexion_skips_when_session_not_found(monkeypatch):
    """_lookup_session_id 返回 None（session 未找到）→ 跳过写入，return {}。"""
    _patch_reflexion_flag(monkeypatch, True)
    _patch_lookup(monkeypatch, session_id=None)
    calls = _patch_insert(monkeypatch)
    result = run(reflexion_write_node(_base_state(
        reflect_count=2,
        last_eval_score=0.3,
        _pending_critique="色调不符",
    )))
    assert result == {}
    assert len(calls) == 0


def test_reflexion_writes_lesson_on_failure(monkeypatch):
    """终态失败（count>=MAX_REFLECT 且 score<threshold）→ 写入 [REFLEXION] 教训。"""
    _patch_reflexion_flag(monkeypatch, True)
    _patch_lookup(monkeypatch, session_id=42)
    calls = _patch_insert(monkeypatch)
    run(reflexion_write_node(_base_state(
        reflect_count=2,          # >= MAX_REFLECT=2
        last_eval_score=0.3,      # < _REFLECT_THRESHOLD=0.8
        _pending_critique="色调不符",
    )))
    assert len(calls) == 1
    assert calls[0]["session_id"] == 42
    assert calls[0]["summary"].startswith("[REFLEXION]")
    assert calls[0]["quality_score"] == 0.6


def test_reflexion_insert_exception_noop(monkeypatch):
    """insert_session_summary 抛异常 → 容错跳过，不上抛。"""
    _patch_reflexion_flag(monkeypatch, True)
    _patch_lookup(monkeypatch, session_id=42)
    import app.agent.memory.recall as recall_mod

    async def raise_insert(*args, **kwargs):
        raise RuntimeError("DB 不可达")

    monkeypatch.setattr(recall_mod, "insert_session_summary", raise_insert)
    result = run(reflexion_write_node(_base_state(reflect_count=2, last_eval_score=0.3)))
    assert result == {}  # 不上抛
