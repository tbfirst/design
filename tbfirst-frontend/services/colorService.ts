/**
 * 色彩实验室 — 对接 tbfirst 后端 phase2Color
 */
import { Phase2ColorSettings } from '@/types';
import { generateImageJob } from '@/services/imageJob';

interface GenerateResponse {
  jobId: number;
  status: string;
  urls: string[];
  rawResponse?: string;
}

/**
 * 生成改色图像
 */
export const generateColorVariantImage = async (
  baseImageBase64: string,
  settings: Phase2ColorSettings
): Promise<{ url: string; label: string }> => {
  const referenceImages: string[] = [baseImageBase64];
  if (settings.referenceImageUrl) {
    referenceImages.push(settings.referenceImageUrl);
  }

  const resp = await generateImageJob('/api/image/phase2Color/generate', {
    prompt: `Color change: ${settings.targetColor || 'reference texture'}`,
    phase: 'phase2Color',
    referenceImages,
    aspectRatio: settings.aspectRatio,
    imageSize: settings.imageSize,
    phaseConfig: {
      targetColor: settings.targetColor,
      targetArea: settings.targetArea,
      remark: settings.remark,
      intensity: settings.intensity,
      referenceImageUrl: settings.referenceImageUrl ? 'provided' : null,
    },
  });

  const url = resp.urls?.[0];
  if (!url) throw new Error('Color variation generation failed.');
  return {
    url,
    label: `改色: ${settings.targetColor || '参考纹理'}`,
  };
};
