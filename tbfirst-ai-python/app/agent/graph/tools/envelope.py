"""统一工具返回信封（对照 CC `classifyToolError` 的"错误即数据"思路，轻量版）。

所有工具的成功 / 失败返回收敛到统一结构，模型据顶层 `ok` 字段稳定判断成败，
不再各写各的 dict（有的 `{"hits":[],"error":...}`、有的 `{"prompt":...,"error":...}`）。
遥测侧也能按 `error_code` 统一分类。

约定：
- 成功：`{"ok": True, ...业务字段}`
- 失败：`{"ok": False, "tool": <name>, "error_code": <code>, "error": <message>, ...可选业务字段}`

`tool_error` 的 `data` 参数是**附加**的：失败时仍可携带业务字段（如空的 `hits`、
原始 `prompt`），既给模型保留语义线索，也保持与历史返回结构的向后兼容。
工具体内部绝不 `raise` 中断 LangGraph——错误一律收敛成 `tool_error` 返回。
"""
from __future__ import annotations

from typing import Any


def tool_ok(data: dict[str, Any] | None = None) -> dict[str, Any]:
    """成功信封：`ok=True` + 业务字段。"""
    if data:
        return {"ok": True, **data}
    return {"ok": True}


def tool_error(
    tool_name: str,
    code: str,
    message: str,
    *,
    data: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """失败信封：`ok=False` + 工具名 + 错误码 + 错误信息（+ 可选业务字段）。

    Args:
        tool_name: 工具名（与 registry 登记一致），便于遥测归集。
        code: 稳定错误码（如 ``no_api_key`` / ``provider_error`` / ``request_failed``），
            供模型与遥测稳定识别，不要塞入会变化的细节。
        message: 人/模型可读的错误描述（通常是异常字符串）。
        data: 可选附加业务字段，失败时一并返回（如 ``{"hits": []}``）。
    """
    env: dict[str, Any] = {
        "ok": False,
        "tool": tool_name,
        "error_code": code,
        "error": message,
    }
    if data:
        env.update(data)
    return env
