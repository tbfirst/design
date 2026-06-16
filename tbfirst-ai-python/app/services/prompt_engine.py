"""
Prompt Engine — 从 BrandGenius-AI TypeScript 移植的全部 prompt 构建逻辑。
源文件: services/phase0/index.ts, services/geminiService.ts,
        services/copilotService.ts, services/colorService.ts,
        features/SmartInpaint/InpaintService.ts
"""

import random
from typing import Any

# ---------------------------------------------------------------------------
# 模型常量已迁至 app/services/model_chain.py，通过 image_chain() / text_chain() /
# dna_chain() 访问；这里不再硬编码单一模型名，避免新加一个场景就多一处字符串。
# ---------------------------------------------------------------------------

# V5.XIX: 灵感无历史记录时，用三轴笛卡尔积随机组合强制注入探索方向。
# 三轴独立随机后拼接，组合空间远大于单一列表，让模型无法套用任何惯用句式。
# 每个 Phase 按本阶段创意焦点独立设计三轴，确保方向对齐。
# 词汇参考：Midjourney Styles & Keywords Reference (fashion/portrait/runway 章节)
#           + 真实时尚摄影术语库（摄影师风格 / 灯光技法 / 胶片型号 / 电影调色）
_INSPIRE_AXES: dict[int, dict[str, list[str]]] = {
    # Phase 0: Mood Board 起点 —— 摄影师风格 × 大片类型 × 年代情绪
    0: {
        "photographer_vibe": [
            "Steven Meisel 写实性感 Campaign 张力",
            "Tim Walker 奇幻叙事概念大片",
            "Helmut Newton 强对比权力感黑白",
            "Paolo Roversi 胶片朦胧长曝光诗意",
            "Nick Knight 数字超现实前卫",
            "Peter Lindbergh 自然纪实情感肖像",
            "Craig McDean 冷静现代极简银盐",
            "David Bailey 60s 摩登经典 Vogue 腔调",
            "Annie Leibovitz 叙事史诗肖像",
            "Patrick Demarchelier 优雅自然柔光商业",
            "Juergen Teller 粗粝日常反时尚感",
            "Alasdair McLellan 英式青春纪实感",
        ],
        "editorial_type": [
            "高定 Haute Couture 概念艺术大片",
            "街拍 Streetwear Lookbook 都市纪实",
            "品牌广告 Campaign 30米户外质感",
            "杂志封面 Magazine Cover 标志性构图",
            "秀场后台 Backstage 真实情绪抓拍",
            "品牌故事 Brand Film 视觉叙事感",
            "运动户外 Activewear 动态力量感",
            "Quiet Luxury 低调奢华生活方式大片",
        ],
        "era_mood": [
            "70s 超模全盛时代 Supermodel 胶片感",
            "90s 极简主义 Calvin Klein 去饰化",
            "2000s Y2K 金属数字未来感",
            "60s Twiggy 摩登几何波普艺术",
            "80s Dynasty 权力肩线戏剧张力",
            "当代 Gen Z 反叛 De-Construct 解构感",
        ],
    },

    # Phase 1: 场景 × 灯光技法 × 镜头构图
    1: {
        "location_scene": [
            "巴黎奥斯曼拱廊街石板路",
            "纽约 SOHO 铸铁建筑工业街区",
            "日本枯山水庭园侘寂留白",
            "摩洛哥利亚德蓝白几何墙面",
            "北欧极简白色室内落地窗",
            "米兰时装周秀场后台金属走廊",
            "都市天台城市天际线远景",
            "撒哈拉沙漠盐滩大地极简",
            "温室热带植物园密林氛围",
            "废弃工厂混凝土铁架工业感",
            "海边悬崖礁石大风天空感",
            "咖啡馆落地窗午后斜射光",
            "古典博物馆大理石廊柱",
            "日式公寓榻榻米障子窗光",
            "雨后街道积水倒影霓虹",
        ],
        "lighting_technique": [
            "Rembrandt Lighting 三角光颧骨立体",
            "Butterfly Lighting 蝴蝶光正面对称",
            "Split Lighting 分割侧光强阴阳对比",
            "Contre-Jour 逆光剪影轮廓光",
            "Large Softbox 大柔光箱均匀漫射",
            "Hard Direct Flash 硬光直闪强阴影",
            "Golden Hour 黄金时刻暖橙侧逆光",
            "Blue Hour 蓝调时刻城市冷调",
            "Window Light 窗边单侧柔和自然光",
            "High-Key Studio 多灯位亮白背景",
            "Low-Key Chiaroscuro 暗调明暗戏剧",
            "Rim Light 轮廓分离光发丝勾边",
            "Godrays 丁达尔光柱穿透感",
            "Strobe Freeze 闪光灯定格瞬间",
        ],
        "lens_composition": [
            "85mm 浅景深人像大光圈焦外虚化",
            "50mm 标准镜头自然透视感",
            "中画幅 Phase One 高质感立体",
            "35mm 广角含纳环境呼吸感",
            "长焦 Telephoto 空间压缩叠层",
            "俯拍 Overhead 几何平铺构图",
            "低角仰拍 Low Angle 气势张力",
            "Rule of Thirds 三分法大留白",
            "对称构图 Symmetry 建筑秩序感",
            "框中框 Frame-in-Frame 视觉层次",
        ],
    },

    # Phase 2: 动作 × 手势细节 × 表情眼神
    2: {
        "pose_style": [
            "Vogue 手部夸张肢体语言强张力",
            "Alexander McQueen 秀场力量步伐",
            "Candid Editorial 街头抓拍自然感",
            "Avant-Garde 前卫雕塑感肢体造型",
            "90s Supermodel 行走裙摆带风",
            "S-Curve 脊柱曲线三围力量感",
            "背影剪影展现廓形裁剪美感",
            "倚靠 Leaning Relaxed 慵懒随性",
            "Dynamic Leap 起跳抓拍运动瞬间",
            "Slow-Motion Freeze 凝固感静止",
            "Seated Floor 席地而坐随意感",
            "Over-the-Shoulder 侧身回眸半脸",
        ],
        "gesture_detail": [
            "Finger Fan 指尖舒展轻触面料质感",
            "Hand-to-Face 单手轻触脸颊侧颜",
            "双臂交叉胸前 Power Stance 力量",
            "Hair Toss 单手撩发律动感",
            "握持道具书本 / 眼镜 / 包袋营造叙事",
            "拇指插口袋休闲自信",
            "指尖掀起裙摆展示裙型廓形",
            "双手托腮若有所思低头感",
            "Wrist Flex 手腕弯折时尚手部特写",
            "摊手 Open Palm 坦然开放姿态",
        ],
        "expression_gaze": [
            "Direct Gaze 破镜凝视摄影师强张力",
            "侧颜低眸温柔内敛诗意",
            "闭眼享受当下沉浸冥想感",
            "Smize 冷峻专注眼神带微笑",
            "自信挑衅式眼神张扬",
            "惊喜轻笑情绪真实抓拍",
            "若有所思眼神涣散文艺感",
            "Seductive Half-Smile 性感微撇嘴角",
            "Stoic Stillness 肃穆静止无表情",
            "Mid-Laugh 大笑瞬间真实情绪",
        ],
    },

    # Phase 3: 胶片型号 × 电影调色参考 × 质感处理
    3: {
        "film_stock": [
            "Kodak Portra 400 暖肤自然有机粒感",
            "Fuji Velvia 50 高饱和翠绿鲜艳",
            "CineStill 800T 钨丝灯暗夜蓝调晕染",
            "Ilford HP5 400 黑白经典银盐粒感",
            "Kodak Ektachrome E100 冷调正片立体",
            "Expired 35mm Film 漏光褪色随机感",
            "Lomo LC-A 暗角高对比暗角玩具机",
            "Polaroid SX-70 拍立得温柔褪色感",
            "Fuji Provia 100F 中性细腻商业幻灯",
            "Kodak Gold 200 日光暖调颗粒感",
            "CineStill 50D 日光电影级高保真",
            "Agfa Ultra 100 鲜艳饱和记忆色",
        ],
        "cinematic_grade": [
            "银翼杀手 2049 橙蓝强对比暗调未来",
            "花样年华 王家卫 复古红绿暖调",
            "天使爱美丽 Jeunet 高饱和红绿互补",
            "布达佩斯大饭店 Anderson 马卡龙粉紫",
            "婚姻故事 去饱和现实主义灰调",
            "Teal & Orange 好莱坞商业标准",
            "Drive 粉霓虹暗调合成波 Synthwave",
            "Lost in Translation 东京冷蓝都市孤独",
            "Her 暖橙未来感柔软大气",
            "Call Me by Your Name 意大利夏日暖黄",
            "Portrait of a Lady on Fire 冷蓝海岸油画感",
            "Midsommar 高曝光北欧白昼漂白感",
        ],
        "texture_finish": [
            "35mm Film Grain 有机颗粒嵌入高光",
            "Halation 高光晕染漏光胶片感",
            "Anamorphic Flare 变形镜头横向眩光",
            "Vignette 暗角收边聚焦主体",
            "Matte Finish 哑光蒙版低饱和感",
            "Cinematic Haze 烟雾柔化空气感",
            "Split Toning 分色调高光暖 / 阴影冷",
            "Cross-Process 交叉冲洗偏色艺术感",
            "Chromatic Aberration 轻微色差边缘感",
        ],
    },
}


# ===========================================================================
# Human Realism Guardrail (Phase1/2/3 共用)
# ---------------------------------------------------------------------------
# 用于压制 AI 生图常见的"塑料感 / 蜡像感 / 对称克隆脸 / 呆滞表情"，提升真人感。
# 注入位点：Phase1（style/tone 段后）、Phase2（candid 段后）、Phase3（CORE GRADE 后）。
# ===========================================================================
REALISM_GUARDRAIL = """
[HUMAN REALISM GUARDRAIL]
- Render natural skin texture with visible pores, subtle imperfections, fine vellus hair, and authentic micro-shadows on the face.
- Preserve realistic skin specular highlights; avoid plastic, waxy, or over-smoothed appearance.
- Capture micro-expressions: relaxed jaw, natural eye catchlights, subtle facial asymmetry; avoid frozen / doll-like stares.
- Body proportions and weight distribution must follow real human anatomy; avoid uncanny valley artifacts.
- Negative: no AI gloss, no airbrushed look, no over-smoothed skin, no plastic doll features, no symmetric face cloning.
""".strip()


# ===========================================================================
# Garment Preservation (Phase1/2/3 共用) — Sprint V5.XVI.1
# ---------------------------------------------------------------------------
# 硬约束：将产品参考图视为权威规格，强制 1:1 保留版型/底色/印花/五金/走线。
# 注入位点（V5.XVI.2-4 接入）：Phase1（拆 realism/garment 双 strict 后注入）、
# Phase2（替换 "Maintain strict consistency of the product's design" 单句）、
# Phase3（紧接 CORE GRADE INSTRUCTION 块末尾追加）。
# ===========================================================================
GARMENT_PRESERVATION_BLOCK = """
GARMENT PRESERVATION (HARD CONSTRAINT — overrides any pose / lighting variation hint):
- Treat the product reference image as an AUTHORITATIVE SPEC, not a style inspiration.
- 1:1 preserve: silhouette, cut, length, fit, all visible seams and topstitching.
- 1:1 preserve: base color (albedo) of every garment panel — ambient lighting may add highlight/shadow but must not shift the underlying pigment.
- 1:1 preserve: prints, embroidery, logos, labels — including position, scale, orientation.
- 1:1 preserve: hardware (buttons, zippers, rivets, buckles) — count, material, finish.
- If any detail is uncertain from the reference image, DO NOT invent — render the most conservative interpretation that matches the visible pixels.
""".strip()


def _build_wide_format_block(aspect_ratio: str) -> str:
    """
    对宽幅比例（16:9 / 21:9）注入防拼接块。
    Gemini 在超宽比例时有两种已知失败模式：
      1. 把同一人物横向复制平铺（tiling）
      2. 把一张窄图切成多片再横向拼接回来（outpaint-stitch），产生可见接缝 / 色调断层
    21:9 的指令针对两种失败模式都做明确禁止，并给出"原生宽画幅"的正确语义。
    """
    if aspect_ratio not in ("16:9", "21:9"):
        return ""

    if aspect_ratio == "21:9":
        return (
            "\n[CRITICAL — NATIVE ULTRA-WIDE SINGLE FRAME 21:9]"
            "\nThis output MUST be a single, natively composed ultra-wide 21:9 image — "
            "as if captured in one shutter click on an ARRI Alexa with Panavision anamorphic glass."
            "\nSTRICTLY FORBIDDEN approaches:"
            "\n  • DO NOT stitch, seam, concatenate, or outpaint multiple image strips together."
            "\n  • DO NOT take a narrower crop and extend it by appending generated side panels."
            "\n  • DO NOT tile, duplicate, or mirror the subject horizontally."
            "\n  • DO NOT create a panorama, diptych, collage, split-panel, or multi-view grid."
            "\nVISUAL CONTINUITY REQUIREMENTS:"
            "\n  • Zero visible seams, join lines, tone boundaries, or color-cast discontinuities anywhere."
            "\n  • Consistent, unbroken lighting and perspective across the full 21:9 frame."
            "\n  • Single unified vanishing point / depth-of-field plane as produced by one physical lens."
            "\nFRAMING DIRECTIVE:"
            "\n  • The subject appears exactly ONCE, positioned within the frame."
            "\n  • Fill the extra horizontal space with genuine environmental depth — "
            "architecture, landscape, atmospheric haze, cinematic bokeh, or negative space — "
            "all rendered as a continuous organic scene, not copy-pasted extensions."
        )

    # 16:9
    return (
        "\n[SINGLE UNIFIED WIDE-FORMAT IMAGE — wide 16:9] "
        "Generate exactly ONE continuous wide-format image. "
        "DO NOT tile, repeat, duplicate, or mirror the subject side by side. "
        "DO NOT stitch or concatenate cropped strips — no visible seam lines. "
        "DO NOT create a diptych, collage, split-panel, or multi-view grid. "
        "The model and garment must appear exactly ONCE. "
        "The wider frame should be filled with extended background/environment — "
        "MORE scene to the left and right of the model, not multiple copies of the model."
    )


def build_garment_attrs_block(attrs_list: list[dict[str, Any] | None] | None) -> str:
    """Sprint V5.XVI.13：根据 phase_config.garment_attrs 生成 AUTHORITATIVE GARMENT SPEC 段。

    attrs_list 与 reference_images 中的 product 段按索引一一对应：
    - None 项跳过（但保留原索引展示给模型 —— Garment #1 / #3，而非 #1 / #2）
    - 全部为空 / 全 None / 缺省 → 返回空字符串，prompt 走纯参考图路径（旧行为）

    返回的段会被注入到 `GARMENT_PRESERVATION_BLOCK` 之后，作为对该次生图的具体规格。
    """
    if not attrs_list:
        return ""
    lines: list[str] = []
    for idx, attrs in enumerate(attrs_list):
        if not attrs:
            continue
        parts: list[str] = []
        if attrs.get("dominant_color"):
            parts.append(f"Dominant color: {attrs['dominant_color']}")
        if attrs.get("print"):
            parts.append(f"Print: {attrs['print']}")
        if attrs.get("hardware"):
            parts.append(f"Hardware: {attrs['hardware']}")
        if attrs.get("logo"):
            parts.append(f"Logo: {attrs['logo']}")
        if attrs.get("stitching"):
            parts.append(f"Stitching: {attrs['stitching']}")
        if parts:
            lines.append(f"  Product Garment #{idx + 1}: " + "; ".join(parts) + ".")
    if not lines:
        return ""
    return (
        "AUTHORITATIVE GARMENT SPEC (user-provided, overrides any ambiguity in reference images):\n"
        + "\n".join(lines)
    )


def _normalize_garment_attrs(raw: Any) -> list[dict[str, Any] | None] | None:
    """把前端来的 garmentAttrs（可能是 camelCase / snake_case / None）统一成 build_garment_attrs_block 期望的形态。"""
    if not raw or not isinstance(raw, list):
        return None
    out: list[dict[str, Any] | None] = []
    for item in raw:
        if not item or not isinstance(item, dict):
            out.append(None)
            continue
        norm: dict[str, Any] = {}
        # 接受 camelCase 别名
        if item.get("dominant_color") or item.get("dominantColor"):
            norm["dominant_color"] = item.get("dominant_color") or item.get("dominantColor")
        for k in ("print", "hardware", "logo", "stitching"):
            if item.get(k):
                norm[k] = item[k]
        out.append(norm if norm else None)
    return out


# ===========================================================================
# Phase 0: Visual DNA
# ===========================================================================

def build_phase0_dna_prompt(views: str = "Front View", extra_remark: str | None = None) -> str:
    """
    Phase 0 Step 1 — Visual DNA Extraction (结构分析)
    对应 phase0/index.ts analyzeGarmentStructure()
    """
    user_note = f"User Note: {extra_remark}." if extra_remark else ""
    return f"""
    Analyze the garment structure comprehensively using the provided views ({views}).
    Each reference image above this prompt is explicitly labeled in the form
    "[Reference Image: <ViewName>]" (e.g. Front View / Side View / Back View, or
    user-supplied labels such as "45° angle" / "Neckline detail" / "Fabric texture"
    / "Detail Reference #N"). When deriving structural traits, TRUST those labels
    as the authoritative description of what each image shows and fuse them into
    ONE coherent garment specification (do not treat angle shots as separate garments).
    Identify:
    1. Garment Type (e.g., Dress, Shirt, Pants).
    2. Cut & Silhouette (e.g., A-line, Slim fit).
    3. Neckline & Collar design.
    4. Sleeve design.
    5. Hemline & Side Structure: CRITICAL - Analyze the Side View (if available) specifically for side slits (vents), splits, rounded corners, or high-low hem designs.
    6. Fabric physical properties (Texture, weight).
    7. CRITICAL: Back design details (Closure type, specific cuts, bows, open back) if visible in Back View.
    8. If any "Detail Reference" / user-labelled close-up image is supplied, extract the specific feature it highlights (hardware, stitching, print, texture) and merge it into the overall DNA.
    {user_note}

    Ignore wrinkles, mannequin imperfections, and lighting issues. Output a precise structural remark in English.
    """


def build_phase0_asset_prompt(
    dna_remark: str,
    view: str,
    reference_context: str,
    settings: dict[str, Any],
) -> str:
    """
    Phase 0 Step 2 — Industrial Asset Reconstruction (资产重构)
    对应 phase0/index.ts generatePhase0Asset()
    """
    view_prompt_map = {
        "3D_FRONT": "Direct Front View, symmetrical composition.",
        "3D_SIDE": "45-degree Side View, showcasing silhouette depth.",
        "3D_BACK": "Direct Back View, focusing on rear details.",
    }

    smart_retouch = settings.get("smartRetouch", True)
    smart_retouch_prompt = (
        "High-end commercial retouching, smooth fabric texture, correct lighting imperfections, "
        "studio soft lighting. Remove mannequin/model, create Ghost Mannequin effect."
        if smart_retouch
        else "Ghost Mannequin effect."
    )

    negative_prompt = (
        "wrinkles, folds, messy, amateur photography, mannequin lines, noise, blur, "
        "distorted texture, bad lighting, human skin, human face, hands, watermark, text."
    )

    remark = settings.get("remark", "")

    return f"""
    Task: Generate a standardized 3D e-commerce asset.
    Target View: {view_prompt_map.get(view, "Front View")}
    Reference Context: {reference_context}
    Design DNA: {dna_remark}
    User Constraints: {remark}

    Style: High-end fashion photography, shot on Phase One IQ4, 150MP, photorealistic, commercial catalog style. Rich fabric texture, visible weave details, tactile material feel, natural fabric drape and slight folds. Soft diffuse lighting, subtle occlusion shadows.
    Background: Solid color background #E7E1D8.
    Retouching: {smart_retouch_prompt}

    CRITICAL INSTRUCTION:
    - IF input is Back View and Target is Back View: CLONE the design details exactly. Do not hallucinate front details on the back.
    - Adhere strictly to the cut lines and seam positions.
    - RECONSTRUCT SIDE DETAILS: If the DNA mentions side slits or rounded hems, ensure they are visible even in the back view (showing the split).

    Negative constraints: {negative_prompt}
    """


# ===========================================================================
# Composition helpers (Phase 1 Xi)
# ===========================================================================

_SCOPE_MAP: dict[str, str] = {
    "overall": (
        "Full body shot — head to toe. "
        "The complete figure including legs and feet MUST be visible in frame. "
        "DO NOT crop at the waist, hips, or knees. "
        "Avoid any partial body framing. Show the entire subject from head to feet."
    ),
    "half_or_region": (
        "Half-body or large region framing. Show either the upper body, lower body, "
        "or a large regional area clearly."
    ),
    "segment": (
        "Specific body segment or zone framing. Focus on a defined portion such as "
        "below the knee, shoulder-neck area, or mid-section. "
        "DO NOT extend framing to full body or distant context. "
        "Crop tightly around the named segment."
    ),
    "detail": (
        "Close-up detail shot. Frame ONLY the focus target and its immediate surroundings "
        "within ~15% margin. Shallow depth of field permitted. "
        "Strictly exclude wider body parts (knees, thighs, full torso, head if target is "
        "not on the head) and unrelated regions. "
        "MUST NOT show full body, head-to-toe framing, or unrelated body zones. "
        "STRICTLY single focus area."
    ),
    "macro": (
        "Extreme macro close-up. Fill the entire frame with material texture, weave, "
        "stitching, zipper, or hardware detail. Single unified image. "
        "DO NOT create collage, grid, multi-view layout, or multi-panel composition. "
        "NO human models, NO full garment view, NO recognisable body parts. "
        "REJECT any composition that resembles a portrait or full-product shot."
    ),
}


# V5.XII.3: 按聚焦对象给出具体排除短语，强化 detail / segment scope 的边界约束。
_TARGET_EXCLUSIONS: dict[str, str] = {
    "鞋履": "Exclude knees, thighs, full torso, and head. Frame from mid-shin downward focusing on footwear.",
    "裤脚": "Exclude knees, thighs, full torso, and head. Frame from mid-shin downward focusing on trouser hem.",
    "领口": "Exclude full torso below chest, lower body, and arms. Frame head, shoulders and neckline only.",
    "袖口": "Exclude torso, head, and lower body. Frame the wrist and sleeve cuff area only.",
    "口袋": "Exclude head, shoulders, and lower legs. Frame the waist and pocket area only.",
    "裙摆": "Exclude knees and above, head and torso. Frame from mid-thigh downward focusing on skirt hem.",
    "包袋": "Exclude head and lower legs. Frame the hand-and-bag area at hip or shoulder level.",
    "首饰": "Exclude full body and large garment areas. Frame fingers, neckline, or ear area where jewelry sits.",
    "手部": "Exclude head, torso, and lower body. Frame hands and forearms only.",
    "脸部": "Exclude shoulders and below, full body. Frame head only with shallow depth of field.",
}


def build_composition_line(settings: dict[str, Any]) -> str:
    """
    统一构图约束行。优先使用 compositionScope/compositionTarget；
    缺失时向后兼容旧 shotType / focus 字段。

    V5.XI-2.7：真实层级（非 inherit/非空）时输出整体包一层
    `[CRITICAL COMPOSITION RULE — MUST OBEY EXACTLY]` 前缀，并完全跳过
    shotType / focus 兼容回写，避免与构图约束冲突。
    """
    scope = settings.get("compositionScope", "")
    target = settings.get("compositionTarget", "")

    # 新字段路径
    if scope and scope not in ("", "inherit"):
        scope_text = _SCOPE_MAP.get(scope, f"Composition scope: {scope}.")
        # V5.XVIII: "overall" 是全身构图，不允许附加聚焦对象（如"上半身"），
        # 否则会产生"全身入镜 + 上半身聚焦"的自相矛盾，模型倾向于取后者生成半身图。
        if scope == "overall":
            target_text = ""
            exclusion_text = ""
        else:
            target_text = f" Focus target: {target}." if target else ""
            # V5.XII.3: detail / segment scope 下，按聚焦对象追加具体排除短语，强化边界约束。
            exclusion_text = ""
            if scope in ("detail", "segment") and target:
                phrase = _TARGET_EXCLUSIONS.get(target.strip())
                if phrase:
                    exclusion_text = f" {phrase}"
        return (
            "[CRITICAL COMPOSITION RULE — MUST OBEY EXACTLY] "
            + scope_text + target_text + exclusion_text
        )

    # 兼容旧字段（不包前缀；inherit/空时只是普通约束行）
    parts: list[str] = []
    shot_type = settings.get("shotType", "")
    focus = settings.get("focus", "")
    if shot_type:
        parts.append(f"Use the composition: {shot_type}.")
    if focus:
        parts.append(f"Camera focus: {focus}.")
    return " ".join(parts)


def build_variation_line(settings: dict[str, Any]) -> str:
    """
    多图差异化提示行。variationTotal <= 1 或无 hint → 返回空串。
    detail/macro/flatLay/fabric 模式下仅输出轻量视觉差异（角度/光线/景深/纹理），
    不输出会改变目标部位或动作的提示。
    """
    total = int(settings.get("variationTotal") or 0)
    hint = (settings.get("variationHint") or "").strip()
    if total <= 1 or not hint:
        return ""

    idx = int(settings.get("variationIndex") or 0)
    fabric_detail = settings.get("fabricDetail", "")
    flat_lay_detail = settings.get("flatLayDetail", "")
    scope = settings.get("compositionScope", "")
    is_restricted = (
        bool(flat_lay_detail)
        or bool(fabric_detail and "PURE_FABRIC_ASSET" in fabric_detail)
        or scope in ("detail", "macro")
    )

    base = (
        f"[VARIATION {idx + 1}/{total}] "
        "Do not duplicate the previous image exactly. "
        "Keep the subject identity, product design, garment details, composition target, "
        "and explicit action consistent with the brief. "
    )
    if is_restricted:
        return base + f"Introduce only a subtle visual variation: {hint}. Vary only light direction, camera micro-angle, depth-of-field, or texture rendering — do NOT change the target area or product structure."
    return base + f"Introduce only a subtle variation: {hint}. Do not change composition scope, pose, or garment."


def build_action_line(action: str, settings: dict[str, Any]) -> str:
    """
    统一动作约束行。新字段优先级：poseAction > gestureAction > customAction > 旧 action 参数。
    特写/平铺/面料模式下返回空串，避免与纯细节资产冲突。
    """
    fabric_detail = settings.get("fabricDetail", "")
    flat_lay_detail = settings.get("flatLayDetail", "")
    is_no_model_mode = bool(flat_lay_detail) or bool(fabric_detail and "PURE_FABRIC_ASSET" in fabric_detail)
    if is_no_model_mode:
        return ""

    pose = settings.get("poseAction", "") or ""
    gesture = settings.get("gestureAction", "") or ""
    custom = settings.get("customAction", "") or ""
    expression = settings.get("expression", "")

    # 旧字段兼容：无新 poseAction 时退到旧 action 参数
    resolved_pose = pose if pose and pose != "Maintain original pose" else action

    # Special sentinel: user uploaded a pose reference image → explicit override instruction.
    # The actual body pose comes from the image labeled "动作参考"; the text here is redundant
    # reinforcement so the model doesn't fall back to a default "candid" pose.
    if resolved_pose == "POSE_REF_IMAGE":
        return (
            "[MANDATORY POSE OVERRIDE] "
            "STRICTLY replicate the exact body posture shown in the image labeled '动作参考' "
            "(Action Pose Reference / Pose Reference). "
            "Match precisely: limb positions, arm angles, leg placement, torso lean, head tilt, "
            "and overall weight distribution — exactly as photographed in that reference image. "
            "DO NOT default to a relaxed/candid pose. DO NOT invent a natural pose. "
            "The pose reference image is authoritative and non-negotiable."
        )

    parts: list[str] = []
    if resolved_pose:
        parts.append(f"Pose: {resolved_pose}.")
    if gesture and gesture not in ("", "无额外手势"):
        parts.append(f"Gesture: {gesture}.")
    if custom:
        parts.append(f"Special action: {custom}.")
    if expression:
        parts.append(f"Expression: {expression}.")

    return " ".join(parts)


# ===========================================================================
# Phase 1: Context-aware Image Generation
# ===========================================================================

def build_phase1_prompt(settings: dict[str, Any], garment_spec: str = "") -> str:
    """
    Phase 1 — 情境生图 (BIOMETRIC IDENTITY LOCK + PRODUCT ISOLATION + SCENE)
    对应 geminiService.ts generateSinglePhase1Image()

    Sprint V5.XVI.14：可选 garment_spec 由 build_garment_attrs_block 产出，
    注入到 GARMENT_PRESERVATION_BLOCK 紧后方作为该次生图的具体规格；为空则旧行为。

    hasModelRef（phaseConfig 内，camel/snake 兼容）：
      True / 缺省  → 走 BIOMETRIC IDENTITY LOCK，从主模特参考图克隆面部
      False        → 走 FREE CASTING，没有主模特参考图时让 Gemini 自由选角，
                     并明确鼓励多变体之间挑不同年龄/族裔/体型，避免连续 N 张一张脸

    hasPoseRef（phaseConfig 内，camel/snake 兼容）：
      True  → 动作参考图为强制约束（MANDATORY），模型必须精确复制参考图的姿态
      False / 缺省 → 动作参考图为补充参考（SUPPLEMENTARY ONLY），有则参考
    """
    tone = settings.get("tone", "")
    atmosphere = settings.get("atmosphere", "")
    remark = settings.get("remark", "")
    garment_spec_block = ("\n" + garment_spec) if garment_spec else ""
    aspect_ratio = settings.get("aspectRatio") or settings.get("aspect_ratio", "")
    wide_format_block = _build_wide_format_block(aspect_ratio)

    composition_line = build_composition_line(settings)
    variation_line = build_variation_line(settings)
    tone_line = f"Tone: {tone}." if tone else ""
    atmosphere_line = f"Atmosphere: {atmosphere}." if atmosphere else ""

    # phaseConfig 里 hasModelRef / hasPoseRef 可能是驼峰或蛇形；缺省兼容老调用方。
    has_model_ref = settings.get("hasModelRef")
    if has_model_ref is None:
        has_model_ref = settings.get("has_model_ref", True)
    has_pose_ref = settings.get("hasPoseRef")
    if has_pose_ref is None:
        has_pose_ref = settings.get("has_pose_ref", False)

    if has_model_ref:
        identity_block = """[CRITICAL: BIOMETRIC IDENTITY LOCK]
    - Among the reference images above, ONE represents the main model identity. Its label may be in English
      ("Main Model Identity"), Chinese ("主模特"), or any user-customised string; trust the label text to
      identify which reference IS the model.
    - You MUST clone the facial structure, eye shape, nose bridge, and lip fullness from that main model reference.
    - DO NOT generate a random face. DO NOT blend features. The output face must look exactly like the person
      in that main model reference."""
    else:
        identity_block = """[FREE CASTING — no main-model reference supplied]
    - NONE of the reference images above is a main model identity. Do NOT treat any of them as a face to clone.
      The garment / accessory / scene references show only clothing, products and environment; ignore any
      humans visible in them.
    - You are free to invent a fresh model whose age, ethnicity, body type, hair and styling best showcase
      the main product within the requested scene and tone. Pick the most commercially appropriate casting.
    - When multiple variations of this same prompt are produced, DELIBERATELY VARY the casting across
      variations (different ethnicities, ages, body types, hair) so the batch shows a diverse range of
      believable wearers — never repeat the same face twice in a row."""

    # hasPoseRef=True → 动作参考图为强制约束；False/缺省 → 补充参考
    if has_pose_ref:
        pose_ref_block = """[POSE / ACTION REFERENCE — MANDATORY — pose reference image was explicitly uploaded]
    - The user has uploaded a dedicated pose reference image (labeled "动作参考" / "Action Pose Reference" / "Pose Reference").
    - MANDATORY: You MUST replicate the EXACT body posture shown in that reference image.
      Precisely match: limb positions, arm angles, leg placement, torso lean, head tilt, and overall weight distribution.
    - The presence of a pose reference does NOT change the primary task. You MUST STILL generate the model
      wearing the main product garment(s) from the Garment references — garment identity is NEVER overridden by the pose ref.
    - ABSOLUTELY DO NOT copy any clothing, outfit, fabric, or accessories from the pose reference image.
      ANY garment visible in the pose reference MUST be COMPLETELY IGNORED.
      The model's clothing MUST come exclusively from the Garment references.
    - Do NOT copy the face, hairstyle, skin tone, or personal identity from the pose reference.
      It is used ONLY as a skeleton/silhouette guide for body positioning.
    - Final output MUST combine: [garment from Garment references] + [exact body pose from pose reference].
    - DO NOT default to a relaxed/candid/standing pose. The pose reference is authoritative and non-negotiable."""
    else:
        pose_ref_block = """[POSE / ACTION REFERENCE — SUPPLEMENTARY ONLY — when present]
    - If any reference image is labeled "动作参考" / "Action Pose Reference" / "Pose Reference"
      or any similar pose-describing label, it is a SUPPLEMENTARY body posture guide ONLY.
    - CRITICAL: The presence of a pose reference does NOT change the primary task. You MUST STILL
      generate the model wearing the main product garment(s) and accessories from the Garment references.
      The garment references define what the model wears — the pose reference is completely irrelevant to clothing.
    - Study the BODY POSE ONLY from the pose reference: overall posture, limb positions, weight distribution,
      and approximate camera angle. Apply that body positioning to the generated model.
    - ABSOLUTELY DO NOT copy or replicate any clothing, outfit, fabric, or accessories visible in the
      pose reference image. ANY garment seen in the pose reference must be COMPLETELY IGNORED.
      The model's clothing MUST come exclusively from the Garment references.
    - Do NOT copy the face, hairstyle, skin tone, or any personal identity from the pose reference.
      It is used purely as a skeleton/silhouette guide for body positioning.
    - Final output MUST combine: [garment from Garment references] + [body pose from pose reference]."""

    # V5.XI-2.7：构图约束提到 prompt 最高优先级（第一段），覆盖所有后续构图相关表述。
    # wide_format_block 作为构图级硬约束也置于顶端，与 composition_line 并列。
    return f"""
    {composition_line}
    {wide_format_block}

    [TASK DEFINITION — READ BEFORE ANYTHING ELSE]
    This is a BRAND NEW IMAGE GENERATION task. You are NOT editing, retouching, or modifying
    any reference image. You are creating a fresh commercial photograph from scratch.
    - The model reference image (if provided) is a FACE/IDENTITY SOURCE ONLY. Extract the person's
      facial features and body type, then DISCARD any clothing visible in that image — it must NOT
      appear in the output. DO NOT treat the model reference as a base image to edit.
    - The product/garment reference images define what the generated model wears. The product MUST
      be clearly visible as the model's main outfit in the output. This is the PRIMARY OBJECTIVE.
    - If a pose reference image is provided, it is a BODY POSTURE GUIDE ONLY — copy the skeleton
      position, not any clothing, identity, or styling from it.
    - OUTPUT: A single new photograph of the identified person (or a freely cast model) WEARING the
      product garment, in the described scene, in the described pose. Nothing less.

    {identity_block}

    [PRODUCT ISOLATION]
    - The GARMENT references are the images whose labels mark them as the main product —
      either English "Main Product Garment #N" / Chinese "主产品 #N", or a user-written variant
      that clearly refers to the garment. When there are multiple such images, they are DIFFERENT
      angles or detail shots of the SAME main product: FUSE them into one consistent garment
      understanding (cut, fabric, design lines, trims).
    - The ACCESSORY references are the images labeled "Brand Accessory #N" / "品牌配饰 #N" / etc. Each
      labeled accessory is a DIFFERENT item — render them all as separate accessories on the model.
    - User-customised labels (e.g. "正面" / "背面" / "面料纹理" / "领口细节") attached to any garment
      or accessory reference should be taken as authoritative hints about the angle or detail shown.
    - For ALL garment / accessory references: IGNORE any human skin, faces, or body parts visible in
      them. Only extract fabric, cut, trim, and design details.
    - Do NOT fabricate extra garments or accessories beyond what the labeled references define.

    [SCENE COMPOSITION]
    - If a reference image is labeled as the background / scene (English "Background/Environment",
      Chinese "场景", or a user-written variant such as "室内" / "户外"), place the model into that environment.

    {pose_ref_block}

    [MANDATORY REQUIREMENTS]
    The model is wearing the main product's clothing and branding accessories.
    The product garment MUST be the dominant clothing item in the output — if it is not visibly present,
    the task has failed. Any outfit worn by the model in the model reference image is irrelevant and must
    not carry over into the output.
    {"Ensure strict character consistency (face, hair, body proportions) with the main model reference." if has_model_ref else "The invented model must look anatomically coherent within this single image — no swapped or merged faces, no extra limbs — but DO NOT carry the model identity across variations; each variation may cast a different person."}
    Apply REALISM_GUARDRAIL only to the model's skin, micro-expressions and anatomy — NOT to garment surfaces.
    Focus on hair texture, hyper-realistic hair texture, natural hair fiber.
    {GARMENT_PRESERVATION_BLOCK}{garment_spec_block}

    {tone_line}
    {atmosphere_line}
    Context: {remark}.
    High-fidelity commercial photography, 8k resolution.

    {REALISM_GUARDRAIL}
    {variation_line}
    """


# ===========================================================================
# Phase 2: Refinement & Variations
# ===========================================================================

def build_phase2_prompt(action: str, settings: dict[str, Any], garment_spec: str = "") -> str:
    """
    Phase 2 — 精修变体 (姿势/表情/焦点 + 平铺模式 + 面料微距)
    对应 geminiService.ts generateSinglePhase2Image()

    Sprint V5.XVI.16：可选 garment_spec 由 build_garment_attrs_block 产出，
    注入到 GARMENT_PRESERVATION_BLOCK 紧后方；空则旧行为。
    """
    garment_spec_block = ("\n" + garment_spec) if garment_spec else ""
    expression = settings.get("expression", "")
    focus = settings.get("focus", "")
    detail_focus = settings.get("detailFocus", "")
    fabric_detail = settings.get("fabricDetail", "")
    flat_lay_detail = settings.get("flatLayDetail", "")
    lighting = settings.get("lighting", "")
    remark = settings.get("remark", "")
    aspect_ratio = settings.get("aspectRatio") or settings.get("aspect_ratio", "")
    wide_format_block = _build_wide_format_block(aspect_ratio)

    is_flat_lay = bool(flat_lay_detail)
    is_fabric = bool(fabric_detail and "PURE_FABRIC_ASSET" in fabric_detail)

    negative_constraint = ""
    if is_flat_lay or is_fabric:
        negative_constraint = (
            "STRICT REQUIREMENT: NO HUMAN MODELS, NO HUMAN SKIN, NO HUMAN FACES, "
            "NO BODY PARTS, NO HUMAN HAIR. The output MUST be a single unified product "
            "asset image. DO NOT create any layout, grid, collage, or multi-view composition."
        )

    flat_lay_prompt = ""
    if is_flat_lay:
        flat_lay_prompt = (
            f"INDUSTRIAL ASSET PROTOCOL: {flat_lay_detail}. "
            "Solid neutral background, 90-degree top-down perspective, "
            "perfectly ironed garment, symmetrical e-commerce presentation."
        )

    # 动作行：平铺模式用 flat_lay_prompt，否则走 build_action_line（含 poseAction/gestureAction 新字段）
    action_line = flat_lay_prompt if is_flat_lay else build_action_line(action, settings)
    variation_line = build_variation_line(settings)

    # 构图行：平铺模式固定 top-down，面料微距模式强制 macro 构图，否则走 build_composition_line
    # V5.XVIII: is_fabric 时不能走 build_composition_line —— 若前端 compositionScope
    # 仍残留 'overall'，会产出"全身入镜 + NO HUMAN MODELS"的自相矛盾指令。
    if is_flat_lay:
        composition_line = "Industrial Top-Down framing."
    elif is_fabric:
        composition_line = (
            "Extreme macro close-up. "
            "Fill the entire frame with fabric texture, weave, or surface detail."
        )
    else:
        composition_line = build_composition_line(settings)
        if not composition_line and focus:
            composition_line = f"Camera focus: {focus}."

    # V5.XI-3.2：前端撤销构图 ↔ 动作互斥后，两者可能同时被设置；
    # 当 compositionScope 是真实层级（非 inherit/非空）且动作非空时，
    # 显式声明"构图优先于动作"，由模型在 prompt 内部冲突时按构图为准。
    scope = settings.get("compositionScope", "")
    is_real_scope = bool(scope) and scope not in ("", "inherit")
    if is_real_scope and action_line and action_line.strip():
        composition_line = (
            composition_line
            + " [OVERRIDE RULE: If the composition rule above conflicts with "
              "the action below, the composition rule MUST WIN. Composition "
              "constraints are binding.]"
        )

    detail_line = flat_lay_detail if is_flat_lay else f"{detail_focus} {fabric_detail or ''}".strip()
    is_pose_ref = (action == "POSE_REF_IMAGE")

    # When a user-uploaded pose reference image drives the pose, suppress the "candid/relaxed"
    # style instruction — it directly conflicts with replicating a specific body posture.
    if is_pose_ref or is_flat_lay or is_fabric:
        style_line = "Advanced refinement of a commercial fashion shot. Maintain photographic quality and commercial appeal."
    else:
        style_line = (
            "Advanced refinement of a commercial fashion shot. Style constraint: Candid lifestyle photography, "
            "captured in the moment. The model looks relaxed and authentic, with natural body weight distribution. "
            "Avoid stiff poses, avoid robotic expressions. High-end editorial aesthetic but with a snapshot feel."
        )

    # V5.XI-2.7：构图约束提到 prompt 最高优先级（第一段）。
    # wide_format_block 作为构图级硬约束也置于顶端，与 composition_line 并列。
    return f"""
    {composition_line}
    {wide_format_block}

    [CORE MISSION — POSE VARIATION ONLY]
    This is a POSE REFINEMENT task. The base reference image(s) define the scene, lighting,
    garment, and model identity. Your ONLY task is to change the body pose / action as instructed.
    Everything else — clothing, background, face, lighting — must remain IDENTICAL to the base reference.

    [GARMENT & SCENE LOCK — ABSOLUTE CONSTRAINT, overrides all other instructions]
    The model's outfit and environment are FROZEN from the base reference image. You must:
    - Preserve EXACTLY: every garment item (top, bottom, outerwear, shoes, accessories) —
      its color, cut, length, fabric texture, print, hardware, and fit.
    - Preserve EXACTLY: model face identity, skin tone, and hairstyle.
    - Preserve EXACTLY: background scene, environment props, and lighting atmosphere.
    DO NOT redesign, replace, recolor, or simplify any clothing element.
    DO NOT change the background or scene. These constraints are NON-NEGOTIABLE.

    {style_line}
    {REALISM_GUARDRAIL}
    {action_line}

    [POSE / ACTION REFERENCE — MANDATORY when labeled image is present]
    - If any reference image is labeled "动作参考" / "Action Pose Reference" / "Pose Reference"
      or any similar pose-describing label, it is a BINDING pose constraint.
    - MANDATORY: Replicate the EXACT body posture shown in that reference image —
      arm positions, leg placement, torso angle, head tilt, and weight distribution.
    - DO NOT substitute a "natural", "relaxed", or "candid" pose. The reference image is
      the authoritative pose template; follow it precisely.
    - Do NOT copy the face, clothing, skin tone, or identity from the pose reference image.
      Only extract the SKELETON / BODY POSITIONING — never the clothing or appearance.
    - The VISUAL POSE REFERENCE takes ABSOLUTE precedence over any text action instruction and
      over any style description (including "candid", "relaxed", or "natural" cues).

    Detail Emphasis: {detail_line}.
    Lighting Design: {lighting}.
    Additional Direction: {remark}.
    {GARMENT_PRESERVATION_BLOCK}{garment_spec_block}
    {negative_constraint}
    {variation_line}
    """


# ===========================================================================
# Phase 2 Color: Color Lab
# ===========================================================================

def build_color_prompt(settings: dict[str, Any], has_reference: bool) -> str:
    """
    Phase 2 Color — 颜色实验室 (HEX 换色 / 参考纹理映射)
    对应 colorService.ts generateColorVariantImage()
    """
    target_area = settings.get("targetArea", "garment")
    remark = settings.get("remark", "")

    if has_reference:
        return f"""
        Apply the texture and color from the Reference Image onto the '{target_area}' of the Original Image.
        Crucial: Do not change the shape, structure, or geometry of the Original Image at all.
        Just map the material surface and colors. Preserve everything else.
        Additional Info: {remark}.
        """
    else:
        target_color = settings.get("targetColor", "#000000")
        intensity = settings.get("intensity", 100)
        return f"""
        Professional Image Editing Task: Color Change.
        Target: Change the color of the {target_area} to {target_color} (Hex Code).
        Constraints:
        1. STRICTLY maintain the original texture, fabric details, shadows, and lighting of the garment.
        2. DO NOT change the model's skin tone, hair, or face.
        3. DO NOT change the background or other accessories.
        4. The output must look like a real photograph, not a flat fill.
        Additional Info: {remark}.
        Intensity: {intensity / 100}.
        """


# ===========================================================================
# SmartInpaint
# ===========================================================================

def _build_forbidden_block(negative_prompt: str | None) -> str:
    """
    V5.XVII.3：把用户填的"绝对禁止"原文按行拆成 FORBIDDEN VISUAL ELEMENTS 段。
    - None / 空串 / 仅空白 → 返回空字符串（prompt 与 V5.XVI 字节级一致）
    - 多行：按 \n 切分，剔空白行，每行作为一条 hard constraint
    """
    if not negative_prompt:
        return ""
    lines = [ln.strip() for ln in negative_prompt.splitlines() if ln.strip()]
    if not lines:
        return ""
    bullets = "\n    ".join(f"- {ln}" for ln in lines)
    return (
        "\n\n    FORBIDDEN VISUAL ELEMENTS (HARD CONSTRAINT — these must NOT appear in the result, "
        "overrides any conflicting positive description):\n    "
        f"{bullets}"
    )


def build_inpaint_prompt(
    user_prompt: str,
    has_reference: bool,
    negative_prompt: str | None = None,
    has_mask_image: bool = False,
) -> str:
    """
    SmartInpaint — 局部重绘 (Visual Prompting)
    对应 SmartInpaint/InpaintService.ts generateInpaintImage()

    V5.XVII.3：新增 negative_prompt 入参，结构化拆分 "绝对禁止" 指令。
    空 / 缺省时 prompt 与 V5.XVI 字节级一致（向后兼容）。
    V5.XVII.B.3：新增 has_mask_image 入参（默认 False = 走旧 RED MASK 单图路径，
    与 V5.XVII Sprint A 末态字节级一致）；True = 走新双图路径，Image 1 = 干净原图、
    Image 2 = 二值 mask、Image 3 = 参考（若 has_reference）。
    """
    forbidden_block = _build_forbidden_block(negative_prompt)

    if not has_mask_image:
        # 旧路径（V5.XVII Sprint A 末态）：字节级保留，向后兼容
        ref_input = "- Image 2: The REFERENCE details image." if has_reference else ""
        ref_instruction = (
            '3. CRITICAL: Transfer the visual details (texture, button style, fabric patterns, shape) '
            'from Image 2 (Reference) into the masked area of Image 1.'
            if has_reference
            else ""
        )
        return f"""
    SYSTEM TASK: Image Inpainting / Local Editing.

    INPUT ANALYSIS:
    - Image 1: The WORKSPACE image. It contains a RED TRANSLUCENT MASK overlays specific areas.
    {ref_input}

    INSTRUCTIONS:
    1. Focus EXCLUSIVELY on the area covered by the RED MASK in Image 1.
    2. Edit this masked area based on the user's request: "{user_prompt}".
    {ref_instruction}
    4. Seamlessly blend the edited area with the surrounding pixels.
    5. The final output must be CLEAN. DO NOT include the red mask in the result.
    6. Keep all non-masked areas PIXEL-PERFECTLY unchanged.{forbidden_block}

    OUTPUT: High-fidelity commercial photography.
    """

    # V5.XVII.B.3 新路径：双图（或三图 含 reference）。mask 是真二值，原图无红色叠加。
    ref_input = "- Image 3: The REFERENCE details image." if has_reference else ""
    ref_instruction = (
        '3. Transfer visual details (texture, button style, fabric patterns, shape) '
        'from Image 3 (Reference) into the WHITE region of Image 2.'
        if has_reference
        else ""
    )
    return f"""
    SYSTEM TASK: Image Inpainting / Local Editing (binary mask mode).

    INPUT ANALYSIS:
    - Image 1: The clean WORKSPACE image (no overlay, no mask painted on it).
    - Image 2: BINARY MASK aligned to Image 1. WHITE pixels mark the area you MUST redraw; BLACK pixels mark pixels you MUST NOT touch.
    {ref_input}

    INSTRUCTIONS:
    1. Read Image 2 as a binary mask: redraw ONLY where Image 2 is WHITE.
    2. Apply the user request: "{user_prompt}".
    {ref_instruction}
    4. The output dimensions MUST equal Image 1 dimensions.
    5. Pixels outside the WHITE region of Image 2 should match Image 1 as closely as possible — the frontend will composite mask-outside pixels from the original, so do not waste capacity on them.
    6. DO NOT output the mask. DO NOT output any red / colored overlay.{forbidden_block}

    OUTPUT: High-fidelity commercial photography.
    """


# ===========================================================================
# Copilot
# ===========================================================================

def build_copilot_system(context: dict[str, Any], enable_safety: bool = True) -> str:
    """
    AI Copilot 系统指令 — 优先级层次 + 环境清单 + 反重复清单 + 解剖学红线
    对应 copilotService.ts CopilotService.generateResponse()

    参数:
        context: 完整 Copilot 上下文（activePhase / brand / p1Settings / p2Settings
                 / _referenceImageCount 临时字段）
        enable_safety: False 时关闭【已知素材清单】与【解剖学红线】两段，作为
                       回滚开关（见 errorConclude #36）
    """
    active_phase = context.get("activePhase", 0)
    brand = context.get("brand", {})
    audience = brand.get("audience", "大众")
    tone = brand.get("tone", "专业")

    env_manifest = _serialize_context(context)

    # Phase 3 影调大师专用角色覆盖：从"电商导演"切换到"达芬奇调色师"
    if active_phase == 3:
        role_block = """
    # 角色设定（Phase 3 影调大师模式）
    你现在是一位资深 **DaVinci Resolve 调色师 / 影视后期色彩总监**。
    你不写场景编导 prompt，而是为 Phase 3 影调大师的"补充描述（P0 高优先级）"字段
    写一条**整体调色导演说明**——目的是把成片在不改服装本色的前提下，
    套上类似胶片冲洗 / LUT / Power Grade 的全局色彩风格。

    # 输出原则（极其重要）
    - 只谈"光"和"色彩转换"，不谈"重画"任何物体。
    - 严禁让模型"换衣服颜色"——服装、肤色、发色、配饰必须保持本色（inherent albedo）。
    - 可以谈：色温 / 白平衡 / 高光-阴影色偏（lift-gamma-gain）/ 全局 LUT / 曝光 / 对比 / 饱和 / 颗粒 / 光晕 / 氛围。
    - 把 Phase 3 的 UI 参数（影调浓度 / 对比度 / 颗粒感）当成已生效的硬约束，无需复述。
    - 视觉 DNA 标签（如 'teal & orange / vintage film / overcast'）是配色锚点，请围绕它写"如何把整张画面拉向这个 look"，而不是写"把衣服染成 teal"。
    """
    else:
        role_block = """
    # 角色设定
    你是一位资深电商导演、视觉专家和 Prompt Copilot。
    你的任务是协助用户为他们的产品生成极具商业感染力的营销提示词（Prompt）。
    """

    # V5.XVII.D：Phase 声明置顶，避免被埋在 system prompt 中部 + 被 chat 历史
    # 污染（用户从 Phase3 切到 Phase2 后历史还留着 Phase3 的对话）。
    phase_header = (
        f"# 【当前阶段：Phase {active_phase}】（本轮回复唯一适用阶段）\n"
        f"  - 不论历史消息里出现过哪个 Phase 的讨论，本轮所有建议、prompt 输出、"
        f"措辞都必须严格站在 Phase {active_phase} 的视角。\n"
        f"  - 如果用户上一轮在别的 Phase 提过的偏好与本 Phase 冲突，本 Phase 的 UI 约束优先。\n"
    )

    base = f"""
    {phase_header}
    {role_block}

    # 指令优先级体系 (CRITICAL)
    1. P0 (最高优先级): 用户对话修正。用户在聊天框输入的最新指令是最高准则，必须优先执行并覆盖之前的冲突项。
    2. P1 (高优先级): UI 面板约束。用户在界面选择的配置（如景别、色调；Phase3 的影调浓度 / 对比度 / 颗粒感 / DNA）是硬性边界。
    3. P2 (基础优先级): 资产 DNA 与品牌基因。基于已上传资产的物理特征进行补位，严禁重复描述已知外观。

    # 智能补位与导演逻辑
    - 资产联动: 识别当前上传的资产类型。在输出 Prompt 时，直接基于资产类型生成场景编导指令，严禁重复输出已知的物理外观特征（如：如果已知是红色裙子，不要在 Prompt 中写 "a red dress"）。
    - 缺失项智能补位: 识别 UI 配置中选了 "自定义/无" 或空白的维度，并在这些维度上进行深度视觉创作（光影、空间感、氛围）。
    - 约束深化: 围绕 P1 的配置项（如"全景"或 Phase3 的"DNA + 浓度 + 对比度"）深化空间感描述、光影表现或氛围铺垫，使 Prompt 更具专业摄影感。

    # 当前工作台全状态感知 (ENVIRONMENT_MANIFEST)
    - 当前阶段: Phase {active_phase}
    - 品牌背景: {audience} | {tone}
    - 界面约束 (P1):
      {env_manifest}
    """

    if enable_safety:
        asset_manifest = _build_known_asset_manifest(context)
        base += f"""
    # 【已知素材清单 — 严禁复述】(DEDUP_GUARD)
    下列信息已经以参考图或 UI 选项形式交给下游图片生成模型，你在输出 Prompt 时**严禁再次复述或换一种说法写这些内容**，否则图片模型会把这些特征权重加倍，导致过饱和、变形或与界面选项冲突：
    {asset_manifest}

    # 【人体解剖学安全红线 — ANATOMY_GUARD】
    只要 Prompt 涉及人物、真实或拟真人体（模特、用户、消费者场景等），必须在 Prompt 末尾追加下列通用解剖学约束短语（英文、逗号分隔，避免中英混杂被 tokenizer 截断）：
    `anatomically correct, 5 fingers per hand, natural joint articulation, balanced body proportions, no extra or missing limbs, symmetrical facial features, realistic weight distribution, pose must be physically plausible, no impossible contortions`
    若 Prompt 纯粹是产品/静物/平铺摄影且 P1/P2 设置均未涉及人体，可省略本段。
    """

    base += """
    # 交互规范
    1. 始终保持品牌调性一致。
    2. 如果用户指令 (P0) 与 UI 约束 (P1) 冲突，请在回复中明确告知："已根据您的指令将 [原配置] 修正为 [新指令]"，并在输出 Prompt 时执行 P0。
    3. 你的回复应简洁专业，并在最后提供一个清晰的提示词文本块（使用 Markdown 代码块）。
    4. 严禁长篇大论，直接切入视觉导演建议。
    """
    return base


def build_copilot_inspire(context: dict[str, Any]) -> str:
    """
    灵感按钮 system instruction —— 无用户输入，根据当前界面素材/选项/品牌
    上下文随机给出一条简短 prompt 灵感。

    输出契约:
        - ≤60 字中文
        - 不带任何解释 / Markdown / 前缀（纯 prompt 本文）
        - 每次生成应尽量不同（temperature 由 route 侧调高）
    """
    active_phase = context.get("activePhase", 0)
    brand = context.get("brand", {})
    audience = brand.get("audience") or "大众"
    tone = brand.get("tone") or "专业"
    env_manifest = _serialize_context(context)
    asset_manifest = _build_known_asset_manifest(context)

    # V5.XVII.C: 把最近 N 条灵感塞进 system prompt，让模型显式回避重复
    # V5.XVIII: 无历史时注入随机探索方向，防止首次/新会话落在相同默认套路
    recent = context.get("_recentInspirations") or []
    _phase_key = int(active_phase) if active_phase is not None else 0
    if isinstance(recent, list) and recent:
        recent_lines = "\n      ".join(f"- {str(r).strip()}" for r in recent[-20:] if str(r).strip())
        recent_block = (
            "\n    # 最近已生成灵感（必须显著不同 — 不同场景 / 不同光线 / 不同动作 / 不同关键词）\n"
            f"      {recent_lines}\n"
        )
    else:
        # V5.XIX: 三轴独立随机，笛卡尔积组合，防止模型复用任何单一惯用句式
        phase_axes = _INSPIRE_AXES.get(_phase_key, _INSPIRE_AXES[0])
        axis_picks = [random.choice(opts) for opts in phase_axes.values()]
        seed_combined = " ✕ ".join(axis_picks)
        recent_block = (
            f"\n    # 本次创意三轴探索方向（随机强制指定，必须同时融合全部三个维度）\n"
            f"      {seed_combined}\n"
            f"      （禁止只满足其中一个维度，≤60字内必须让三个维度都有所体现）\n"
        )

    ref_count = int(context.get("_referenceImageCount", 0) or 0)
    ref_roles = context.get("_referenceImageRoles") or []
    if not isinstance(ref_roles, list):
        ref_roles = []

    # V5.XVII.D：基于 roles 给每张图打位置标签，让模型在识别"主商品"时
    # 不会把模特参考图误当主商品。
    if ref_count > 0 and ref_roles:
        role_label_cn = {
            "product": "产品图（本次主商品 / 主服装本体，灵感识别就基于它）",
            "model": "模特参考图（仅作姿态 / 身材 / 肤色参考，不是主商品）",
            "inspiration": "Phase3 灵感参考图（DNA 提取用，不是主商品）",
        }
        role_lines: list[str] = []
        for i in range(ref_count):
            role = ref_roles[i] if i < len(ref_roles) else "unknown"
            label = role_label_cn.get(role, "未知用途参考图")
            role_lines.append(f"       - 第{i + 1}张：{label}")
        roles_block = "    本次共上传 {n} 张参考图，按 inline_data 顺序对应：\n{lines}\n".format(
            n=ref_count, lines="\n".join(role_lines),
        )
    else:
        roles_block = ""

    image_anchor = (
        f"\n    # 参考图视觉识别（必须先完成识别，再生成灵感）\n"
        f"    用户当前工作台已上传 {ref_count} 张参考图，已作为 inline_data 直接喂给你。\n"
        f"{roles_block}"
        "    【第一步：主产品识别】聚焦所有【产品图】，识别并记住：\n"
        "    - 服装品类（亚麻衬衫 / 针织毛衫 / 真丝连衣裙 / 牛仔外套 / 棉麻长裤 / 风衣 / 卫衣 / 西装等）\n"
        "    - 面料质感（亚麻 / 羊毛 / 棉 / 真丝 / 牛仔 / 皮革 / 针织 / 雪纺 / 网纱等）\n"
        "    - 廓形版型（oversize / 修身 / A字 / 阔腿 / 落肩 / 直筒等）\n"
        "    - 主色调（米白 / 深蓝 / 黑色 / 驼色等）\n"
        "\n"
        "    【第二步：模特参考识别】若有【模特参考图】，识别并记住模特所穿衣物，\n"
        "    目的是区分「参考服装」与「主产品」，避免混淆：\n"
        "    - 模特参考图中的衣物仅作姿态/廓形参考，其服装不是本次主产品\n"
        "    - 若参考模特穿蓝色连衣裙，但主产品是白色衬衫，灵感必须围绕白色衬衫展开\n"
        "\n"
        "    【识别约束】灵感的场景/光影/动作必须与主产品的面料调性相符。\n"
        "    严禁凭空臆造品类 —— 图中是亚麻衬衫就不能写针织衫；图中是连衣裙就不能写西装。\n"
    ) if ref_count > 0 else ""

    # V5.XIX: 按 active_phase 给不同的创意聚焦方向 + 专业摄影词汇引导，
    # 让模型产出真正的业内术语而非泛泛电商描述。
    phase_focus_map = {
        0: (
            "Phase 0（起点）—— 给出整体 Mood Board 方向：摄影师风格 + 大片类型 + 年代情绪，"
            "一句话作为 Phase1/2/3 的种子。"
            "可引用：摄影师（Steven Meisel / Tim Walker / Paolo Roversi / Peter Lindbergh）、"
            "大片类型（Couture 概念片 / Streetwear Lookbook / Campaign 广告片）、"
            "年代氛围（90s 极简 / 70s 胶片感 / Quiet Luxury）。"
        ),
        1: (
            "Phase 1（场景 / 构图 / 光影）—— 聚焦【拍摄地点 + 灯光技法 + 镜头构图】。"
            "地点例：巴黎奥斯曼拱廊 / SOHO 工业街区 / 枯山水庭园 / 摩洛哥蓝白墙 / 都市天台。"
            "灯光技法例：Rembrandt Lighting / Butterfly Light / Contre-Jour 逆光剪影 / "
            "Hard Direct Flash / Golden Hour 黄金时刻 / Godrays 丁达尔光柱。"
            "镜头例：85mm 浅景深 / 中画幅 Phase One / 长焦压缩空间 / 仰拍气势感。"
            "不要写动作细节或后期调色。"
        ),
        2: (
            "Phase 2（模特动作 / 表情 / 手势）—— 聚焦【肢体姿态 + 手部细节 + 眼神情绪】。"
            "动作例：Alexander McQueen 秀场步伐 / Vogue 手部夸张 / S-Curve 脊柱力量 / "
            "Dynamic Leap 起跳抓拍 / Over-the-Shoulder 侧身回眸 / Candid Editorial 街头抓拍。"
            "手势例：Finger Fan 指尖触面料 / Hair Toss 撩发律动 / Hand-to-Face 触颊侧颜。"
            "眼神例：Direct Gaze 破镜凝视 / Smize 冷峻带笑 / Stoic Stillness 肃穆无表情。"
            "场景仅一句带过，核心在动作与情绪。"
        ),
        3: (
            "Phase 3（影调 / 胶片质感 / 电影调色）—— 聚焦【光的色温 + 胶片型号 + 电影参考】。"
            "胶片例：Kodak Portra 400 暖肤 / CineStill 800T 暗夜蓝 / Ilford HP5 黑白粒感 / "
            "Fuji Velvia 高饱和 / Expired 35mm 漏光随机感。"
            "电影参考例：银翼杀手 2049 橙蓝 / 花样年华复古红绿 / Teal & Orange 商业标准 / "
            "Lost in Translation 东京冷蓝 / Midsommar 北欧漂白感。"
            "质感例：Halation 晕染 / Anamorphic Flare 横向眩光 / Vignette 暗角 / Cross-Process 偏色。"
            "服装本色绝对不改，只描述【光的色彩偏移】，不描述【漆衣服颜色】。"
        ),
    }
    phase_focus_text = phase_focus_map.get(int(active_phase) if active_phase is not None else 0, phase_focus_map[0])
    phase_focus_block = (
        f"\n    # 当前阶段创意聚焦（必须严格遵守）\n"
        f"    {phase_focus_text}\n"
    )

    # V5.XVII.D：Phase 声明置顶 —— 与 build_copilot_system 对齐，
    # 让模型不会被 chat 历史里其它 Phase 的语境拉走。
    phase_header = (
        f"    # 【当前阶段：Phase {active_phase}】(本次灵感唯一适用阶段)\n"
        f"    本次输出必须严格站在 Phase {active_phase} 的视角；如果"
        f"【当前阶段创意聚焦】里同时列出过其它 Phase 的描述，仅"
        f"Phase {active_phase} 那一段生效。\n"
    )

    return f"""
{phase_header}
    # 角色
    你是一位顶级时尚杂志的视觉创意总监，熟悉 Vogue / W / AnOther Magazine 的 Prompt 写作风格，
    擅长把摄影师风格、灯光技法、胶片型号等专业词汇融入一句话灵感。
{image_anchor}{phase_focus_block}
    # 当前工作台
    - 阶段: Phase {active_phase}
    - 品牌: {audience} | {tone}
    - 界面约束:
      {env_manifest}

    # 已知素材（严禁复述外观，可用"图中商品 / the garment"等指代）
    {asset_manifest}
{recent_block}
    # 输出契约（非常严格）
    - 仅输出一条 ≤80 字的中文 Prompt 灵感（中英混排允许，但主体中文）
    - 优先使用专业摄影术语（灯光技法 / 胶片型号 / 摄影师风格 / 电影调色参考）而非泛泛描述
    - 不要任何解释、前缀、Markdown、代码块、编号、引号
    - 灵感方向必须与上方【当前阶段创意聚焦】完全对齐（不要混入其它 Phase 的视角）
    - 灵感主体必须与【产品图】真实品类一致（不能用模特参考图里的服装替代主产品）
    - 与"最近已生成灵感"显著不同（换场景 / 换光线 / 换动作 / 换词汇风格）
    - 若涉及人物，追加英文解剖学短语：`anatomically correct, 5 fingers per hand, natural pose`
    """


def _build_known_asset_manifest(context: dict[str, Any]) -> str:
    """
    汇总用户已经显式提供给下游模型的信息（品牌 DNA + UI 选项 + 参考图数量），
    让 Copilot 知道"这些别再复述了"。
    """
    lines: list[str] = []
    brand = context.get("brand", {}) or {}
    if brand.get("url"):
        lines.append(f"- 品牌参考链接：{brand['url']}")
    if brand.get("audience"):
        lines.append(f"- 目标受众（已由品牌 DNA 注入）：{brand['audience']}")
    if brand.get("tone"):
        lines.append(f"- 品牌调性：{brand['tone']}")
    desc = brand.get("description") or ""
    if desc:
        # 超长品牌视觉描述做截断，避免挤占有限 context 预算
        truncated = desc if len(desc) <= 200 else desc[:200] + f"…(省略 {len(desc) - 200} 字)"
        lines.append(f"- 品牌视觉描述：{truncated}")

    p1 = context.get("p1Settings", {}) or {}
    p2 = context.get("p2Settings", {}) or {}
    p3 = context.get("p3Settings", {}) or {}
    if p1.get("shotType"):
        lines.append(f"- 景别（P1 已选）：{p1['shotType']}")
    p1_scope = p1.get("compositionScope", "")
    if p1_scope and p1_scope != "inherit":
        p1_target = p1.get("compositionTarget", "") if p1_scope != "overall" else ""
        lines.append(f"- 构图层级（P1 已选）：{p1_scope}" + (f" / {p1_target}" if p1_target else ""))
    if p1.get("tone"):
        lines.append(f"- 色调（P1 已选）：{p1['tone']}")
    if p1.get("atmosphere"):
        lines.append(f"- 氛围（P1 已选）：{p1['atmosphere']}")
    pose = p2.get("poseAction", "")
    if pose and pose != "Maintain original pose":
        lines.append(f"- 整体动作（P2 已选）：{pose}")
    gesture = p2.get("gestureAction", "")
    if gesture and gesture not in ("", "无额外手势"):
        lines.append(f"- 局部手势（P2 已选）：{gesture}")
    if p2.get("customAction"):
        lines.append(f"- 特殊动作（P2 已选）：{p2['customAction']}")
    p2_scope = p2.get("compositionScope", "")
    if p2_scope and p2_scope != "inherit":
        p2_target = p2.get("compositionTarget", "") if p2_scope != "overall" else ""
        lines.append(f"- 构图层级（P2 已选）：{p2_scope}" + (f" / {p2_target}" if p2_target else ""))
    else:
        actions = p2.get("actions") or []
        if isinstance(actions, list) and actions:
            lines.append(f"- 动作（P2 已选）：{', '.join(actions)}")
    if p2.get("expression"):
        lines.append(f"- 表情（P2 已选）：{p2['expression']}")
    if p2.get("focus"):
        lines.append(f"- 聚焦部位（P2 已选）：{p2['focus']}")

    # Phase 3 影调大师：把 DNA 标签 + 控制面板硬约束塞进 manifest
    if p3:
        style_dna = (p3.get("styleDNA") or "").strip()
        if style_dna:
            short_dna = style_dna if len(style_dna) <= 160 else style_dna[:160] + "…"
            lines.append(f"- 视觉 DNA 标签（P3 已提取，Gemini 已看到灵感图）：{short_dna}")
        dna_t = p3.get("dnaTranslation") or {}
        if isinstance(dna_t, dict):
            for k, label in (("color", "色彩"), ("lighting", "光影"), ("texture", "质感"), ("mood", "影调")):
                v = (dna_t.get(k) or "").strip()
                if v:
                    lines.append(f"- {label}笔记（P3 DNA）：{v}")
        if p3.get("intensity") is not None:
            try:
                pct = round(float(p3.get("intensity") or 0) * 100)
                lines.append(f"- 影调浓度（P3 控制面板）：{pct}%")
            except (TypeError, ValueError):
                pass
        if p3.get("contrast"):
            lines.append(f"- 对比度（P3 控制面板）：{p3['contrast']}")
        if p3.get("grain") is True:
            lines.append("- 颗粒感：开启（P3 控制面板）")
        if p3.get("imageSize"):
            lines.append(f"- 画质（P3 控制面板）：{p3['imageSize']}")
        p3_remark = (p3.get("remark") or "").strip()
        if p3_remark:
            short_remark = p3_remark if len(p3_remark) <= 200 else p3_remark[:200] + "…"
            lines.append(f"- 补充描述 P0（P3 控制面板，最高优先级，覆盖 DNA 默认倾向）：{short_remark}")

    ref_count = int(context.get("_referenceImageCount", 0) or 0)
    if ref_count > 0:
        lines.append(
            f"- 参考图片 {ref_count} 张（图片模型已直接看到，"
            "你只需用 'the reference model / the garment in the image' "
            "之类的指代词，不要用文字复述外观）"
        )

    if not lines:
        return "（用户尚未选择任何硬约束项，你可以自由发挥）"
    return "\n    ".join(lines)


def build_brand_analyze() -> str:
    """
    品牌 URL 分析系统指令
    对应 copilotService.ts CopilotService.analyzeBrand()
    """
    return """
    你是一位资深品牌分析专家。
    请访问并分析提供的 URL 内容。
    提取该品牌的：
    1. 目标受众 (audience): 描述该品牌的核心客户群。
    2. 品牌调性 (tone): 提取 3-5 个描述品牌性格的关键词。
    3. 品牌视觉描述 (remark): 总结该品牌的视觉风格、色彩偏好及核心设计理念。

    请严格以 JSON 格式返回结果。
    """


def _serialize_context(context: dict[str, Any]) -> str:
    """根据 activePhase 格式化 UI 状态"""
    phase = context.get("activePhase", 0)
    p1 = context.get("p1Settings", {})
    p2 = context.get("p2Settings", {})
    p3 = context.get("p3Settings", {}) or {}

    if phase == 0:
        return f"""
        - 任务: {p1.get('remark', '资产生成')}
        - 比例: {p1.get('aspectRatio', '3:4')}
        """
    elif phase == 1:
        p1_scope = p1.get("compositionScope", "")
        p1_target = p1.get("compositionTarget", "") if p1_scope != "overall" else ""
        composition_hint = f"{p1_scope}/{p1_target}" if p1_target else (p1_scope or "inherit")
        return f"""
        - 景别: {p1.get('shotType', '')}
        - 构图层级: {composition_hint}
        - 色调: {p1.get('tone', '')}
        - 氛围: {p1.get('atmosphere', '')}
        - 描述: {p1.get('remark', '无')}
        """
    elif phase == 2:
        actions = p2.get("actions", [])
        actions_str = ", ".join(actions) if isinstance(actions, list) else str(actions)
        pose = p2.get("poseAction", "") or actions_str or "默认"
        gesture = p2.get("gestureAction", "") or ""
        custom = p2.get("customAction", "") or ""
        p2_scope = p2.get("compositionScope", "")
        p2_target = p2.get("compositionTarget", "") if p2_scope != "overall" else ""
        composition_hint = f"{p2_scope}/{p2_target}" if p2_target else (p2_scope or "inherit")
        return f"""
        - 整体动作: {pose}
        - 局部手势: {gesture or '无'}
        - 特殊动作: {custom or '无'}
        - 构图层级: {composition_hint}
        - 表情: {p2.get('expression', '')}
        - 焦点: {p2.get('focus', '')}
        - 细节: {p2.get('detailFocus', '无')}
        - 描述: {p2.get('remark', '无')}
        """
    elif phase == 3:
        try:
            intensity_pct = round(float(p3.get("intensity") or 0) * 100)
        except (TypeError, ValueError):
            intensity_pct = 0
        dna_tags = (p3.get("styleDNA") or "").strip() or "（尚未提取，请先在视觉DNA提取模块上传灵感图并点击提取）"
        if len(dna_tags) > 120:
            dna_tags = dna_tags[:120] + "…"
        return f"""
        - 模式: 影调大师 / DaVinci 式整体调色
        - 视觉 DNA: {dna_tags}
        - 影调浓度: {intensity_pct}%
        - 对比度: {p3.get('contrast', 'Standard')}
        - 颗粒感: {'开启' if p3.get('grain') else '关闭'}
        - 画质: {p3.get('imageSize', '2K')}
        - 补充描述 (P0): {(p3.get('remark') or '').strip() or '无（用户尚未填写）'}
        """
    return "未知阶段"


# ===========================================================================
# Reference image labeling (for Phase 1 multi-modal parts)
# ===========================================================================

def build_reference_labels(
    reference_images: list[str],
    phase: str,
    user_labels: list[str] | None = None,
    has_model_ref: bool = True,
    has_scene_ref: bool = True,
) -> list[dict[str, str]]:
    """
    为参考图片生成标签，对应 geminiService.ts preparePhase1Parts()
    返回 [{label: "...", index: 0}, ...] 用于组装 Gemini parts

    errorConclude #41 新增 user_labels 参数：
      - 与 reference_images 等长的用户自定义标签数组
      - 某位置为非空串时，优先用 "[Reference Image: <user_label>]" 替换默认位置性标签，
        让 Gemini 在多图场景下能根据用户语义（如"正面"/"背面"/"面料纹理"）做区分
      - 为空串 / None 或缺省时，退回到原位置性映射（Main Model / Background / ... Product Detail）
      - 传入数组长度短于 reference_images 时，后续位置也按默认处理

    has_model_ref / has_scene_ref（默认 True 兼容老调用方）：
      前端 preparePhase1Parts 是按 [model?, scene?, products..., accessories...] 顺序追加 refs。
      当 model / scene 缺位时，refs[0] 实际是 scene 或 product，旧固定 label_map 会把它误标成
      "Main Model Identity" → Gemini 锁错脸。这两个旗标用来动态裁剪 label_map 头部，
      让 refs[i] 的默认标签与真正语义对齐。
    """
    labels: list[dict[str, str]] = []
    if not reference_images:
        return labels

    def _pick_user(i: int) -> str | None:
        if not user_labels or i >= len(user_labels):
            return None
        v = user_labels[i]
        if not isinstance(v, str):
            return None
        v = v.strip()
        return v or None

    if phase in ("phase1", "phase2", "phase2Color"):
        # Phase 1/2 默认位置性标签。相比旧版把 3..6 位置全部写成 "Product Detail"，
        # 这里按 preparePhase1Parts 的固定顺序拆分到具体编号，让 Gemini 能区分
        # "这是主产品的第 N 张视角" vs "这是第 N 件配饰"：
        #   model? / scene? / product[0..2] / accessory[0..1]
        # 参见 geminiService.ts preparePhase1Parts 的序列。
        label_map: list[str] = []
        if has_model_ref:
            label_map.append("[Reference Image: Main Model Identity]")
        if has_scene_ref:
            label_map.append("[Reference Image: Background/Environment]")
        label_map.extend([
            "[Reference Image: Main Product Garment #1]",
            "[Reference Image: Main Product Garment #2]",
            "[Reference Image: Main Product Garment #3]",
            "[Reference Image: Brand Accessory #1]",
            "[Reference Image: Brand Accessory #2]",
        ])
        for i, _ in enumerate(reference_images):
            user_lbl = _pick_user(i)
            if user_lbl:
                lbl = f"[Reference Image: {user_lbl}]"
            else:
                # 越界（理论上 preparePhase1Parts 已限制到 7）兜底为带序号的 Detail
                lbl = label_map[i] if i < len(label_map) else f"[Reference Image: Extra Reference #{i - len(label_map) + 1}]"
            labels.append({"label": lbl, "index": i})
    else:
        # Phase 0: 无默认标签，只有 user_labels 提供时才插入（当前 phase0 管线只下发 front/side/back
        # 三张固定语义图，本分支暂未使用；预留给未来 phase0 扩展）
        for i, _ in enumerate(reference_images):
            user_lbl = _pick_user(i)
            labels.append({"label": f"[Reference Image: {user_lbl}]" if user_lbl else "", "index": i})

    return labels


# ===================== Phase 3 — 影调大师 =====================

def build_phase3_dna_prompt() -> str:
    """Phase 3 Step 1 —— 视觉 DNA 提取 prompt（多模态 Gemini 调用）。

    输出契约（前后端跨语言强约束，前端 extractToneDNA 直接 JSON.parse）：
        {
          "tags": "k1, k2, k3, ... (12-15 总数)",
          "translation": {
            "color":    "1 句中文，25-50 字",
            "lighting": "1 句中文，25-50 字",
            "texture":  "1 句中文，25-50 字",
            "mood":     "1 句中文，25-50 字"
          }
        }

    硬性输出规则（违反任何一条都会让前端解析失败、回落到"解析失败"占位）：
      - RAW JSON ONLY，禁 ```json 围栏、禁前后散文。
      - tags 必须 12-15 个英文短词（每个 1-3 词），逗号 + 单空格分隔。
      - translation 四维必须各为 1 句 25-50 中文字符，禁 URL/markdown/换行。
      - 禁套娃 JSON / 禁多余 metadata / 禁 base64 原文。

    消费链路：
        ai-python build_phase3_dna_prompt
          → Gemini dna_chain (flash 顶链首)
          → raw["text"] = JSON 文本
          → Java setRawResponse(raw.get("text"))
          → 前端 extractToneDNA (geminiService.ts，含 fence/HashMap 兜底解析)
          → p3Settings.styleDNA (tags) + p3Settings.dnaTranslation (translation)

    前端兜底已经处理过 markdown fence、Java HashMap.toString 残留两种历史污染；
    本 prompt 任何放松（如允许 fence）都会让那一段兜底变得脆弱，请勿删 "NO markdown" 行。
    """
    return """Analyze this fashion/lifestyle photography for visual DNA extraction.
Examine 4 dimensions:
1. Color: Primary hues, saturation levels, skin tone rendering.
2. Lighting: Direction, hardness, temperature (K), high-key/low-key.
3. Texture: Grain, noise, clarity, lens effects (anamorphic, vintage glass).
4. Mood: Overall atmospheric quality (cinematic, editorial, dreamy, gritty).

CRITICAL OUTPUT RULES (must follow exactly):
- Respond with RAW JSON ONLY. NO markdown code fences (no ```json, no ```), NO leading/trailing prose.
- The "tags" field MUST contain exactly 12 to 15 short English keywords (each 1-3 words), comma-separated with a single space after each comma.
- Each Chinese description (color/lighting/texture/mood) MUST be ONE single concise sentence, 25-50 Chinese characters, no URLs, no markdown, no line breaks.
- Do NOT include any URLs, file paths, base64 data, JSON within JSON, or any extra metadata in the response.
- Output exactly the structure below, nothing more, nothing less.

{"tags":"keyword1, keyword2, keyword3, ... (12-15 total)","translation":{"color":"...","lighting":"...","texture":"...","mood":"..."}}"""


def build_phase3_prompt(
    style_dna: str,
    intensity: float,
    grain: bool,
    contrast: str,
    image_size: str,
    remark: str | None = None,
    garment_spec: str = "",
    has_style_ref: bool = False,
) -> str:
    """Prompt for Phase3 Step2 image generation (single base image input).

    定位为 DaVinci Resolve 式专业整体调色：
    - **只**做 global color grading（lift / gamma / gain / LUT / 曝光 / 白平衡 / 色温 / 饱和 / 颗粒）
    - **严禁** repaint / recolor 服装、皮肤、发色、配饰、背景物体的"本色"
    - 类比胶片冲洗、LUT 套色、达芬奇 Power Grade —— 改的是"光"，不是"漆"
    - 服装颜色 = 物体本色 (inherent surface albedo)，必须 100% 保持
      整体色调 = 全局色彩偏移 (global color shift / LUT) —— 通过环境光、白平衡、色阶整体偏移实现

    remark 是用户在控制面板填入的高优先级 P0 指令（如"偏冷青调"/"夕阳暖光"/
    "保留服装本色"）。提到 prompt 最高优先级位置，并显式标记为 P0，
    与 [[project-sprint-v5-xiii-phase3]] Spec Lock #23 的"100% PRESERVE"硬约束并列。
    """
    intensity_pct = round(intensity * 100)
    grain_text = "organic 35mm film grain (subtle, embedded in highlight rolloff)" if grain else "clean digital finish, no synthetic grain"

    # V5.XVII.F：浓度档位扩到 5 档（每 20% 一档），档与档之间是"色调逐档加深"的清晰递进。
    # 关键约束：每档都只是【ambient lighting / LUT 强度】递增，绝不递增【garment albedo
    # recolor】—— 5 档全程保持服装本色（surface pigment）不变。
    # 边界取档值中点判定：≤0.25→T1, ≤0.45→T2, ≤0.65→T3, ≤0.85→T4, >0.85→T5。
    if intensity <= 0.25:
        intensity_tier = "T1 (20% — WHISPER)"
        intensity_descriptor = (
            "barest hint of grade — like applying a print-film tone curve at 20% opacity. "
            "~80% of the original look is preserved. Color cast appears ONLY in highlight rolloff "
            "and deepest shadows; midtones remain virtually neutral. Garment pigment must read "
            "100% identical to the source image under casual inspection."
        )
    elif intensity <= 0.45:
        intensity_tier = "T2 (40% — SOFT)"
        intensity_descriptor = (
            "soft film-color wash — a gentle but visible Kodak/Fuji-style color temperature "
            "shift. ~60% of the original look is preserved. Style DNA palette is detectable "
            "in shadow and highlight regions; midtones lean only mildly. Clearly DEEPER in tone "
            "than T1 but still restrained; garment surface pigment unchanged."
        )
    elif intensity <= 0.65:
        intensity_tier = "T3 (60% — BALANCED)"
        intensity_descriptor = (
            "balanced cinematic grade — clearly recognizable LUT signature without overpowering. "
            "~50/50 mix of original tonality and Style DNA color cast. Shadows AND highlights "
            "both carry the target palette; midtones noticeably shift. Tone is meaningfully "
            "DEEPER and richer than T2 — this is the 'professional commercial look' threshold. "
            "Garment surface pigment still 100% locked."
        )
    elif intensity <= 0.85:
        intensity_tier = "T4 (80% — DEEP)"
        intensity_descriptor = (
            "deep stylized grade — cinematic LUT dominates the look. ~30% original tonality, "
            "~70% Style DNA character. Shadows and highlights both heavily tinted; mood is "
            "strong and atmospheric. Tone is markedly DEEPER and more saturated than T3. "
            "Still pure ambient-light grading — garment albedo (red stays red, black stays "
            "black, white stays white) absolutely unchanged."
        )
    else:
        intensity_tier = "T5 (100% — FULL)"
        intensity_descriptor = (
            "maximum cinematic grade — full-strength stylized LUT. Crushed or lifted blacks, "
            "saturated color cast across the entire frame, heavy film mood, possible halation / "
            "vignette. Style DNA palette is unmistakably the dominant visual signature. Tone is "
            "the DEEPEST of all 5 tiers. Even at this maximum strength, garment surface albedo "
            "still reads as its original pigment — red dress remains red dress, white shirt "
            "remains white shirt; only the ambient illumination tints them. THIS IS NOT A RECOLOR."
        )

    remark_clean = (remark or "").strip()
    # V5.XVII.C: 即使用户未填补充描述，也强制注入"不染色"P0 硬约束，
    # 不再依赖用户在 textarea 里手打。
    if remark_clean:
        remark_block = (
            "\n[P0 USER DIRECTIVE — HIGHEST PRIORITY, OVERRIDES ANY CONFLICTING STYLE DNA HINT BELOW]\n"
            f"{remark_clean}\n"
            "Interpret this strictly as a colorist / DaVinci Resolve grading note. If it implies a "
            "specific cast (cool / warm / teal / orange / sunset / overcast / cinematic), apply it "
            "as a GLOBAL color wheel + curve adjustment, NOT as a paint job on the garment.\n"
            "ALSO: garment surface albedo (base pigment / dye color) MUST remain 100% unchanged. "
            "Only ambient lighting on the garment may shift in tint.\n"
        )
    else:
        remark_block = (
            "\n[P0 AUTO-INJECTED DIRECTIVE — HIGHEST PRIORITY]\n"
            "Garment surface albedo (the intrinsic dye / pigment of every fabric panel) MUST "
            "remain 100% unchanged. The only allowed effect on clothing is how the new ambient "
            "illumination tints highlights and shadows. Do NOT recolor, retint, or shift the "
            "underlying garment hue. A red dress stays red, a black coat stays black, a white "
            "shirt stays white. The grade is applied to the LIGHT, not to the FABRIC.\n"
        )

    lines = [
        "# TASK: Professional COLOR GRADING ONLY (DaVinci Resolve style global grade)",
        "",
    ]
    if has_style_ref:
        lines += [
            "[STYLE REFERENCE IMAGE PROVIDED — HOW TO USE IT]",
            "The image labeled [Style Reference] above the base image is your TONAL TARGET.",
            "Calibrate your grade to match its: color cast, luminosity curve, highlight rolloff,",
            "shadow depth, film grain character, and overall atmospheric mood.",
            "Do NOT copy subjects, clothing, composition, or any object from it.",
            "The Style DNA keywords below are semantic annotations of that same reference —",
            "they serve as a cross-check, not a replacement for direct visual calibration.",
            "",
        ]
    lines += [
        "Think of yourself as a senior colorist working on Blackmagic DaVinci Resolve. The base image",
        "is already a finished commercial photograph. Your job is to apply a non-destructive global",
        "color grade — lift / gamma / gain, LUT, white balance, color temperature, exposure, contrast,",
        "saturation, and film emulation. You are NOT repainting any object's inherent surface color.",
        "",
        "[CORE GRADE INSTRUCTION — HARD CONSTRAINTS]",
        "1. 100% PRESERVE subject identity: face, body, skin tone (skin remains the same race/tone,",
        "   only the LIGHT falling on it shifts), hair geometry, and natural hair color.",
        "2. 100% PRESERVE garment structure, silhouette, fabric design, prints, logos, and the",
        "   GARMENT'S INHERENT BASE COLOR (albedo). Do NOT recolor clothing. A red dress stays a red",
        "   dress; a white shirt stays a white shirt. The only allowed change is how ambient light",
        "   tints/shades it — never replace its base pigment.",
        "3. 100% PRESERVE all accessories, props, and background OBJECTS in their original positions",
        "   and base colors. No add / remove / repaint of any object.",
        "4. ONLY allowed modifications: global LUT-style color cast, white balance shift, exposure /",
        "   contrast / saturation adjustment, atmospheric haze / glow, film grain / halation, lens",
        "   character (anamorphic flare, vintage glass falloff). All applied as a UNIFORM overlay",
        "   across the WHOLE frame, never to a single object in isolation.",
        "5. Distinguish 'ambient illumination grading' vs 'garment surface albedo':",
        "   - ambient illumination grading: a global LUT / WB / curve that re-renders how light",
        "     reaches every surface, including the garment. Highlights, shadows, and color cast on",
        "     the garment WILL shift naturally. This is ALLOWED.",
        "   - garment surface albedo (base pigment): the intrinsic color of the fabric panels",
        "     themselves. This MUST NOT change. A red dress under cool blue light may appear cooler",
        "     / slightly purplish in highlights, BUT the underlying dye must still read as red.",
        "   - Rule of thumb: if the user removed all environment lighting and viewed the garment",
        "     under neutral 5500K white, the pigment must match the reference exactly.",
        "   If the Style DNA says 'teal & orange', that means push shadows toward teal and highlights",
        "   toward orange GLOBALLY — it does NOT mean dye the shirt teal.",
        "6. Do not add or remove any objects, accessories, characters, or environmental elements.",
        "7. Do not change pose, framing, crop, aspect, or composition.",
        GARMENT_PRESERVATION_BLOCK,
        (garment_spec or ""),
        remark_block,
        REALISM_GUARDRAIL,
        "",
        "[GRADE PARAMETERS]",
        f"- Style DNA (mood / palette reference, applied as a global look): {style_dna}.",
        f"- Grade intensity tier: {intensity_tier} (raw value {intensity_pct}%).",
        f"  Tier definition: {intensity_descriptor}",
        "  Tier scale (5 discrete steps, 20% apart) — color cast DEEPENS monotonically:",
        "    T1 (20%) → T2 (40%) → T3 (60%) → T4 (80%) → T5 (100%).",
        "  Every tier must be visually distinguishable from its neighbors; a viewer placing the",
        "  5 outputs side-by-side MUST see a clear 'deepening' progression of color mood.",
        "  CRITICAL — what 'deepening' means here:",
        "    DEEPER = stronger ambient color cast, richer shadow/highlight tinting, more LUT presence.",
        "    DEEPER ≠ recoloring the garment. The dress / shirt / jacket pigment is FIXED at",
        "    every tier; only the LIGHT around it grows more saturated and stylized.",
        f"- Contrast curve: {contrast}.",
        f"- Film texture: {grain_text}.",
        f"- Target output resolution: {image_size}.",
        "",
        "[NEGATIVE CONSTRAINTS]",
        "- Do NOT change garment hue / saturation as a 'recolor' operation.",
        "- Do NOT change skin race or hair color.",
        "- Do NOT regenerate the scene from scratch — start from the base image pixels and apply a",
        "  color transform on top.",
        "- Do NOT introduce new objects, hands, faces, or backgrounds.",
    ]
    # 去掉空 remark_block 留下的空行
    return "\n".join(line for line in lines if line != "")
