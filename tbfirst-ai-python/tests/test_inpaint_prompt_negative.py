"""Sprint V5.XVII Sprint A — Inpaint negative prompt 结构化拆分回归。

覆盖 build_inpaint_prompt 在新增 negative_prompt 入参下的行为：

1. negative_prompt 为 None / 空串 → prompt 输出与 V5.XVI 字节级一致（向后兼容）。
2. negative_prompt 非空 → FORBIDDEN VISUAL ELEMENTS 段出现且原文按行进入。
3. negative_prompt 多行 → 每行作为独立 bullet，空白行跳过。
"""

from app.services.prompt_engine import build_inpaint_prompt


def test_empty_negative_keeps_byte_compatible_prompt():
    baseline = build_inpaint_prompt("change the buttons", has_reference=False)

    # None / 空串 / 仅空白 → 三态都必须与 baseline 字节级一致
    assert build_inpaint_prompt("change the buttons", False, None) == baseline
    assert build_inpaint_prompt("change the buttons", False, "") == baseline
    assert build_inpaint_prompt("change the buttons", False, "   \n  \n") == baseline

    # FORBIDDEN 段不应出现
    assert "FORBIDDEN VISUAL ELEMENTS" not in baseline


def test_non_empty_negative_injects_forbidden_block():
    prompt = build_inpaint_prompt(
        "open mouth slightly",
        has_reference=False,
        negative_prompt="不要露出牙齿",
    )
    assert "FORBIDDEN VISUAL ELEMENTS" in prompt
    assert "HARD CONSTRAINT" in prompt
    assert "- 不要露出牙齿" in prompt

    # POSITIVE 与 NEGATIVE 共存，但 FORBIDDEN 必须出现在 INSTRUCTIONS 之后、OUTPUT 之前
    pos_instr = prompt.find("INSTRUCTIONS:")
    pos_forbidden = prompt.find("FORBIDDEN VISUAL ELEMENTS")
    pos_output = prompt.find("OUTPUT:")
    assert pos_instr < pos_forbidden < pos_output


def test_multiline_negative_expands_to_bullets_and_skips_blank_lines():
    prompt = build_inpaint_prompt(
        "neutral expression",
        has_reference=True,
        negative_prompt="不要张嘴\n\n不要露牙齿\n   \n不要笑出酒窝\n",
    )
    # 三条非空行全部进入 bullet
    assert "- 不要张嘴" in prompt
    assert "- 不要露牙齿" in prompt
    assert "- 不要笑出酒窝" in prompt
    # 空白行不应造成 "- " 空 bullet
    assert "- \n" not in prompt
