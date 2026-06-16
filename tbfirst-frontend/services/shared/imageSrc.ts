import type React from 'react';

/**
 * imageSrc.ts — V5.XV.6 同源图片代理工具
 *
 * 把 GCS 直链（`https://storage.googleapis.com/<bucket>/<key>?X-Goog-Signature=...`）
 * 改写为同源 `/img/<key>` 代理路径，用于 `<img src>` 渲染。
 *
 * 与 downloadHref.toDownloadHref 区别：本函数 **不附加** `?download=` 参数，避免
 * 浏览器误把 inline 渲染当成 attachment 下载。
 *
 * 输入形态：
 *   - data: / blob: → 原样返回（已是本地字节）
 *   - 已包含 `/img/` → 原样返回（已是反代路径）
 *   - GCS 直链 → 改写为 `/img/<key>`
 *   - 其他 → 原样返回
 */
export function toProxiedSrc(url: string | undefined | null): string {
  if (!url) return url ?? '';
  if (url.startsWith('data:') || url.startsWith('blob:')) return url;
  if (url.startsWith('/img/') || url.includes('/img/')) return url;
  const m = url.match(/storage\.googleapis\.com\/[^/]+\/(.+?)(\?|$)/);
  if (m) return `/img/${m[1]}`;
  return url;
}

/**
 * 把任意图片 URL 转为 /img/... 代理短链。
 * 行为与 toProxiedSrc 一致，语义更明确：专为"我知道这是一条需要代理的 URL"场景。
 */
export function toImgPath(url: string | undefined | null): string {
  return toProxiedSrc(url);
}

/**
 * `<img onError>` 处理器工厂：失败 1 次后自动改写为同源代理重试，防止首次
 * 缓存命中错误时永久卡死。data-proxied 标记位避免无限循环。
 */
export function makeImgErrorFallback() {
  return (e: React.SyntheticEvent<HTMLImageElement>) => {
    const t = e.currentTarget;
    if (t.dataset.proxied === '1') return; // 已重试过，避免死循环
    const next = toProxiedSrc(t.src);
    if (next === t.src) {
      t.dataset.proxied = '1';
      return;
    }
    t.dataset.proxied = '1';
    t.src = next;
  };
}
