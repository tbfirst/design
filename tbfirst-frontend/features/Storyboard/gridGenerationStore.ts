import type { GridImage, Shot } from './StoryboardTypes';

/**
 * 宫格图后台生成 store（模块级单例，按 projectId 隔离）。
 *
 * 目的：让「审片台」的出图成为脱离组件生命周期的后台异步任务——
 *   · 切换阶段 / 新建项目都不会打断正在跑的上一轮生图；
 *   · 多轮生图累积（旧图保留），由用户用删除按钮自行裁剪。
 *
 * 与 brandgenius-ai 一致：占位先入列表，后台并发渲染，逐张回填状态。
 */

export interface ProjectGenState {
  images: GridImage[];
  generatingCount: number;
  error: string | null;
}

const EMPTY: ProjectGenState = { images: [], generatingCount: 0, error: null };

type Listener = () => void;

const states = new Map<number, ProjectGenState>();
const listeners = new Set<Listener>();
/** 每个项目最近一次的落库回调（携带当轮上下文快照），任务结算时调用 */
const persisters = new Map<number, (images: GridImage[]) => void>();

let idSeq = 0;
function nextId(): string {
  idSeq += 1;
  return `g-${Date.now().toString(36)}-${idSeq}`;
}

function emit() {
  listeners.forEach(l => l());
}

function getOr(projectId: number): ProjectGenState {
  return states.get(projectId) ?? EMPTY;
}

/** 不可变更新（配合 useSyncExternalStore 的引用相等判断） */
function setState(projectId: number, next: ProjectGenState) {
  states.set(projectId, next);
  emit();
}

function patchImage(projectId: number, id: string, patch: Partial<GridImage>) {
  const s = states.get(projectId);
  if (!s) return;
  setState(projectId, { ...s, images: s.images.map(g => (g.id === id ? { ...g, ...patch } : g)) });
}

function settleOne(projectId: number) {
  const s = states.get(projectId);
  if (!s) return;
  const generatingCount = Math.max(0, s.generatingCount - 1);
  const next = { ...s, generatingCount };
  states.set(projectId, next);
  emit();
  if (generatingCount === 0) persisters.get(projectId)?.(next.images);
}

export const gridGenStore = {
  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  },

  getState(projectId: number): ProjectGenState {
    return getOr(projectId);
  },

  isGenerating(projectId: number): boolean {
    return getOr(projectId).generatingCount > 0;
  },

  /** 登记落库回调（StageGrid 每次渲染用当前上下文刷新） */
  setPersister(projectId: number, fn: (images: GridImage[]) => void) {
    persisters.set(projectId, fn);
  },

  /**
   * 用已加载项目的既有宫格图初始化 store。
   * 若该项目已有 store 状态（含正在后台跑的任务或已有图），跳过——避免覆盖在跑的任务。
   */
  hydrate(projectId: number, images: GridImage[]) {
    const existing = states.get(projectId);
    if (existing && (existing.generatingCount > 0 || existing.images.length > 0)) return;
    setState(projectId, {
      images: images.map(g => ({ ...g })),
      generatingCount: 0,
      error: null,
    });
  },

  /**
   * 追加一批 count 张宫格图并在后台并发生成（不被组件卸载打断）。
   * renderOne 为携带当轮参数快照的渲染闭包，返回图片短链。
   * shotsSnapshot 为生成这批图时的分镜表快照，逐图记录以便「查看分镜表」溯源。
   */
  startBatch(projectId: number, count: number, renderOne: () => Promise<string>, shotsSnapshot?: Shot[]) {
    const s = getOr(projectId);
    const newImgs: GridImage[] = Array.from({ length: count }, () => ({
      id: nextId(), status: 'generating' as const, shots: shotsSnapshot,
    }));
    setState(projectId, {
      images: [...s.images, ...newImgs],
      generatingCount: s.generatingCount + count,
      error: null,
    });

    newImgs.forEach(img => {
      renderOne()
        .then(url => { patchImage(projectId, img.id, { status: 'done', imageUrl: url }); })
        .catch((e: any) => {
          patchImage(projectId, img.id, { status: 'error' });
          const cur = states.get(projectId);
          if (cur) setState(projectId, { ...cur, error: e?.message ?? '宫格图生成失败' });
        })
        .finally(() => settleOne(projectId));
    });
  },

  /** 重绘单张（保持位置，完成后替换图片）；同步刷新该图的分镜表快照 */
  regenOne(projectId: number, id: string, renderOne: () => Promise<string>, shotsSnapshot?: Shot[]) {
    const s = getOr(projectId);
    setState(projectId, {
      images: s.images.map(g => (g.id === id ? { ...g, status: 'generating' as const, shots: shotsSnapshot ?? g.shots } : g)),
      generatingCount: s.generatingCount + 1,
      error: null,
    });
    renderOne()
      .then(url => { patchImage(projectId, id, { status: 'done', imageUrl: url }); })
      .catch((e: any) => {
        patchImage(projectId, id, { status: 'error' });
        const cur = states.get(projectId);
        if (cur) setState(projectId, { ...cur, error: e?.message ?? '宫格图生成失败' });
      })
      .finally(() => settleOne(projectId));
  },

  /** 删除单张（落库由调用方在 persister 中处理；这里立即写库以防丢失） */
  remove(projectId: number, id: string) {
    const s = states.get(projectId);
    if (!s) return;
    const next = { ...s, images: s.images.filter(g => g.id !== id) };
    states.set(projectId, next);
    emit();
    persisters.get(projectId)?.(next.images);
  },
};
