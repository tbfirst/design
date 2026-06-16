/**
 * Phase4 视频生成服务 —— 对接 tbfirst-image 的 phase4 视频端点
 *
 * 后端路由（均走 tbfirst-gateway:8000，需 JWT）：
 *   POST /api/image/phase4/generate-video   → { jobId, status }
 *   GET  /api/image/video-jobs/{jobId}      → { jobId, status, videoUrl?, errorMsg? }
 *
 * 链路：前端 → gateway → tbfirst-image → Feign → tbfirst-ai-python /video/generate
 * Python 立即返回 pending（< 1s）+ 后台 asyncio 轮询 Veo Operation，结果写 Redis
 * key `video:job:{jobId}`，TTL 24h。前端轮询 video-jobs 接口直到 success/failed。
 */
import { api } from '@/services/api';
import type { Phase4Settings, VideoJob } from '@/types';

interface VideoJobApiDto {
  jobId: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  videoUrl?: string;
  errorMsg?: string;
}

/**
 * 触发一次视频生成；Python 立即返回 pending + jobId。
 * 前端拿到 jobId 后开始轮询 getVideoJob。
 */
export async function generateVideo(settings: Phase4Settings): Promise<VideoJobApiDto> {
  return api.post<VideoJobApiDto>('/api/image/phase4/generate-video', {
    phase: 'phase4',
    prompt: settings.prompt,
    model: settings.model,
    durationSec: settings.durationSec,
    aspectRatio: settings.aspectRatio,
    referenceImageUrl: settings.referenceImage || null,
  });
}

/**
 * 查询单个视频任务状态。
 * 终态（success / failed）由调用方负责停止轮询。
 *
 * jobId 走 query param 而非 path —— Veo 的 jobId 形如
 * `models/veo-3.0-generate-001/operations/xxx`，含多个 `/`：
 * 放 path 里 encodeURIComponent 后会产生 `%2F`，触发 Tomcat / Spring firewall
 * 默认的"路径不允许含编码斜杠"安全规则（CVE 防护）返回 400。
 */
export async function getVideoJob(jobId: string): Promise<VideoJobApiDto> {
  return api.get<VideoJobApiDto>(`/api/image/video-jobs?jobId=${encodeURIComponent(jobId)}`);
}

/**
 * 给 Workspace 用的"已知非终态时继续轮询"判定。
 */
export function isVideoJobTerminal(job: Pick<VideoJob, 'status'>): boolean {
  return job.status === 'success' || job.status === 'failed';
}
