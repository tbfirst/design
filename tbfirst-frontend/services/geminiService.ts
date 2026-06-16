/**
 * 生图服务 — 对接 tbfirst-image + tbfirst-ai-python
 * 前端不再构建 prompt，只发送结构化参数，prompt 构建在 Python prompt_engine.py
 */
import { generateImageJob } from '@/services/imageJob';
import { InputFiles, InputLabels, Phase1Settings, Phase2Settings } from '@/types';
import { fileToDataUri } from '@/services/shared/imagePartUtils';

export const GENERATION_MODELS = {
  PRIMARY: 'gemini-3.1-flash-image-preview',
  FALLBACK: 'gemini-3-pro-image-preview',
} as const;

export const VARIATION_HINTS = [
  'slight three-quarter camera variation',
  'subtle weight shift',
  'slight hand placement nuance',
  'softer expression variation',
  'stronger confident gaze',
  'slightly lower camera angle',
  'slightly wider breathing room',
  'subtle background depth variation',
] as const;

export const DETAIL_VARIATION_HINTS = [
  'subtle light direction variation',
  'slightly different macro angle',
  'shallow depth-of-field variation',
  'texture emphasis variation',
] as const;

interface GenerateResponse {
  jobId: number;
  status: string;
  urls: string[];
  rawResponse?: string;
}

export const getFriendlyError = (error: any): string => {
  const message = error.message || String(error);
  if (message.includes('429') || message.includes('quota')) return 'API 调用额度已耗尽，请稍后再试。';
  if (message.includes('403')) return 'API Key 权限不足或已被禁用。';
  if (message.includes('401') || message.includes('Key not configured')) return '系统未配置有效的 API Key，请联系管理员。';
  if (message.includes('safety')) return '生成内容因安全策略被拦截，请尝试修改描述。';
  return `生成失败: ${message}`;
};

/**
 * 准备 Phase 1/2 参考图列表（顺序: model, scene, products[0..2], accessories[0..1]）。
 *
 * 返回的 labels 与 refs 严格一一对应，空串表示"用户没打标"，后端按位置落 fallback label。
 * 保留 refs 作为独立数组是为了兼容老调用方（Phase0 服务里还是只用 refs）。
 */
export const preparePhase1Parts = async (
  inputs: InputFiles,
  _settings?: any,
  inputLabels?: InputLabels
): Promise<{ refs: string[]; labels: string[] }> => {
  const refs: string[] = [];
  const labels: string[] = [];
  const pickLabel = (field: keyof InputLabels, index?: number): string => {
    if (!inputLabels) return '';
    const v = (inputLabels as any)[field];
    if (Array.isArray(v)) return (index != null ? v[index] : '') || '';
    return (typeof v === 'string' ? v : '') || '';
  };

  if (inputs.model) {
    refs.push(await fileToDataUri(inputs.model));
    labels.push(pickLabel('model'));
  }
  if (inputs.scene) {
    refs.push(await fileToDataUri(inputs.scene));
    labels.push(pickLabel('scene'));
  }
  if (inputs.product) {
    const products = Array.isArray(inputs.product) ? inputs.product : [inputs.product];
    const trimmed = products.slice(0, 3);
    for (let i = 0; i < trimmed.length; i++) {
      refs.push(await fileToDataUri(trimmed[i]));
      labels.push(pickLabel('product', i));
    }
  }
  if (inputs.accessory && Array.isArray(inputs.accessory)) {
    const trimmed = inputs.accessory.slice(0, 2);
    for (let i = 0; i < trimmed.length; i++) {
      refs.push(await fileToDataUri(trimmed[i]));
      labels.push(pickLabel('accessory', i));
    }
  }
  return { refs, labels };
};

/**
 * Phase1 二步流 Step 2 — 将 Phase1 底图 + 动作参考图送入 phase2/generate 通道。
 * 底图 label = "参考图 #1"（Phase2 基准），poseRef label = "动作参考"，action = POSE_REF_IMAGE。
 * Phase2 prompt 的 [CORE MISSION] 锁定底图的服装/场景/人物，[POSE OVERRIDE] 强制复制参考图姿态。
 */
export const applyPoseToPhase1Result = async (
  baseImageUrl: string,
  poseRefUrl: string,
  settings: Phase1Settings,
): Promise<{ url: string }> => {
  const resp = await generateImageJob('/api/image/phase2/generate', {
    prompt: (settings.remark || '').trim() || 'apply pose reference to product image',
    phase: 'phase2',
    referenceImages: [baseImageUrl, poseRefUrl],
    referenceLabels: ['参考图 #1', '动作参考'],
    aspectRatio: settings.aspectRatio,
    imageSize: settings.imageSize,
    phaseConfig: {
      action: 'POSE_REF_IMAGE',
      remark: (settings.remark || '').trim(),
      compositionScope: settings.compositionScope,
      compositionTarget: settings.compositionTarget,
      garmentAttrs: settings.garmentAttrs,
    },
  });
  const url = resp.urls?.[0];
  if (!url) throw new Error('Pose application step returned no image.');
  return { url };
};

/**
 * Phase 1 生图
 *
 * @param referenceLabels 与 baseParts 等长的标签数组；空串 = 让后端按位置走默认 label。
 */
export const generateSinglePhase1Image = async (
  baseParts: string[],
  settings: Phase1Settings,
  referenceLabels?: string[],
  variationMeta?: { variationIndex: number; variationTotal: number; variationHint: string },
  // 槽位旗标：告诉后端这次 refs 数组里到底有没有 model / scene 参考图。
  // 缺省（undefined）= 兼容老调用方，后端按"位置 0=Main Model, 位置 1=Background"老规则映射；
  // 显式传 hasModelRef=false 后，后端会把位置 0 往后顺移，并切换到 FREE CASTING prompt 模式，
  // 让 Gemini 在没有主模特参考图时自由选角，而不是把 scene/product 当成 Main Model 锁脸。
  slotFlags?: { hasModelRef?: boolean; hasSceneRef?: boolean; hasPoseRef?: boolean }
): Promise<{ url: string; usedFallback: boolean }> => {
  const resp = await generateImageJob('/api/image/phase1/generate', {
    prompt: settings.remark || 'commercial photography',
    phase: 'phase1',
    referenceImages: baseParts,
    referenceLabels: referenceLabels && referenceLabels.length ? referenceLabels : undefined,
    aspectRatio: settings.aspectRatio,
    imageSize: settings.imageSize,
    phaseConfig: {
      shotType: settings.shotType,
      tone: settings.tone,
      atmosphere: settings.atmosphere,
      remark: settings.remark,
      compositionScope: settings.compositionScope,
      compositionTarget: settings.compositionTarget,
      garmentAttrs: settings.garmentAttrs,
      variationIndex: variationMeta?.variationIndex,
      variationTotal: variationMeta?.variationTotal,
      variationHint: variationMeta?.variationHint ?? '',
      hasModelRef: slotFlags?.hasModelRef,
      hasSceneRef: slotFlags?.hasSceneRef,
      hasPoseRef: slotFlags?.hasPoseRef,
    },
  });
  const url = resp.urls?.[0];
  if (!url) throw new Error('No image was generated.');
  return { url, usedFallback: false };
};

/**
 * Phase 2 生图
 *
 * @param referenceLabels 与 baseParts 等长的标签数组；空串 = 后端按位置走默认 label。
 */
export const generateSinglePhase2Image = async (
  baseParts: string[],
  action: string,
  settings: Phase2Settings,
  referenceLabels?: string[],
  variationMeta?: { variationIndex: number; variationTotal: number; variationHint: string }
): Promise<{ url: string; actionLabel: string; usedFallback: boolean }> => {
  const baseAction = settings.poseAction && settings.poseAction !== 'Maintain original pose'
    ? settings.poseAction
    : (action === 'DETAIL_FABRIC' ? '面料特写' : action === 'DETAIL_LIFESTYLE' ? '生活交互' : action === 'DETAIL_FLATLAY' ? '平铺资产' : action === 'POSE_REF_IMAGE' ? '参考图姿态' : 'Refined');
  const gesture = settings.gestureAction && settings.gestureAction !== '无额外手势' ? settings.gestureAction : '';
  const actionLabel = gesture ? `${baseAction} + ${gesture}` : baseAction;

  const resp = await generateImageJob('/api/image/phase2/generate', {
    prompt: settings.remark || 'refinement',
    phase: 'phase2',
    referenceImages: baseParts,
    referenceLabels: referenceLabels && referenceLabels.length ? referenceLabels : undefined,
    aspectRatio: settings.aspectRatio,
    imageSize: settings.imageSize,
    phaseConfig: {
      action,
      expression: settings.expression,
      focus: settings.focus,
      detailFocus: settings.detailFocus,
      fabricDetail: settings.fabricDetail,
      flatLayDetail: settings.flatLayDetail,
      lighting: settings.lighting,
      remark: settings.remark,
      compositionScope: settings.compositionScope,
      compositionTarget: settings.compositionTarget,
      poseAction: settings.poseAction,
      gestureAction: settings.gestureAction,
      customAction: settings.customAction,
      garmentAttrs: settings.garmentAttrs,
      variationIndex: variationMeta?.variationIndex,
      variationTotal: variationMeta?.variationTotal,
      variationHint: variationMeta?.variationHint ?? '',
    },
  });
  const url = resp.urls?.[0];
  if (!url) throw new Error('No image was generated.');
  return {
    url,
    actionLabel: !!settings.flatLayDetail ? '平铺资产' : actionLabel,
    usedFallback: false,
  };
};

/**
 * 通用生图
 */
export const generateImageFromPrompt = async (
  baseParts: string[],
  prompt: string,
  settings: Phase1Settings | Phase2Settings
): Promise<{ url: string; usedFallback: boolean }> => {
  const resp = await generateImageJob('/api/image/phase1/generate', {
    prompt,
    phase: 'phase1',
    referenceImages: baseParts,
    aspectRatio: settings.aspectRatio,
    imageSize: settings.imageSize,
    phaseConfig: { remark: prompt },
  });
  const url = resp.urls?.[0];
  if (!url) throw new Error('No image was generated.');
  return { url, usedFallback: false };
};

/** @deprecated 不再直接调 Gemini */
export async function callAIProxy(_model: string, _contents: any, _config?: any): Promise<any> {
  throw new Error('callAIProxy is deprecated. Use api.post.');
}

/** @deprecated */
export async function callAIProxyWithFallback(_contents: any, _config?: any): Promise<any> {
  throw new Error('callAIProxyWithFallback is deprecated.');
}

// ===================== Phase 3 — 影调大师 =====================
//
// 整段对接的是 ai-python 的 Phase 3 流水线（达芬奇式整体调色，禁改服装本色）。
// 由两个端点动作组成，复用同一个 Java 路由 POST /api/image/phase3/generate，由
// phase_config.step 区分子动作：
//
//   ┌────────────── Step 1: 灵感图 → 视觉 DNA ──────────────┐
//   │ extractToneDNA(refImageDataUri)                       │
//   │   phaseConfig = { step: 'dna' }                       │
//   │   Java _phase3 → ai-python _phase3_dna                │
//   │   prompt: build_phase3_dna_prompt()                   │
//   │   模型链: dna_chain()（flash 优先，免费配额走得动）   │
//   │   返回: response.rawResponse = JSON 文本              │
//   │     { tags: "k1, k2, ... (12-15)",                    │
//   │       translation: { color, lighting, texture, mood }}│
//   │   前端 JSON.parse 后落到 p3Settings.styleDNA /        │
//   │   dnaTranslation                                      │
//   └───────────────────────────────────────────────────────┘
//
//   ┌────────────── Step 2: 单底片 → 影调渲染 ──────────────┐
//   │ generateSinglePhase3Image({ baseDataUri, styleDNA,    │
//   │   intensity, grain, contrast, imageSize, remark })    │
//   │   phaseConfig = { step:'generate', styleDNA,          │
//   │     intensity, grain, contrast,                       │
//   │     targetQuality: imageSize, remark }                │
//   │   Java _phase3 → ai-python _phase3_generate           │
//   │   prompt: build_phase3_prompt(remark=…)               │
//   │     — DaVinci-style global grade，6 条 HARD CONSTRAINT│
//   │       100% 保服装本色 / 模特身份 / 构图                │
//   │     — remark 非空时插入 [P0 USER DIRECTIVE] 段，       │
//   │       优先级覆盖 styleDNA 默认倾向                     │
//   │   模型链: image_chain(preferred_first=PRO)            │
//   │   返回: response.urls[0]                              │
//   └───────────────────────────────────────────────────────┘
//
// remark 全程小心透传：UI textarea(maxLength=200) → Workspace.handleBatchRender
//   → 这里(trim) → Java HashMap → ai-python pc.get('remark') → prompt 嵌入。
// 任何一环漏写或类型不符都会让"P0 高优先级"指令失效。

export interface VisualDNAResponse {
  tags: string;
  translation: {
    color: string;
    lighting: string;
    texture: string;
    mood: string;
  };
}

/**
 * 从 Java HashMap.toString 输出（`{urls=[], text={...}, used_model=...}`）中提取 text=后的 JSON 值。
 * 兼容老 Java 部署（未更新 setRawResponse）以及 Gemini 用 markdown fence 包裹 JSON 的情况：
 *   text=```json\n{...}\n```, raw=...
 * 如果 raw 本身已是干净 JSON（新 Java），则不会命中此分支。
 */
function extractTextFromJavaMapString(raw: string): string | null {
  const idx = raw.indexOf('text=');
  if (idx < 0) return null;
  let i = idx + 5;
  // 跳过 text= 后的空白
  while (i < raw.length && /\s/.test(raw[i])) i++;
  // 跳过可能的 markdown opening fence: ```json\n 或 ```\n
  if (raw.substring(i, i + 3) === '```') {
    i += 3;
    // 跳过语言标识符（json / JSON / 等字母）
    while (i < raw.length && /[a-zA-Z]/.test(raw[i])) i++;
    // 跳过换行/空白
    while (i < raw.length && /\s/.test(raw[i])) i++;
  }
  if (raw[i] !== '{') return null;
  // 计 { } 深度，忽略字符串内部的 {
  let depth = 0;
  let inStr = false;
  let esc = false;
  const start = i;
  for (; i < raw.length; i++) {
    const c = raw[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return null;
}

export async function extractToneDNA(
  refImageDataUri: string,
  // V5.XVII.K.2：true 时旁路 ai-python DNA Redis 缓存，强制重新调 Gemini
  forceRefresh = false,
): Promise<VisualDNAResponse> {
  // Java GenerateRequest 的 prompt 字段是 @NotBlank，DNA 提取实际 prompt 在 ai-python prompt_engine
  // 这里仅传非空占位以通过 Java validation
  const resp = await generateImageJob('/api/image/phase3/generate', {
    phase: 'phase3',
    prompt: 'Extract visual style DNA from reference image.',
    referenceImages: [refImageDataUri],
    phaseConfig: {
      step: 'dna',
      ...(forceRefresh ? { force_refresh: true } : {}),
    },
  });
  const raw = (resp.rawResponse ?? '').trim();

  // 解析路径：
  //  A) raw 本身是 JSON（Java 已更新为返回 text 字段）
  //  B) raw 是 Java HashMap.toString，需提取 text=... JSON
  //  C) raw 被 ```json ... ``` markdown fence 包裹
  let payload: string = raw;
  if (!payload.startsWith('{')) {
    const fromMap = extractTextFromJavaMapString(payload);
    if (fromMap) payload = fromMap;
  }
  payload = payload
    .replace(/^```(?:json|JSON)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  // 兜底：截取首尾大括号之间的最大 JSON 子串
  const firstBrace = payload.indexOf('{');
  const lastBrace = payload.lastIndexOf('}');
  const candidate = firstBrace >= 0 && lastBrace > firstBrace
    ? payload.slice(firstBrace, lastBrace + 1)
    : payload;

  // V5.XIV.5: 解析失败 → 抛错；不再返回占位 translation 让 styleDNA 静默为空
  // 进入生成阶段（后续 handleBatchRender 会用空 styleDNA 调后端，必然 400 / 走
  // 不出意义的渲染）。抛错由 Workspace.handleP3ExtractDNA 的 try/catch 弹 alert，
  // 让用户立刻知情并重试。
  let parsed: any;
  try {
    parsed = JSON.parse(candidate);
  } catch (err) {
    console.error('[Phase3] DNA JSON parse failed:', err, '\nraw response (first 500):', raw.slice(0, 500));
    throw new Error('DNA 解析失败：后端返回的不是合法 JSON，请重试。详细信息见浏览器控制台。');
  }
  if (!parsed?.tags && !parsed?.translation) {
    console.error('[Phase3] DNA JSON shape invalid:', parsed);
    throw new Error('DNA 解析失败：返回的 JSON 缺少 tags / translation 字段，请重试。');
  }
  return {
    tags: typeof parsed.tags === 'string' ? parsed.tags : '',
    translation: parsed.translation ?? { color: '', lighting: '', texture: '', mood: '' },
  } as VisualDNAResponse;
}

/**
 * Phase 3 单底片影调渲染 —— 见本文件顶部 Step 2 流程图。
 *
 * - baseDataUri：必须是 data:image/...;base64,...（来自队列/成品库 originalUrl/本地导入）。
 *   后端 Java persistImages 看到 `data:` 前缀才会落盘 image/phase3/<uuid>.png；
 *   外链直通时不会复制到本地。
 * - styleDNA：12-15 个英文 tag 的逗号串（Step 1 提取产物）。会成为 prompt 的
 *   "Style DNA (mood / palette reference)"，作用于 LUT/曲线，不作用于服装本色。
 * - intensity：0-1，会乘 100 写入 prompt 的 "Grade intensity %"。
 * - grain：film grain on/off；prompt 切换为 "organic 35mm" vs "clean digital finish"。
 * - contrast：Low/Standard/High，直出到 prompt "Contrast curve" 行。
 * - imageSize：1K/2K/4K；4K 较慢，配合 PRO 顶链首调用时间可达 60s+，由 Vite proxy 200s 兜底。
 * - remark：用户控制面板 200 字内输入，trim 后透传；非空时进入 prompt 的
 *   [P0 USER DIRECTIVE — HIGHEST PRIORITY] 段，会覆盖 styleDNA 的默认倾向。
 *   ⚠ 空串 ""  → Python 侧 `(remark or '').strip()` 视为无 directive，不写 P0 块。
 */
export async function generateSinglePhase3Image(params: {
  baseDataUri: string;
  styleDNA: string;
  inspirationImage?: string;
  intensity: number;
  grain: boolean;
  contrast: 'Low' | 'Standard' | 'High';
  imageSize: string;
  remark?: string;
  garmentAttrs?: import('@/types').GarmentAttrs[];
}): Promise<{ url: string }> {
  const resp = await generateImageJob('/api/image/phase3/generate', {
    phase: 'phase3',
    prompt: params.styleDNA,
    referenceImages: [params.baseDataUri],
    imageSize: params.imageSize,
    phaseConfig: {
      step: 'generate',
      styleDNA: params.styleDNA,
      inspirationImage: params.inspirationImage || '',
      intensity: params.intensity,
      grain: params.grain,
      contrast: params.contrast,
      targetQuality: params.imageSize,
      remark: (params.remark || '').trim(),
      garmentAttrs: params.garmentAttrs,
    },
  });
  const url = resp.urls?.[0];
  if (!url) throw new Error('Phase3 generation returned no image.');
  return { url };
}
