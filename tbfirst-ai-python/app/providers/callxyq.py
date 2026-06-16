"""
callxyq 视频网关 Provider — Seedance 2.0 等模型的异步 图/文 生视频。

文档：视频接口文档.md（callxyq）。统一异步任务流，全部走 /v1/videos：
  POST  /v1/videos                     创建任务 → 返回 task_id
  GET   /v1/videos/{task_id}           查询任务状态
  GET   /v1/videos/{task_id}/content   下载结果（二进制）
鉴权：Authorization: Bearer <token>；Content-Type/Accept: application/json。

与旧 Veo 实现的关键差别：task_id 是无状态字符串，进程重启不丢
（旧 Veo 把 operation 对象缓存在内存 dict，重启即轮询报错）。

注意：所给文档只含 Sora 段，未列出 Seedance 的 model 名/参数上限，也未给
/v1/videos 的【响应体】结构与 status 枚举。故本实现对响应做防御式解析，并在
轮询时打印原始响应，便于按上游实际返回校准 _DONE_OK / 字段名。
"""
import base64
import logging
import math
from typing import Any

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)

# 任务状态枚举（宽松匹配：不同网关/上游拼写不一）
_DONE_OK = {"completed", "succeeded", "success", "done", "finished", "complete", "ok"}
_DONE_FAIL = {"failed", "fail", "error", "errored", "cancelled", "canceled", "rejected"}

# 结果视频下载体积上限（720p / ≤15s 通常远小于此）
_CONTENT_SIZE_LIMIT = 100 * 1024 * 1024  # 100 MB
_CHUNK = 65536  # 64 KB

_CREATE_TIMEOUT = 60.0
_POLL_TIMEOUT = 30.0
_CONTENT_TIMEOUT = 120.0


def _compute_size(aspect_ratio: str, resolution: str) -> str:
    """由画幅比 + 分辨率推算像素串（短边 = 分辨率数值，取偶数）。

    如 720p：9:16→720x1280，16:9→1280x720，1:1→720x720，21:9→1680x720。
    """
    try:
        w_str, h_str = (aspect_ratio or "9:16").split(":")
        w, h = int(w_str), int(h_str)
    except Exception:
        w, h = 9, 16
    if w <= 0 or h <= 0:
        w, h = 9, 16
    digits = "".join(ch for ch in (resolution or "") if ch.isdigit())
    short = int(digits) if digits else 720
    g = math.gcd(w, h) or 1
    w, h = w // g, h // g
    if w <= h:
        width, height = short, round(short * h / w)
    else:
        width, height = round(short * w / h), short
    width -= width % 2  # 规避部分编码器对奇数宽高的拒绝
    height -= height % 2
    return f"{width}x{height}"


# Seedance 单次参考图上限
_MAX_REF_IMAGES = 9


def _build_create_body(
    prompt: str,
    uris: list[str],
    *,
    model: str,
    seconds: int,
    aspect_ratio: str,
    resolution: str,
) -> dict[str, Any]:
    """组装 /v1/videos 请求体。

    按文档 §2.4 的图字段规则：1 张 → image_url；≥2 张 → reference_image_urls（数组，
    @Image1..@ImageN）。超过 9 张截断到前 9。
    """
    body: dict[str, Any] = {
        "model": model,
        "prompt": prompt,
        "aspect_ratio": aspect_ratio,
        "resolution": resolution,
        "size": _compute_size(aspect_ratio, resolution),
        "seconds": str(int(seconds)),  # 文档要求字符串
    }
    refs = [u for u in (uris or []) if u][:_MAX_REF_IMAGES]
    if len(refs) == 1:
        body["image_url"] = refs[0]
    elif len(refs) >= 2:
        body["reference_image_urls"] = refs
    return body


def _walk(data: Any, keys: tuple[str, ...]) -> Any:
    """在 dict（含常见 data/result/output 包裹层）里按 keys 顺序找第一个字符串/数值。"""
    if not isinstance(data, dict):
        return None
    for k in keys:
        v = data.get(k)
        if isinstance(v, (str, int)) and str(v):
            return v
    for container in ("data", "result", "output", "outputs", "response", "task"):
        c = data.get(container)
        if isinstance(c, dict):
            r = _walk(c, keys)
            if r is not None:
                return r
        elif isinstance(c, list) and c and isinstance(c[0], dict):
            r = _walk(c[0], keys)
            if r is not None:
                return r
    return None


def _extract_task_id(data: Any) -> str | None:
    v = _walk(data, ("id", "task_id", "taskId", "uuid"))
    return str(v) if v is not None else None


def _extract_status(data: Any) -> str | None:
    v = _walk(data, ("status", "state", "task_status", "taskStatus"))
    return str(v) if v is not None else None


def _extract_error(data: Any) -> str | None:
    if isinstance(data, dict):
        err = data.get("error")
        if isinstance(err, dict):
            inner = err.get("message") or err.get("msg")
            if isinstance(inner, str) and inner:
                return inner
    v = _walk(data, ("error", "message", "msg", "fail_reason", "failure_reason", "detail"))
    return str(v) if v is not None else None


def _extract_video_url(data: Any) -> str | None:
    """部分网关在查询响应里直接给结果 URL 或 data URL。"""
    v = _walk(data, ("video_url", "videoUrl", "url", "output_url", "result_url", "download_url"))
    return str(v) if v is not None else None


class CallxyqVideoProvider:
    """callxyq 视频网关客户端（默认模型 settings.callxyq_video_model = seedance-2.0）。"""

    def __init__(self) -> None:
        self._settings = get_settings()

    def _base(self) -> str:
        return (self._settings.callxyq_base_url or "http://api.callxyq.xyz").rstrip("/")

    def _headers(self) -> dict[str, str]:
        token = (self._settings.callxyq_api_token or "").strip()
        if not token:
            raise ValueError("CALLXYQ_API_TOKEN 未配置，无法调用 callxyq 视频网关")
        # 容错：.env 里只需填 apikey 本身；若误带了 "Bearer " 前缀则剥掉，避免重复
        if token.lower().startswith("bearer "):
            token = token[7:].strip()
        return {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

    async def create_video_task(
        self,
        prompt: str,
        image_data_uris: list[str] | None,
        *,
        model: str | None = None,
        seconds: int = 10,
        aspect_ratio: str = "9:16",
        resolution: str = "720p",
    ) -> str:
        """创建视频生成任务，返回 task_id 供前端轮询。

        image_data_uris 为参考图列表（data URL 或 http(s) URL，文档明示两者皆可，最多 9 张，
        对应 @Image1..@ImageN）；空列表/None 时为纯文本生成。
        """
        mdl = model or self._settings.callxyq_video_model or "seedance-2.0"
        body = _build_create_body(
            prompt, image_data_uris or [],
            model=mdl, seconds=seconds, aspect_ratio=aspect_ratio, resolution=resolution,
        )
        logger.info(
            "[callxyq] create task: model=%s seconds=%s aspect=%s size=%s ref_images=%d",
            mdl, body["seconds"], aspect_ratio, body["size"],
            len([u for u in (image_data_uris or []) if u]),
        )
        async with httpx.AsyncClient(timeout=_CREATE_TIMEOUT) as client:
            resp = await client.post(
                f"{self._base()}/v1/videos", headers=self._headers(), json=body
            )
        if resp.status_code >= 400:
            raise RuntimeError(f"callxyq 创建任务失败 HTTP {resp.status_code}: {resp.text[:300]}")
        data = resp.json()
        task_id = _extract_task_id(data)
        if not task_id:
            raise RuntimeError(f"callxyq 创建任务返回缺少 task id: {str(data)[:300]}")
        logger.info("[callxyq] task created: %s", task_id)
        return task_id

    async def poll_video_task(self, task_id: str) -> dict:
        """查询任务状态；完成时下载结果转 data:video/mp4;base64。

        返回 {done: bool, video_uri?: str, error?: str}。
        """
        base = self._base()
        async with httpx.AsyncClient(timeout=_POLL_TIMEOUT) as client:
            resp = await client.get(f"{base}/v1/videos/{task_id}", headers=self._headers())
        if resp.status_code >= 400:
            return {"done": True, "error": f"查询任务失败 HTTP {resp.status_code}: {resp.text[:200]}"}
        data = resp.json()
        status = (_extract_status(data) or "").lower()
        direct = _extract_video_url(data)
        if not status and not direct:
            # 首版校准：状态字段未知时打印原始响应，便于按上游实际返回调整枚举/字段名
            logger.info("[callxyq] poll %s → no status field, raw=%s", task_id, str(data)[:300])
        else:
            logger.info("[callxyq] poll %s → status=%s", task_id, status or "?")

        if status in _DONE_FAIL:
            return {"done": True, "error": _extract_error(data) or f"任务失败（status={status}）"}

        is_done = (status in _DONE_OK) or bool(direct)
        if not is_done:
            return {"done": False}

        # 已完成：直链是 data URL 则直接用，否则下载（直链 http(s) 或 /content 二进制）
        if direct and direct.startswith("data:"):
            return {"done": True, "video_uri": direct}
        try:
            video_bytes = await self._download_content(base, task_id, direct)
        except Exception as e:
            return {"done": True, "error": f"下载视频失败: {e}"}
        b64 = base64.b64encode(video_bytes).decode("ascii")
        logger.info("[callxyq] video downloaded: %d bytes → data URI", len(video_bytes))
        return {"done": True, "video_uri": f"data:video/mp4;base64,{b64}"}

    async def _download_content(self, base: str, task_id: str, direct_url: str | None) -> bytes:
        url = (
            direct_url
            if (direct_url and direct_url.startswith(("http://", "https://")))
            else f"{base}/v1/videos/{task_id}/content"
        )
        async with httpx.AsyncClient(timeout=_CONTENT_TIMEOUT, follow_redirects=True) as client:
            async with client.stream("GET", url, headers=self._headers()) as r:
                r.raise_for_status()
                cl = r.headers.get("content-length")
                if cl is not None and int(cl) > _CONTENT_SIZE_LIMIT:
                    raise ValueError(f"视频过大: {cl} bytes, 上限 100MB")
                chunks: list[bytes] = []
                received = 0
                async for chunk in r.aiter_bytes(_CHUNK):
                    received += len(chunk)
                    if received > _CONTENT_SIZE_LIMIT:
                        raise ValueError("视频过大: 超过 100MB 上限")
                    chunks.append(chunk)
        return b"".join(chunks)
