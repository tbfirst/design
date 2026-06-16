"""V5.XIV.4 — _phase3_dna / _phase3_generate 入参校验测试。

针对用户反馈的「Phase3 经常生成失败」，加 refs / styleDNA 空值校验：
- refs 为空 → 400 而不是冒泡为模型层 502 / 失败响应；
- styleDNA + prompt 同时为空 → 400 而不是用空字符串去调模型。

测试不依赖真实 Gemini API（只验证校验路径 → 早期 raise，不进 generate_with_fallback）。
"""
import asyncio
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi import HTTPException  # noqa: E402

from app.schemas import ImageGenerateRequest  # noqa: E402
from app.routes.image import _phase3_dna, _phase3_generate  # noqa: E402


def _req(prompt: str = "x") -> ImageGenerateRequest:
    return ImageGenerateRequest(prompt=prompt, phase="phase3")


def test_phase3_dna_rejects_empty_refs():
    """灵感参考图缺失 → 400 而不是进入 generate_with_fallback。"""
    with pytest.raises(HTTPException) as exc:
        asyncio.run(_phase3_dna(_req(), {"step": "dna"}, refs=[]))
    assert exc.value.status_code == 400
    assert "灵感参考图" in str(exc.value.detail)


def test_phase3_generate_rejects_empty_refs():
    """底片缺失 → 400。"""
    pc = {"step": "generate", "styleDNA": "warm golden, kodak gold"}
    with pytest.raises(HTTPException) as exc:
        asyncio.run(_phase3_generate(_req(), pc, refs=[], image_config={}))
    assert exc.value.status_code == 400
    assert "底片" in str(exc.value.detail)


def test_phase3_generate_rejects_empty_style_dna():
    """styleDNA 与 req.prompt 同时为空 → 400（避免用空字符串调模型）。"""
    pc = {"step": "generate", "styleDNA": ""}
    # 用一个 1x1 透明 PNG 的 data URI 占位作为底片，确保通过 refs 校验
    fake_base = (
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAen63NgAAAAASUVORK5CYII="
    )
    req = ImageGenerateRequest(prompt="", phase="phase3")
    with pytest.raises(HTTPException) as exc:
        asyncio.run(_phase3_generate(req, pc, refs=[fake_base], image_config={}))
    assert exc.value.status_code == 400
    assert "styleDNA" in str(exc.value.detail)


def test_phase3_generate_accepts_style_dna_via_prompt_fallback():
    """styleDNA 为空但 req.prompt 非空 → 校验通过（保留旧前端兼容路径）。

    本测试只走到 generate_with_fallback 之前的所有校验，再触发该调用必然失败
    （网络/凭证），用 pytest.raises 匹配 HTTPException 502（包装后）或 OSError
    （未配置 API key 直接抛）都算通过 — 关键是 *不能* 抛 400。
    """
    pc = {"step": "generate", "styleDNA": ""}
    fake_base = (
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAen63NgAAAAASUVORK5CYII="
    )
    req = ImageGenerateRequest(prompt="kodak gold warm tone", phase="phase3")
    try:
        asyncio.run(_phase3_generate(req, pc, refs=[fake_base], image_config={}))
    except HTTPException as e:
        # 关键断言：fallback 工作了，不能再因 styleDNA 空抛 400
        assert e.status_code != 400, f"styleDNA fallback to prompt failed: {e.detail}"
    except Exception:
        # 网络 / 凭证错误都可接受，校验已通过
        pass
