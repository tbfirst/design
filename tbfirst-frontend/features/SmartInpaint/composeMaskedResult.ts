/**
 * V5.XVII.B.8 — SmartInpaint 前端 mask-outside 像素硬锁合成。
 *
 * 设计目标（详见 .ralph/fix_plan.md 顶部 Spec Lock 段）：
 * - mask 黑色像素区 = 原图字节，保证用户报告的"重绘后衣服细节偏移"100% 消失；
 * - mask 白色像素区 = generated 像素，保留 Gemini 的局部生成结果；
 * - 红色 mask 不进 RGB 通道（mask 是 off-screen 二值 canvas 输出的 PNG，非显示层）；
 * - 零外部依赖（纯浏览器 Canvas + ImageData）；feather 用 ctx.filter='blur(Npx)' 软边。
 *
 * 公开签名（在 InpaintModal.handleGenerate 中调用）：
 *   composeMaskedResult({ originalSrc, generatedSrc, maskSrc, feather? }) → Promise<dataURL>
 *
 * CORS 兜底：generatedSrc 可能是 GCS 直链（V5.XV.6 引入的 toProxiedSrc 路径），
 * 这里 inline 一份 5 行级改写为 /img/<key>，避免跨目录依赖。
 * fetch 失败时也会 fallback 走 crossOrigin='anonymous' 的 Image() 加载。
 */

export interface ComposeMaskedResultOptions {
  originalSrc: string;
  generatedSrc: string;
  maskSrc: string;
  /** mask 边缘羽化半径（px）。0 = 硬边；默认 2，可在边界场景下手动调高。 */
  feather?: number;
}

function rewriteToProxy(url: string): string {
  if (!url) return url;
  if (url.startsWith('data:') || url.startsWith('blob:')) return url;
  if (url.startsWith('/img/') || url.includes('/img/')) return url;
  const m = url.match(/storage\.googleapis\.com\/[^/]+\/(.+?)(\?|$)/);
  if (m) return `/img/${m[1]}`;
  return url;
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  const url = rewriteToProxy(src);
  // 优先 fetch + blob URL（同源 + 自动带 cookie；不污染 canvas）；
  // 失败回退 crossOrigin='anonymous' 直加载，给纯前端测试用例留口子。
  if (url.startsWith('data:') || url.startsWith('blob:')) {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Image load failed: ${url.slice(0, 64)}…`));
      img.src = url;
    });
  }
  try {
    const headers: Record<string, string> = { Accept: 'image/*' };
    try {
      const token = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('token') : null;
      if (token) headers['Authorization'] = `Bearer ${token}`;
    } catch { /* sessionStorage 不可访问 */ }
    const r = await fetch(url, { credentials: 'include', headers, cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const blob = await r.blob();
    const blobUrl = URL.createObjectURL(blob);
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => { resolve(img); /* blob URL 不主动 revoke，留 GC 处理 */ };
      img.onerror = () => { URL.revokeObjectURL(blobUrl); reject(new Error('Blob decode failed')); };
      img.src = blobUrl;
    });
  } catch {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Image load failed: ${url.slice(0, 64)}…`));
      img.src = url;
    });
  }
}

/**
 * 把 src 图片画到一张新 canvas（自适应到目标尺寸，按比例 contain + 居中）；
 * generated 可能与原图不同尺寸 → 等比缩放贴到 originalImage 大小的画布上。
 */
function drawImageContain(
  img: HTMLImageElement,
  targetW: number,
  targetH: number,
): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = targetW;
  out.height = targetH;
  const ctx = out.getContext('2d');
  if (!ctx) return out;
  if (img.width === targetW && img.height === targetH) {
    ctx.drawImage(img, 0, 0);
    return out;
  }
  const r = Math.min(targetW / img.width, targetH / img.height);
  const drawW = img.width * r;
  const drawH = img.height * r;
  const dx = (targetW - drawW) / 2;
  const dy = (targetH - drawH) / 2;
  ctx.drawImage(img, dx, dy, drawW, drawH);
  return out;
}

export async function composeMaskedResult(opts: ComposeMaskedResultOptions): Promise<string> {
  const feather = Math.max(0, opts.feather ?? 2);
  const [origImg, genImg, maskImg] = await Promise.all([
    loadImage(opts.originalSrc),
    loadImage(opts.generatedSrc),
    loadImage(opts.maskSrc),
  ]);

  const W = origImg.width;
  const H = origImg.height;

  // 原图直接画
  const origCanvas = document.createElement('canvas');
  origCanvas.width = W;
  origCanvas.height = H;
  const origCtx = origCanvas.getContext('2d');
  if (!origCtx) throw new Error('Canvas 2D context unavailable');
  origCtx.drawImage(origImg, 0, 0);

  // generated 等比缩放贴到原图尺寸
  const genCanvas = drawImageContain(genImg, W, H);

  // mask 同样等比缩放贴到原图尺寸；可选 feather 模糊
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = W;
  maskCanvas.height = H;
  const maskCtx = maskCanvas.getContext('2d');
  if (!maskCtx) throw new Error('Canvas 2D context unavailable');
  if (feather > 0) {
    // ctx.filter 在浏览器内置高斯模糊，性能足够本场景（一张图一次）
    maskCtx.filter = `blur(${feather}px)`;
  }
  const maskBase = drawImageContain(maskImg, W, H);
  maskCtx.drawImage(maskBase, 0, 0);

  const origData = origCtx.getImageData(0, 0, W, H);
  const genCtx = genCanvas.getContext('2d');
  const maskOutCtx = maskCanvas.getContext('2d');
  if (!genCtx || !maskOutCtx) throw new Error('Canvas 2D context unavailable');
  const genData = genCtx.getImageData(0, 0, W, H);
  const maskData = maskOutCtx.getImageData(0, 0, W, H);

  const out = origCtx.createImageData(W, H);
  const o = origData.data;
  const g = genData.data;
  const m = maskData.data;
  const d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    // 用 mask 灰度推导 alpha（白=1 / 黑=0），feather 模糊后是 0..1 连续
    const a = m[i] / 255; // 二值 mask 三通道相等，直接读 R
    const inv = 1 - a;
    d[i]     = a * g[i]     + inv * o[i];
    d[i + 1] = a * g[i + 1] + inv * o[i + 1];
    d[i + 2] = a * g[i + 2] + inv * o[i + 2];
    d[i + 3] = 255;
  }
  origCtx.putImageData(out, 0, 0);
  return origCanvas.toDataURL('image/png');
}
