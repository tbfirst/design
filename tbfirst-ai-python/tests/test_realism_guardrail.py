"""V5.XIV.1 — REALISM_GUARDRAIL 注入测试。

确认 Phase1/Phase2/Phase3 三个 prompt 都包含 HUMAN REALISM GUARDRAIL 段落，
该段落用于压制 AI 生图常见的塑料感 / 蜡像感 / 呆滞表情，提升人像真人感。
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.prompt_engine import (  # noqa: E402
    REALISM_GUARDRAIL,
    build_phase1_prompt,
    build_phase2_prompt,
    build_phase3_prompt,
)


def _phase1_settings():
    return {
        "tone": "Warm sunset",
        "atmosphere": "Editorial",
        "remark": "",
        "shotType": "中景 (Medium Shot)",
        "compositionScope": "inherit",
        "compositionTarget": "",
        "variationIndex": 0,
        "variationTotal": 1,
        "variationHint": "",
    }


def _phase2_settings():
    return {
        "pose": "standing",
        "expression": "calm",
        "focus": "face",
        "detailFocus": "fabric weave",
        "fabricDetail": "",
        "lighting": "softbox",
        "remark": "",
        "compositionScope": "inherit",
        "variationIndex": 0,
        "variationTotal": 1,
        "variationHint": "",
    }


def test_realism_guardrail_constant_has_keywords():
    """常量本身必须含 5 大关键词，避免后续误删某条规则。"""
    text = REALISM_GUARDRAIL
    assert "HUMAN REALISM GUARDRAIL" in text
    assert "skin texture" in text
    assert "micro-expressions" in text
    assert "uncanny valley" in text
    assert "Negative" in text


def test_phase1_prompt_includes_realism_guardrail():
    prompt = build_phase1_prompt(_phase1_settings())
    assert "HUMAN REALISM GUARDRAIL" in prompt
    assert "no plastic doll features" in prompt


def test_phase2_prompt_includes_realism_guardrail():
    prompt = build_phase2_prompt("walking towards camera", _phase2_settings())
    assert "HUMAN REALISM GUARDRAIL" in prompt
    assert "skin texture" in prompt


def test_phase3_prompt_includes_realism_guardrail():
    prompt = build_phase3_prompt(
        style_dna="Kodak Gold, warm highlight",
        intensity=0.65,
        grain=True,
        contrast="Standard",
        image_size="2K",
    )
    assert "HUMAN REALISM GUARDRAIL" in prompt
    # Phase3 是 color-grading-only，但真人感仍需保留：肌肤纹理不能被全局 LUT 抹平
    assert "skin texture" in prompt
    # Phase3 原有的 100% PRESERVE 硬约束不能被 GUARDRAIL 注入破坏
    assert "100% PRESERVE subject identity" in prompt


def test_phase3_prompt_guardrail_position_after_core_grade():
    """GUARDRAIL 必须在 CORE GRADE INSTRUCTION 之后、GRADE PARAMETERS 之前。"""
    prompt = build_phase3_prompt(
        style_dna="teal and orange",
        intensity=0.5,
        grain=False,
        contrast="High",
        image_size="4K",
    )
    core_idx = prompt.index("[CORE GRADE INSTRUCTION")
    guardrail_idx = prompt.index("HUMAN REALISM GUARDRAIL")
    params_idx = prompt.index("[GRADE PARAMETERS")
    assert core_idx < guardrail_idx < params_idx
