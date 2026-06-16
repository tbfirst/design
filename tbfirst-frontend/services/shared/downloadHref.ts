/**
 * downloadHref.ts — V5.XII.6 下载链接转换
 *
 * 浏览器下载按钮的 `href` 走 `/img/<key>?download=<filename>`，让后端 GCS 反代
 * 注入 `Content-Disposition: attachment; filename=...`，从而触发系统文件保存对话框，
 * 而不是直接跳到 GCS 域名 inline 渲染。
 *
 * 输入形态：
 *   1. 已是反代路径（`/img/...` 或绝对 URL 含 `/img/`） → 追加 `?download=` 查询参数
 *   2. GCS 直链（`https://storage.googleapis.com/<bucket>/<key>`） → 抽 key 转 `/img/<key>?download=...`
 *   3. 本地 `/static/...` / data URI / 其它 → 原样返回（兜底，避免破坏现有行为）
 */
export function toDownloadHref(url: string, filename: string): string {
  if (!url) return url;
  const encodedName = encodeURIComponent(filename);

  // 1. 已是反代路径
  if (url.startsWith('/img/') || url.includes('/img/')) {
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}download=${encodedName}`;
  }

  // 2. GCS 直链 → 改写为反代路径
  const m = url.match(/storage\.googleapis\.com\/[^/]+\/(.+?)(\?|$)/);
  if (m) {
    return `/img/${m[1]}?download=${encodedName}`;
  }

  // 3. 兜底：原样返回（含 data: / blob: / /static/ 等）
  return url;
}
