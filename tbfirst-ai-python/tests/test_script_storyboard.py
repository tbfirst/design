from unittest.mock import AsyncMock, patch

import pytest

from fastapi import FastAPI
from fastapi.testclient import TestClient

# script_storyboard 是分镜/视频域路由，my1 agent 分支未纳入（routes/__init__ 不注册），
# 模块缺失时跳过整个文件而非报 collection error。
pytest.importorskip("app.routes.script_storyboard", reason="storyboard route not present on agent branch")

from app.routes.cinestitch import router as cinestitch_router
from app.routes.script_storyboard import router as script_storyboard_router

_app = FastAPI()
_app.include_router(script_storyboard_router)
_app.include_router(cinestitch_router)
client = TestClient(_app)

_FAKE_MARKDOWN = (
    "| 镜号 | 景别 | 角度 | 运镜 | 人物 | 环境/背景 | 动作与台词 | 视觉描述(EN) |\n"
    "|---|---|---|---|---|---|---|---|\n"
    "| 1 | LS | 正面 | 固定 | 主角 | 城市夜景 | 独自行走 | A man walks alone at night, city lights |\n"
)


def test_parse_script_success():
    fake_result = {"text": _FAKE_MARKDOWN, "used_model": "gemini-2.5-flash"}
    with patch(
        "app.routes.script_storyboard._gemini.generate_text_with_fallback",
        new=AsyncMock(return_value=fake_result),
    ):
        resp = client.post(
            "/cinestitch/parse-script",
            json={"scriptContent": "INT. CITY STREET - NIGHT\nA man walks alone."},
        )

    assert resp.status_code == 200
    data = resp.json()
    assert data["markdown"]
    assert "视觉描述" in data["markdown"]


def test_parse_script_empty_ai_return():
    fake_result = {"text": "", "used_model": "gemini-2.5-flash"}
    with patch(
        "app.routes.script_storyboard._gemini.generate_text_with_fallback",
        new=AsyncMock(return_value=fake_result),
    ):
        resp = client.post(
            "/cinestitch/parse-script",
            json={"scriptContent": "INT. OFFICE - DAY\nA meeting happens."},
        )

    assert resp.status_code == 502
    assert "为空" in resp.json()["detail"]


def test_generate_shot_image_success():
    fake_result = {"urls": ["data:image/png;base64,abc"], "used_model": "m1"}
    with patch(
        "app.routes.cinestitch._gemini.generate_with_fallback",
        new=AsyncMock(return_value=fake_result),
    ):
        resp = client.post(
            "/cinestitch/generate-shot-image",
            json={"visualDescription": "A man walks in rain, cinematic lighting"},
        )

    assert resp.status_code == 200
    data = resp.json()
    assert data["imageUrl"] == "data:image/png;base64,abc"
    assert data["usedModel"] == "m1"
