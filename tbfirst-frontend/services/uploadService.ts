/**
 * V5.XVII.E：通用参考图上传服务
 *
 * 用途：
 *   - Phase2 / Phase2Color / Phase3 的"拖拽 / 粘贴 / 选文件"上传参考图场景。
 *   - 浏览器拿到 File 对象 → 压缩 → FileReader 转 data URI base64 → 调本服务落 GCS → 拿短链。
 *
 * 不要直接把 base64 塞 selectedBaseImages：
 *   原本 Phase2.tsx::processFiles 直接把 base64 塞 selectedBaseImages，
 *   导致后续 phase2/generate 请求 body 累加几张图后 > 10MB，浏览器 / vite-proxy
 *   在传输途中断连，fetch 抛 TypeError("Failed to fetch")，被 getFriendlyError
 *   误判为 "网关未启动"。改用本服务先换短链，request body 永远稳定在几 KB。
 */
import { api } from '@/services/api';
import { fileToDataUri } from '@/services/shared/imagePartUtils';

interface UploadResponse {
  urls: string[];
}

/**
 * 上传前客户端压缩：把大图缩到 maxDim×maxDim 以内，JPEG quality=0.85。
 * 原本 3-5MB 的手机照片压缩后约 150-400KB，POST body 缩小 90%，上传时间从 15-30s 降到 2-5s。
 * 若图片尺寸已在 maxDim 以内则原样返回，避免多余编解码。
 * 出错时静默退回原始 File，不阻塞上传流程。
 */
export const compressImage = async (
  file: File,
  maxDim = 1024,
  quality = 0.85,
): Promise<File> => {
  return new Promise((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const { naturalWidth: w, naturalHeight: h } = img;
      if (w <= maxDim && h <= maxDim) { resolve(file); return; }
      const scale = maxDim / Math.max(w, h);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(file); return; }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => {
          if (!blob) { resolve(file); return; }
          resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }));
        },
        'image/jpeg',
        quality,
      );
    };
    img.onerror = () => { URL.revokeObjectURL(objectUrl); resolve(file); };
    img.src = objectUrl;
  });
};

/**
 * 把 data URI 列表上传到 GCS，返回与入参等长的短链 URL 列表。
 *
 * @param dataUris  必须是 data:image/...;base64,... 形式；非 data URI 会被后端拒
 * @param phase     存储桶子目录，缺省 "upload"；保持与生图阶段桶子目录隔离
 */
export const uploadDataUrisToGcs = async (
  dataUris: string[],
  phase: string = 'upload',
): Promise<string[]> => {
  if (!dataUris || dataUris.length === 0) return [];
  const resp = await api.post<UploadResponse>('/api/image/upload', {
    dataUris,
    phase,
  });
  return resp.urls || [];
};

/**
 * File[] 一站式上传 —— 内部把 File → 压缩 → data URI → GCS 短链。
 * 任一文件转换失败抛错，调用方应负责 UI 兜底（toast / 错误占位）。
 */
export const uploadFilesToGcs = async (
  files: File[],
  phase: string = 'upload',
): Promise<string[]> => {
  if (!files || files.length === 0) return [];
  const compressed = await Promise.all(files.map((f) => compressImage(f)));
  const uris = await Promise.all(compressed.map((f) => fileToDataUri(f)));
  return uploadDataUrisToGcs(uris, phase);
};
