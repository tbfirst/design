/**
 * 生图异步任务统一入口（P1 生图异步化前端侧）。
 *
 * 后端 generate 已改为"POST 立即返回 { jobId, status: 'pending' } → 后台出图"，
 * 本 helper 把"POST 触发 → 轮询 /jobs/{id}/status 到终态"封装成一次 await，
 * 返回与旧同步响应同构的对象（urls / rawResponse），因此各 service 函数只需把
 * `api.post(...)` 换成 `generateImageJob(...)`，其余逻辑与组件层零改动。
 *
 * 链路：前端 → gateway → tbfirst-image。POST 与每次 GET 都是短请求，
 * 不再有单条 60-600s 长连接（此前长连接常被 vite-proxy / 网关 / 浏览器在 idle 时 RST）。
 *
 * 失败语义：status=failed 抛 Error(errorMsg)，沿用既有 try/catch + getFriendlyError。
 */
import { api } from '@/services/api';

export interface ImageJobResult {
  jobId: number;
  /** pending | success | failed */
  status: string;
  urls?: string[];
  rawResponse?: string;
  errorMsg?: string;
}

// 轮询间隔与上限：生图最慢路径（4K / PRO 顶链）可达 ~600s，留足冗余到 11 分钟。
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 11 * 60 * 1000;

export async function generateImageJob(path: string, body: any): Promise<ImageJobResult> {
  const submitted = await api.post<ImageJobResult>(path, body);

  // 兼容：万一后端某路径仍同步直接返回终态，直接用之，不进轮询。
  if (submitted.status && submitted.status !== 'pending') {
    if (submitted.status === 'failed') {
      throw new Error(submitted.errorMsg || 'generation failed');
    }
    return submitted;
  }

  const jobId = submitted.jobId;
  if (jobId == null) {
    throw new Error('生图任务创建失败：后端未返回 jobId');
  }

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const job = await api.get<ImageJobResult>(`/api/image/jobs/${jobId}/status`);
    if (job.status === 'success') return job;
    if (job.status === 'failed') {
      throw new Error(job.errorMsg || 'generation failed');
    }
    // pending → 继续轮询
  }
  throw new Error('生图超时：任务仍在进行，可稍后在历史记录中查看结果。');
}
