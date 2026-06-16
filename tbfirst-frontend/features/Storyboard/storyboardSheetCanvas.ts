import type { Shot } from './StoryboardTypes';
import { FONT_BODY } from './theme';

/** 故事板每一格：来源宫格图（已加载）+ 该格在源图中的格号 + 对应分镜（用于字幕） */
export interface SheetCell {
  img: HTMLImageElement | null; // null = 空格（未填图）
  cellIndex: number;            // 在来源宫格图中的格号：决定裁哪一格 + 对应哪个分镜
  shot?: Shot;                  // 该格对应分镜（取自来源宫格图的分镜快照，回退当前分镜表）
}

interface SheetTheme {
  surface: string; bgTint: string; line: string;
  ink: string; inkSoft: string; accent: string; imgBackdrop: string;
}

interface Line { text: string; accent?: boolean }

/**
 * 导出故事板 PNG：宫格图的每个小图 + 其下方一条字幕（部分分镜表内容：景别/运镜/时长/画面/动作/台词）。
 * 纯 Canvas，无第三方依赖；中文逐字换行、按内容算每行字幕高度、按 devicePixelRatio 放大保证清晰。
 */
export async function renderStoryboardSheet(
  cells: SheetCell[], rows: number, cols: number, cellAspect: number, theme: SheetTheme,
): Promise<Blob> {
  const CELL_W = 440;                                  // 每格图片宽（CSS px）
  const cellH = Math.round(CELL_W / (cellAspect > 0 ? cellAspect : 0.75));
  const M = 18;                                        // 外边距
  const G = 12;                                        // 格间距
  const PAD = 10;                                      // 字幕内边距
  const FONT = 13;
  const LINE_H = 18;
  const MAX = { description: 4, action: 2, dialogue: 3, notes: 2 }; // 各字段最多占行数（超出截断 …）

  const mctx = document.createElement('canvas').getContext('2d')!;

  /** 带标签的字段 → 逐字换行（中文无空格），超过 maxLines 截断并加省略号 */
  function wrapField(label: string, value: string | undefined, maxW: number, maxLines: number): string[] {
    const v = String(value ?? '').trim();
    if (!v) return [];
    mctx.font = `${FONT}px ${FONT_BODY}`;
    const chars = Array.from(label + v);
    const out: string[] = [];
    let line = '';
    let i = 0;
    for (; i < chars.length; i++) {
      const ch = chars[i];
      const t = line + ch;
      if (line && mctx.measureText(t).width > maxW) {
        out.push(line);
        line = ch;
        if (out.length === maxLines) { line = ''; break; }
      } else {
        line = t;
      }
    }
    if (line && out.length < maxLines) out.push(line);
    if (i < chars.length && out.length) {
      const last = out[out.length - 1];
      out[out.length - 1] = (last.length > 1 ? last.slice(0, -1) : last) + '…';
    }
    return out;
  }

  function captionLines(cell: SheetCell, idx: number, maxW: number): Line[] {
    const sh = cell.shot;
    const n = sh?.shotNo ?? (idx + 1);
    const meta = [sh?.shotSize, sh?.cameraMovement, sh?.duration]
      .map(x => String(x ?? '').trim()).filter(Boolean);
    const lines: Line[] = [{ text: `镜${n}${meta.length ? '　' + meta.join(' · ') : ''}`, accent: true }];
    wrapField('画面：', sh?.description, maxW, MAX.description).forEach(t => lines.push({ text: t }));
    wrapField('动作：', sh?.action, maxW, MAX.action).forEach(t => lines.push({ text: t }));
    wrapField('台词：', sh?.dialogue, maxW, MAX.dialogue).forEach(t => lines.push({ text: t }));
    wrapField('备注：', sh?.notes, maxW, MAX.notes).forEach(t => lines.push({ text: t }));
    return lines;
  }

  const innerW = CELL_W - PAD * 2;
  const cellLines = cells.map((c, i) => captionLines(c, i, innerW));

  // 每行字幕高度 = 该行各格的最大行数
  const rowCapH: number[] = [];
  for (let r = 0; r < rows; r++) {
    let maxLines = 1;
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      if (idx < cells.length) maxLines = Math.max(maxLines, cellLines[idx].length);
    }
    rowCapH[r] = maxLines * LINE_H + PAD * 2;
  }

  const canvasW = M * 2 + cols * CELL_W + (cols - 1) * G;
  const canvasH = M * 2 + rows * cellH + rowCapH.reduce((a, b) => a + b, 0) + (rows - 1) * G;

  const dpr = canvasH > 16000 ? 1 : Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(canvasW * dpr);
  canvas.height = Math.round(canvasH * dpr);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  ctx.textBaseline = 'top';

  ctx.fillStyle = theme.surface;
  ctx.fillRect(0, 0, canvasW, canvasH);

  // 每行 y 顶
  const rowTop: number[] = [];
  let acc = M;
  for (let r = 0; r < rows; r++) { rowTop[r] = acc; acc += cellH + rowCapH[r] + G; }

  cells.forEach((cell, idx) => {
    const r = Math.floor(idx / cols), c = idx % cols;
    const x = M + c * (CELL_W + G);
    const yTop = rowTop[r];
    const capH = rowCapH[r];

    // 图片格
    if (cell.img) {
      const im = cell.img;
      const sCellW = im.naturalWidth / cols, sCellH = im.naturalHeight / rows;
      const sr = Math.floor(cell.cellIndex / cols), sc = cell.cellIndex % cols;
      ctx.drawImage(im, sc * sCellW, sr * sCellH, sCellW, sCellH, x, yTop, CELL_W, cellH);
    } else {
      ctx.fillStyle = theme.imgBackdrop;
      ctx.fillRect(x, yTop, CELL_W, cellH);
      ctx.fillStyle = theme.inkSoft;
      ctx.font = `700 14px ${FONT_BODY}`;
      const t = `第 ${idx + 1} 格 · 待填`;
      ctx.fillText(t, x + (CELL_W - ctx.measureText(t).width) / 2, yTop + cellH / 2 - 8);
    }

    // 字幕带
    const capY = yTop + cellH;
    ctx.fillStyle = theme.bgTint;
    ctx.fillRect(x, capY, CELL_W, capH);
    cellLines[idx].forEach((ln, li) => {
      ctx.fillStyle = ln.accent ? theme.accent : theme.ink;
      ctx.font = `${ln.accent ? '700 ' : ''}${FONT}px ${FONT_BODY}`;
      ctx.fillText(ln.text, x + PAD, capY + PAD + li * LINE_H);
    });

    // 边框 + 图/字幕分隔线
    ctx.strokeStyle = theme.line;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, yTop + 0.5, CELL_W - 1, cellH + capH - 1);
    ctx.beginPath();
    ctx.moveTo(x + 0.5, capY + 0.5);
    ctx.lineTo(x + CELL_W - 0.5, capY + 0.5);
    ctx.stroke();
  });

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('生成图片失败'))), 'image/png');
  });
}
