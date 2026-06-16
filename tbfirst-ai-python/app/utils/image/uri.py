"""图片 URI 解码 —— 把 data: 或 http(s)/相对路径统一转成 Gemini inline_data。

为什么单独抽出来：
之前各 route 直接 `data_uri.index(",")`，前端只要传一个 `/static/...` 或 `http(s)://...`
URL（典型场景：phase2Color 把上一轮生成的图当参考）就会抛 `ValueError: substring not found`，
对外报 500 `{"detail":"substring not found"}`。

策略：
  - `data:` 前缀 → 拆 mime + base64
  - `http://` / `https://` → 同步 httpx 拉取 → base64
  - `/static/...` 或裸路径 → 视为 gateway 静态资源，prefix `IMAGE_REF_BASE_URL`
    （默认 `http://localhost:8000`）后再拉取
失败一律抛 ValueError，调用侧 image route 已经 catch ValueError → 500，但 detail 会是
明确的"reference image fetch failed: ..."，便于排错。
"""
from __future__ import annotations

import base64
import logging
import os
import time
from typing import Any
from urllib.parse import urlparse

import httpx

logger = logging.getLogger(__name__)

# V5.XVII.J：默认从 gateway:8000 改为直连 image:8102。
_DEFAULT_BASE_URL = os.environ.get("IMAGE_REF_BASE_URL", "http://localhost:8102")

# SSRF 防护：http(s):// 外链只允许拉取白名单域名的资源。
_base_host = urlparse(_DEFAULT_BASE_URL).hostname or ""
_ALLOWED_FETCH_HOSTS: frozenset[str] = frozenset(
    [_base_host] +
    [h.strip()
     for h in os.environ.get("IMAGE_FETCH_ALLOWED_HOSTS", "storage.googleapis.com").split(",")
     if h.strip()]
)
_GCS_BUCKET: str = os.environ.get("GCS_BUCKET", "tbfirst-bucket-01")
_GCS_HOST = "storage.googleapis.com"
_FETCH_TIMEOUT = 30.0
_FETCH_RETRY = 1
_FETCH_RETRY_SLEEP = 0.5


def _gcs_url_to_proxy(url: str) -> str | None:
    parsed = urlparse(url)
    if parsed.hostname != _GCS_HOST:
        return None
    path = parsed.path.lstrip("/")
    prefix = _GCS_BUCKET + "/"
    if not path.startswith(prefix):
        return None
    key = path[len(prefix):]
    return _DEFAULT_BASE_URL.rstrip("/") + "/img/" + key


def _guess_mime(content_type: str | None, url: str) -> str:
    if content_type and content_type.startswith("image/"):
        return content_type.split(";", 1)[0].strip()
    lower = url.lower()
    if lower.endswith(".png"):
        return "image/png"
    if lower.endswith(".jpg") or lower.endswith(".jpeg"):
        return "image/jpeg"
    if lower.endswith(".webp"):
        return "image/webp"
    if lower.endswith(".gif"):
        return "image/gif"
    return "image/png"


def _fetch_as_inline(url: str) -> dict[str, Any]:
    parsed = urlparse(url)
    if parsed.hostname not in _ALLOWED_FETCH_HOSTS:
        raise ValueError(
            f"SSRF blocked: host '{parsed.hostname}' not in IMAGE_FETCH_ALLOWED_HOSTS"
        )
    last_err: Exception | None = None
    resp = None
    for attempt in range(_FETCH_RETRY + 1):
        try:
            with httpx.Client(timeout=_FETCH_TIMEOUT, follow_redirects=True) as client:
                resp = client.get(url)
            if resp.status_code in (502, 503, 504) and attempt < _FETCH_RETRY:
                logger.warning(
                    "[image_uri] %s returned %d, retrying (attempt %d/%d)",
                    url, resp.status_code, attempt + 1, _FETCH_RETRY,
                )
                time.sleep(_FETCH_RETRY_SLEEP)
                continue
            if resp.status_code >= 400:
                proxy_url = _gcs_url_to_proxy(url)
                if proxy_url:
                    logger.warning(
                        "[image_uri] GCS %d, fallback to proxy: %s",
                        resp.status_code, proxy_url,
                    )
                    with httpx.Client(timeout=_FETCH_TIMEOUT, follow_redirects=True) as pc:
                        resp = pc.get(proxy_url)
                    resp.raise_for_status()
                    mime = _guess_mime(resp.headers.get("content-type"), url)
                    b64 = base64.b64encode(resp.content).decode("ascii")
                    return {"inline_data": {"mime_type": mime, "data": b64}}
            resp.raise_for_status()
            break
        except (httpx.ConnectError, httpx.ReadError, httpx.RemoteProtocolError) as e:
            last_err = e
            if attempt < _FETCH_RETRY:
                logger.warning(
                    "[image_uri] %s transient %s, retrying (attempt %d/%d)",
                    url, type(e).__name__, attempt + 1, _FETCH_RETRY,
                )
                time.sleep(_FETCH_RETRY_SLEEP)
                continue
            proxy_url = _gcs_url_to_proxy(url)
            if proxy_url:
                logger.warning(
                    "[image_uri] GCS connect error (%s), fallback to proxy: %s",
                    type(e).__name__, proxy_url,
                )
                try:
                    with httpx.Client(timeout=_FETCH_TIMEOUT, follow_redirects=True) as pc:
                        resp = pc.get(proxy_url)
                    resp.raise_for_status()
                    mime = _guess_mime(resp.headers.get("content-type"), url)
                    b64 = base64.b64encode(resp.content).decode("ascii")
                    return {"inline_data": {"mime_type": mime, "data": b64}}
                except Exception as pe:
                    raise ValueError(f"reference image fetch failed: {url} (proxy also failed: {pe})") from pe
            raise ValueError(f"reference image fetch failed: {url} ({e})") from e
        except Exception as e:
            raise ValueError(f"reference image fetch failed: {url} ({e})") from e

    if resp is None:
        raise ValueError(f"reference image fetch failed: {url} ({last_err})")
    mime = _guess_mime(resp.headers.get("content-type"), url)
    b64 = base64.b64encode(resp.content).decode("ascii")
    return {"inline_data": {"mime_type": mime, "data": b64}}


def decode_image_to_inline(uri: str) -> dict[str, Any]:
    """把任意支持的图像引用形式转成 Gemini `inline_data` part。

    支持：
      - `data:image/png;base64,...`
      - `http(s)://...`（直接拉）
      - `/static/...` 或其他相对路径（拼 IMAGE_REF_BASE_URL 后拉）
    """
    if not uri or not isinstance(uri, str):
        raise ValueError(f"invalid reference image: {type(uri).__name__}")

    if uri.startswith("data:"):
        comma = uri.find(",")
        if comma == -1:
            raise ValueError("malformed data URI (missing comma)")
        meta = uri[:comma]
        b64 = uri[comma + 1:]
        mime = meta.replace("data:", "").replace(";base64", "") or "image/png"
        return {"inline_data": {"mime_type": mime, "data": b64}}

    if uri.startswith(("http://", "https://")):
        return _fetch_as_inline(uri)

    if uri.startswith("/"):
        return _fetch_as_inline(_DEFAULT_BASE_URL.rstrip("/") + uri)

    return _fetch_as_inline(_DEFAULT_BASE_URL.rstrip("/") + "/" + uri)


_VIDEO_SIZE_LIMIT = 50 * 1024 * 1024  # 50 MB
_VIDEO_CHUNK_SIZE = 65536  # 64 KB per streaming read

# 非空时对视频下载域名做白名单检查（与 IMAGE_FETCH_ALLOWED_HOSTS 同机制）。
# 生产可设置为逗号分隔的允许域列表；留空则不做限制（默认，保持向后兼容）。
_VIDEO_FETCH_ALLOWED_HOSTS: frozenset[str] = frozenset(
    h.strip()
    for h in os.environ.get("VIDEO_FETCH_ALLOWED_HOSTS", "").split(",")
    if h.strip()
)


def decode_video_to_inline(uri: str) -> dict:
    """把 http(s) 视频 URL 流式下载并转成 Gemini inline_data part。

    超过 50 MB 立即中止（流式逐块累计，不缓冲整体）；mime 从 Content-Type 读取，
    无则 fallback 'video/mp4'。VIDEO_FETCH_ALLOWED_HOSTS 非空时做域名白名单检查。
    """
    if not uri or not isinstance(uri, str):
        raise ValueError(f"invalid video uri: {type(uri).__name__}")

    # data: 视频（前端上传短视频直传 base64，不经 GCS）→ 直接拆 mime+base64
    if uri.startswith("data:"):
        comma = uri.find(",")
        if comma == -1:
            raise ValueError("malformed video data URI (missing comma)")
        meta = uri[:comma]
        b64 = uri[comma + 1 :]
        mime = meta.replace("data:", "").replace(";base64", "") or "video/mp4"
        return {"inline_data": {"mime_type": mime, "data": b64}}

    if not uri.startswith(("http://", "https://")):
        raise ValueError(f"video uri must be http(s) or data: {uri!r}")

    if _VIDEO_FETCH_ALLOWED_HOSTS:
        hostname = urlparse(uri).hostname
        if hostname not in _VIDEO_FETCH_ALLOWED_HOSTS:
            raise ValueError(
                f"SSRF blocked: host '{hostname}' not in VIDEO_FETCH_ALLOWED_HOSTS"
            )

    with httpx.Client(timeout=30.0, follow_redirects=True) as client:
        with client.stream("GET", uri) as resp:
            resp.raise_for_status()
            cl = resp.headers.get("content-length")
            if cl is not None and int(cl) > _VIDEO_SIZE_LIMIT:
                raise ValueError(f"video too large: {cl} bytes, limit 50MB")
            ct = resp.headers.get("content-type")
            mime = (ct.split(";", 1)[0].strip() if ct and ct.startswith("video/") else None) or "video/mp4"
            chunks: list[bytes] = []
            received = 0
            for chunk in resp.iter_bytes(chunk_size=_VIDEO_CHUNK_SIZE):
                received += len(chunk)
                if received > _VIDEO_SIZE_LIMIT:
                    raise ValueError(f"video too large: >{received} bytes, limit 50MB")
                chunks.append(chunk)
    data = b"".join(chunks)
    b64 = base64.b64encode(data).decode("ascii")
    return {"inline_data": {"mime_type": mime, "data": b64}}


