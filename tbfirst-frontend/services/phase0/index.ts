/**
 * Phase 0: Visual DNA 提取 + 资产重构 — 对接 tbfirst 后端
 */
import { AssetStudioSettings } from '@/types';
import { generateImageJob } from '@/services/imageJob';
import { fileToDataUri } from '@/services/shared/imagePartUtils';

interface GenerateResponse {
  jobId: number;
  status: string;
  urls: string[];
  rawResponse?: string;
}

/**
 * Phase 0 Step 1: Visual DNA Extraction
 *
 * errorConclude #41 延伸：
 *   - detailImages 是用户在 mannequinDetail 槽里上传的"细节/额外角度"图；本轮起真正下发给 Gemini
 *     （此前只是前端 state 留存、不进入请求），让 DNA 分析能参考多角度信息。
 *   - labels 与 (front/side/back/...detailImages) 的拼接顺序严格对齐，透传为 referenceLabels。
 *     空串表示"让后端按位置走默认 ViewName / Detail Reference #N"。
 */
export const analyzeGarmentStructure = async (
  // V5.XVII.G：参数类型扩成 File | string —— processFiles 已会把 File 上传换短链塞回
  // inputs[field]，绝大多数情况这里其实是 string 短链。fileToDataUri 内部支持透传 string。
  frontImage: File | string,
  sideImage: File | string | undefined,
  backImage: File | string | undefined,
  extraremark?: string,
  detailImages?: (File | string)[],
  labels?: {
    front?: string;
    side?: string;
    back?: string;
    details?: string[];
  },
  // V5.XVII.K.2：透传给 ai-python 的 DNA 缓存旁路开关，true 时强制重新调 Gemini
  forceRefresh?: boolean,
): Promise<string> => {
  const referenceImages: string[] = [];
  const referenceLabels: string[] = [];

  referenceImages.push(await fileToDataUri(frontImage));
  referenceLabels.push(labels?.front || '');
  if (sideImage) {
    referenceImages.push(await fileToDataUri(sideImage));
    referenceLabels.push(labels?.side || '');
  }
  if (backImage) {
    referenceImages.push(await fileToDataUri(backImage));
    referenceLabels.push(labels?.back || '');
  }
  if (detailImages && detailImages.length > 0) {
    for (let i = 0; i < detailImages.length; i++) {
      referenceImages.push(await fileToDataUri(detailImages[i]));
      referenceLabels.push(labels?.details?.[i] || '');
    }
  }

  const hasAnyLabel = referenceLabels.some((l) => !!l);
  const resp = await generateImageJob('/api/image/phase0/generate', {
    prompt: extraremark || 'Analyze garment structure',
    phase: 'phase0',
    referenceImages,
    // 整组空串就不发，保持请求体精简；后端按位置走默认 label
    referenceLabels: hasAnyLabel ? referenceLabels : undefined,
    phaseConfig: {
      step: 'dna',
      remark: extraremark,
      ...(forceRefresh ? { force_refresh: true } : {}),
    },
  });

  // DNA 分析返回的是文本（在 rawResponse 或 urls 中）
  // Python 端返回 text 字段
  return resp.rawResponse || resp.urls?.[0] || 'Standard garment structure specification';
};

/**
 * Phase 0 Step 2: Industrial Asset Reconstruction
 */
export const generatePhase0Asset = async (
  // V5.XVII.G：同 analyzeGarmentStructure —— processFiles 后 inputs[field] 已是短链
  inputImages: { front: File | string; side?: File | string; back?: File | string },
  dnaremark: string,
  view: string,
  settings: AssetStudioSettings
): Promise<string> => {
  const referenceImages: string[] = [];
  referenceImages.push(await fileToDataUri(inputImages.front));
  if (inputImages.side) referenceImages.push(await fileToDataUri(inputImages.side));
  if (inputImages.back) referenceImages.push(await fileToDataUri(inputImages.back));

  const resp = await generateImageJob('/api/image/phase0/generate', {
    prompt: dnaremark,
    phase: 'phase0',
    referenceImages,
    aspectRatio: settings.aspectRatio,
    imageSize: settings.imageSize,
    phaseConfig: {
      step: 'asset',
      view,
      dna: dnaremark,
      smartRetouch: settings.smartRetouch,
      remark: settings.remark,
    },
  });

  const url = resp.urls?.[0];
  if (!url) throw new Error('Asset reconstruction failed.');
  return url;
};
