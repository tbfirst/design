"""Sprint V5.XVI.17 — 服装属性槽端到端 prompt 装配回归。

覆盖 build_garment_attrs_block + build_phase1/2/3_prompt 的拼装行为：

1. 空 garment_attrs → AUTHORITATIVE GARMENT SPEC **不出现**（向后兼容旧请求）。
2. 单条 garment_attrs（仅填 dominant_color）→ `Product Garment #1: Dominant color: ...` 出现。
3. 多条 garment_attrs 含 None → 跳过 None 项、索引按原数组位置保留（#1 / #3 而非 #1 / #2）。
4. garment_attrs 段位于 `GARMENT PRESERVATION` 之后。
"""

from app.services.prompt_engine import (
    build_garment_attrs_block,
    build_phase1_prompt,
    build_phase2_prompt,
    build_phase3_prompt,
    _normalize_garment_attrs,
)


_PHASE1_MIN = {
    "shotType": "",
    "tone": "",
    "atmosphere": "",
    "remark": "",
    "compositionScope": "overall",
    "compositionTarget": "",
}

_PHASE2_MIN = {
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


def test_empty_garment_attrs_keeps_legacy_prompt():
    spec = build_garment_attrs_block(None)
    assert spec == ""
    spec_empty_list = build_garment_attrs_block([])
    assert spec_empty_list == ""

    prompt = build_phase1_prompt(_PHASE1_MIN, garment_spec=spec)
    assert "AUTHORITATIVE GARMENT SPEC" not in prompt
    # GARMENT PRESERVATION 块仍存在 —— Sprint A 已注入
    assert "GARMENT PRESERVATION" in prompt


def test_single_dominant_color_emits_spec_line():
    raw = [{"dominantColor": "#B4252A"}]
    norm = _normalize_garment_attrs(raw)
    spec = build_garment_attrs_block(norm)
    assert "AUTHORITATIVE GARMENT SPEC" in spec
    assert "Product Garment #1: Dominant color: #B4252A." in spec


def test_none_items_preserve_original_index():
    raw = [{"dominant_color": "酒红"}, None, {"hardware": "亚光银金属扣"}]
    spec = build_garment_attrs_block(raw)
    assert "Product Garment #1" in spec
    # 第二项是 None，整体跳过，但索引继续走第三位
    assert "Product Garment #2" not in spec
    assert "Product Garment #3: Hardware: 亚光银金属扣." in spec


def test_garment_spec_appears_after_preservation_block_in_phase1():
    raw = [{"print": "几何条纹"}]
    norm = _normalize_garment_attrs(raw)
    spec = build_garment_attrs_block(norm)
    prompt = build_phase1_prompt(_PHASE1_MIN, garment_spec=spec)
    pos_block = prompt.find("GARMENT PRESERVATION")
    pos_spec = prompt.find("AUTHORITATIVE GARMENT SPEC")
    assert pos_block != -1 and pos_spec != -1
    assert pos_block < pos_spec, "AUTHORITATIVE GARMENT SPEC 必须位于 GARMENT PRESERVATION 之后"


def test_phase2_and_phase3_also_inject_garment_spec():
    raw = [{"stitching": "明线撞色"}]
    spec = build_garment_attrs_block(_normalize_garment_attrs(raw))

    p2 = build_phase2_prompt("Maintain original pose", _PHASE2_MIN, garment_spec=spec)
    assert "AUTHORITATIVE GARMENT SPEC" in p2
    assert "Stitching: 明线撞色" in p2

    p3 = build_phase3_prompt(
        style_dna="teal & orange",
        intensity=0.6,
        grain=False,
        contrast="Standard",
        image_size="2K",
        remark="",
        garment_spec=spec,
    )
    assert "AUTHORITATIVE GARMENT SPEC" in p3
    assert "Stitching: 明线撞色" in p3
