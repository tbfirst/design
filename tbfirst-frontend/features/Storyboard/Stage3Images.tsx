import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { storyboardService } from './storyboardService';
import { uploadDataUrisToGcs } from '@/services/uploadService';
import { toProxiedSrc, toImgPath, makeImgErrorFallback } from '@/services/shared/imageSrc';
import Lightbox from './Lightbox';
import ShotTableModal from './ShotTableModal';
import { gridGenStore } from './gridGenerationStore';
import type { Shot, GridImage, GarmentInfo, ModelInfo, GenParams, LayoutSlot } from './StoryboardTypes';
import { gridDims } from './StoryboardTypes';
import { C, FONT_DISPLAY, label as L, btn } from './theme';

interface Props {
  projectId: number;
  preProductionJson: string;
  storyText: string;
  shots: Shot[];
  garment: GarmentInfo | null;
  model: ModelInfo | null;
  genParams: GenParams;
  layout?: LayoutSlot[];
  initialGridImages?: GridImage[];
  /**
   * 自动生图触发器：单调递增的计数器。每次「立即生图并进入审片台」按钮置位 +1 → 追加一批。
   * 用 nonce（而非布尔）是因为流式单页下审片台常驻挂载、不再 unmount/remount，
   * 布尔一次性标志无法在「回滚改分镜后再次点按钮」时重新触发。加载项目时保持 0 → 不自动生图。
   */
  autoGenNonce: number;
  onGridsChange?: (grids: GridImage[]) => void;
  onComplete: (grids: GridImage[]) => void;
}

/**
 * 审片台：一次性出图，每张是整张 N 宫格图（N 个小格分别画一个分镜，全图同一主模特/服装）。
 * 出图为脱离组件生命周期的后台异步任务（gridGenStore），切阶段 / 新建项目都不打断；
 * 多轮生图累积（旧图保留），每张可单独删除 / 重绘。
 */
export default function StageGrid({
  projectId, preProductionJson, storyText, shots, garment, model, genParams, layout,
  initialGridImages, autoGenNonce, onGridsChange, onComplete,
}: Props) {
  const N = genParams.gridCount;
  const M = Math.max(1, genParams.imageCount || 1);
  const [rows, cols] = gridDims(N);
  const cellAspect = (genParams.aspectRatio || '3:4').replace(':', '/');

  // 首次挂载：把项目既有宫格图灌入 store（store 已有在跑任务/数据则跳过）
  useState(() => { gridGenStore.hydrate(projectId, initialGridImages ?? []); return null; });

  // 订阅后台生成 store（按 projectId 隔离）
  const state = useSyncExternalStore(
    gridGenStore.subscribe,
    () => gridGenStore.getState(projectId),
  );
  const grids = state.images;
  const generating = state.generatingCount > 0;
  const error = state.error;

  const [lightbox, setLightbox] = useState<string | null>(null);
  const [tableModal, setTableModal] = useState<Shot[] | null>(null);
  const onImgError = makeImgErrorFallback();

  /** 生成时的分镜表快照（精简列：只保留只读展示用字段，丢弃恒空的 frames，避免 docJson 膨胀） */
  function shotsSnapshot(): Shot[] {
    return shots.map(s => ({
      shotNo: s.shotNo,
      scene: s.scene,
      shotSize: s.shotSize,
      description: s.description,
      action: s.action,
      cameraMovement: s.cameraMovement,
      dialogue: s.dialogue,
      duration: s.duration,
      notes: s.notes,
      characterIds: [],
      motionType: s.motionType,
      frameCount: s.frameCount,
      frames: [],
    }));
  }

  /** 分镜表前 N 个分镜 → 宫格逐格内容 */
  function shotsPayload() {
    return shots.slice(0, N).map(s => ({
      description: s.description?.trim() || undefined,
      action: s.action?.trim() || undefined,
      cameraMovement: s.cameraMovement?.trim() || undefined,
      shotSize: s.shotSize?.trim() || undefined,
    }));
  }

  /** 出一张宫格图（携带当前参数快照） */
  async function renderGrid(): Promise<string> {
    const dataUri = await storyboardService.generateGrid(projectId, {
      shots: shotsPayload(),
      gridCount: N,
      aspectRatio: genParams.aspectRatio,
      imageSize: genParams.quality,
      garmentRefs: garment?.refs,
      modelRefs: model?.refs,
      consistencyProtocol: garment?.consistencyProtocol || undefined,
    });
    const urls = await uploadDataUrisToGcs([dataUri], 'storyboard-grid');
    if (!urls[0]) throw new Error('图片上传返回为空');
    return toImgPath(urls[0]);
  }

  function buildDoc(nextGrids: GridImage[]) {
    return JSON.stringify({
      preProduction: preProductionJson ? JSON.parse(preProductionJson) : undefined,
      shots,
      garment: garment ?? undefined,
      model: model ?? undefined,
      genParams,
      storyText: storyText || undefined,
      gridImages: nextGrids,
      // 累积保留旧图 → 旧图 id 不变，已有排版仍有效，保留 layout
      layout: layout && layout.length ? layout : undefined,
    });
  }

  // 登记落库回调（用当前上下文快照刷新；后台任务结算/删除时调用，即便组件已卸载）。
  // 仅落库后端，不回写向导 ref——避免「新建项目后上一轮后台完成」污染当前项目的 gridImagesRef；
  // 向导 ref 的同步只在挂载期通过下方订阅 effect 进行。
  useEffect(() => {
    gridGenStore.setPersister(projectId, (images) => {
      storyboardService.saveDoc(projectId, buildDoc(images), 'stage-grid')
        .catch(e => console.error('[StageGrid] saveDoc failed', e));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, preProductionJson, storyText, shots, garment, model, genParams, layout]);

  // 挂载时同步既有图到向导 ref；store 变化时持续同步（供排版阶段使用）
  useEffect(() => { onGridsChange?.(grids); }, [grids]); // eslint-disable-line react-hooks/exhaustive-deps

  // 进入即自动生图：nonce 每 +1 触发追加一批。
  // lastNonce ref 守卫必须保留：防 React StrictMode 开发态 effect 双触发导致重复生成一批。
  // 注：renderGrid/shotsSnapshot 读当前 props（shots 等）；wizard 在 setGridAutoGenNonce 时重渲染
  //     把最新 shotsRef.current 传进来，闭包才拿到最新分镜——这条耦合不可省。
  const lastNonce = useRef(0);
  useEffect(() => {
    if (autoGenNonce > 0 && autoGenNonce !== lastNonce.current) {
      lastNonce.current = autoGenNonce;
      gridGenStore.startBatch(projectId, M, renderGrid, shotsSnapshot());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoGenNonce]);

  function generateMore() {
    gridGenStore.startBatch(projectId, M, renderGrid, shotsSnapshot());
  }

  function regenOne(id: string) {
    gridGenStore.regenOne(projectId, id, renderGrid, shotsSnapshot());
  }

  function removeOne(id: string) {
    gridGenStore.remove(projectId, id);
  }

  const doneCount = grids.filter(g => g.status === 'done' && g.imageUrl).length;
  const hasAnyDone = doneCount > 0;
  const shotCount = Math.min(shots.length, N);

  return (
    <div style={{ padding: '32px 28px', maxWidth: 1180, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, marginBottom: 22, flexWrap: 'wrap' }}>
        <div style={{ marginRight: 'auto' }}>
          <span style={L}>第三步 · 审片台</span>
          <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 30, fontWeight: 600, color: C.ink, margin: '4px 0 0' }}>审片台</h2>
          <span style={{ fontSize: 12, color: C.inkSoft }}>
            {N} 宫格（{rows}×{cols}） · {genParams.aspectRatio} · {genParams.quality} · 每轮 {M} 张
            {garment?.consistencyProtocol ? ' · 服装一致性' : ''}
            {model?.refs?.length ? ` · 主模特${model.name ? '「' + model.name + '」' : ''}` : ''}
            {grids.length > 0 ? ` · 已有 ${grids.length} 张` : ''}
          </span>
        </div>
        <button onClick={generateMore} style={btn('primary')}>
          {generating
            ? `出图中…（${state.generatingCount} 张进行中）`
            : grids.length > 0 ? `再生成 ${M} 张` : `生成 ${M} 张宫格图`}
        </button>
        <button onClick={() => onComplete(grids)} disabled={!hasAnyDone} style={btn('primary', !hasAnyDone)}>进入排版 →</button>
      </div>

      {shotCount < N && (
        <p style={{ color: C.accent, fontSize: 13, marginBottom: 14 }}>
          注意：分镜表只有 {shots.length} 个分镜，少于 {N} 宫格；空缺格将由 AI 按同一主体补足。可返回上一步补满分镜。
        </p>
      )}
      {error && <p style={{ color: C.danger, marginBottom: 12, fontSize: 13 }}>{error}</p>}

      {grids.length === 0 && !generating && (
        <p style={{ color: C.inkFaint, fontSize: 13, marginBottom: 14 }}>
          暂无图片。点击右上「生成 {M} 张宫格图」开始出图；返回上一步调整设置后再次生图，旧图会保留在此。
        </p>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 18 }}>
        {grids.map((g, i) => {
          const status = g.status ?? 'idle';
          return (
            <div key={g.id || i} style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, overflow: 'hidden' }}>
              <div style={{
                width: '100%', aspectRatio: cellAspect, background: C.imgBackdrop, position: 'relative',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: status === 'error' ? `2px solid ${C.danger}` : 'none',
              }}>
                {status === 'done' && g.imageUrl ? (
                  <img
                    src={toProxiedSrc(g.imageUrl)}
                    onError={onImgError}
                    onClick={() => setLightbox(g.imageUrl!)}
                    title="点击放大查看完整图"
                    alt={`grid-${i}`}
                    style={{ width: '100%', height: '100%', objectFit: 'contain', cursor: 'zoom-in' }}
                  />
                ) : status === 'generating' ? (
                  <span style={{ color: C.accent, fontSize: 12.5 }}>生成中…</span>
                ) : status === 'error' ? (
                  <span style={{ color: C.danger, fontSize: 12.5 }}>✗ 失败</span>
                ) : (
                  <span style={{ color: C.inkFaint, fontSize: 12.5 }}>{N} 宫格</span>
                )}
                {/* 删除按钮（右上角） */}
                {status !== 'generating' && (
                  <button
                    onClick={() => removeOne(g.id)}
                    title="删除这张图"
                    style={{
                      position: 'absolute', top: 8, right: 8, width: 24, height: 24, borderRadius: '50%',
                      border: 'none', background: 'rgba(42,37,30,0.72)', color: '#fff', cursor: 'pointer',
                      fontSize: 14, lineHeight: '24px', padding: 0,
                    }}
                  >×</button>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: C.ink }}>第 {i + 1} 张</span>
                <span style={{ flex: 1 }} />
                <button onClick={() => setTableModal(g.shots?.length ? g.shots : shots)}
                  title="查看该图对应的分镜表"
                  style={{ background: 'none', border: 'none', color: C.inkSoft, cursor: 'pointer', fontSize: 12.5, fontWeight: 600, padding: 0 }}>
                  分镜表
                </button>
                <button onClick={() => regenOne(g.id)} disabled={status === 'generating'}
                  style={{ background: 'none', border: 'none', color: C.accent, cursor: status === 'generating' ? 'default' : 'pointer', fontSize: 12.5, fontWeight: 600, padding: 0 }}>
                  {status === 'done' || status === 'error' ? '重绘' : '出图'}
                </button>
                <button onClick={() => removeOne(g.id)} disabled={status === 'generating'}
                  style={{ background: 'none', border: 'none', color: C.danger, cursor: status === 'generating' ? 'default' : 'pointer', fontSize: 12.5, fontWeight: 600, padding: 0 }}>
                  删除
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <Lightbox src={lightbox} onClose={() => setLightbox(null)} />
      <ShotTableModal shots={tableModal} onClose={() => setTableModal(null)} />
    </div>
  );
}
