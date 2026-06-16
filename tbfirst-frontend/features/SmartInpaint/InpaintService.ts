/**
 * SmartInpaint — 对接 tbfirst 后端 /api/image/inpaint
 */
import { api } from '@/services/api';

interface InpaintResponse {
  url: string;
  jobId: number;
}

export const generateInpaintImage = async (
  maskedImageBase64: string,
  promptText: string,
  referenceImageBase64: string | null | undefined,
  aspectRatio: string = '3:4',
  /**
   * V5.XVII.B.9：二值 mask 图（黑=保留 / 白=重绘）。
   * 空 / undefined → 不进 body，后端走 V5.XVII Sprint A 单图路径（向后兼容）。
   * 非空 → 后端走双图路径（build_inpaint_prompt has_mask_image=True 模板）。
   */
  maskImageBase64?: string,
  /**
   * V5.XVII.6：绝对禁止段（多行字符串，每行一条）。
   * 空 / undefined → 不进 body，后端 prompt 输出与 V5.XVI 字节级一致。
   */
  negativePrompt?: string,
): Promise<string> => {
  const body: Record<string, unknown> = {
    maskedImage: maskedImageBase64,
    prompt: promptText,
    referenceImage: referenceImageBase64 || undefined,
    aspectRatio,
  };
  if (maskImageBase64) {
    body.maskImage = maskImageBase64;
  }
  if (negativePrompt && negativePrompt.trim()) {
    body.negativePrompt = negativePrompt;
  }
  const resp = await api.post<InpaintResponse>('/api/image/inpaint', body);
  return resp.url;
};
