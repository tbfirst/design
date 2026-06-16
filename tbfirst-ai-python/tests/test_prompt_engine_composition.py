"""
V5.XI.14 — prompt_engine 最小单测（构图层级 + 动作 + variation）
"""
import pytest
from app.services.prompt_engine import (
    build_composition_line,
    build_action_line,
    build_variation_line,
    build_phase1_prompt,
    build_phase2_prompt,
)


# ---------------------------------------------------------------------------
# 1. overall → 完整主体约束
# ---------------------------------------------------------------------------
def test_composition_overall_full_subject():
    line = build_composition_line({"compositionScope": "overall"})
    # V5.XVIII 起 overall 文案为「Full body shot — head to toe … Show the entire subject」
    assert "full body" in line.lower() or "entire subject" in line.lower()


# ---------------------------------------------------------------------------
# 2. detail + 裤脚 → 裤脚/足部特写语义
# ---------------------------------------------------------------------------
def test_composition_detail_trouser_hem():
    line = build_composition_line({"compositionScope": "detail", "compositionTarget": "裤脚"})
    assert "close-up" in line.lower() or "detail" in line.lower()
    assert "裤脚" in line


# ---------------------------------------------------------------------------
# 3. macro + 走线 → 极近材质/工艺约束；不出现 collage/grid
# ---------------------------------------------------------------------------
def test_composition_macro_no_collage():
    line = build_composition_line({"compositionScope": "macro", "compositionTarget": "走线"})
    lower = line.lower()
    assert "macro" in lower or "extreme" in lower or "fill" in lower
    # macro scope must PROHIBIT collage/grid, not create it
    assert "do not create collage" in lower or "no collage" in lower
    assert "走线" in line


# ---------------------------------------------------------------------------
# 4. Phase2 动作组合：poseAction + gestureAction 同时进入 prompt
# ---------------------------------------------------------------------------
def test_action_pose_and_gesture_combined():
    settings = {
        "poseAction": "侧身站立",
        "gestureAction": "插兜",
        "customAction": "",
        "expression": "",
    }
    line = build_action_line("", settings)
    assert "侧身站立" in line
    assert "插兜" in line


# ---------------------------------------------------------------------------
# 5. 特写模式互斥：有 fabricDetail 时不输出人物动作约束
# ---------------------------------------------------------------------------
def test_action_suppressed_in_fabric_mode():
    settings = {
        "fabricDetail": "PURE_FABRIC_ASSET",
        "poseAction": "行走",
        "gestureAction": "插兜",
    }
    line = build_action_line("walk", settings)
    assert line == ""


# ---------------------------------------------------------------------------
# 6. 多图 variation：variationTotal=3 且 hint 不同时 prompt 含差异化提示
# ---------------------------------------------------------------------------
def test_variation_line_included_for_multi_image():
    hints = [
        "slight three-quarter camera variation",
        "subtle weight shift",
        "softer expression variation",
    ]
    lines = [
        build_variation_line({"variationTotal": 3, "variationHint": h, "variationIndex": i})
        for i, h in enumerate(hints)
    ]
    for i, (h, line) in enumerate(zip(hints, lines)):
        assert h in line, f"hint not in line[{i}]: {line!r}"
    # All three should differ
    assert len(set(lines)) == 3


# ---------------------------------------------------------------------------
# 7. 单图不污染：variationTotal=1 时 prompt 不含 variation line
# ---------------------------------------------------------------------------
def test_variation_line_empty_for_single_image():
    settings = {
        "variationTotal": 1,
        "variationHint": "slight three-quarter camera variation",
        "variationIndex": 0,
        "tone": "",
        "atmosphere": "",
        "remark": "",
    }
    prompt = build_phase1_prompt(settings)
    assert "VARIATION" not in prompt


# ---------------------------------------------------------------------------
# 8. V5.XII.3: detail + 鞋履 → 排除短语含 'Exclude knees, thighs'
# ---------------------------------------------------------------------------
def test_detail_shoes_excludes_knees():
    line = build_composition_line({"compositionScope": "detail", "compositionTarget": "鞋履"})
    assert "Exclude knees, thighs" in line


# ---------------------------------------------------------------------------
# 9. V5.XII.3: macro + 走线 → prompt 含 'NO human models'
# ---------------------------------------------------------------------------
def test_macro_excludes_humans():
    line = build_composition_line({"compositionScope": "macro", "compositionTarget": "走线"})
    assert "NO human models" in line


# ===========================================================================
# V5.XI-2.7: 构图行提到 prompt 最高优先级 + 强否定文案 + shotType 互斥
# ===========================================================================

# ---------------------------------------------------------------------------
# 10. Phase1 prompt 首段含 `CRITICAL COMPOSITION RULE` 前缀
# ---------------------------------------------------------------------------
def test_phase1_composition_at_top():
    settings = {
        "compositionScope": "detail",
        "compositionTarget": "鞋履",
        "tone": "", "atmosphere": "", "remark": "",
        "variationTotal": 1,
    }
    prompt = build_phase1_prompt(settings)
    assert "CRITICAL COMPOSITION RULE" in prompt
    crit_idx = prompt.index("CRITICAL COMPOSITION RULE")
    biometric_idx = prompt.index("BIOMETRIC IDENTITY LOCK")
    assert crit_idx < biometric_idx, (
        f"构图行应在 BIOMETRIC LOCK 之前 "
        f"(crit={crit_idx}, biometric={biometric_idx})"
    )


# ---------------------------------------------------------------------------
# 11. Phase2 prompt 首段含 `CRITICAL COMPOSITION RULE` 前缀
# ---------------------------------------------------------------------------
def test_phase2_composition_at_top():
    settings = {
        "compositionScope": "detail",
        "compositionTarget": "裤脚",
        "expression": "", "focus": "", "lighting": "", "remark": "",
        "variationTotal": 1,
    }
    prompt = build_phase2_prompt("walking", settings)
    assert "CRITICAL COMPOSITION RULE" in prompt
    crit_idx = prompt.index("CRITICAL COMPOSITION RULE")
    refinement_idx = prompt.index("Advanced refinement")
    assert crit_idx < refinement_idx, (
        f"构图行应在 Advanced refinement 之前 "
        f"(crit={crit_idx}, refinement={refinement_idx})"
    )


# ---------------------------------------------------------------------------
# 12. detail scope 文案含 `MUST NOT show full body` 强否定短语
# ---------------------------------------------------------------------------
def test_detail_must_not_full_body():
    line = build_composition_line({
        "compositionScope": "detail",
        "compositionTarget": "裤脚",
    })
    assert "MUST NOT show full body" in line


# ---------------------------------------------------------------------------
# 13. segment scope 文案含 `DO NOT extend framing` 强否定短语
# ---------------------------------------------------------------------------
def test_segment_no_distant_context():
    line = build_composition_line({
        "compositionScope": "segment",
        "compositionTarget": "上半身",
    })
    assert "DO NOT extend framing" in line


# ---------------------------------------------------------------------------
# 14. macro scope 文案含 `REJECT any composition that resembles a portrait`
# ---------------------------------------------------------------------------
def test_macro_reject_portrait():
    line = build_composition_line({
        "compositionScope": "macro",
        "compositionTarget": "走线",
    })
    assert "REJECT any composition that resembles a portrait" in line


# ---------------------------------------------------------------------------
# 15. 真实 compositionScope 覆盖 shotType：prompt 不出现旧字段兼容短语
# ---------------------------------------------------------------------------
def test_real_scope_overrides_shottype():
    settings = {
        "compositionScope": "detail",
        "compositionTarget": "裤脚",
        "shotType": "full body shot",
        "tone": "", "atmosphere": "", "remark": "",
        "variationTotal": 1,
    }
    prompt = build_phase1_prompt(settings)
    # 旧字段兼容路径会输出 "Use the composition: full body shot." —— 真实 scope 时该路径
    # 应被完全跳过；prompt 只能含强否定意义上的 "full body"（来自 _SCOPE_MAP['detail']）。
    assert "Use the composition:" not in prompt, (
        "真实 scope 时不应再走 shotType 兼容路径"
    )
    assert "CRITICAL COMPOSITION RULE" in prompt


# ===========================================================================
# V5.XI-3.2：撤销前端互斥后，构图 + 动作同时存在时 prompt 含 OVERRIDE RULE，
# 且 OVERRIDE 文案在 action 文案之前出现（先声明优先级，再给动作描述）。
# ===========================================================================

# ---------------------------------------------------------------------------
# 16. detail scope + poseAction 同时存在 → prompt 含 OVERRIDE RULE 显式声明
#     "构图规则与动作冲突时，构图优先"
# ---------------------------------------------------------------------------
def test_composition_override_action_in_prompt():
    settings = {
        "compositionScope": "detail",
        "compositionTarget": "鞋履",
        "poseAction": "侧身站立",
        "gestureAction": "插兜",
        "expression": "", "focus": "", "lighting": "", "remark": "",
        "variationTotal": 1,
    }
    prompt = build_phase2_prompt("walking", settings)
    assert "OVERRIDE RULE" in prompt
    assert "composition rule MUST WIN" in prompt
    override_idx = prompt.index("OVERRIDE RULE")
    action_idx = prompt.index("侧身站立")
    assert override_idx < action_idx, (
        f"OVERRIDE 应在 action_line 之前出现 "
        f"(override={override_idx}, action={action_idx})"
    )
