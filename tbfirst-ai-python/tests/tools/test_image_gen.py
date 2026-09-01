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
    return {
        "user_id": user_id,
        "group_id": 3,
        "session_uuid": "session-123",
        "request_id": "request-123",
        "messages": [],
    }


def test_successful_submission():
    """Gateway が job id を返す場合、status=submitted で返ること。"""
    mock_client = MagicMock()
    mock_client.generate_image = AsyncMock(return_value={"jobId": "job-abc-123", "status": "pending"})

    with patch("app.agent.graph.tools.image_gen.GatewayClient", return_value=mock_client):
        result = run(image_gen.ainvoke({"prompt": "a cat on a sofa", "state": _state(user_id=5)}))

    assert result["ok"] is True
    assert result["status"] == "pending"
    assert result["job_id"] == "job-abc-123"
    assert result["prompt"] == "a cat on a sofa"


def test_http_failure_returns_error():
    """Gateway が例外を投げても error を返すこと（例外なし）。"""
    mock_client = MagicMock()
    mock_client.generate_image = AsyncMock(side_effect=Exception("connection refused"))

    with patch("app.agent.graph.tools.image_gen.GatewayClient", return_value=mock_client):
        result = run(image_gen.ainvoke({"prompt": "test prompt", "state": _state()}))

    assert result["ok"] is False
    assert "error" in result
    assert "connection refused" in result["error"]


def test_identity_and_idempotency_are_forwarded():
    """state identity と安定した request id が Gateway に渡ること。"""
    captured: dict = {}

    async def fake_generate(payload):
        captured["payload"] = payload
        return {"jobId": "j1", "status": "pending"}

    mock_client = MagicMock()
    mock_client.generate_image = fake_generate

    with patch("app.agent.graph.tools.image_gen.GatewayClient", return_value=mock_client) as client_cls:
        run(image_gen.ainvoke({"prompt": "test", "state": _state(user_id=99)}))

    ctx = client_cls.call_args.args[0]
    assert ctx.user_id == "99"
    assert ctx.group_id == "3"
    assert captured["payload"]["requestId"].startswith("agent:")
    assert len(captured["payload"]["requestId"]) == 70


def test_idempotency_key_is_stable():
    mock_client = MagicMock()
    payloads: list[dict] = []

    async def fake_generate(payload):
        payloads.append(payload)
        return {"jobId": "j1", "status": "pending"}

    mock_client.generate_image = fake_generate
    with patch("app.agent.graph.tools.image_gen.GatewayClient", return_value=mock_client):
        run(image_gen.ainvoke({"prompt": "same prompt", "state": _state()}))
        run(image_gen.ainvoke({"prompt": "same prompt", "state": _state()}))

    assert payloads[0]["requestId"] == payloads[1]["requestId"]
