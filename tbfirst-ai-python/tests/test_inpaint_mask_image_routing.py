"""Sprint V5.XVII Sprint B — build_inpaint_prompt 双路径回归。

覆盖 `has_mask_image` 入参引入后的 4 个行为：

1. `has_mask_image=False`（默认 / 旧路径）→ prompt 输出与 V5.XVII Sprint A 末态字节级一致，
   保证旧客户端（不发 maskImage 字段）走单图 visual-prompting 路径不退化。
2. `has_mask_image=True` → 新模板使用 BINARY MASK / Image 2 / WHITE / BLACK 语义，
   且不再出现 RED TRANSLUCENT MASK 表述。
3. `has_mask_image=True` + `has_reference=True` → 参考图从 Image 2 重编号为 Image 3，
   且旧 "Image 2: The REFERENCE" 字面不复存在（避免误导 Gemini）。
4. `has_mask_image=True` + 非空 `negative_prompt` → FORBIDDEN VISUAL ELEMENTS 段
   与 BINARY MASK 段共存，且 FORBIDDEN 位于 OUTPUT 之前（与旧路径同位）。
"""

from app.services.prompt_engine import build_inpaint_prompt


def test_no_mask_image_keeps_legacy_prompt_byte_equal():
    legacy_default = build_inpaint_prompt("test", has_reference=False)
    legacy_explicit_false = build_inpaint_prompt(
        "test", has_reference=False, negative_prompt=None, has_mask_image=False
    )
    # 字节级一致 → V5.XVII Sprint A 末态向后兼容
    assert legacy_default == legacy_explicit_false
    # 旧路径用 RED MASK 描述
    assert "RED TRANSLUCENT MASK" in legacy_default
    # 旧路径不应包含新模板的 BINARY MASK 段
    assert "BINARY MASK" not in legacy_default


def test_mask_image_branch_uses_binary_mask_template():
    prompt = build_inpaint_prompt(
        "change buttons", has_reference=False, negative_prompt=None, has_mask_image=True
    )
    # 新模板必出现以下 4 个关键串
    assert "BINARY MASK" in prompt
    assert "Image 2" in prompt
    assert "WHITE pixels" in prompt
    assert "BLACK pixels" in prompt
    # 旧模板的 RED TRANSLUCENT MASK 在新路径里必须消失
    assert "RED TRANSLUCENT MASK" not in prompt
    # 用户 prompt 必出现在 INSTRUCTIONS 内
    assert "change buttons" in prompt


def test_mask_image_branch_with_reference_renumbers_to_image_3():
    prompt = build_inpaint_prompt(
        "x", has_reference=True, negative_prompt=None, has_mask_image=True
    )
    # 参考图必须重编号为 Image 3
    assert "Image 3" in prompt
    assert "REFERENCE" in prompt
    # 旧单图路径下 reference 是 "Image 2: The REFERENCE"，新路径下不应再出现
    assert "Image 2: The REFERENCE" not in prompt
    # mask 仍然是 Image 2
    assert "Image 2" in prompt
    assert "BINARY MASK" in prompt


def test_mask_image_branch_keeps_forbidden_block():
    prompt = build_inpaint_prompt(
        "x",
        has_reference=False,
        negative_prompt="不要张嘴\n不要露牙齿",
        has_mask_image=True,
    )
    # BINARY MASK 段与 FORBIDDEN 段共存
    assert "BINARY MASK" in prompt
    assert "FORBIDDEN VISUAL ELEMENTS" in prompt
    assert "- 不要张嘴" in prompt
    assert "- 不要露牙齿" in prompt

    # FORBIDDEN 段位于 OUTPUT 之前（与旧路径同位）
    pos_forbidden = prompt.find("FORBIDDEN VISUAL ELEMENTS")
    pos_output = prompt.find("OUTPUT:")
    assert pos_forbidden != -1 and pos_output != -1
    assert pos_forbidden < pos_output
