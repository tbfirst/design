/**
 * HistoryModal —— 历史生图查询面板
 *
 * 触发时机：用户点 Workspace header 的 "历史生图" 按钮。
 *
 * 业务语义：
 *  - 后端 30 天 LRU：生图默认只保留 30 天（见 GenerationJobLruCleaner）。
 *    到期会真物理删 GCS Blob / 本地文件 + 软删 DB 行（@TableLogic），用户即看不到。
 *  - 用户可对任一张点 "下载并收藏" → 浏览器把图下载到本地 PC，同时服务端刷新 last_access_at（= 续命 30 天）
 *  - 已收藏过的图在列表里显示 "✓ 已下载" 徽章；这只是视觉标记，不影响 LRU —— 再过 30 天没续仍会被清
 *  - 本人卡片右上角 hover 出红色垃圾桶按钮：点击二次 confirm 后 DELETE /api/image/jobs/{id}，
 *    同步永久删 GCS Blob / 本地文件 + 软删 DB 行（与 LRU 到期等价的清理路径，只是用户主动触发）。
 *    权限收紧到"仅作者本人"，组员 / 组长 / admin 都不能代删（与"下载并收藏"的共享语义有意区分）。
 *
 * 与 Workspace.resultsPhase0/1/2 完全解耦：本组件自管 loading / data / error。
 * 关闭后不保留任何状态，每次打开都重新拉一次 /api/image/history。
 */
import React, { useEffect, useRef, useState } from 'react';
import { authService } from '../features/Auth/authService';
import RefreshableImage from './RefreshableImage';
import { toDownloadHref } from '../services/shared/downloadHref';
import { downloadAndFavorite, chooseDownloadDir } from '../services/shared/saveBlobAs';
import {
  getDownloadDirHandle,
  clearDownloadDirHandle,
  isFileSystemAccessSupported,
} from '../services/shared/downloadDirStore';

interface HistoryJob {
  id: number;
  phase: string;
  prompt: string;
  assetUrls: string;
  status: string;
  saved: boolean;
  userId?: number;         // 作者（可能是当前用户自己，也可能是同组他人）
  /** 作者用户名；后端聚合 tbfirst-auth 填充，auth 不可达时可能为空 */
  authorName?: string;
  createTime: string;      // ISO / yyyy-MM-ddTHH:mm:ss
  lastAccessAt?: string;
  phaseConfig?: string;
}

interface HistoryImage {
  jobId: number;
  /** URL 在一个 job 里的序号（assetUrls 换行拆分后的 index），用于前端 key */
  urlIndex: number;
  url: string;
  phase: 0 | 1 | 2 | 3;
  promptUsed: string;
  createTime: string;
  saved: boolean;
  /** 作者用户 ID；仍保留用于 mine 判定 */
  authorId?: number;
  /** 作者用户名；徽标优先显示，缺失则 fallback 到 authorId */
  authorName?: string;
  /** 是否本人的历史 */
  mine: boolean;
  /** 构图/动作摘要，从 phaseConfig JSON 解析；解析失败时为空 */
  compositionLabel?: string;
}

interface Props {
  onClose: () => void;
}

const PHASE_LABEL: Record<0 | 1 | 2 | 3, string> = {
  0: 'Phase 0 资产工厂',
  1: 'Phase 1 创意生成',
  2: 'Phase 2 精修/改色/重绘',
  3: 'Phase 3 影调精修',
};

function toPhaseIndex(p: string): 0 | 1 | 2 | 3 | null {
  if (p === 'phase0') return 0;
  if (p === 'phase1') return 1;
  if (p === 'phase2' || p === 'phase2Color' || p === 'SmartInpaint' || p === 'color') return 2;
  if (p === 'phase3') return 3;
  return null;
}

function formatDateKey(iso: string): string {
  // 服务端返回的日期可能没带时区 ("2026-04-17T10:30:00")，直接 new Date 在浏览器按本地时区解析即可
  try { return new Date(iso).toLocaleDateString('zh-CN'); }
  catch { return iso.slice(0, 10); }
}

function filenameFromUrl(url: string): string {
  const seg = url.split('/').pop() || 'image.png';
  return seg.split('?')[0];
}

function parseCompositionLabel(phaseConfig: string | undefined, phase: 0 | 1 | 2 | 3): string {
  if (!phaseConfig) return '';
  try {
    const cfg = JSON.parse(phaseConfig);
    const scope: string = cfg.compositionScope || '';
    const target: string = cfg.compositionTarget || '';
    const poseAction: string = cfg.poseAction || '';
    const gestureAction: string = cfg.gestureAction || '';
    const parts: string[] = [];
    if (scope && scope !== 'inherit') parts.push(target ? `${scope}·${target}` : scope);
    if (phase === 2) {
      if (poseAction && poseAction !== 'Maintain original pose') {
        const actionStr = gestureAction && gestureAction !== '无额外手势' ? `${poseAction}+${gestureAction}` : poseAction;
        parts.push(actionStr);
      }
    }
    if (phase === 3) {
      const styleDNA: string = cfg.styleDNA || '';
      const intensity: number = cfg.intensity ?? 0.8;
      const quality: string = cfg.targetQuality || cfg.imageSize || '';
      const dnaSummary = styleDNA ? styleDNA.split(',').slice(0, 3).join(', ') : '';
      if (dnaSummary) parts.push(`${Math.round(intensity * 100)}% · ${quality} · ${dnaSummary}`);
    }
    return parts.join(' / ');
  } catch {
    return '';
  }
}

export const HistoryModal: React.FC<Props> = ({ onClose }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [images, setImages] = useState<HistoryImage[]>([]);
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set()); // `${jobId}-${urlIndex}`
  // 删除态按 jobId 维度记录：一次 DELETE 会摘掉同 jobId 下所有 urlIndex 卡片
  const [deletingJobIds, setDeletingJobIds] = useState<Set<number>>(new Set());
  const [preview, setPreview] = useState<HistoryImage | null>(null);
  // 当前用户 ID，用来区分自己的 vs 同组他人的历史
  const currentUserId: number | null = (authService.getCurrentUser()?.userId) ?? null;
  // V5.XI-2.3：账号是否已设默认下载目录（IndexedDB 探测结果）
  const [hasDefaultDir, setHasDefaultDir] = useState(false);
  // 当前展开 ⋮ 菜单的图片 key（`${jobId}-${urlIndex}`）；null = 全部收起
  const [openMenuKey, setOpenMenuKey] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const fsAccessSupported = isFileSystemAccessSupported();

  // ===== 批量删除 =====
  // 选择模式开关。开启后：mine 卡片左上角出现 checkbox；卡片点击改为切换选中；
  // 非 mine 卡片整体置灰且不可选；底部出现"已选 N · 全选本人 · 取消 · 删除选中"工具栏。
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedJobIds, setSelectedJobIds] = useState<Set<number>>(new Set());
  const [batchDeleting, setBatchDeleting] = useState(false);

  // 打开时锁滚动，关闭时恢复。避免正文滚动和 Modal 抢输入
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // V5.XI-2.3：mount + 用户切换时探测一次 IndexedDB 中是否已存默认目录句柄
  useEffect(() => {
    let cancelled = false;
    if (currentUserId == null || !fsAccessSupported) {
      setHasDefaultDir(false);
      return;
    }
    (async () => {
      const handle = await getDownloadDirHandle(currentUserId);
      if (!cancelled) setHasDefaultDir(handle != null);
    })();
    return () => { cancelled = true; };
  }, [currentUserId, fsAccessSupported]);

  // ⋮ 菜单外部点击关闭
  useEffect(() => {
    if (openMenuKey == null) return;
    const onDocClick = (e: MouseEvent) => {
      if (!menuRef.current) return;
      if (e.target instanceof Node && menuRef.current.contains(e.target)) return;
      setOpenMenuKey(null);
    };
    // 用 capture 阶段避免被卡片内 stopPropagation 吃掉
    document.addEventListener('mousedown', onDocClick, true);
    return () => document.removeEventListener('mousedown', onDocClick, true);
  }, [openMenuKey]);

  // 挂载时拉取历史；关闭后重新打开会重新走一遍（组件 unmount/remount）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const resp = await authService.fetchWithAuth('/api/image/history');
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const body = await resp.json();
        if (body.code !== undefined && body.code !== 0) {
          throw new Error(body.msg || `code=${body.code}`);
        }
        const jobs: HistoryJob[] = body.data || [];
        const flat: HistoryImage[] = jobs
          .filter(j => j.status === 'success' && j.assetUrls)
          .flatMap(j => {
            const phase = toPhaseIndex(j.phase);
            if (phase === null) return [];
            const compositionLabel = parseCompositionLabel(j.phaseConfig, phase);
            return String(j.assetUrls).split('\n').filter(Boolean).map((url, idx) => ({
              jobId: j.id,
              urlIndex: idx,
              url,
              phase,
              promptUsed: j.prompt || '',
              createTime: j.createTime,
              saved: !!j.saved,
              authorId: j.userId,
              authorName: j.authorName,
              mine: currentUserId != null && j.userId === currentUserId,
              compositionLabel,
            } as HistoryImage));
          });
        if (!cancelled) setImages(flat);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || '拉取失败');
        console.warn('[HistoryModal] load failed', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  /**
   * V5.XV.15 "下载并收藏" 一张图（修订顺序）：
   *  1) 触发本地落盘（picker / 默认目录 / fallback）—— 等用户真的选了位置并写入成功后再续接
   *  2) 本地真的写入成功后才 POST /api/image/jobs/{id}/save → 后端置 saved=true + 刷 last_access_at
   *  3) UI saved 角标 setImages
   *
   * 修订原因：V5.XI-2.3 原顺序是先调后端 /save 再弹 picker。用户在 picker 取消时前端不
   * 更新本地 UI，但后端 DB 已经是 saved=true —— 关闭重开历史列表时从后端拉回 saved=true
   * 立刻显示"已下载"，与用户预期（取消=未下载）矛盾。
   *
   * 副作用：本地下载耗时内后端 last_access_at 不会被刷，但 LRU TTL 30 天，这点延迟可接受。
   */
  const handleSaveAndDownload = async (img: HistoryImage, mode: 'auto' | 'saveAs' = 'auto') => {
    const key = `${img.jobId}-${img.urlIndex}`;
    if (savingIds.has(key)) return;
    setSavingIds(prev => new Set(prev).add(key));
    try {
      // 1) 先弹 picker / 走默认目录，把字节真的落到用户磁盘
      const filename = filenameFromUrl(img.url);
      const url = toDownloadHref(img.url, filename);
      const r = await downloadAndFavorite({ url, filename, userId: currentUserId, mode });
      if (r.result === 'cancelled') {
        // 用户主动取消 → 静默；后端不标 saved，UI 也不标 saved
        return;
      }
      if (r.result === 'failed') {
        // 真实下载失败 → 弹错误提示，后端不标 saved，UI 也不标 saved，用户可再点重试
        alert(r.needsAlert || '下载失败');
        return;
      }

      // 2) 本地写盘真的成功（saved / fallback）→ 才告知后端置 saved=true
      try {
        const resp = await authService.fetchWithAuth(`/api/image/jobs/${img.jobId}/save`, { method: 'POST' });
        if (!resp.ok) {
          const body = await resp.json().catch(() => ({}));
          // 后端标记失败不阻塞本地已成功的下载，仅 warn + UI 角标暂不更新
          console.warn('[HistoryModal] backend save flag failed:', body.msg || `HTTP ${resp.status}`);
        } else {
          setImages(prev => prev.map(x => x.jobId === img.jobId ? { ...x, saved: true } : x));
        }
      } catch (e) {
        console.warn('[HistoryModal] backend /save call failed:', e);
      }
      if (r.needsAlert) alert(r.needsAlert);
    } catch (err: any) {
      console.error('[HistoryModal] save failed', err);
      alert(err?.message || '下载收藏失败');
    } finally {
      setSavingIds(prev => { const n = new Set(prev); n.delete(key); return n; });
    }
  };

  /**
   * 用户主动删除一条历史生图记录。
   *
   * 后端契约（DELETE /api/image/jobs/{id}）：
   *  - 仅作者本人可调用（同组成员 / 组长 / admin 都会被判 NOT_FOUND，不暴露存在性）
   *  - 后端会同步真删 GCS Blob / 本地磁盘文件 + 软删 DB 行
   *  - 不可恢复（除非 bucket 开了 versioning），所以前端强制 confirm 二次确认
   *
   * 前端副作用：把同 jobId 下所有 urlIndex 卡片从 images state 摘掉
   * （一个 job 可能对应批量生成的多张图，asset_urls 里换行分隔多个 assetKey）。
   */
  const handleDelete = async (img: HistoryImage) => {
    if (!img.mine) return; // UI 已经按 mine gating，这里做最后一道防御
    if (deletingJobIds.has(img.jobId)) return;
    const ok = window.confirm(
      '确认删除这张历史生图吗？\n\n' +
      '· 云端原图会被永久删除（GCS 上的 Blob 真删，不可恢复）\n' +
      '· 若此任务批量生成了多张图，将一并删除\n' +
      '· DB 记录会被软删（审计仍可按 jobId 反查）',
    );
    if (!ok) return;
    setDeletingJobIds(prev => new Set(prev).add(img.jobId));
    try {
      const resp = await authService.fetchWithAuth(`/api/image/jobs/${img.jobId}`, { method: 'DELETE' });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.msg || `HTTP ${resp.status}`);
      }
      setImages(prev => prev.filter(x => x.jobId !== img.jobId));
    } catch (err: any) {
      console.error('[HistoryModal] delete failed', err);
      alert('删除失败：' + (err?.message || '未知错误'));
    } finally {
      setDeletingJobIds(prev => { const n = new Set(prev); n.delete(img.jobId); return n; });
    }
  };

  // ===== 批量删除 handlers =====

  /** 切换"批量删除"模式：进入时清空已选；退出时也清空。同时关掉任何展开的 ⋮ 菜单。 */
  const toggleSelectionMode = () => {
    setOpenMenuKey(null);
    setSelectedJobIds(new Set());
    setSelectionMode(prev => !prev);
  };

  /** 切换某张图（按 jobId 维度，因一个 job 多张图视为整体）选中态。仅 mine 可选。 */
  const toggleSelectCard = (img: HistoryImage) => {
    if (!img.mine) return;
    setSelectedJobIds(prev => {
      const n = new Set(prev);
      if (n.has(img.jobId)) n.delete(img.jobId);
      else n.add(img.jobId);
      return n;
    });
  };

  /** 全选当前列表中所有本人的 jobId（已被删除/正在删除的 job 不会出现在 images 里，天然过滤掉）。 */
  const selectAllMine = () => {
    const mineJobIds = new Set<number>();
    for (const img of images) if (img.mine) mineJobIds.add(img.jobId);
    setSelectedJobIds(mineJobIds);
  };

  /** 调 POST /api/image/jobs/batch-delete，成功后从 state 摘掉所有被删 jobId,自动退出选择模式 */
  const handleBatchDelete = async () => {
    if (selectedJobIds.size === 0 || batchDeleting) return;
    const count = selectedJobIds.size;
    const ok = window.confirm(
      `确认批量删除选中的 ${count} 个历史生图任务吗？\n\n` +
      '· 每个任务下的所有图片都会一并删除\n' +
      '· 云端 GCS Blob 同步永久删除，不可恢复\n' +
      '· DB 记录会被软删（审计仍可按 jobId 反查）\n' +
      '· 非本人记录会被服务端静默跳过，不会被误删',
    );
    if (!ok) return;
    setBatchDeleting(true);
    const idsToDelete = Array.from(selectedJobIds);
    try {
      const resp = await authService.fetchWithAuth('/api/image/jobs/batch-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: idsToDelete }),
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.msg || `HTTP ${resp.status}`);
      }
      const body = await resp.json();
      const summary = body.data || {};
      const deleted = summary.deleted ?? 0;
      const skipped = summary.skipped ?? 0;
      const filesFail = summary.filesFail ?? 0;
      // 从 state 摘掉所有被删 jobId（按理 skipped 的不该在前端列表里，但保险起见以服务端为准）
      const deletedSet = new Set(idsToDelete);
      setImages(prev => prev.filter(x => !deletedSet.has(x.jobId)));
      setSelectedJobIds(new Set());
      setSelectionMode(false);
      if (skipped > 0 || filesFail > 0) {
        alert(`批量删除完成：成功 ${deleted} 条${skipped > 0 ? `，跳过 ${skipped} 条（非本人 / 已删）` : ''}${filesFail > 0 ? `，文件清理失败 ${filesFail} 个（DB 已软删，文件可能残留待 LRU 重试）` : ''}`);
      }
    } catch (err: any) {
      console.error('[HistoryModal] batch-delete failed', err);
      alert('批量删除失败：' + (err?.message || '未知错误'));
    } finally {
      setBatchDeleting(false);
    }
  };

  /** ⋮ → 设置默认存储位置（V5.XI-3.3：set/change 文案幂等合并） */
  const handleSetDefaultDir = async () => {
    setOpenMenuKey(null);
    if (currentUserId == null) { alert('请先登录后再设置默认存储位置'); return; }
    const r = await chooseDownloadDir(currentUserId);
    if (r === 'saved') {
      const wasSet = hasDefaultDir;
      setHasDefaultDir(true);
      alert(wasSet
        ? '已更新本账号默认存储位置，下次"下载并收藏"将静默写入新目录'
        : '已设置本账号默认存储位置，下次"下载并收藏"将静默写入该目录');
    } else if (r === 'unsupported') {
      alert('当前浏览器不支持设置默认存储位置（仅 Chromium 内核浏览器支持）');
    }
    // 'cancelled' → 静默
  };

  /** ⋮ → 清除默认存储位置 */
  const handleClearDefaultDir = async () => {
    setOpenMenuKey(null);
    if (currentUserId == null) return;
    await clearDownloadDirHandle(currentUserId);
    setHasDefaultDir(false);
    alert('已清除默认存储位置，下次"下载并收藏"将弹出另存为对话框');
  };

  // 按日期分组，日期 key 以 desc 排序
  const grouped: Record<string, HistoryImage[]> = {};
  for (const img of images) {
    const k = formatDateKey(img.createTime);
    (grouped[k] ||= []).push(img);
  }
  const dateKeys = Object.keys(grouped).sort((a, b) =>
    new Date(b).getTime() - new Date(a).getTime()
  );

  return (
    <div className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-6xl max-h-[90vh] bg-white rounded-3xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-8 py-5 border-b border-slate-100">
          <div>
            <h2 className="text-xl font-black text-slate-900">历史生图</h2>
            <p className="text-xs text-slate-400 font-medium mt-0.5">
              仅展示当前账号未被 30 天 LRU 清理的记录；点"下载并收藏"续命 30 天 + 下载到本地，
              本人卡片 hover 出现红色按钮可永久删除（云端 GCS Blob 同步删，不可恢复）
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* 批量删除入口：进入后头部按钮变为"退出批量"+ 选中计数；底部工具栏负责实际删除 */}
            <button
              onClick={toggleSelectionMode}
              disabled={batchDeleting}
              className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all flex items-center gap-1.5 ${
                selectionMode
                  ? 'bg-rose-600 text-white hover:bg-rose-700'
                  : 'bg-slate-100 text-slate-600 hover:bg-rose-50 hover:text-rose-600'
              } disabled:opacity-50`}
              title={selectionMode ? '退出批量删除模式' : '进入批量删除模式（仅可勾选本人历史）'}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
              </svg>
              {selectionMode ? `批量中 (${selectedJobIds.size})` : '批量删除'}
            </button>
            <button
              onClick={onClose}
              disabled={batchDeleting}
              className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-500 hover:text-slate-800 transition-colors disabled:opacity-50"
              title="关闭"
            >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-8 py-6 custom-scrollbar">
          {loading && (
            <div className="flex items-center justify-center py-20 text-slate-400 text-sm font-medium">
              <div className="w-5 h-5 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin mr-3"></div>
              加载中…
            </div>
          )}

          {!loading && error && (
            <div className="text-center py-20">
              <p className="text-sm text-red-500 font-medium mb-3">拉取失败：{error}</p>
              <button
                onClick={() => { setLoading(true); setError(null); setImages([]); /* trigger re-mount effect via parent if needed */ window.location.reload(); }}
                className="text-sm text-indigo-600 font-bold hover:underline"
              >
                刷新页面重试
              </button>
            </div>
          )}

          {!loading && !error && images.length === 0 && (
            <div className="text-center py-20">
              <p className="text-sm text-slate-400 font-medium">暂无历史生图记录</p>
              <p className="text-xs text-slate-300 mt-1">生图超过 30 天未收藏会被自动清理</p>
            </div>
          )}

          {!loading && !error && dateKeys.map(dateKey => (
            <section key={dateKey} className="mb-8 last:mb-0">
              <div className="flex items-baseline gap-3 mb-3 py-2">
                <h3 className="text-sm font-black text-slate-800">{dateKey}</h3>
                <span className="text-[11px] text-slate-400 font-bold">共 {grouped[dateKey].length} 张</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {grouped[dateKey].map(img => {
                  const key = `${img.jobId}-${img.urlIndex}`;
                  const isSaving = savingIds.has(key);
                  const isSelected = selectionMode && selectedJobIds.has(img.jobId);
                  // 选择模式下：mine 卡片高亮已选；非 mine 卡片整体置灰且不响应点击
                  const cardSelectionClass = !selectionMode
                    ? ''
                    : img.mine
                      ? (isSelected ? 'ring-4 ring-rose-500 ring-offset-2 ring-offset-white' : 'ring-2 ring-transparent hover:ring-rose-300')
                      : 'opacity-40 grayscale cursor-not-allowed';
                  return (
                    <div
                      key={key}
                      className={`group relative aspect-[3/4] rounded-2xl overflow-hidden border border-slate-100 bg-slate-50 shadow-sm hover:shadow-lg transition-all ${cardSelectionClass}`}
                    >
                      {/* RefreshableImage：onError 自动重拉签名 URL，应对 provider=gcs 下 15min TTL 过期场景。
                          local 模式下 /static/... 不会过期，组件正常透明工作。
                          选择模式下劫持 onClick：mine → toggle 选中；!mine → 静默忽略；非选择模式 → 走原来的预览。 */}
                      <RefreshableImage
                        src={img.url}
                        jobId={img.jobId}
                        urlIndex={img.urlIndex}
                        alt={img.promptUsed || 'history'}
                        title={img.promptUsed}
                        className={`w-full h-full object-cover ${selectionMode ? (img.mine ? 'cursor-pointer' : 'cursor-not-allowed') : 'cursor-zoom-in'}`}
                        onClick={() => {
                          if (selectionMode) {
                            if (img.mine) toggleSelectCard(img);
                          } else {
                            setPreview(img);
                          }
                        }}
                      />
                      {/* 选择模式下，mine 卡片左上角覆盖一个 checkbox（取代 RefreshableImage 的提示，
                          非 mine 卡片仍显示"组员"徽标）。点击 checkbox 等同于点击卡片。 */}
                      {selectionMode && img.mine && (
                        <div
                          className="absolute top-2 left-2 z-20 cursor-pointer"
                          onClick={(e) => { e.stopPropagation(); toggleSelectCard(img); }}
                        >
                          <div className={`w-6 h-6 rounded-md flex items-center justify-center shadow-md transition-all ${
                            isSelected ? 'bg-rose-600 text-white' : 'bg-white/95 border-2 border-slate-300 text-transparent hover:border-rose-400'
                          }`}>
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                            </svg>
                          </div>
                        </div>
                      )}
                      {/* 作者徽标（左上角）：非本人历史标"组员 {username}"；
                          用户名缺失（auth 临时不可达）时 fallback 到 authorId 保底 */}
                      {!img.mine && (
                        <div className="absolute top-2 left-2">
                          <span className="flex items-center gap-1 px-2 py-1 bg-slate-700/80 text-white text-[10px] font-black rounded-lg shadow-md" title="组内其他成员的历史 · 组员之间可互相下载">
                            组员 {img.authorName || (img.authorId != null ? `#${img.authorId}` : '')}
                          </span>
                        </div>
                      )}

                      {/* 角标：已下载 / 下载并收藏 + ⋮ 菜单 + 删除按钮（仅本人）。
                          历史共享语义修正：组员互相可下载对方的历史生图，不再限制 mine；
                          模特库（BrandModel）才是"私有资产"，那里仍保持作者 + 组长 + admin 权限；
                          删除（DELETE /jobs/{id}）则相反 —— 不可逆 + 同步物理删 GCS Blob，
                          权限收紧到"仅作者本人"，由 img.mine 双重门控（UI + 后端）。
                          批量选择模式下整块隐藏，避免误触下载/单删，全部交由底部工具栏统一处理。 */}
                      {!selectionMode && (
                      <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
                        {img.saved ? (
                          <span className="flex items-center gap-1 px-2 py-1 bg-emerald-500 text-white text-[10px] font-black rounded-lg shadow-md">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" /></svg>
                            已下载
                          </span>
                        ) : (
                          <div className={`flex items-center gap-1 transition-all ${openMenuKey === key ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleSaveAndDownload(img, 'auto'); }}
                              disabled={isSaving}
                              className="flex items-center gap-1 px-2 py-1 bg-white/90 hover:bg-indigo-600 hover:text-white text-indigo-600 text-[10px] font-black rounded-lg shadow-md disabled:opacity-50"
                              title={
                                hasDefaultDir
                                  ? '静默写入已设的默认存储位置；点 ⋮ 可改另存为'
                                  : (img.mine ? '弹另存为对话框；点 ⋮ 可设默认存储位置' : '弹另存为对话框下载组员历史图；点 ⋮ 可设默认存储位置')
                              }
                            >
                              {isSaving ? (
                                <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin"></div>
                              ) : (
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                              )}
                              下载并收藏
                            </button>
                            <div className="relative" ref={openMenuKey === key ? menuRef : null}>
                              <button
                                onClick={(e) => { e.stopPropagation(); setOpenMenuKey(openMenuKey === key ? null : key); }}
                                disabled={isSaving}
                                className="px-1.5 py-1 bg-white/90 hover:bg-slate-100 text-slate-600 text-[10px] font-black rounded-lg shadow-md disabled:opacity-50"
                                title="下载选项"
                                aria-haspopup="menu"
                                aria-expanded={openMenuKey === key}
                              >
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M12 5v.01M12 12v.01M12 19v.01" /></svg>
                              </button>
                              {openMenuKey === key && (
                                // 菜单宽度收窄到 w-44（176px）；菜单项右侧留 pr-5 + whitespace-nowrap，
                                // 避免"设置默认存储位置 / 清除默认存储位置"等 8 字标签在窄菜单里被截断
                                <div role="menu" className="absolute right-0 top-full mt-1 w-44 bg-white border border-slate-200 rounded-xl shadow-xl py-1 text-[11px] font-bold text-slate-700 z-20">
                                  <button
                                    role="menuitem"
                                    onClick={(e) => { e.stopPropagation(); setOpenMenuKey(null); handleSaveAndDownload(img, 'saveAs'); }}
                                    className="w-full text-left pl-3 pr-5 py-2 hover:bg-slate-50 flex items-center gap-2 whitespace-nowrap"
                                  >
                                    <svg className="w-3.5 h-3.5 text-indigo-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1M12 12V4m0 0l-4 4m4-4l4 4" /></svg>
                                    另存为（本次）
                                  </button>
                                  <button
                                    role="menuitem"
                                    onClick={(e) => { e.stopPropagation(); handleSetDefaultDir(); }}
                                    disabled={!fsAccessSupported}
                                    title={!fsAccessSupported ? '仅 Chromium 内核浏览器（Chrome / Edge / Brave）支持' : ''}
                                    className="w-full text-left pl-3 pr-5 py-2 hover:bg-slate-50 flex items-center gap-2 whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
                                  >
                                    <svg className="w-3.5 h-3.5 text-purple-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>
                                    设置默认存储位置
                                  </button>
                                  {hasDefaultDir && (
                                    <button
                                      role="menuitem"
                                      onClick={(e) => { e.stopPropagation(); handleClearDefaultDir(); }}
                                      className="w-full text-left pl-3 pr-5 py-2 hover:bg-slate-50 flex items-center gap-2 whitespace-nowrap text-rose-600"
                                    >
                                      <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" /></svg>
                                      清除默认存储位置
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                        {/* 删除按钮：仅作者本人可见，hover 显形；点击二次 confirm 后
                            DELETE /api/image/jobs/{id} 同步真删 GCS Blob / 本地文件 */}
                        {img.mine && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDelete(img); }}
                            disabled={deletingJobIds.has(img.jobId)}
                            className="flex items-center justify-center w-6 h-6 bg-white/90 hover:bg-rose-600 hover:text-white text-rose-600 rounded-lg shadow-md transition-all opacity-0 group-hover:opacity-100 disabled:opacity-50"
                            title="永久删除（云端原图同步删除，不可恢复）"
                            aria-label="删除此历史生图"
                          >
                            {deletingJobIds.has(img.jobId) ? (
                              <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin"></div>
                            ) : (
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
                              </svg>
                            )}
                          </button>
                        )}
                      </div>
                      )}
                      {/* 底部 phase 徽章 + 构图/动作摘要 */}
                      <div className="absolute bottom-0 left-0 right-0 px-2 py-1.5 bg-gradient-to-t from-black/60 to-transparent">
                        <div className="text-[10px] text-white font-bold tracking-wider uppercase truncate">{PHASE_LABEL[img.phase]}</div>
                        {img.compositionLabel && (
                          <div className="text-[9px] text-white/80 font-medium truncate mt-0.5">{img.compositionLabel}</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        {/* 底部批量删除工具栏：仅 selectionMode 时出现，sticky 在 Modal 底部 */}
        {selectionMode && (
          <div className="border-t border-slate-200 bg-rose-50/60 px-8 py-3 flex items-center justify-between gap-4 shrink-0">
            <div className="flex items-center gap-3 text-xs">
              <span className="font-black text-rose-600">批量删除模式</span>
              <span className="font-bold text-slate-600">
                已选 <span className="text-rose-600 font-black">{selectedJobIds.size}</span> 个任务
              </span>
              <span className="text-slate-400">仅本人记录可勾选，组员记录将被服务端静默跳过</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={selectAllMine}
                disabled={batchDeleting}
                className="px-3 py-1.5 text-xs font-black text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50"
                title="把列表里所有本人的历史一次选中"
              >
                全选本人
              </button>
              <button
                onClick={() => setSelectedJobIds(new Set())}
                disabled={batchDeleting || selectedJobIds.size === 0}
                className="px-3 py-1.5 text-xs font-black text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-40"
              >
                清空已选
              </button>
              <button
                onClick={toggleSelectionMode}
                disabled={batchDeleting}
                className="px-3 py-1.5 text-xs font-black text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={handleBatchDelete}
                disabled={batchDeleting || selectedJobIds.size === 0}
                className="px-4 py-1.5 text-xs font-black text-white bg-rose-600 hover:bg-rose-700 rounded-lg transition-colors disabled:opacity-40 flex items-center gap-1.5"
              >
                {batchDeleting ? (
                  <>
                    <div className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin"></div>
                    删除中...
                  </>
                ) : (
                  <>
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
                    </svg>
                    删除选中 ({selectedJobIds.size})
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 简易 lightbox 预览层 —— 不复用 ImageModal（它绑定了当次会话的 resultsPhaseN 导航） */}
      {preview && (
        <div
          className="fixed inset-0 z-[110] bg-black/90 flex items-center justify-center p-8 cursor-zoom-out"
          onClick={() => setPreview(null)}
        >
          {/* lightbox 预览也用 RefreshableImage：用户可能开了 modal 后停留几十分钟才点开放大 */}
          <RefreshableImage
            src={preview.url}
            jobId={preview.jobId}
            urlIndex={preview.urlIndex}
            alt=""
            className="max-w-full max-h-full rounded-2xl shadow-2xl"
          />
        </div>
      )}
    </div>
  );
};

export default HistoryModal;
