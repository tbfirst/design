import json
from unittest.mock import AsyncMock, patch

import pytest

from fastapi import FastAPI
from fastapi.testclient import TestClient

# video_storyboard 是分镜/视频域路由，my1 agent 分支未纳入（且依赖已移除的 app/core），
# 模块缺失时跳过整个文件而非报 collection error。
pytest.importorskip("app.routes.video_storyboard", reason="storyboard route not present on agent branch")

from app.routes.cinestitch import router as cinestitch_router
from app.routes.video_storyboard import router as video_storyboard_router

_app = FastAPI()
_app.include_router(video_storyboard_router)
_app.include_router(cinestitch_router)
client = TestClient(_app)


def test_parse_video_success():
    fake_part = {"inline_data": {"mime_type": "video/mp4", "data": "AAAA"}}
    fake_result = {
        "text": "| 1 | 全景 | 模特走秀 | 挺胸抬头 | 明亮 | 西装 | 首镜 |",
        "used_model": "gemini-2.5-flash",
    }
    with (
        patch("app.routes.video_storyboard.decode_video_to_inline", return_value=fake_part),
        patch(
            "app.routes.video_storyboard._gemini.generate_text_with_fallback",
            new=AsyncMock(return_value=fake_result),
        ),
    ):
        resp = client.post("/cinestitch/parse-video", json={"videoUrl": "http://example.com/v.mp4"})

    assert resp.status_code == 200
    assert resp.json()["markdown"]


def test_parse_video_too_large():
    with patch(
        "app.routes.video_storyboard.decode_video_to_inline",
        side_effect=ValueError("video too large: 99999999 bytes, limit 50MB"),
    ):
        resp = client.post("/cinestitch/parse-video", json={"videoUrl": "http://example.com/v.mp4"})

    assert resp.status_code == 422
    assert "视频加载失败" in resp.json()["detail"]


def test_generate_video_prompts_success():
    prompts_list = ["Close-up of jacket lapel detail", "Model walking on runway full body"]
    fake_result = {"text": json.dumps(prompts_list), "used_model": "gemini-2.5-flash"}
    with patch(
        "app.routes.cinestitch._gemini.generate_text_with_fallback",
        new=AsyncMock(return_value=fake_result),
    ):
        resp = client.post(
            "/cinestitch/generate-video-prompts",
            json={"scenesMarkdown": "| 1 | 全景 | ... |\n| 2 | 特写 | ... |"},
        )

    assert resp.status_code == 200
    data = resp.json()
    assert len(data["prompts"]) == 2
