"""callxyq / Seedance 视频生成：size 推算、响应解析、路由 wiring。"""
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.providers.callxyq import (
    _build_create_body,
    _compute_size,
    _extract_error,
    _extract_status,
    _extract_task_id,
    _extract_video_url,
)
from app.routes.cinestitch import router as cinestitch_router

_app = FastAPI()
_app.include_router(cinestitch_router)
client = TestClient(_app)


# ---- 纯函数：size 推算（短边 = 分辨率，取偶数） ----

def test_compute_size_portrait_720p():
    assert _compute_size("9:16", "720p") == "720x1280"


def test_compute_size_landscape_720p():
    assert _compute_size("16:9", "720p") == "1280x720"


def test_compute_size_square_and_wide():
    assert _compute_size("1:1", "720p") == "720x720"
    assert _compute_size("21:9", "720p") == "1680x720"


def test_compute_size_bad_input_falls_back_portrait():
    # 非法画幅退化为 9:16
    assert _compute_size("oops", "720p") == "720x1280"
    # 分辨率无数字退化为 720
    assert _compute_size("16:9", "hd") == "1280x720"


# ---- 防御式响应解析（文档未给响应结构，需容忍多种形状） ----

def test_extract_task_id_variants():
    assert _extract_task_id({"id": "abc"}) == "abc"
    assert _extract_task_id({"task_id": 123}) == "123"
    assert _extract_task_id({"data": {"id": "nested"}}) == "nested"
    assert _extract_task_id({"nope": 1}) is None


def test_extract_status_and_error():
    assert _extract_status({"status": "completed"}) == "completed"
    assert _extract_status({"data": {"state": "in_progress"}}) == "in_progress"
    assert _extract_error({"error": {"message": "boom"}}) == "boom"
    assert _extract_error({"data": {"message": "bad"}}) == "bad"


def test_extract_video_url():
    assert _extract_video_url({"video_url": "http://x/v.mp4"}) == "http://x/v.mp4"
    assert _extract_video_url({"data": {"url": "data:video/mp4;base64,AA"}}) == "data:video/mp4;base64,AA"
    assert _extract_video_url({"outputs": [{"download_url": "http://x/2.mp4"}]}) == "http://x/2.mp4"


# ---- 多参考图映射：1→image_url，≥2→reference_image_urls，>9 截断 ----

def _body(uris):
    return _build_create_body("p", uris, model="seedance-2.0", seconds=10, aspect_ratio="9:16", resolution="720p")


def test_build_body_no_image_text_only():
    b = _body([])
    assert "image_url" not in b and "reference_image_urls" not in b
    assert b["size"] == "720x1280" and b["seconds"] == "10"


def test_build_body_single_uses_image_url():
    b = _body(["data:image/png;base64,AAA"])
    assert b["image_url"] == "data:image/png;base64,AAA"
    assert "reference_image_urls" not in b


def test_build_body_multi_uses_reference_array():
    b = _body(["a", "b", "c"])
    assert "image_url" not in b
    assert b["reference_image_urls"] == ["a", "b", "c"]


def test_build_body_caps_at_nine():
    b = _body([str(i) for i in range(12)])
    assert len(b["reference_image_urls"]) == 9


# ---- 路由 wiring：含新增 resolution 字段、operationName 透传 ----

def _patched_provider(create_ret="task-xyz", poll_ret=None):
    inst = MagicMock()
    inst.create_video_task = AsyncMock(return_value=create_ret)
    inst.poll_video_task = AsyncMock(return_value=poll_ret or {"done": False})
    cls = MagicMock(return_value=inst)
    return cls, inst


def test_generate_video_clip_route_passes_images_and_resolution():
    cls, inst = _patched_provider(create_ret="task-xyz")
    with patch("app.routes.cinestitch.CallxyqVideoProvider", cls):
        resp = client.post(
            "/cinestitch/generate-video-clip",
            json={
                "imageDataUris": ["data:image/png;base64,AAAA", "data:image/png;base64,BBBB"],
                "prompt": "one continuous cinematic video",
                "durationSeconds": 12,
                "aspectRatio": "9:16",
                "resolution": "720p",
            },
        )
    assert resp.status_code == 200
    assert resp.json()["operationName"] == "task-xyz"
    # 图列表按位置参数传入，resolution/seconds/aspect 走 kwargs
    args = inst.create_video_task.call_args.args
    kwargs = inst.create_video_task.call_args.kwargs
    assert args[1] == ["data:image/png;base64,AAAA", "data:image/png;base64,BBBB"]
    assert kwargs["resolution"] == "720p"
    assert kwargs["seconds"] == 12
    assert kwargs["aspect_ratio"] == "9:16"


def test_poll_video_clip_route_returns_done():
    cls, _ = _patched_provider(
        poll_ret={"done": True, "video_uri": "data:video/mp4;base64,QUJD"}
    )
    with patch("app.routes.cinestitch.CallxyqVideoProvider", cls):
        resp = client.post(
            "/cinestitch/poll-video-clip", json={"operationName": "task-xyz"}
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["done"] is True
    assert body["videoUri"].startswith("data:video/mp4;base64,")
