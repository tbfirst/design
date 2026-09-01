from __future__ import annotations

import base64
import re
from typing import Any
from urllib.parse import urlparse

from app.config import get_settings
from app.mcp_server.errors import McpToolError
from app.mcp_server.schemas import ImageInput

_ASSET_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,180}$")
_DATA_URI_RE = re.compile(r"^data:(image/(png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=\s]+)$", re.IGNORECASE)


def normalize_images(value: Any, *, field_name: str) -> list[str]:
    values = value if isinstance(value, list) else ([value] if value else [])
    refs: list[str] = []
    for item in values:
        refs.append(normalize_image(item, field_name=field_name))
    return refs


def normalize_image(value: Any, *, field_name: str) -> str:
    if isinstance(value, str):
        return _normalize_string_ref(value, field_name=field_name)
    if isinstance(value, dict):
        image = ImageInput(**value)
        populated = [v for v in (image.url, image.asset_id, image.data_uri) if v]
        if len(populated) != 1:
            raise McpToolError(f"{field_name} must contain exactly one of url, asset_id, data_uri.")
        if image.url:
            return _normalize_url(image.url, field_name=field_name)
        if image.asset_id:
            return _normalize_asset_id(image.asset_id, field_name=field_name)
        return _normalize_data_uri(image.data_uri or "", field_name=field_name)
    raise McpToolError(f"{field_name} must be a string or ImageInput object.")


def _normalize_string_ref(value: str, *, field_name: str) -> str:
    raw = value.strip()
    if raw.startswith("data:image/"):
        return _normalize_data_uri(raw, field_name=field_name)
    if raw.startswith(("http://", "https://", "/img/", "/static/")):
        return _normalize_url(raw, field_name=field_name)
    if "\\" in raw or raw.startswith(("/", ".", "~")):
        raise McpToolError(f"{field_name} cannot be a server or local filesystem path.")
    return _normalize_asset_id(raw, field_name=field_name)


def _normalize_url(raw: str, *, field_name: str) -> str:
    if raw.startswith(("/img/", "/static/")):
        return raw
    parsed = urlparse(raw)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise McpToolError(f"{field_name} has an invalid URL.")
    allowed = _allowed_hosts()
    if allowed and parsed.hostname not in allowed:
        raise McpToolError(f"{field_name} URL host is not allowed: {parsed.hostname}")
    return raw


def _normalize_asset_id(raw: str, *, field_name: str) -> str:
    asset_id = raw.strip()
    if not _ASSET_ID_RE.match(asset_id):
        raise McpToolError(f"{field_name} has an invalid asset_id.")
    return f"/img/{asset_id}"


def _normalize_data_uri(raw: str, *, field_name: str) -> str:
    match = _DATA_URI_RE.match(raw.strip())
    if not match:
        raise McpToolError(f"{field_name} data_uri must be png/jpeg/webp base64.")
    try:
        decoded_size = len(base64.b64decode(match.group(3), validate=True))
    except Exception as exc:
        raise McpToolError(f"{field_name} data_uri is invalid base64.") from exc
    if decoded_size > get_settings().tbfirst_mcp_max_image_bytes:
        raise McpToolError(f"{field_name} data_uri exceeds MCP image size limit.")
    return raw


def _allowed_hosts() -> set[str]:
    raw = getattr(get_settings(), "tbfirst_mcp_allowed_image_hosts", "")
    return {host.strip().lower() for host in raw.split(",") if host.strip()}
