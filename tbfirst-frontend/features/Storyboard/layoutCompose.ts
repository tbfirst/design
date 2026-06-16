import type { GridImage, LayoutSlot } from './StoryboardTypes';
import { gridDims } from './StoryboardTypes';
import { toProxiedSrc } from '@/services/shared/imageSrc';

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('图片加载失败: ' + url));
    im.src = toProxiedSrc(url); // 同源 /img/，画到 canvas 不污染
  });
}

/**
 * 把「排版」阶段当前的槽位排布合成为一张成片 data URI（与 Stage4Layout 导出成片同逻辑）。
 * 视频生成「使用当前项目」时据此取参考图，确保排版改动后实时反映。
 * 无任何已填槽位时返回 null（调用侧回退到原始宫格图）。
 */
export async function composeLayoutDataUri(
  slots: LayoutSlot[],
  gridImages: GridImage[],
  gridCount: number,
): Promise<string | null> {
  const [rows, cols] = gridDims(gridCount);
  const urlById = new Map(gridImages.map(g => [g.id, g.imageUrl] as const));
  const used = Array.from(new Set(slots.map(s => s.sourceImageId).filter((x): x is string => !!x)));
  if (used.length === 0) return null;

  const imgs = new Map<string, HTMLImageElement>();
  await Promise.all(used.map(async id => {
    const url = urlById.get(id);
    if (url) imgs.set(id, await loadImage(url));
  }));
  const base = imgs.get(used[0]);
  if (!base) return null;

  const cellW = Math.max(1, Math.round(base.naturalWidth / cols));
  const cellH = Math.max(1, Math.round(base.naturalHeight / rows));
  const canvas = document.createElement('canvas');
  canvas.width = cellW * cols;
  canvas.height = cellH * rows;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  slots.forEach((s, idx) => {
    if (!s.sourceImageId || s.cellIndex == null) return;
    const im = imgs.get(s.sourceImageId);
    if (!im) return;
    const sCellW = im.naturalWidth / cols;
    const sCellH = im.naturalHeight / rows;
    const sr = Math.floor(s.cellIndex / cols);
    const sc = s.cellIndex % cols;
    const dr = Math.floor(idx / cols);
    const dc = idx % cols;
    ctx.drawImage(im, sc * sCellW, sr * sCellH, sCellW, sCellH, dc * cellW, dr * cellH, cellW, cellH);
  });
  return canvas.toDataURL('image/jpeg', 0.9);
}
