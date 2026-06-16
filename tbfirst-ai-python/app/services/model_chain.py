"""
Gemini 模型降级链 —— 按可用性 / 配额 / 瞬态错误依次下探。

- IMAGE_CHAIN: Phase1 / Phase2 / Phase0-asset / Phase2-color / Inpaint / fallback dispatch 共用
- TEXT_CHAIN:  Copilot chat / inspire / analyze-brand 共用
- DNA_CHAIN:   Phase0 DNA（vision + structured text，独立一条避免被 image 链噪声干扰）

默认顺序（2026-04-22 用户选定）：
    IMAGE: gemini-3.1-flash-image-preview → gemini-3-pro-image-preview → gemini-2.5-flash-image-preview
    TEXT:  gemini-3-flash-preview         → gemini-2.5-flash
    DNA:   gemini-3-flash-preview         → gemini-2.5-flash

env 覆盖（逗号分隔，config.py 自动解析为 list[str]）：
    GEMINI_IMAGE_CHAIN="gemini-3.1-flash-image-preview,gemini-3-pro-image-preview"
"""
from __future__ import annotations

from app.config import get_settings

DEFAULT_IMAGE_CHAIN: list[str] = [
    "gemini-3.1-flash-image-preview",
    "gemini-3-pro-image-preview",
    "gemini-2.5-flash-image-preview",
]

DEFAULT_TEXT_CHAIN: list[str] = [
    "gemini-3-flash-preview",
    "gemini-2.5-flash",
]

DEFAULT_DNA_CHAIN: list[str] = [
    "gemini-3-flash-preview",
    "gemini-2.5-flash",
]


def _dedup(models: list[str]) -> list[str]:
    """保序去重，避免 preferred_first 与默认链里的同名模型重复尝试。"""
    seen: set[str] = set()
    out: list[str] = []
    for m in models:
        if m and m not in seen:
            seen.add(m)
            out.append(m)
    return out


def resolve_chain(
    env_chain: list[str],
    default: list[str],
    preferred_first: str | None = None,
) -> list[str]:
    """
    合成最终链：preferred_first（如有）→ env 覆盖 / default → 去重。

    preferred_first 用于调用方已知当前场景更适合某个模型的场景
    （如 Phase0 Asset 更适合 pro），把它顶到链首，失败后仍按链降级。
    """
    base = env_chain if env_chain else list(default)
    if preferred_first:
        return _dedup([preferred_first, *base])
    return _dedup(base)


def image_chain(preferred_first: str | None = None) -> list[str]:
    return resolve_chain(get_settings().gemini_image_chain, DEFAULT_IMAGE_CHAIN, preferred_first)


def text_chain(preferred_first: str | None = None) -> list[str]:
    return resolve_chain(get_settings().gemini_text_chain, DEFAULT_TEXT_CHAIN, preferred_first)


def dna_chain(preferred_first: str | None = None) -> list[str]:
    return resolve_chain(get_settings().gemini_dna_chain, DEFAULT_DNA_CHAIN, preferred_first)
