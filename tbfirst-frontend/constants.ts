
import { ImageSize } from "./types";
import type { CompositionScope, GarmentAttrs } from "./types";

/**
 * 全局常量定义
 */
export const SHOT_TYPES = [
  { value: '', label: '无 (None) - 完全自定义' },
  { value: 'Wide Shot, full body visible with environment, editorial composition', label: '全景 (Wide Shot) - 全身展示带环境' },
  { value: 'Medium Shot, waist up, focus on interaction and outfit', label: '中景 (Medium Shot) - 半身穿搭/交互' },
  { value: 'Close-up, head and shoulders, emotional connection', label: '近景 (Close-up) - 胸部以上/情绪' },
  { value: 'Extreme Close-up, detailed texture of product or eye', label: '特写 (Extreme Close-up) - 局部材质纹理' },
  { value: 'Extreme Wide Shot, panoramic view establishing the setting', label: '大远景 (Extreme Wide) - 宏大环境氛围' },
  { value: 'Low Angle Shot, looking up, powerful and dominant', label: '低角度 (Low Angle) - 仰视权威感' },
  { value: 'High Angle Shot, looking down, clean layout', label: '上帝视角 (Top Down) - 俯视平铺/布局' },
];

export const TONES = [
  { value: '', label: '无 (None) - 完全自定义' },
  { value: 'Warm Golden Hour, soft sunlight, cozy, inviting', label: '暖阳金调 (Golden Hour) - 温暖治愈' },
  { value: 'Cool Blue, professional, tech-oriented, clean, clinical', label: '冷调科技 (Cool Tech) - 专业洁净' },
  { value: 'Neutral Studio Lighting, balanced, true to color, e-commerce standard', label: '中性影棚 (Studio) - 真实还原/电商标准' },
  { value: 'Black and White, high contrast, artistic, noir style', label: '黑白艺术 (B&W Art) - 经典格调' },
  { value: 'Morandi Palette, low saturation, muted, elegant, premium gray', label: '莫兰迪色 (Morandi) - 低饱和高级灰' },
  { value: 'Cyberpunk Neon, pink and blue lights, night vibe, futuristic', label: '赛博霓虹 (Cyberpunk) - 潮流夜景' },
  { value: 'Vintage Film, grain, nostalgia, Kodak Portra style', label: '复古胶片 (Vintage Film) - 怀旧质感' },
  { value: 'Luxury Dark, moody lighting, gold accents, premium', label: '暗调奢华 (Dark Luxury) - 尊贵质感' },
  { value: 'Fresh Pastel, macaron colors, bright, youthful', label: '清新马卡龙 (Pastel) - 活泼年轻' },
];

export const ATMOSPHERES = [
  { value: '', label: '无 (None) - 完全自定义' },
  { value: 'Natural Lifestyle, candid, relaxed, authentic, daylight', label: '自然生活 (Lifestyle) - 真实松弛感' },
  { value: 'High Fashion Editorial, avant-garde, bold visuals, vogue style', label: '时尚大片 (High Fashion) - 先锋杂志感' },
  { value: 'Cinematic Storytelling, dramatic lighting, emotional depth', label: '电影叙事 (Cinematic) - 情绪故事感' },
  { value: 'Minimalist Clean, whitespace, focus on product, zen', label: '极简纯粹 (Minimalist) - 留白高级感' },
  { value: 'Business Professional, confident, office setting, trustworthy', label: '职场精英 (Professional) - 自信干练' },
  { value: 'Surreal Dreamscape, artistic, imaginative elements, fantasy', label: '超现实梦境 (Surreal) - 艺术想象力' },
  { value: 'Energetic Sports, dynamic motion, vibrant, high speed', label: '运动活力 (Energetic) - 动态张力' },
  { value: 'Romantic dreamy, soft focus, ethereal, elegant', label: '浪漫唯美 (Romantic) - 柔美梦幻' },
  { value: 'Streetwear Urban, city background, gritty, cool', label: '街头潮流 (Urban) - 酷感街拍' },
];

export const LIGHTING_OPTIONS = [
  { value: 'Default Lighting, matching the concept image', label: '默认光影 - 匹配原图' },
  { value: 'Rembrandt lighting, cinematic triangle of light on cheek, high depth, professional portrait', label: '伦勃朗光 - 电影感立体人像' },
  { value: 'Rim lighting, backlit silhouette, hair light, strong separation from background, high contrast', label: '轮廓边缘光 - 提升产品质感' },
  { value: 'Natural window light, side lighting, soft shadows, authentic lifestyle atmosphere', label: '柔和窗光 - 真实生活氛围' },
  { value: 'High-key lighting, bright and airy, minimal shadows, clean and optimistic', label: '通透高调光 - 清洁明亮感' },
  { value: 'Butterfly lighting, paramount light, glamorous, flattering shadows under nose and chin', label: '蝴蝶光 - 时尚大片质感' },
  { value: 'Softbox studio lighting, even diffusion, professional commercial catalog look', label: '影棚柔光 - 商业画册标准' },
  { value: 'Top-down spot light, dramatic shadows, focus on product texture and form', label: '顶显聚焦光 - 强调材质纹理' },
  { value: 'Sunset glow, warm directional light, long shadows, nostalgic mood', label: '日落夕阳 - 温暖氛围故事' },
];

export const ASPECT_RATIOS = [
  { value: '3:4', label: '3:4 (小红书/海报)' },
  { value: '9:16', label: '9:16 (抖音/Story)' },
  { value: '16:9', label: '16:9 (横屏Banner)' },
  { value: '21:9', label: '21:9 (超宽屏/电影画幅)' },
  { value: '1:1', label: '1:1 (电商主图/Instagram)' },
  { value: '4:3', label: '4:3 (传统横屏)' },
];

export const IMAGE_SIZES = [
  { value: ImageSize.K1, label: '标准高清 (1K)' },
  { value: ImageSize.K2, label: '超清画质 (2K)' },
  { value: ImageSize.K4, label: '影院级4K (4K)' },
];

export const ACTIONS = [
  { value: 'Maintain original pose', label: '保持原样' },
  { value: 'Facing camera, making eye contact, confident stance, professional modeling pose', label: '正面直视 - 自信展示' },
  { value: 'Side profile standing, showcasing the body silhouette and side details of the garment', label: '侧身轮廓 - 展现曲线' },
  { value: 'Model standing still with back to the camera, full back view, straight posture, emphasizing back silhouette and details.', label: '背面静立 - 展现背部全貌' },
  { value: 'Three-quarter back view, model slightly turned, showing the intersection of side and back design, elegant stance.', label: '侧背展示 - 优雅背侧曲线' },
  { value: 'Model walking away from the camera, back view in motion, capturing the natural movement and flow of the garment\'s back.', label: '背影离去 - 捕捉背部动感' },
  { value: 'Model turned away from camera, looking back over shoulder, emphasizing back design and details', label: '转身回眸 - 展示背部设计' },
  { value: 'Walking towards camera, captures motion, clothes flowing naturally with the movement', label: '行走动态 - 展示服装动感' },
  { value: 'Elegant side stance, focusing on the drape, texture and flow of the fabric', label: '侧身舒展 - 展示垂坠质感' },
  { value: 'Kneeling or crouching pose, low camera angle, highlighting footwear and lower garment details', label: '优雅跪姿 - 突出鞋履下装' },
  { value: 'Sitting comfortably in a stylish chair or surface, relaxed but high-fashion posture', label: '坐姿精修 - 惬意高级感' },
  { value: 'Dynamic jumping or mid-air floating pose, high energy, capturing fabric in motion', label: '跳跃悬浮 - 视觉冲击力' },
  { value: 'Model leaning against a wall or prop, cool attitude, casual editorial style', label: '倚靠姿态 - 随性潮流感' },
  { value: 'Arms raised or hands on hips, emphasizing the structure of shoulders and sleeves', label: '双臂姿态 - 突出版型结构' },
  { value: 'Holding the product close to the face or camera, macro-like focus on hands and product', label: '手持特写 - 突出产品细节' },
];

export const EXPRESSIONS = [
  { value: 'Maintain original expression', label: '保持原样' },
  { value: 'Gentle warm smile, approachable, friendly', label: '温和微笑 - 亲和力' },
  { value: 'Big confident laugh, joyful, authentic', label: '开怀大笑 - 感染力' },
  { value: 'Neutral, high fashion, cool, aloof, model face', label: '高冷厌世 - 时尚高级' },
  { value: 'Focused, serious, professional, determined', label: '专注认真 - 专业感' },
  { value: 'Surprised, delighted, mouth slightly open, wow moment', label: '惊喜发现 - 种草感' },
  { value: 'Soft, dreamy, relaxed eyes, enjoying the moment', label: '陶醉享受 - 沉浸感' },
  { value: 'Mysterious, intense gaze, alluring', label: '神秘魅惑 - 吸引力' },
];

export const FOCUS_OPTIONS = [
  { value: 'Full body framing, balanced composition showing both model and environment', label: '全身展示 - 均衡构图' },
  { value: 'Upper body focus, waist up, emphasizing tops, jewelry, and facial expressions', label: '上半身 - 聚焦上装/首饰' },
  { value: 'Lower body focus, highlighting trousers, skirts, leg movement, and shoes', label: '下半身 - 聚焦裤装/裙装' },
  { value: 'Feet and ankles focus, extreme low angle, highlighting footwear details and textures', label: '足部特写 - 聚焦鞋履细节' },
  { value: 'Torso and mid-section focus, highlighting bags, belts, and mid-rif details', label: '腰腹局部 - 聚焦包袋/配饰' },
  { value: 'Head and shoulders portrait, focusing on headwear, earrings, and makeup', label: '头部近景 - 聚焦头饰/妆容' },
];

export const FLAT_LAY_OPTIONS = [
  { value: 'INDUSTRIAL_FLAT_LAY: Full view top-down flat lay, perfectly ironed, e-commerce catalog style, neutral background, NO HUMANS.', label: '全件平铺 (整体资产)' },
  { value: 'INDUSTRIAL_FLAT_LAY_COLLAR: Macro top-down view of the collar/neckline, highlighting stitching and label, NO HUMAN ELEMENTS.', label: '领口结构 (上装/连衣裙)' },
  { value: 'INDUSTRIAL_FLAT_LAY_CUFF: Close-up top-down view of cuffs, sleeve ends and precision seams, industrial texture focus.', label: '袖口细节 (长短袖通用)' },
  { value: 'INDUSTRIAL_FLAT_LAY_HEM: Detailed view of the hemline and finish seams, perfectly straight, industrial photography.', label: '下摆线条 (全品类适用)' },
  { value: 'INDUSTRIAL_FLAT_LAY_WAIST: Focus on waistband, belt loops, and front closure/button of bottoms, NO SKIN.', label: '腰头与门襟 (下装专用)' },
  { value: 'INDUSTRIAL_FLAT_LAY_POCKET: Tight focus on pocket construction and decorative stitching, high-resolution textile view.', label: '口袋/后幅结构 (工装/牛仔)' },
  { value: 'INDUSTRIAL_FLAT_LAY_HARDWARE: Extreme macro of zippers, buttons, rivets and luxury hardware, NO HANDS.', label: '五金辅料 (拉链/扣子)' },
  { value: 'INDUSTRIAL_FLAT_LAY_LABEL: Macro view of brand logo, wash label or embroidery details, single unified product shot.', label: '品牌绣标/洗唛 (工艺细节)' },
];

export const FABRIC_DETAILS = [
  { value: 'PURE_FABRIC_ASSET: Extreme macro photography of fabric weave, microscopic view of textile fibers, filling 100% of the frame, isolated fabric swatch, NO HUMAN MODELS, NO SKIN, NO FACES, NO COLLAGE, single unified image.', label: '极近纤维特写 - 展现细微纹理' },
  { value: 'PURE_FABRIC_ASSET: Macro shot of fabric drape and soft folds, filling the frame with textile texture, showing premium sheen, NO MODELS, NO HUMAN BODY PARTS, NO GRID, professional product asset style.', label: '光泽垂坠特写 - 展现面料高级感' },
  { value: 'PURE_FABRIC_ASSET: Macro focus on embroidery and print craftsmanship, single full-frame view of material surface, high resolution textile texture, ABSOLUTELY NO HUMANS, pure industrial material asset.', label: '工艺/印花特写 - 展现匠心细节' },
  { value: 'PURE_FABRIC_ASSET: Macro photography of fabric hem and precision stitching, focus only on edge quality and weave, filling the screen, NO MODELS, NO HANDS, NO COLLAGE, single industrial shot.', label: '走线缝合特写 - 展现做工品质' },
  { value: 'PURE_FABRIC_ASSET: Extreme close-up of organic fabric texture under soft directional light, pure fiber surface filling the entire frame, NO HUMAN ELEMENTS, NO LIFESTYLE LAYOUT, single high-end material image.', label: '自然光感材质 - 展现真实触感' },
];

// V5.XII.2: LIFESTYLE_DETAILS 细化为 4 分组，拆分原含 `/` 的项并并入 GESTURE_ACTIONS 11 个手势。
// 索引位约定：[0]=上身、[1]=配饰、[2]=下身、[3]=头脸；Phase2.tsx 的 handleExclusiveMode 依赖
// [0]/[1]/[2] 自动联动 focus，[3] 头脸不强制 focus（保留用户选项）。
export const LIFESTYLE_DETAILS = [
  {
    group: "上身衣物交互",
    options: [
      { value: 'Macro close-up on the collar area, model hands gently adjusting the lapel, high-definition stitching', label: '衣领细节与手部整理动作' },
      { value: 'Focus on cuff and sleeve end, model hand gracefully touching the wrist area, highlighting button details', label: '袖口细节与手势展示' },
      { value: 'Extreme close-up on garment texture, model fingers feeling the fabric weave, shallow depth of field', label: '手触质感特写' },
      { value: 'Hand adjusting collar and lapel with deliberate fingers, highlighting neckline detail and stitching', label: '整理衣领手势' },
      { value: 'Hand at cuff pulling the sleeve end, highlighting button placement and sleeve hemline detail', label: '拉袖口手势' },
      { value: 'Fingers lightly touching fabric across the chest area, feeling texture and showing soft shadow', label: '抚摸面料手势' },
      { value: 'Arms crossed in front of torso, confident body language, highlighting sleeve and shoulder structure', label: '抱臂手势' },
      { value: 'Hands clasped behind back, elegant upright posture, highlighting front silhouette of garment', label: '背手手势' },
    ]
  },
  {
    group: "配饰交互特写",
    options: [
      { value: 'Macro focus on fingers interacting with rings, premium skin texture and elegant jewelry detail', label: '指尖与首饰交互特写' },
      { value: 'Close-up on hand carrying a luxury bag by the top handle, emphasizing handle detail and leather texture', label: '手拎包袋' },
      { value: 'Close-up on hand gripping a luxury bag firmly, emphasizing finger placement and leather texture in use', label: '手握包袋' },
      { value: 'Hand adjusting sunglasses with one finger on the bridge, capturing reflections on the lens', label: '手部调整眼镜动作' },
      { value: 'Hand holding bag handle at hip level, showcasing bag in active use with natural arm position', label: '手拿包手势' },
    ]
  },
  {
    group: "下身产品特写",
    options: [
      { value: 'Focus on waistline with hand tucked into front pocket, highlighting waistband design and pocket structure', label: '腰部插兜手势' },
      { value: 'Focus on waistline with hand resting on the hip belt area, highlighting waistband and silhouette', label: '腰部扶腰手势' },
      { value: 'Tight focus on garment pocket, model hand partially tucked inside to show utility and form', label: '口袋细节与入袋手势' },
      { value: 'Extreme focus on trouser hemline, showing precision stitching and movement of the fabric near the ankle', label: '裤脚缝线特写' },
      { value: 'Extreme focus on skirt hemline, showing precision stitching and flowing movement of the fabric', label: '裙摆缝线特写' },
      { value: 'Hands on hips at waist level, emphasizing shoulder and waist structure, confident editorial pose', label: '叉腰手势' },
      { value: 'Both hands tucked into trouser pockets, relaxed casual attitude, highlighting pocket placement', label: '插兜手势' },
      { value: 'Hand pulling trouser hem near the ankle, highlighting hemline detail and stitching', label: '拉裤脚手势' },
    ]
  },
  {
    group: "头脸手势特写",
    options: [
      { value: 'One hand touching forehead, thoughtful gesture, soft attention to face and hairline', label: '扶额手势' },
      { value: 'Hand cupping chin, contemplative pose, attention to jawline and cheek', label: '托腮手势' },
      { value: 'Hand gently touching face, candid natural gesture, close attention to expression', label: '摸脸手势' },
    ]
  }
];

export const GENERATION_MODELS = {
  PRIMARY: 'gemini-3.1-flash-image-preview',
  FALLBACK: 'gemini-3-pro-image-preview',
} as const;

export const COMPOSITION_SCOPES = [
  { value: 'inherit', label: '继承上一轮构图' },
  { value: 'overall', label: '整体写照 (Overall) — 主体完整可见' },
  { value: 'half_or_region', label: '半身 / 大区域 (Half/Region) — 上/下半身、大范围' },
  { value: 'segment', label: '明确部位段 (Segment) — 膝盖以下、肩颈、腰腹' },
  { value: 'detail', label: '局部特写 (Detail) — 裤脚+足部、袖口+手部、口袋' },
  { value: 'macro', label: '材质极近特写 (Macro) — 织纹、走线、拉链、五金' },
] as const;

export const COMPOSITION_TARGETS = [
  { value: '整体人物', label: '整体人物' },
  { value: '上半身', label: '上半身' },
  { value: '下半身', label: '下半身' },
  { value: '头肩', label: '头肩' },
  { value: '脸部', label: '脸部' },
  { value: '手部', label: '手部' },
  { value: '腰腹', label: '腰腹' },
  { value: '领口', label: '领口' },
  { value: '袖口', label: '袖口' },
  { value: '口袋', label: '口袋' },
  { value: '裤脚', label: '裤脚' },
  { value: '裙摆', label: '裙摆' },
  { value: '鞋履', label: '鞋履' },
  { value: '包袋', label: '包袋' },
  { value: '首饰', label: '首饰' },
  { value: '面料纹理', label: '面料纹理' },
  { value: '走线', label: '走线' },
  { value: '五金', label: '五金' },
  { value: '背景/场景', label: '背景/场景' },
] as const;

// V5.XII.3: 构图层级与聚焦对象联动 —— 每个 scope 仅展示语义合理的 target 子集。
export const COMPOSITION_TARGETS_BY_SCOPE: Record<Exclude<CompositionScope, 'inherit'>, ReadonlyArray<{ value: string; label: string }>> = {
  overall: [
    { value: '整体人物', label: '整体人物' },
    { value: '背景/场景', label: '背景/场景' },
  ],
  half_or_region: [
    { value: '上半身', label: '上半身' },
    { value: '下半身', label: '下半身' },
    { value: '头肩', label: '头肩' },
    { value: '腰腹', label: '腰腹' },
    { value: '背景/场景', label: '背景/场景' },
  ],
  segment: [
    { value: '头肩', label: '头肩' },
    { value: '脸部', label: '脸部' },
    { value: '手部', label: '手部' },
    { value: '腰腹', label: '腰腹' },
    { value: '裤脚', label: '裤脚' },
    { value: '裙摆', label: '裙摆' },
  ],
  detail: [
    { value: '脸部', label: '脸部' },
    { value: '手部', label: '手部' },
    { value: '领口', label: '领口' },
    { value: '袖口', label: '袖口' },
    { value: '口袋', label: '口袋' },
    { value: '裤脚', label: '裤脚' },
    { value: '裙摆', label: '裙摆' },
    { value: '鞋履', label: '鞋履' },
    { value: '包袋', label: '包袋' },
    { value: '首饰', label: '首饰' },
  ],
  macro: [
    { value: '面料纹理', label: '面料纹理' },
    { value: '走线', label: '走线' },
    { value: '五金', label: '五金' },
  ],
};

// V5.XIV.9: 景别（shotType）与构图层级（compositionScope）兼容矩阵。
// key 必须精确匹配 SHOT_TYPES 数组中的 value 字符串。
// 'inherit' 视为通配（与所有 shotType 兼容），作为安全兜底允许用户回到
// "不限定构图层级"状态。空字符串 '' (None) 视为完全自由，不限定 scope。
export const SHOT_TYPE_SCOPE_COMPAT: Record<string, ReadonlyArray<CompositionScope>> = {
  '': ['inherit', 'overall', 'half_or_region', 'segment', 'detail', 'macro'],
  // 全景：默认整体人物全身，也可缩到半身
  'Wide Shot, full body visible with environment, editorial composition': ['inherit', 'overall', 'half_or_region'],
  // 中景：默认半身/上半身，排在 overall 之前，避免 deriveScopeFromShot 取到全身
  'Medium Shot, waist up, focus on interaction and outfit': ['inherit', 'half_or_region', 'segment', 'overall'],
  // 近景：默认上半身，也可精确到 segment/detail
  'Close-up, head and shoulders, emotional connection': ['inherit', 'half_or_region', 'segment', 'detail'],
  'Extreme Close-up, detailed texture of product or eye': ['inherit', 'detail', 'macro'],
  'Extreme Wide Shot, panoramic view establishing the setting': ['inherit', 'overall'],
  'Low Angle Shot, looking up, powerful and dominant': ['inherit', 'overall', 'half_or_region'],
  'High Angle Shot, looking down, clean layout': ['inherit', 'overall', 'half_or_region', 'segment'],
};

/**
 * 判断 shotType 与 compositionScope 是否兼容。
 * 未在映射表登记的 shotType（旧值或自定义）视为完全自由（true）；
 * 'inherit' scope 视为通配，永远兼容。
 */
export function isShotScopeCompatible(shot: string, scope: CompositionScope): boolean {
  if (scope === 'inherit') return true;
  const allowed = SHOT_TYPE_SCOPE_COMPAT[shot];
  return !allowed || allowed.includes(scope);
}

export function getCompositionTargets(scope: CompositionScope): ReadonlyArray<{ value: string; label: string }> {
  if (scope === 'inherit') return COMPOSITION_TARGETS;
  return COMPOSITION_TARGETS_BY_SCOPE[scope];
}

/**
 * V5.XV.1: shotType → 该景别允许的 compositionTarget 子集。
 * 基于 SHOT_TYPE_SCOPE_COMPAT 的 scope union → COMPOSITION_TARGETS_BY_SCOPE 合并去重。
 * 空字符串 shotType ('' = 沿用/None) 或未登记的 shotType 视为通配，返回全部 COMPOSITION_TARGETS。
 */
export function getTargetsByShotType(shot: string): ReadonlyArray<{ value: string; label: string }> {
  const compatScopes = SHOT_TYPE_SCOPE_COMPAT[shot];
  if (!compatScopes) return COMPOSITION_TARGETS;
  const seen = new Set<string>();
  const out: { value: string; label: string }[] = [];
  for (const scope of compatScopes) {
    if (scope === 'inherit') continue;
    const list = COMPOSITION_TARGETS_BY_SCOPE[scope as Exclude<CompositionScope, 'inherit'>];
    if (!list) continue;
    for (const t of list) {
      if (!seen.has(t.value)) {
        seen.add(t.value);
        out.push({ value: t.value, label: t.label });
      }
    }
  }
  return out.length > 0 ? out : COMPOSITION_TARGETS;
}

/**
 * V5.XV.1: shotType → 典型 compositionScope，用于 prompt_engine 后端兼容字段填充。
 * 取兼容 scope 中第一个非 'inherit' 项（如近景→half_or_region、特写→detail、全景→overall）；
 * '' / 未登记 shotType → 'inherit' 表示不限定。
 */
export function deriveScopeFromShot(shot: string): CompositionScope {
  const compat = SHOT_TYPE_SCOPE_COMPAT[shot];
  if (!compat) return 'inherit';
  const real = compat.find(s => s !== 'inherit');
  return (real ?? 'inherit') as CompositionScope;
}

/**
 * V5.XIX: shotType → { scope, defaultTarget }
 * 在 deriveScopeFromShot 基础上，为部分景别附带语义明确的默认聚焦对象，
 * 避免 compositionTarget 为空时后端 prompt 指令含糊（如"中景"缺少"上半身"锚点）。
 * Phase1 onChange 使用此函数，当 compositionTarget 未被用户主动设置时自动填入。
 */
export function deriveScopeIntentFromShot(shot: string): { scope: CompositionScope; defaultTarget: string } {
  const scope = deriveScopeFromShot(shot);
  const defaultTargetMap: Record<string, string> = {
    'Medium Shot, waist up, focus on interaction and outfit': '上半身',
    'Close-up, head and shoulders, emotional connection': '上半身',
  };
  return { scope, defaultTarget: defaultTargetMap[shot] ?? '' };
}

/** @deprecated since V5.XII.1 — UI 已回退至 ACTIONS toggle；本常量留作 prompt_engine fallback 兼容 */
export const POSE_ACTIONS = [
  { value: 'Maintain original pose', label: '保持原样' },
  { value: 'Facing camera directly, confident upright stance', label: '正面站立' },
  { value: 'Side profile standing, showcasing silhouette', label: '侧身站立' },
  { value: 'Standing still with back to camera, straight posture', label: '背面静立' },
  { value: 'Turned away, looking back over shoulder', label: '转身回眸' },
  { value: 'Walking towards camera, clothes flowing naturally', label: '向镜头行走' },
  { value: 'Walking away from camera, back view in motion', label: '背影行走' },
  { value: 'Sitting comfortably, relaxed high-fashion posture', label: '坐姿' },
  { value: 'Kneeling or crouching pose, low angle', label: '蹲姿' },
  { value: 'Leaning against a wall or prop, casual editorial', label: '倚靠' },
] as const;

/** @deprecated since V5.XII.1 — UI 已回退至 ACTIONS toggle；本常量留作 prompt_engine fallback 兼容 */
export const GESTURE_ACTIONS = [
  { value: '', label: '无额外手势' },
  { value: 'hands on hips, emphasizing shoulder and waist structure', label: '叉腰' },
  { value: 'hands in pockets, relaxed casual attitude', label: '插兜' },
  { value: 'arms crossed, confident body language', label: '抱臂' },
  { value: 'hands clasped behind back, elegant posture', label: '背手' },
  { value: 'one hand touching forehead, thoughtful gesture', label: '扶额' },
  { value: 'hand cupping chin, contemplative pose', label: '托腮' },
  { value: 'hand gently touching face, candid natural gesture', label: '摸脸' },
  { value: 'hand adjusting collar or lapel, highlighting neckline detail', label: '整理衣领' },
  { value: 'hand at cuff, pulling sleeve end to highlight detail', label: '拉袖口' },
  { value: 'fingers lightly touching fabric, feeling texture', label: '抚摸面料' },
  { value: 'hand pulling trouser hem, highlighting hemline detail', label: '拉裤脚' },
  { value: 'hand holding bag handle, showcasing bag in use', label: '手拿包' },
] as const;

// === Phase3 影调大师常量 ===
export const TONE_QUALITY_OPTIONS = [
  { value: '1K', label: '标准高清 1K' },
  { value: '2K', label: '超清 2K' },
  { value: '4K', label: '影院级 4K' },
] as const;

export const PHASE3_CONTRAST_OPTIONS = ['Low', 'Standard', 'High'] as const;

export const TONE_DNA_DIMENSIONS_CN = {
  color: '色彩',
  lighting: '光影',
  texture: '质感',
  mood: '影调',
} as const;

/**
 * Sprint V5.XVI.8：服装属性槽字段元数据。
 * 5 个可选字段；不填走旧路径，填了由后端拼装 AUTHORITATIVE GARMENT SPEC 段。
 */
export const GARMENT_ATTR_FIELDS: ReadonlyArray<{
  key: keyof GarmentAttrs;
  label: string;
  placeholder: string;
}> = [
  { key: 'dominantColor', label: '主色', placeholder: '如 #B4252A / 酒红 / 牛仔蓝' },
  { key: 'print',         label: '印花', placeholder: '如 小碎花 / 几何条纹 / 纯色' },
  { key: 'hardware',      label: '五金', placeholder: '如 亚光银金属扣 / 树脂扣' },
  { key: 'logo',          label: 'Logo', placeholder: '如 左胸刺绣 / 后领织标' },
  { key: 'stitching',     label: '走线', placeholder: '如 明线撞色 / 暗线同色' },
];
