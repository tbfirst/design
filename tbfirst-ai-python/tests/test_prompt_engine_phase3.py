"""
Phase3 prompt_engine unit tests — V5.XIII.17
Covers: DNA prompt format, build_phase3_prompt CORE GRADE INSTRUCTION,
intensity percentage, grain variants, contrast variants, image_size passthrough.
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.prompt_engine import build_phase3_dna_prompt, build_phase3_prompt


def test_dna_prompt_contains_json_instruction():
    prompt = build_phase3_dna_prompt()
    # 提示语句已在后续 commit 中调整，关键词 "RAW JSON ONLY" 标志结构化输出约束。
    assert "RAW JSON ONLY" in prompt or "Respond ONLY with valid JSON" in prompt


def test_dna_prompt_has_four_dimensions():
    prompt = build_phase3_dna_prompt()
    for dim in ("Color", "Lighting", "Texture", "Mood"):
        assert dim in prompt, f"Missing dimension: {dim}"


def test_dna_prompt_has_translation_schema():
    prompt = build_phase3_dna_prompt()
    assert '"translation"' in prompt
    assert '"tags"' in prompt


def test_phase3_prompt_core_grade_instruction():
    prompt = build_phase3_prompt("cinematic teal", 0.8, True, "Standard", "2K")
    assert "100% PRESERVE subject identity" in prompt
    assert "100% PRESERVE garment structure" in prompt
    # Phase3 是 color-grading-only：原 "ONLY modify color grading" 短语在 DaVinci 重写后
    # 演化为 "COLOR GRADING ONLY" 任务标题；语义等价。
    assert "COLOR GRADING ONLY" in prompt or "ONLY modify color grading" in prompt


def test_phase3_prompt_intensity_percentage():
    prompt = build_phase3_prompt("warm golden", 0.65, False, "Standard", "1K")
    # V5.XIII 后续 DaVinci 重写：原 "Intensity: 65% application" → "Grade intensity: 65%".
    assert "65%" in prompt and ("Grade intensity" in prompt or "Intensity" in prompt)


def test_phase3_prompt_grain_organic():
    prompt = build_phase3_prompt("kodak grain", 1.0, True, "Low", "2K")
    # 原 "organic film grain texture" 演化为 "organic 35mm film grain"。
    assert "organic" in prompt and "grain" in prompt


def test_phase3_prompt_grain_clean():
    prompt = build_phase3_prompt("clean editorial", 0.5, False, "High", "4K")
    assert "clean digital finish" in prompt


def test_phase3_prompt_image_size_passthrough():
    for size in ("1K", "2K", "4K"):
        prompt = build_phase3_prompt("test", 0.5, True, "Standard", size)
        # 原 "Target resolution" 演化为 "Target output resolution"。
        assert f"resolution: {size}" in prompt


def test_phase3_prompt_contrast_passthrough():
    for contrast in ("Low", "Standard", "High"):
        prompt = build_phase3_prompt("test", 0.5, True, contrast, "2K")
        # 原 "Contrast: Low" 演化为 "Contrast curve: Low"。
        assert f"Contrast curve: {contrast}" in prompt or f"Contrast: {contrast}" in prompt


def test_phase3_prompt_style_dna_included():
    dna = "cinematic teal-and-orange grading, anamorphic lens flare"
    prompt = build_phase3_prompt(dna, 0.8, True, "Standard", "2K")
    assert dna in prompt


if __name__ == "__main__":
    import unittest
    # Run via: python -m unittest tests.test_prompt_engine_phase3
    tests = [
        test_dna_prompt_contains_json_instruction,
        test_dna_prompt_has_four_dimensions,
        test_dna_prompt_has_translation_schema,
        test_phase3_prompt_core_grade_instruction,
        test_phase3_prompt_intensity_percentage,
        test_phase3_prompt_grain_organic,
        test_phase3_prompt_grain_clean,
        test_phase3_prompt_image_size_passthrough,
        test_phase3_prompt_contrast_passthrough,
        test_phase3_prompt_style_dna_included,
    ]
    for t in tests:
        t()
        print(f"  PASS: {t.__name__}")
    print(f"\n{len(tests)}/10 tests passed.")
