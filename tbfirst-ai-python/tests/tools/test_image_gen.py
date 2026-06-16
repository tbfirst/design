"""F.3: image_gen tool 单元测试。

验证：成功提交（httpx mock）、HTTP 失败（返 error 不抛）、user_id 注入断言。
"""
from __future__ import annotations

import asyncio
import importlib
import os
import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

importlib.import_module("app.agent.graph.tools.image_gen")
ig_ns = sys.modules["app.agent.graph.tools.image_gen"]
from app.agent.graph.tools.image_gen import image_gen  # noqa: E402


def run(coro):
    return asyncio.run(coro)


def _state(user_id: int = 7) -> dict:
    return {"user_id": user_id, "messages": []}


def test_successful_submission(monkeypatch: pytest.MonkeyPatch):
    """httpx mock が job_id を返す場合、status=submitted で返ること。"""
    monkeypatch.setattr(ig_ns, "_IMAGE_SERVICE_URL", "http://fake-image:8080")

    fake_resp = MagicMock()
    fake_resp.json.return_value = {"job_id": "job-abc-123"}
    fake_resp.raise_for_status = MagicMock()

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.post = AsyncMock(return_value=fake_resp)

    with patch("app.agent.graph.tools.image_gen.httpx.AsyncClient", return_value=mock_client):
        result = run(image_gen.ainvoke({"prompt": "a cat on a sofa", "state": _state(user_id=5)}))

    assert result["ok"] is True
    assert result["status"] == "submitted"
    assert result["job_id"] == "job-abc-123"
    assert result["prompt"] == "a cat on a sofa"


def test_http_failure_returns_error(monkeypatch: pytest.MonkeyPatch):
    """httpx が例外を投げても error を返すこと（例外なし）。"""
    monkeypatch.setattr(ig_ns, "_IMAGE_SERVICE_URL", "http://fake-image:8080")

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.post = AsyncMock(side_effect=Exception("connection refused"))

    with patch("app.agent.graph.tools.image_gen.httpx.AsyncClient", return_value=mock_client):
        result = run(image_gen.ainvoke({"prompt": "test prompt", "state": _state()}))

    assert result["ok"] is False
    assert "error" in result
    assert "connection refused" in result["error"]


def test_user_id_injected(monkeypatch: pytest.MonkeyPatch):
    """state['user_id'] が POST ボディに含まれること。"""
    monkeypatch.setattr(ig_ns, "_IMAGE_SERVICE_URL", "http://fake-image:8080")
    captured: dict = {}

    fake_resp = MagicMock()
    fake_resp.json.return_value = {"job_id": "j1"}
    fake_resp.raise_for_status = MagicMock()

    async def fake_post(url, json=None, **kwargs):
        captured["body"] = json
        return fake_resp

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.post = fake_post

    with patch("app.agent.graph.tools.image_gen.httpx.AsyncClient", return_value=mock_client):
        run(image_gen.ainvoke({"prompt": "test", "state": _state(user_id=99)}))

    assert captured["body"]["user_id"] == 99
    assert captured["body"]["user_id"] != 0


def test_no_image_service_url_returns_stub(monkeypatch: pytest.MonkeyPatch):
    """IMAGE_SERVICE_URL 未設定の場合、stub 応答を返すこと。"""
    monkeypatch.setattr(ig_ns, "_IMAGE_SERVICE_URL", "")

    result = run(image_gen.ainvoke({"prompt": "test", "state": _state()}))

    assert result["ok"] is False
    assert result["status"] == "stub"
    assert "error" in result
