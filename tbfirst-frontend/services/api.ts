/**
 * 统一 API 封装层 — 所有请求通过 tbfirst-gateway (http://localhost:8000)
 *
 * 职责：
 *   1. 从 localStorage 读 JWT，自动加 Authorization: Bearer <token>
 *   2. 401/403 → 清除 token + 跳 /login
 *   3. 统一解包 R<T>（{code, msg, data}）：code!==0 抛业务异常，否则返回 data
 *
 * 特殊场景：
 *   - 上传二进制 / 下载原始流：用 api.rawFetch 绕过 JSON 解包
 *   - /api/auth/me 同时兼任 ConnectionManager 心跳（见 errorConclude #18）
 */

const GATEWAY_BASE = '';  // Vite dev proxy 到 gateway:8000，生产环境配为实际域名

export interface ApiResponse<T = any> {
  code: number;
  msg: string;
  data: T;
  traceId?: string;
  timestamp?: number;
}

/**
 * 通用 fetch 封装
 */
async function request<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const token = sessionStorage.getItem('token');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // V5.XVII.E：把 fetch 异常抓住，区分"真没连上"vs"本次请求体太大/超时"。
  // 之前 fetch 直接抛 TypeError("Failed to fetch") 会被 getFriendlyError 一律
  // 译成"tbfirst-gateway 未启动或不可达"，可 gateway 在跑也照样报这个，无法定位。
  // 现在带出 path / body size / token 在场标志，方便控制台快速看出真因。
  let resp: Response;
  try {
    resp = await fetch(`${GATEWAY_BASE}${path}`, { ...options, headers });
  } catch (err: any) {
    // 计算 body 大小（仅当是字符串/Buffer 时；FormData/Blob 跳过）
    let bodyBytes = -1;
    const b: any = (options as any).body;
    if (typeof b === 'string') {
      bodyBytes = new Blob([b]).size;
    } else if (b instanceof Uint8Array) {
      bodyBytes = b.byteLength;
    }
    const hint =
      bodyBytes > 8 * 1024 * 1024 ? '（请求体 > 8MB，可能被浏览器或 vite-proxy 断开）' :
      bodyBytes > 0                ? `（请求体 ${(bodyBytes / 1024).toFixed(1)} KB）` : '';
    const detail =
      `[${(options.method || 'GET')} ${path}] ${err?.message || err} ${hint}`;
    // 控制台输出原始诊断，方便贴日志
    // eslint-disable-next-line no-console
    console.error('[api.fetch.error]', detail, { hasToken: !!token, bodyBytes });
    // 给上层一个 TypeError，message 含 'Failed to fetch' 字样以便兼容旧 getFriendlyError 分支
    const e = new TypeError(`Failed to fetch ${detail}`);
    (e as any).cause = err;
    throw e;
  }

  if (resp.status === 401 || resp.status === 403) {
    // 同时清掉 tokenExpiresAt，保持与 authService.logout() 一致；否则下一次路由判断仍以为在有效期内
    // 与 authService 保持一致：token 全部在 sessionStorage
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('user');
    sessionStorage.removeItem('tokenExpiresAt');
    window.location.replace('/login');
    throw new Error('Session expired');
  }

  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.msg || body.error || `HTTP ${resp.status}`);
  }

  const body: ApiResponse<T> = await resp.json();

  // R<T> 解包：code !== 0 表示业务异常
  if (body.code !== undefined && body.code !== 0) {
    throw new Error(body.msg || 'unknown error');
  }

  return body.data;
}

export const api = {
  get: <T = any>(path: string) => request<T>(path, { method: 'GET' }),

  post: <T = any>(path: string, data?: any) =>
    request<T>(path, {
      method: 'POST',
      body: data !== undefined ? JSON.stringify(data) : undefined,
    }),

  put: <T = any>(path: string, data?: any) =>
    request<T>(path, {
      method: 'PUT',
      body: data !== undefined ? JSON.stringify(data) : undefined,
    }),

  patch: <T = any>(path: string, data?: any) =>
    request<T>(path, {
      method: 'PATCH',
      body: data !== undefined ? JSON.stringify(data) : undefined,
    }),

  delete: <T = any>(path: string) => request<T>(path, { method: 'DELETE' }),

  /**
   * 原始 fetch（不解包 R<T>），用于需要原始响应的场景
   */
  rawFetch: async (path: string, options: RequestInit = {}) => {
    const token = sessionStorage.getItem('token');
    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string>),
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return fetch(`${GATEWAY_BASE}${path}`, { ...options, headers });
  },
};
