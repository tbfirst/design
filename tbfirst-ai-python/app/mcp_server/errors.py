from __future__ import annotations

import re
from typing import Any

from fastapi import HTTPException

_DATA_URI_RE = re.compile(r"data:[^;]+;base64,[A-Za-z0-9+/=]{80,}")
_TOKEN_RE = re.compile(r"(Bearer\s+)[A-Za-z0-9._~+/=-]+", re.IGNORECASE)


class McpToolError(RuntimeError):
    def __init__(self, message: str, *, status_code: int = 400):
        super().__init__(message)
        self.status_code = status_code


def sanitize(value: Any, *, max_chars: int = 1200) -> Any:
    if isinstance(value, dict):
        return {str(k): sanitize(v, max_chars=max_chars) for k, v in value.items()}
    if isinstance(value, list):
        return [sanitize(v, max_chars=max_chars) for v in value[:20]]
    if not isinstance(value, str):
        return value
    text = _TOKEN_RE.sub(r"\1***", value)
    text = _DATA_URI_RE.sub("data:...;base64,[redacted]", text)
    if len(text) > max_chars:
        return text[:max_chars] + "...[truncated]"
    return text


def to_http_error(exc: Exception) -> HTTPException:
    if isinstance(exc, McpToolError):
        return HTTPException(status_code=exc.status_code, detail=str(exc))
    return HTTPException(status_code=502, detail=f"MCP tool failed: {sanitize(str(exc), max_chars=500)}")
