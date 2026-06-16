"""Sprint V5.XVI Sprint A 综合回归 — 服装保护块在三 Phase prompt 内的存在性断言。

覆盖：
1. Phase1 prompt 含 GARMENT PRESERVATION + AUTHORITATIVE SPEC
2. Phase2 prompt 含 GARMENT PRESERVATION，且旧句 "Maintain strict consistency of the product's design" 已删除
3. Phase3 prompt 含 surface albedo + 5500K 物理表达，CORE GRADE 后追加了 GARMENT PRESERVATION
"""

from app.services.prompt_engine import (
    build_phase1_prompt,
    build_phase2_prompt,
    build_phase3_prompt,
)


_PHASE1_SETTINGS = {
    "shotType": "Wide Shot, full body visible with environment, editorial composition",
    "tone": "",
    "atmosphere": "",
    "remark": "",
    "compositionScope": "overall",
    "compositionTarget": "",
}

_PHASE2_SETTINGS = {
    "shotType": "",
    "tone": "",
    "atmosphere": "",
    "remark": "",
    "action": "",
    "lighting": "",
    "detailFocus": "",
    "fabricDetail": "",
    "negative": "",
    "variation": "",
    "focus": "",
    "compositionScope": "",
    "compositionTarget": "",
}


def test_phase1_includes_garment_preservation():
    prompt = build_phase1_prompt(_PHASE1_SETTINGS)
    assert "GARMENT PRESERVATION" in prompt
    assert "AUTHORITATIVE SPEC" in prompt
    assert "Ensure strict character consistency (face, hair, body proportions)" in prompt


def test_phase2_includes_garment_preservation():
    prompt = build_phase2_prompt("", _PHASE2_SETTINGS)
    assert "GARMENT PRESERVATION" in prompt
    # 旧 V5.XV 之前的 "Maintain strict consistency of the product's design" 单句应被删除
    assert "Maintain strict consistency of the product's design" not in prompt


def test_phase3_albedo_wording():
    prompt = build_phase3_prompt(
        style_dna="teal & orange cinematic",
        intensity=0.6,
        grain=True,
        contrast="medium",
        image_size="1024x1024",
        remark="",
    )
    assert "surface albedo" in prompt
    assert "5500K" in prompt
    # CORE GRADE 后已追加 GARMENT_PRESERVATION_BLOCK
    assert "GARMENT PRESERVATION" in prompt
