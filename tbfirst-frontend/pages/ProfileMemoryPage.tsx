/**
 * V6.M2.C.6: 个人记忆管理页（/profile/memory）。
 *
 * Sprint C：L4 偏好卡片（key / value / confidence / lock toggle / inline edit / confirm delete）
 *           + L3 / L5 占位段（v6.M2.D / v6.M2.E 上线后接入）
 *
 * V6.M3.UI: 全页迁 Tailwind "Calm Focused AI Workspace" 风格（D.1–D.2）
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  Preference,
  ProceduralItem,
  RecallItem,
  deletePreference,
  listMemory,
  updatePreference,
} from '../services/profileMemory';
import { api } from '../services/api';

interface RecallRow {
  id: number;
  summary: string;
  quality_score: number | null;
  recall_count: number | null;
  last_recalled_at: string | null;
  archived: boolean;
}

// Shared class strings
const cx = {
  btn: 'px-2.5 py-1 text-[12px] border border-gray-200 rounded-md bg-surface text-gray-700 hover:bg-gray-50 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent',
  btnPri: 'px-2.5 py-1 text-[12px] bg-accent text-white rounded-md hover:bg-accent-dark active:scale-[0.98] transition-all cursor-pointer border-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent',
  btnDanger: 'px-2.5 py-1 text-[12px] bg-danger text-white rounded-md hover:bg-danger-dark active:scale-[0.98] transition-all cursor-pointer border-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-danger',
  badge: 'inline-block px-1.5 py-0.5 rounded text-[10px] ml-1.5 bg-amber-50 text-amber-700 border border-amber-200 font-medium',
  input: 'w-full px-2 py-1.5 text-[13px] border border-gray-200 rounded-md [font-family:inherit] outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:border-accent transition-colors mb-1.5 bg-surface',
  empty: 'text-[13px] text-text-muted italic',
  sectionHead: 'text-[15px] font-semibold text-gray-700 mb-2.5',
  card: 'rounded-lg border border-border bg-surface p-3 hover:shadow-sm transition-shadow',
  cardKey: 'text-[12px] text-accent font-semibold mb-1',
  cardVal: 'text-[14px] text-gray-700 mb-1.5 break-words',
  cardMeta: 'text-[11px] text-text-faint mb-2.5',
  cardActs: 'flex gap-1.5 flex-wrap',
};

const ProfileMemoryPage: React.FC = () => {
  const [prefs, setPrefs] = useState<Preference[]>([]);
  const [recall, setRecall] = useState<RecallItem[]>([]);
  const [procedural, setProcedural] = useState<ProceduralItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const d = await listMemory();
      setPrefs(d.preferences); setRecall(d.recall); setProcedural(d.procedural);
    } catch (e) { setErr((e as Error).message || 'load failed'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const apply = useCallback((updated: Preference) => {
    setPrefs((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
  }, []);

  const toggleLock = useCallback(async (p: Preference) => {
    setErr(null);
    try { apply(await updatePreference(p.id, { user_locked: !p.user_locked })); }
    catch (e) { setErr((e as Error).message || 'lock toggle failed'); }
  }, [apply]);

  const saveEdit = useCallback(async (p: Preference) => {
    const value = editDraft.trim();
    if (!value || value === p.value) { setEditingId(null); return; }
    setErr(null);
    try { apply(await updatePreference(p.id, { value })); setEditingId(null); }
    catch (e) { setErr((e as Error).message || 'save failed'); }
  }, [editDraft, apply]);

  const doDelete = useCallback(async (id: number) => {
    setErr(null);
    try {
      await deletePreference(id);
      setPrefs((prev) => prev.filter((x) => x.id !== id));
      setConfirmDeleteId(null);
    } catch (e) { setErr((e as Error).message || 'delete failed'); }
  }, []);

  const toggleArchive = useCallback(async (id: number, archived: boolean) => {
    setErr(null);
    try {
      await api.put(`/api/image/agent/profile/memory/recall/${id}`, { archived: !archived });
      setRecall((prev) =>
        prev.map((r) => ((r as unknown as RecallRow).id === id ? { ...r, archived: !archived } : r)),
      );
    } catch (e) { setErr((e as Error).message || 'archive toggle failed'); }
  }, []);

  return (
    <div className="min-h-[calc(100vh-56px)] bg-canvas px-6 py-5">
      <div className="max-w-[960px] mx-auto">
        <h1 className="text-xl font-bold text-gray-800 mb-2">我的记忆</h1>
        <p className="text-[13px] text-text-muted mb-4">
          L4 偏好按 confidence 倒序；锁定后不被自动覆盖也不被衰减。
        </p>
        {err && <div className="text-[12px] text-danger mb-3">错误：{err}</div>}

        {/* L4 偏好 */}
        <section className="mb-7">
          <div className={cx.sectionHead}>L4 用户偏好（{prefs.length}）</div>
          {loading ? (
            <div className={cx.empty}>加载中…</div>
          ) : prefs.length === 0 ? (
            <div className={cx.empty}>暂无偏好。多和 Agent 对话，偏好会自动萃取。</div>
          ) : (
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
              {prefs.map((p) => (
                <div key={p.id} className={cx.card}>
                  <div className={cx.cardKey}>
                    {p.key}
                    {p.user_locked && <span className={cx.badge}>锁定</span>}
                  </div>
                  {editingId === p.id ? (
                    <>
                      <input
                        className={cx.input}
                        value={editDraft}
                        onChange={(e) => setEditDraft(e.target.value)}
                        autoFocus
                      />
                      <div className={cx.cardActs}>
                        <button type="button" className={cx.btnPri} onClick={() => void saveEdit(p)}>保存</button>
                        <button type="button" className={cx.btn} onClick={() => setEditingId(null)}>取消</button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className={cx.cardVal}>{p.value}</div>
                      <div className={cx.cardMeta}>
                        confidence: {p.confidence != null ? p.confidence.toFixed(2) : '—'}
                        {p.last_injected_at && ` · 上次注入 ${p.last_injected_at.slice(0, 10)}`}
                      </div>
                      <div className={cx.cardActs}>
                        <button type="button" className={cx.btn} onClick={() => void toggleLock(p)}>
                          {p.user_locked ? '解锁' : '锁定'}
                        </button>
                        <button type="button" className={cx.btn} onClick={() => { setEditingId(p.id); setEditDraft(p.value); }}>编辑</button>
                        <button type="button" className={cx.btnDanger} onClick={() => setConfirmDeleteId(p.id)}>删除</button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* L3 回顾 */}
        <section className="mb-7">
          <div className={cx.sectionHead}>L3 历史回顾（{recall.length}）</div>
          {loading ? (
            <div className={cx.empty}>加载中…</div>
          ) : recall.length === 0 ? (
            <div className={cx.empty}>暂无跨会话摘要。长会话压缩后会在此沉淀。</div>
          ) : (
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
              {(recall as unknown as RecallRow[]).map((r) => (
                <div key={r.id} className={`${cx.card} ${r.archived ? 'opacity-50' : ''}`}>
                  <div className={cx.cardKey}>
                    摘要 #{r.id}
                    {r.archived && <span className={cx.badge}>已归档</span>}
                  </div>
                  <div className={cx.cardVal}>{r.summary}</div>
                  <div className={cx.cardMeta}>
                    质量 {r.quality_score != null ? r.quality_score.toFixed(2) : '—'}
                    {' · '}召回 {r.recall_count ?? 0} 次
                    {r.last_recalled_at && ` · 上次 ${r.last_recalled_at.slice(0, 10)}`}
                  </div>
                  <div className={cx.cardActs}>
                    <button type="button" className={cx.btn} onClick={() => void toggleArchive(r.id, r.archived)}>
                      {r.archived ? '恢复' : '归档'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* L5 占位 */}
        <section className="mb-7">
          <div className={cx.sectionHead}>L5 流程模板</div>
          <div className={cx.empty}>
            v6.M2.E 上线后此处显示成功 prompt 工作流模板（共 {procedural.length} 条）
          </div>
        </section>
      </div>

      {/* 删除 confirm modal */}
      {confirmDeleteId !== null && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-[100] animate-in fade-in"
          onClick={() => setConfirmDeleteId(null)}
        >
          <div
            className="bg-surface rounded-lg p-5 w-[340px] max-w-[95vw] shadow-md animate-in slide-in-from-bottom-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-gray-800 mt-0 mb-3">删除确认</h3>
            <p className="text-sm text-text-muted">确定删除该偏好吗？此操作不可撤销。</p>
            <div className="flex justify-end gap-2 mt-4">
              <button type="button" className={cx.btn} onClick={() => setConfirmDeleteId(null)}>取消</button>
              <button type="button" className={cx.btnDanger} onClick={() => void doDelete(confirmDeleteId)}>确认删除</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProfileMemoryPage;
