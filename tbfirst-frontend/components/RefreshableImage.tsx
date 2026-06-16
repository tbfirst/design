/**
 * RefreshableImage —— 长期渲染场景下自动重拉签名 URL 的 <img> 包装。
 *
 * 背景：
 *   v3 S2 起后端 provider=gcs 时，asset URL 是 V4 预签名（默认 TTL=15min）。
 *   用户在历史 modal、Phase 详情页停留超过 15 分钟后再次点击预览，浏览器
 *   会拿过期 URL 打到 storage.googleapis.com → 403 → broken image。
 *
 * 工作机制：
 *   <img onError> 触发后调 GET /api/image/jobs/{jobId}/urls，拿当前任务下
 *   一份新的 fresh URL 列表，按 urlIndex 取对应位的 URL 替换 src。每张图
 *   最多自动重试一次，避免 jobId 错误时无限循环。
 *
 * 与 provider=local 的兼容：
 *   local 模式下 /static/... 不会过期，正常情况不触发 onError；即使触发也安全
 *   降级（同一个 URL 重新拉一次）。组件无需感知 provider，全靠后端透明切换。
 *
 * 关联文档：cloud_plan.md § 10.2 坑 2、附录 C.5.3 onError 重拉模式
 */
import React, { useEffect, useRef, useState } from 'react';
import { authService } from '../features/Auth/authService';

interface Props extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src' | 'onError'> {
  /** 初始 URL（来自 /api/image/history 或 /api/image/{phase}/generate 的响应） */
  src: string;
  /** 该图所属的 generation_job 主键 —— 重拉时调 /api/image/jobs/{jobId}/urls */
  jobId: number;
  /** 该图在 job.assetUrls 中的位序（多图任务用） */
  urlIndex: number;
  /** 多次重试均失败后的回调（默认仅 console.warn） */
  onPermanentError?: () => void;
}

export const RefreshableImage: React.FC<Props> = ({
  src,
  jobId,
  urlIndex,
  onPermanentError,
  ...imgProps
}) => {
  const [currentSrc, setCurrentSrc] = useState(src);
  // 标记是否已经触发过一次自动重拉，避免无限循环（譬如 jobId 错位 / 桶里对象真没了）
  const refreshedRef = useRef(false);

  // 父组件传入的 src 变了（譬如切换不同 job），重置内部状态以再次允许一次重拉
  useEffect(() => {
    setCurrentSrc(src);
    refreshedRef.current = false;
  }, [src]);

  const handleError = async () => {
    if (refreshedRef.current) {
      // 第二次失败：放弃自动重试，让浏览器显示 broken icon，把决定权交给 caller
      console.warn('[RefreshableImage] still failing after refresh, giving up', { jobId, urlIndex });
      onPermanentError?.();
      return;
    }
    refreshedRef.current = true;
    try {
      const resp = await authService.fetchWithAuth(`/api/image/jobs/${jobId}/urls`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const body = await resp.json();
      if (body.code !== undefined && body.code !== 0) {
        throw new Error(body.msg || `code=${body.code}`);
      }
      const urls: string[] = body.data || [];
      const next = urls[urlIndex];
      if (!next) {
        console.warn('[RefreshableImage] refreshed urls missing index', { jobId, urlIndex, urls });
        onPermanentError?.();
        return;
      }
      setCurrentSrc(next);
    } catch (err) {
      console.warn('[RefreshableImage] refresh failed', err);
      onPermanentError?.();
    }
  };

  return <img {...imgProps} src={currentSrc} onError={handleError} />;
};

export default RefreshableImage;
