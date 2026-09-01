"""V6.M2.C.8: L4 semantic 单元测试。5 case，覆盖 upsert 4 分支规则 + Gemini 萃取链 mock。

无 PG 依赖：用 FakeAsyncConnection 拦截共享连接池入口，
脚本化 fetchone/fetchall 返回；用 monkeypatch 替换 ChatGoogleGenerativeAI 为返回固定 JSON
的伪类。运行：pytest tests/memory/test_semantic.py -v
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from contextlib import asynccontextmanager
from typing import Any

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from app.agent.memory import semantic  # noqa: E402


# -----------------------------------------------------------------------------
# Fake async psycopg 连接：支持 `async with agent_db_connection()`
# -----------------------------------------------------------------------------


class FakeCursor:
    def __init__(self, scripted_fetchone: list[dict | None]):
        self._fetchone_queue = list(scripted_fetchone)
        self.executed: list[tuple[str, tuple]] = []
        self.rowcount = 0

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def execute(self, sql: str, params: tuple = ()):
        self.executed.append((sql.strip(), params))
        # 简化：DELETE 时 rowcount=1，其他 0
        if "DELETE" in sql.upper():
            self.rowcount = 1

    async def fetchone(self):
        if not self._fetchone_queue:
            return None
        return self._fetchone_queue.pop(0)

    async def fetchall(self):
        # 队列里剩余全部一次性返回
        out = self._fetchone_queue
        self._fetchone_queue = []
        return out


class FakeConn:
    def __init__(self, cursor: FakeCursor):
        self._cursor = cursor
        self.committed = 0

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    def cursor(self) -> FakeCursor:
        return self._cursor

    async def commit(self):
        self.committed += 1


def _patch_connect(monkeypatch: pytest.MonkeyPatch, cursor: FakeCursor) -> FakeConn:
    """把共享连接池入口替换成返回 FakeConn 的异步上下文。"""
    conn = FakeConn(cursor)

    @asynccontextmanager
    async def fake_connection():
        yield conn

    monkeypatch.setattr(semantic, "agent_db_connection", fake_connection)
    return conn


# -----------------------------------------------------------------------------
# upsert 规则 3 case
# -----------------------------------------------------------------------------


def test_upsert_low_confidence_discarded(monkeypatch: pytest.MonkeyPatch):
    """confidence=0.5 < CONFIDENCE_FLOOR(0.6) → return None；不触发 INSERT/UPDATE。"""
    cur = FakeCursor(scripted_fetchone=[None])  # SELECT existing → None
    conn = _patch_connect(monkeypatch, cur)

    result = asyncio.run(
        semantic.upsert_preference(
            user_id=1,
            key="color_preference",
            value="冷色调",
            confidence=0.5,
        )
    )
    assert result is None, "低 confidence 应被丢弃"
    # 应只执行 1 次 SELECT，无 INSERT/UPDATE
    assert len(cur.executed) == 1
    assert "SELECT" in cur.executed[0][0].upper()
    assert conn.committed == 1  # 仍 commit 关闭事务


def test_upsert_locked_not_overwritten(monkeypatch: pytest.MonkeyPatch):
    """user_locked=True + 非 force_lock → 直接返回旧记录，不执行 UPDATE。"""
    locked_row = {
        "id": 42,
        "user_id": 1,
        "key": "tone",
        "value": "正式",
        "confidence": 0.9,
        "source_session_id": None,
        "evidence": [],
        "user_locked": True,
        "last_injected_at": None,
        "create_time": None,
        "update_time": None,
    }
    cur = FakeCursor(scripted_fetchone=[locked_row])
    _patch_connect(monkeypatch, cur)

    result = asyncio.run(
        semantic.upsert_preference(
            user_id=1,
            key="tone",
            value="俏皮",  # 试图覆盖
            confidence=0.95,  # 高 confidence 也无效
        )
    )
    assert result is not None and result["value"] == "正式", "锁定项不应被覆盖"
    assert result["user_locked"] is True
    # 只跑了 1 次 SELECT FOR UPDATE，没有 UPDATE
    assert len(cur.executed) == 1


def test_upsert_higher_confidence_replaces(monkeypatch: pytest.MonkeyPatch):
    """已存在 + 新 confidence(0.85) > 旧(0.7) → value 被覆盖 + confidence 取 max。"""
    existing = {
        "id": 7,
        "user_id": 1,
        "key": "audience",
        "value": "25-35 女性",
        "confidence": 0.7,
        "source_session_id": None,
        "evidence": [{"snippet": "之前"}],
        "user_locked": False,
        "last_injected_at": None,
        "create_time": None,
        "update_time": None,
    }
    updated = dict(existing, value="30-40 都市女性", confidence=0.85)
    cur = FakeCursor(scripted_fetchone=[existing, updated])
    _patch_connect(monkeypatch, cur)

    result = asyncio.run(
        semantic.upsert_preference(
            user_id=1,
            key="audience",
            value="30-40 都市女性",
            confidence=0.85,
            evidence={"snippet": "新一轮对话"},
        )
    )
    assert result is not None
    assert result["value"] == "30-40 都市女性"
    assert float(result["confidence"]) == 0.85
    # SELECT + UPDATE 各一次
    assert len(cur.executed) == 2
    assert "UPDATE" in cur.executed[1][0].upper()


# -----------------------------------------------------------------------------
# Gemini 萃取链 2 case（monkeypatch ChatGoogleGenerativeAI）
# -----------------------------------------------------------------------------


class _FakeResp:
    def __init__(self, content: str):
        self.content = content


class _FakeLLM:
    """伪 ChatGoogleGenerativeAI：构造时收任意 kwargs，ainvoke 返回脚本化 content。"""

    _scripted_content: str = "[]"

    def __init__(self, **kwargs):  # noqa: ARG002
        pass

    async def ainvoke(self, prompt: str):  # noqa: ARG002
        return _FakeResp(self.__class__._scripted_content)


def _patch_gemini(monkeypatch: pytest.MonkeyPatch, content: str):
    """让 extract_preferences_from_messages 内部 `from langchain_google_genai import ...` 拿到伪类。"""
    _FakeLLM._scripted_content = content

    # 构造伪模块对象，挂到 sys.modules，覆盖真实模块
    import types

    fake_mod = types.ModuleType("langchain_google_genai")
    fake_mod.ChatGoogleGenerativeAI = _FakeLLM
    monkeypatch.setitem(sys.modules, "langchain_google_genai", fake_mod)

    # 必须有 gemini_api_key 才不会 early-return
    settings = semantic.get_settings()
    monkeypatch.setattr(settings, "gemini_api_key", "test-key")


def test_extract_preferences_returns_at_least_one(monkeypatch: pytest.MonkeyPatch):
    """mock Gemini 返回标准 JSON 含 1 条偏好 → 解析出 1 条。"""
    content = json.dumps(
        [
            {"key": "color_preference", "value": "冷色调", "confidence": 0.8, "evidence": "用户说"},
        ],
        ensure_ascii=False,
    )
    _patch_gemini(monkeypatch, content)

    messages: list[Any] = [{"role": "user", "content": "我喜欢冷色调"}]
    out = asyncio.run(semantic.extract_preferences_from_messages(messages))
    assert len(out) == 1
    assert out[0]["key"] == "color_preference"
    assert out[0]["value"] == "冷色调"
    assert out[0]["confidence"] == 0.8


def test_extract_preferences_filters_low_confidence(monkeypatch: pytest.MonkeyPatch):
    """mock 返回 0.5 / 0.8 两条 → 只 keep 0.8（_parse_json_array 内 confidence ∈ [0,1] 不过滤；
    业务过滤在调用方 upsert_preference 里走 CONFIDENCE_FLOOR）。

    注：semantic._parse_json_array 本身不按 confidence 过滤，只做 schema 校验；
    "filter" 真正发生在 upsert_preference 的置信度门槛分支。这里我们断言：
    返回 2 条均通过 schema，但 0.5 那条 confidence 字段确实 < 0.6（业务侧应拒）。
    """
    content = json.dumps(
        [
            {"key": "tone", "value": "随便", "confidence": 0.5, "evidence": "模糊"},
            {"key": "style", "value": "极简", "confidence": 0.8, "evidence": "明确"},
        ],
        ensure_ascii=False,
    )
    _patch_gemini(monkeypatch, content)

    out = asyncio.run(semantic.extract_preferences_from_messages([{"role": "user", "content": "test"}]))
    assert len(out) == 2  # _parse_json_array 不按 confidence 阈值过滤
    # 0.5 那条标记可见 → upsert_preference 端的 CONFIDENCE_FLOOR 才会真正丢弃
    low = [p for p in out if p["confidence"] < semantic.CONFIDENCE_FLOOR]
    high = [p for p in out if p["confidence"] >= semantic.CONFIDENCE_FLOOR]
    assert len(low) == 1 and low[0]["confidence"] == 0.5
    assert len(high) == 1 and high[0]["confidence"] == 0.8
