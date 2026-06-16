"""V6.M2.F.5: cross-user 路由隔离测试（6 case）。

策略：
  - 创建轻量 TestApp（仅挂载 agent router），绕过完整 lifespan / graph 初始化。
  - monkeypatch agent.psycopg + semantic.psycopg 的 AsyncConnection.connect，
    注入进程内 FakeDB（session 表 + preference 表），按 user_id / id 过滤。
  - 404 防侧信道：越权访问（user_B 查 user_A 的资源）与"资源不存在"同样返回 404。

case：
  1. user_B GET /sessions/{user_A_uuid}/messages → 404
  2. user_B POST /chat session=user_A_uuid       → 404
  3. user_B DELETE /sessions/{user_A_uuid}        → 404
  4. user_B GET /profile/memory                   → 200，不含 user_A 偏好（空列表）
  5. user_B PUT /profile/memory/preference/{user_A_pref_id} → 404
  6. user_B DELETE /profile/memory/preference/{user_A_pref_id} → 404
"""
from __future__ import annotations

import asyncio
import os
import sys

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../.."))

from app.routes.agent import router as agent_router  # noqa: E402
from app.agent.memory import semantic as semantic_module  # noqa: E402
from app.routes import agent as agent_module  # noqa: E402

# ---------------------------------------------------------------------------
# 进程内假数据库
# ---------------------------------------------------------------------------

USER_A = 1
USER_B = 2
UUID_A = "aaa00000aaa00000aaa00000aaa00000"  # user_A 的会话
PREF_A_ID = 101  # user_A 的偏好 id


class FakeDB:
    """进程内 session 表 + preference 表（每次测试重置）。"""

    def __init__(self):
        self.sessions: dict[str, dict] = {
            UUID_A: {
                "id": 1,
                "session_uuid": UUID_A,
                "user_id": USER_A,
                "scope": None,
                "title": None,
                "started_at": None,
                "last_active_at": None,
                "deleted": 0,
            }
        }
        self.preferences: dict[int, dict] = {
            PREF_A_ID: {
                "id": PREF_A_ID,
                "user_id": USER_A,
                "key": "color_preference",
                "value": "冷色调",
                "confidence": 0.9,
                "source_session_id": None,
                "evidence": None,
                "user_locked": False,
                "last_injected_at": None,
                "create_time": None,
                "update_time": None,
            }
        }


class FakeCursor:
    def __init__(self, db: FakeDB):
        self._db = db
        self._one: dict | None = None
        self._many: list[dict] = []
        self.rowcount: int = 0

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return False

    async def execute(self, sql: str, params: tuple = ()):
        u = sql.upper()

        # _session_must_belong_to: SELECT ... WHERE session_uuid=%s AND user_id=%s AND deleted=0
        if "AI.SESSION" in u and "SESSION_UUID" in u and "USER_ID" in u and "SELECT" in u:
            uuid, user_id = params[0], params[1]
            row = self._db.sessions.get(uuid)
            if row and row["user_id"] == int(user_id) and row["deleted"] == 0:
                self._one = row

        # list_sessions: SELECT ... FROM ai.session WHERE user_id=%s AND deleted=0
        elif "AI.SESSION" in u and "SELECT" in u and "USER_ID" in u and "SESSION_UUID" not in u:
            user_id = params[0]
            self._many = [
                s for s in self._db.sessions.values()
                if s["user_id"] == int(user_id) and s["deleted"] == 0
            ]

        # list_session_summary: SELECT ... FROM ai.session_summary WHERE user_id=%s
        elif "AI.SESSION_SUMMARY" in u and "SELECT" in u:
            user_id = params[0]
            self._many = []  # no summaries in test DB

        # list_preferences: SELECT ... FROM ai.user_preference WHERE user_id=%s
        elif "AI.USER_PREFERENCE" in u and "SELECT" in u:
            user_id = params[0]
            self._many = [
                p for p in self._db.preferences.values()
                if p["user_id"] == int(user_id)
            ]

        # update preference: UPDATE ... WHERE id=%s AND user_id=%s RETURNING ...
        elif "AI.USER_PREFERENCE" in u and "UPDATE" in u and "RETURNING" in u:
            value, locked, pref_id, user_id = params[0], params[1], params[2], params[3]
            pref = self._db.preferences.get(int(pref_id))
            if pref and pref["user_id"] == int(user_id):
                if value is not None:
                    pref["value"] = value
                if locked is not None:
                    pref["user_locked"] = locked
                self._one = pref
                self.rowcount = 1

        # delete preference: DELETE FROM ai.user_preference WHERE id=%s AND user_id=%s
        elif "AI.USER_PREFERENCE" in u and "DELETE" in u:
            pref_id, user_id = params[0], params[1]
            pref = self._db.preferences.get(int(pref_id))
            if pref and pref["user_id"] == int(user_id):
                del self._db.preferences[int(pref_id)]
                self.rowcount = 1

        # soft delete session: UPDATE ai.session SET deleted=1
        elif "AI.SESSION" in u and "UPDATE" in u:
            pass  # tested via _session_must_belong_to before reaching here

    async def fetchone(self):
        return self._one

    async def fetchall(self):
        return self._many


class FakeConn:
    def __init__(self, db: FakeDB):
        self._db = db
        self._cur: FakeCursor | None = None

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return False

    def cursor(self):
        self._cur = FakeCursor(self._db)
        return self._cur

    async def commit(self):
        pass

    # delete_preference calls cur.rowcount on the cursor after connect, expose via last cursor
    @property
    def last_cursor(self):
        return self._cur


# ---------------------------------------------------------------------------
# pytest fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def fake_db():
    return FakeDB()


@pytest.fixture()
def client(monkeypatch: pytest.MonkeyPatch, fake_db: FakeDB):
    """轻量 TestApp，仅挂载 agent router，monkeypatch 两个模块的 psycopg 连接。"""
    app = FastAPI()
    app.include_router(agent_router)

    # patch agent.py 里的 psycopg 连接
    async def fake_connect_agent(dsn, row_factory=None):  # noqa: ARG001
        return FakeConn(fake_db)

    monkeypatch.setattr(agent_module.psycopg.AsyncConnection, "connect", fake_connect_agent)

    # patch semantic.py 里的 psycopg 连接（list_preferences / delete_preference）
    async def fake_connect_semantic(dsn, row_factory=None):  # noqa: ARG001
        return FakeConn(fake_db)

    monkeypatch.setattr(semantic_module.psycopg.AsyncConnection, "connect", fake_connect_semantic)

    # 不注入 app.state.agent_graph（值 None）→ 在越权 404 命中前不会被访问
    return TestClient(app, raise_server_exceptions=False)


# ---------------------------------------------------------------------------
# 测试 cases
# ---------------------------------------------------------------------------


def test_case1_user_b_cannot_read_user_a_session_messages(client: TestClient):
    """case 1: user_B GET /sessions/{user_A_uuid}/messages → 404（越权）。"""
    resp = client.get(
        f"/agent/sessions/{UUID_A}/messages",
        headers={"X-User-Id": str(USER_B)},
    )
    assert resp.status_code == 404, f"期望 404，实际 {resp.status_code}: {resp.text}"


def test_case2_user_b_cannot_chat_on_user_a_session(client: TestClient):
    """case 2: user_B POST /chat session=user_A_uuid → 404（_session_must_belong_to 在 graph 之前拦截）。"""
    resp = client.post(
        "/agent/chat",
        json={"session_uuid": UUID_A, "message": "hello"},
        headers={"X-User-Id": str(USER_B)},
    )
    assert resp.status_code == 404, f"期望 404，实际 {resp.status_code}: {resp.text}"


def test_case3_user_b_cannot_delete_user_a_session(client: TestClient):
    """case 3: user_B DELETE /sessions/{user_A_uuid} → 404（越权）。"""
    resp = client.delete(
        f"/agent/sessions/{UUID_A}",
        headers={"X-User-Id": str(USER_B)},
    )
    assert resp.status_code == 404, f"期望 404，实际 {resp.status_code}: {resp.text}"


def test_case4_user_b_profile_memory_excludes_user_a_prefs(client: TestClient):
    """case 4: user_B GET /profile/memory → 200，preferences 列表不含 user_A 的偏好。"""
    resp = client.get(
        "/agent/profile/memory",
        headers={"X-User-Id": str(USER_B)},
    )
    assert resp.status_code == 200, f"期望 200，实际 {resp.status_code}: {resp.text}"
    data = resp.json()
    prefs = data.get("preferences", [])
    user_ids_in_response = {p.get("user_id") for p in prefs}
    assert USER_A not in user_ids_in_response, f"user_B 响应不应含 user_A 偏好，实际: {prefs}"


def test_case5_user_b_cannot_update_user_a_preference(client: TestClient):
    """case 5: user_B PUT /profile/memory/preference/{user_A_pref_id} → 404（id + user_id 不匹配）。"""
    resp = client.put(
        f"/agent/profile/memory/preference/{PREF_A_ID}",
        json={"value": "攻击注入"},
        headers={"X-User-Id": str(USER_B)},
    )
    assert resp.status_code == 404, f"期望 404，实际 {resp.status_code}: {resp.text}"


def test_case6_user_b_cannot_delete_user_a_preference(client: TestClient):
    """case 6: user_B DELETE /profile/memory/preference/{user_A_pref_id} → 404（rowcount=0）。"""
    resp = client.delete(
        f"/agent/profile/memory/preference/{PREF_A_ID}",
        headers={"X-User-Id": str(USER_B)},
    )
    assert resp.status_code == 404, f"期望 404，实际 {resp.status_code}: {resp.text}"
