import React, { useEffect, useRef, useState } from 'react';
import { storyboardService } from './storyboardService';
import { toProxiedSrc } from '@/services/shared/imageSrc';
import type { Shot, GenParams, GridImage, LayoutSlot, GarmentInfo, ModelInfo } from './StoryboardTypes';
import { gridDims } from './StoryboardTypes';
import { TEXT_COLS } from './shotTableColumns';
import { renderShotTableToCanvas } from './shotTableCanvas';
import { renderStoryboardSheet, type SheetCell } from './storyboardSheetCanvas';
import { C, FONT_DISPLAY, label as L, btn } from './theme';

interface Props {
  projectId: number | null;
  shots: Shot[];
  genParams: GenParams;
  gridImages: GridImage[];
  initialLayout?: LayoutSlot[];
  preProductionJson: string;
  storyText: string;
  garment: GarmentInfo | null;
  model: ModelInfo | null;
  onLayoutChange?: (layout: LayoutSlot[]) => void;
  onComplete?: () => void;
}

interface Candidate { sourceImageId: string; cellIndex: number; }

/** CSS 精灵裁切：把整张 N 宫格图只显示其中第 cellIndex 格 */
function cellBgStyle(url: string, cellIndex: number, rows: number, cols: number): React.CSSProperties {
  const r = Math.floor(cellIndex / cols);
  const c = cellIndex % cols;
  const posX = cols > 1 ? (c / (cols - 1)) * 100 : 0;
  const posY = rows > 1 ? (r / (rows - 1)) * 100 : 0;
  return {
    backgroundImage: `url("${toProxiedSrc(url)}")`,
    backgroundSize: `${cols * 100}% ${rows * 100}%`,
    backgroundPosition: `${posX}% ${posY}%`,
    backgroundRepeat: 'no-repeat',
  };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('图片加载失败: ' + url));
    im.src = toProxiedSrc(url); // 同源 /img/，画到 canvas 不污染
  });
}

/**
 * 排版：把生成图（多张 N 宫格图）裁成小图候选，拖进固定 N 宫格槽位自由拼接，一键导出成片。
 */
export default function StageLayout({
  projectId, shots, genParams, gridImages, initialLayout,
  preProductionJson, storyText, garment, model, onLayoutChange, onComplete,
}: Props) {
  const N = genParams.gridCount;
  const [rows, cols] = gridDims(N);
  // 每个小格的真实宽高比 = 整图宽高比 ×(行/列)；方形网格即整图比例，2×3 等非方形据此校正预览不拉伸
  const [aw, ah] = (genParams.aspectRatio || '3:4').split(':').map(Number);
  const imgAspect = aw > 0 && ah > 0 ? aw / ah : 0.75;
  const cellAspect = String(imgAspect * (rows / cols));

  const doneGrids = gridImages.filter(g => g.status === 'done' && g.imageUrl);
  const urlById = new Map<string, string | undefined>(
    gridImages.map(g => [g.id, g.imageUrl] as [string, string | undefined]),
  );

  const makeDefault = (): LayoutSlot[] => {
    const first = doneGrids[0];
    return Array.from({ length: N }, (_, i) => (first ? { sourceImageId: first.id, cellIndex: i } : {}));
  };

  const [slots, setSlots] = useState<LayoutSlot[]>(() => {
    if (initialLayout && initialLayout.length === N && initialLayout.some(s => s.sourceImageId)) {
      return initialLayout.map(s => ({ ...s }));
    }
    return makeDefault();
  });
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [exporting, setExporting] = useState(false);
  const [activeSlot, setActiveSlot] = useState<number | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const candidates: Candidate[] = doneGrids.flatMap(g =>
    Array.from({ length: N }, (_, i) => ({ sourceImageId: g.id, cellIndex: i })),
  );

  function buildDoc(nextSlots: LayoutSlot[]) {
    return JSON.stringify({
      preProduction: preProductionJson ? JSON.parse(preProductionJson) : undefined,
      shots,
      garment: garment ?? undefined,
      model: model ?? undefined,
      genParams,
      storyText: storyText || undefined,
      gridImages,
      layout: nextSlots,
    });
  }

  function saveSoon(nextSlots: LayoutSlot[]) {
    onLayoutChange?.(nextSlots);
    if (projectId == null) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      storyboardService.saveDoc(projectId, buildDoc(nextSlots), 'stage4').catch(e =>
        console.error('[StageLayout] saveDoc failed', e),
      );
    }, 800);
  }

  function assignSlot(idx: number, cand: Candidate | null) {
    setSlots(prev => {
      const next = prev.map((s, i) => (i === idx ? (cand ? { ...cand } : {}) : s));
      saveSoon(next);
      return next;
    });
  }

  function onSlotClick(idx: number) {
    if (selected) {
      assignSlot(idx, selected);
    } else {
      setActiveSlot(a => (a === idx ? null : idx));
    }
  }

  function onCandidateClick(cand: Candidate) {
    if (activeSlot != null) {
      assignSlot(activeSlot, cand);
      setActiveSlot(null);
    } else {
      const key = (c: Candidate) => `${c.sourceImageId}:${c.cellIndex}`;
      setSelected(s => (s && key(s) === key(cand) ? null : cand));
    }
  }

  function resetDefault() {
    const def = makeDefault();
    setSlots(def);
    saveSoon(def);
  }

  async function exportImage() {
    const used: string[] = Array.from(
      new Set(slots.map(s => s.sourceImageId).filter((x): x is string => !!x)),
    );
    if (used.length === 0) { window.alert('请先往格子里填入小图'); return; }
    setExporting(true);
    try {
      const imgs = new Map<string, HTMLImageElement>();
      await Promise.all(used.map(async id => {
        const url = urlById.get(id);
        if (url) imgs.set(id, await loadImage(url));
      }));
      const base = imgs.get(used[0])!;
      const cellW = Math.max(1, Math.round(base.naturalWidth / cols));
      const cellH = Math.max(1, Math.round(base.naturalHeight / rows));
      const canvas = document.createElement('canvas');
      canvas.width = cellW * cols;
      canvas.height = cellH * rows;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('canvas 不可用');
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
      const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/png'));
      if (!blob) throw new Error('生成图片失败');
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = `分镜成片_${N}宫格.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objUrl), 60_000);
    } catch (e: any) {
      console.error('[StageLayout] export failed', e);
      window.alert('导出失败：' + (e?.message ?? e));
    } finally {
      setExporting(false);
    }
  }

  const [exportingTable, setExportingTable] = useState(false);

  /** 导出分镜表为 PNG 图片（纯 Canvas 绘制；镜头号 + 8 文本列，省略操作列） */
  async function exportShotTable() {
    if (shots.length === 0) { window.alert('暂无分镜数据'); return; }
    setExportingTable(true);
    try {
      const blob = await renderShotTableToCanvas(shots, TEXT_COLS, C);
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = `分镜表_${N}镜.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objUrl), 60_000);
    } catch (e: any) {
      console.error('[StageLayout] export shot table failed', e);
      window.alert('导出失败：' + (e?.message ?? e));
    } finally {
      setExportingTable(false);
    }
  }

  const [exportingSheet, setExportingSheet] = useState(false);

  /** 导出故事板 PNG：宫格小图 + 其下方部分分镜表（景别/运镜/时长/画面/动作/台词） */
  async function exportStoryboard() {
    const used: string[] = Array.from(new Set(slots.map(s => s.sourceImageId).filter((x): x is string => !!x)));
    if (used.length === 0) { window.alert('请先往格子里填入小图'); return; }
    setExportingSheet(true);
    try {
      const imgs = new Map<string, HTMLImageElement>();
      await Promise.all(used.map(async id => {
        const url = urlById.get(id);
        if (url) imgs.set(id, await loadImage(url));
      }));
      const gridById = new Map(gridImages.map(g => [g.id, g] as const));
      // 每格对应的分镜：优先用来源宫格图自带的分镜快照，回退到当前分镜表（按格号取）
      const cells: SheetCell[] = slots.map((s, idx) => {
        if (!s.sourceImageId || s.cellIndex == null) return { img: null, cellIndex: idx, shot: shots[idx] };
        const g = gridById.get(s.sourceImageId);
        const shot = g?.shots?.[s.cellIndex] ?? shots[s.cellIndex];
        return { img: imgs.get(s.sourceImageId) ?? null, cellIndex: s.cellIndex, shot };
      });
      const blob = await renderStoryboardSheet(cells, rows, cols, Number(cellAspect), C);
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = `故事板_${N}格.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objUrl), 60_000);
    } catch (e: any) {
      console.error('[StageLayout] export storyboard failed', e);
      window.alert('导出失败：' + (e?.message ?? e));
    } finally {
      setExportingSheet(false);
    }
  }

  const candKey = (c: Candidate) => `${c.sourceImageId}:${c.cellIndex}`;
  const selKey = selected ? candKey(selected) : '';
  const filledCount = slots.filter(s => s.sourceImageId).length;

  // 进入排版即把当前排布（默认或已恢复）落库一次：让 doc.layout 非空、stage='stage4'。
  // 否则「进入排版但没动排布就退出」时无任何进度落库，重载会卡在审片台、进不了排版。
  // 数据驱动（hasLayout）比 stage 字段更稳——即便审片台后台保存把 stage 回退到 stage-grid 也能恢复到排版。
  const didInitLayoutPersist = useRef(false);
  useEffect(() => {
    if (didInitLayoutPersist.current || projectId == null) return;
    if (slots.some(s => s.sourceImageId)) {
      didInitLayoutPersist.current = true;
      saveSoon(slots);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, slots]);

  if (doneGrids.length === 0) {
    return (
      <div style={{ padding: '32px 28px', maxWidth: 1180, margin: '0 auto' }}>
        <span style={L}>第四步 · 排版</span>
        <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 30, fontWeight: 600, color: C.ink, margin: '4px 0 18px' }}>排版</h2>
        <p style={{ color: C.inkSoft, fontSize: 14 }}>还没有生成图。请先回到「生成图」生成宫格图，再来这里裁剪拼接。</p>
      </div>
    );
  }

  return (
    <div style={{ padding: '32px 28px', maxWidth: 1180, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div style={{ marginRight: 'auto' }}>
          <span style={L}>第四步 · 排版</span>
          <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 30, fontWeight: 600, color: C.ink, margin: '4px 0 0' }}>排版</h2>
          <span style={{ fontSize: 12, color: C.inkSoft }}>
            {N} 宫格（{rows}×{cols}） · 已填 {filledCount}/{N} · 候选 {candidates.length} 张小图
          </span>
        </div>
        <button onClick={resetDefault} style={btn('ghost')}>恢复默认排布</button>
        <button onClick={exportShotTable} disabled={shots.length === 0 || exportingTable} style={btn('ghost', shots.length === 0 || exportingTable)}>
          {exportingTable ? '导出中…' : '⤓ 导出分镜表(PNG)'}
        </button>
        <button onClick={exportStoryboard} disabled={filledCount === 0 || exportingSheet} style={btn('ghost', filledCount === 0 || exportingSheet)}>
          {exportingSheet ? '导出中…' : '⤓ 导出故事板'}
        </button>
        <button onClick={exportImage} disabled={exporting || filledCount === 0} style={btn('primary', exporting || filledCount === 0)}>
          {exporting ? '导出中…' : '⤓ 导出成片'}
        </button>
        {onComplete && (
          <button onClick={onComplete} style={btn('primary')}>
            → 视频生成
          </button>
        )}
      </div>

      <p style={{ fontSize: 12.5, color: C.inkSoft, margin: '0 0 16px' }}>
        点选下方小图候选 → 再点目标格填入（或直接把候选拖到格子里）。已选中：
        <b style={{ color: C.ink }}>{selected ? '✓ 一张小图' : '无'}</b>
        {activeSlot != null && <span style={{ color: C.accent }}>　待填格：第 {activeSlot + 1} 格</span>}
      </p>

      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {/* 目标 N 宫格槽位 */}
        <div style={{ flex: '1 1 420px', minWidth: 300 }}>
          <span style={{ ...L, display: 'block', marginBottom: 10 }}>成片画布 · {rows}×{cols}</span>
          <div style={{
            display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 4,
            background: C.line, padding: 4, borderRadius: 12, border: `1px solid ${C.line}`,
          }}>
            {slots.map((s, idx) => {
              const url = s.sourceImageId ? urlById.get(s.sourceImageId) : undefined;
              const active = activeSlot === idx;
              return (
                <div
                  key={idx}
                  onClick={() => onSlotClick(idx)}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => {
                    e.preventDefault();
                    try {
                      const cand = JSON.parse(e.dataTransfer.getData('text/plain')) as Candidate;
                      if (cand && cand.sourceImageId) assignSlot(idx, cand);
                    } catch { /* ignore */ }
                  }}
                  title={url ? '点击可替换（先选候选）' : '点击选为待填格'}
                  style={{
                    position: 'relative', aspectRatio: cellAspect, background: C.imgBackdrop,
                    borderRadius: 6, overflow: 'hidden', cursor: 'pointer',
                    outline: active ? `2px solid ${C.accent}` : 'none',
                    ...(url && s.cellIndex != null ? cellBgStyle(url, s.cellIndex, rows, cols) : {}),
                  }}
                >
                  {!url && (
                    <span style={{
                      position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: C.inkFaint, fontSize: 12,
                    }}>{idx + 1}</span>
                  )}
                  {url && (
                    <button
                      onClick={e => { e.stopPropagation(); assignSlot(idx, null); }}
                      title="清空该格"
                      style={{
                        position: 'absolute', top: 3, right: 3, width: 18, height: 18, borderRadius: '50%',
                        border: 'none', background: 'rgba(42,37,30,0.66)', color: '#fff', cursor: 'pointer',
                        fontSize: 11, lineHeight: '18px', padding: 0,
                      }}
                    >×</button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* 候选小图池 */}
        <div style={{ flex: '1 1 420px', minWidth: 300 }}>
          <span style={{ ...L, display: 'block', marginBottom: 10 }}>小图候选 · 来自 {doneGrids.length} 张生成图</span>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(86px, 1fr))', gap: 8,
            maxHeight: 560, overflowY: 'auto', padding: 4,
          }}>
            {candidates.map(cand => {
              const url = urlById.get(cand.sourceImageId);
              if (!url) return null;
              const isSel = selKey === candKey(cand);
              return (
                <div
                  key={candKey(cand)}
                  draggable
                  onDragStart={e => e.dataTransfer.setData('text/plain', JSON.stringify(cand))}
                  onClick={() => onCandidateClick(cand)}
                  title="点选后再点目标格，或直接拖入"
                  style={{
                    aspectRatio: cellAspect, borderRadius: 6, cursor: 'pointer',
                    border: isSel ? `2px solid ${C.accent}` : `1px solid ${C.line}`,
                    boxShadow: isSel ? `0 0 0 2px ${C.accentSoft}` : 'none',
                    ...cellBgStyle(url, cand.cellIndex, rows, cols),
                  }}
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
