import type { Shot } from './StoryboardTypes';
import { FONT_BODY } from './theme';

interface Col { key: string; label: string; w: number }
interface TableTheme {
  surface: string; bgTint: string; line: string; ink: string; inkSoft: string; accent: string;
}

/**
 * 把分镜表（Shot[]）绘制成一张分镜表 PNG（镜头号 + 传入的文本列，省略操作列）。
 * 纯 Canvas，无第三方依赖；中文逐字换行、按内容算行高、按 devicePixelRatio 放大保证清晰。
 */
export async function renderShotTableToCanvas(
  shots: Shot[],
  columns: Col[],
  theme: TableTheme,
): Promise<Blob> {
  const TOTAL_W = 1500;        // 目标 CSS 像素总宽
  const PAD_X = 10;
  const PAD_Y = 8;
  const FONT_SIZE = 13;
  const HEADER_FONT_SIZE = 12;
  const LINE_H = 19;
  const NO_COL_W = 64;         // 镜头号列固定宽

  // 列宽：镜头号固定，其余按 w 比例分摊剩余宽
  const sumW = columns.reduce((a, c) => a + c.w, 0) || 1;
  const restW = TOTAL_W - NO_COL_W;
  const cols = [
    { key: '__no__', label: '镜头号', width: NO_COL_W },
    ...columns.map(c => ({ key: c.key, label: c.label, width: Math.max(60, Math.round((c.w / sumW) * restW)) })),
  ];
  const tableW = cols.reduce((a, c) => a + c.width, 0);

  // 测量用 ctx（换行）
  const mctx = document.createElement('canvas').getContext('2d')!;
  mctx.font = `${FONT_SIZE}px ${FONT_BODY}`;

  const wrap = (text: string, maxW: number): string[] => {
    const out: string[] = [];
    for (const para of String(text ?? '').split('\n')) {
      if (para === '') { out.push(''); continue; }
      let line = '';
      for (const ch of para) { // 逐字（中文无空格）
        const test = line + ch;
        if (line && mctx.measureText(test).width > maxW) { out.push(line); line = ch; }
        else line = test;
      }
      out.push(line);
    }
    return out;
  };

  const cellText = (s: Shot, key: string, idx: number): string =>
    key === '__no__' ? String(idx + 1) : String((s as unknown as Record<string, unknown>)[key] ?? '');

  // 预计算每行换行 + 行高
  const rowsLines = shots.map((s, idx) => {
    const lines = cols.map(c => wrap(cellText(s, c.key, idx), c.width - PAD_X * 2));
    const maxLines = Math.max(1, ...lines.map(l => l.length));
    return { lines, height: maxLines * LINE_H + PAD_Y * 2 };
  });

  const headerH = HEADER_FONT_SIZE + PAD_Y * 2 + 6;
  const tableH = headerH + rowsLines.reduce((a, r) => a + r.height, 0);

  // DPR：超大表降到 1，避免越过 canvas 32767 上限
  const rawDpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  const dpr = tableH * rawDpr > 16000 ? 1 : rawDpr;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(tableW * dpr);
  canvas.height = Math.round(tableH * dpr);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  ctx.textBaseline = 'top';

  // 背景
  ctx.fillStyle = theme.surface;
  ctx.fillRect(0, 0, tableW, tableH);

  // 表头带
  ctx.fillStyle = theme.bgTint;
  ctx.fillRect(0, 0, tableW, headerH);
  ctx.font = `700 ${HEADER_FONT_SIZE}px ${FONT_BODY}`;
  ctx.fillStyle = theme.inkSoft;
  let hx = 0;
  cols.forEach(c => { ctx.fillText(c.label, hx + PAD_X, PAD_Y + 2); hx += c.width; });

  // 行文本
  let y = headerH;
  rowsLines.forEach(({ lines, height }) => {
    let cx = 0;
    cols.forEach((c, ci) => {
      const isNo = c.key === '__no__';
      ctx.fillStyle = isNo ? theme.accent : theme.ink;
      ctx.font = isNo ? `700 ${FONT_SIZE}px ${FONT_BODY}` : `${FONT_SIZE}px ${FONT_BODY}`;
      const colLines = lines[ci];
      if (isNo) {
        const t = colLines[0] ?? '';
        const tw = ctx.measureText(t).width;
        ctx.fillText(t, cx + (c.width - tw) / 2, y + PAD_Y);
      } else {
        colLines.forEach((ln, li) => ctx.fillText(ln, cx + PAD_X, y + PAD_Y + li * LINE_H));
      }
      cx += c.width;
    });
    y += height;
  });

  // 网格线
  ctx.strokeStyle = theme.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  let ly = headerH;
  ctx.moveTo(0, headerH + 0.5); ctx.lineTo(tableW, headerH + 0.5);
  rowsLines.forEach(r => { ly += r.height; ctx.moveTo(0, ly + 0.5); ctx.lineTo(tableW, ly + 0.5); });
  let lx = 0;
  cols.forEach(c => { ctx.moveTo(lx + 0.5, 0); ctx.lineTo(lx + 0.5, tableH); lx += c.width; });
  ctx.moveTo(tableW - 0.5, 0); ctx.lineTo(tableW - 0.5, tableH);
  ctx.stroke();
  ctx.strokeRect(0.5, 0.5, tableW - 1, tableH - 1);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('生成图片失败'))), 'image/png');
  });
}
