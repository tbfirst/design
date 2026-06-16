import React, { useEffect, useState } from 'react';
import { Plus, RefreshCcw, Check, X as XIcon, Pencil } from 'lucide-react';
import { adminService, AdminGroupBrief } from './adminService';
import { authService } from '../Auth/authService';

/**
 * /admin → "组管理" Tab。
 *
 * 功能：
 *  - 列出所有 share_group（含 leaderUsername / memberCount / modelCap / status）
 *  - 就地编辑每组的 modelCap（容量覆盖）
 *  - 右上角 "admin 直接建组" 按钮：admin 成为该组 leader，跳过申请审批流程
 *
 * 注意：admin 建组后需要 refresh token + reload 才能让 Phase1 / Workspace 同步新的 groupId。
 */
const GroupList: React.FC = () => {
  const [groups, setGroups] = useState<AdminGroupBrief[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [capDraft, setCapDraft] = useState<Record<number, string>>({});

  const fetchAll = async () => {
    try {
      setLoading(true);
      setError('');
      const data = await adminService.listAllGroups();
      setGroups(data);
    } catch (err: any) {
      setError(err?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, []);

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const id = await adminService.adminCreateGroup(newName.trim(), newDesc.trim() || undefined);
      alert(`组创建成功（ID ${id}），即将刷新以同步管理员身份。`);
      setShowCreate(false); setNewName(''); setNewDesc('');
      try { await authService.refresh(); } catch { /* ignore */ }
      window.location.reload();
    } catch (err: any) { alert(err?.message || '建组失败'); }
  };

  const onSaveCap = async (groupId: number) => {
    const raw = (capDraft[groupId] ?? '').trim();
    let cap: number | null;
    if (raw === '') {
      cap = null; // 清除覆盖
    } else {
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
        alert('容量必须是正整数，留空表示清除覆盖');
        return;
      }
      cap = n;
    }
    try {
      await adminService.updateGroupCap(groupId, cap);
      setGroups(prev => prev.map(g => g.groupId === groupId ? { ...g, modelCap: cap } : g));
      setCapDraft(prev => { const n = { ...prev }; delete n[groupId]; return n; });
    } catch (err: any) { alert(err?.message || '保存失败'); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-slate-500">
          共 {groups.length} 个组；modelCap 留空表示默认 30。
        </div>
        <div className="flex gap-2">
          <button onClick={fetchAll} className="text-xs font-bold text-slate-500 hover:text-indigo-600 flex items-center gap-1">
            <RefreshCcw className="w-3.5 h-3.5" /> 刷新
          </button>
          <button onClick={() => setShowCreate(true)} className="px-3 py-1.5 bg-indigo-600 text-white text-xs font-bold rounded-lg hover:bg-indigo-700 flex items-center gap-1">
            <Plus className="w-3.5 h-3.5" /> 直接建组（管理员）
          </button>
        </div>
      </div>

      {error && <div className="p-3 rounded-xl bg-red-50 text-red-600 text-sm">{error}</div>}

      <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
       <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50/50 border-b border-slate-100">
              <th className="px-4 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap">ID</th>
              <th className="px-4 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap">名称</th>
              <th className="px-4 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap">组长</th>
              <th className="px-4 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap">成员数</th>
              <th className="px-4 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap">状态</th>
              <th className="px-4 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap">容量上限</th>
              <th className="px-4 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap">创建时间</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={7} className="px-6 py-12 text-center text-slate-400">加载中...</td></tr>
            ) : groups.length === 0 ? (
              <tr><td colSpan={7} className="px-6 py-12 text-center text-slate-400">暂无组</td></tr>
            ) : groups.map(g => {
              const draft = capDraft[g.groupId];
              const dirty = draft !== undefined && draft !== String(g.modelCap ?? '');
              return (
                <tr key={g.groupId} className="hover:bg-slate-50/50">
                  <td className="px-4 py-4 text-xs text-slate-400 whitespace-nowrap">{g.groupId}</td>
                  <td className="px-4 py-4">
                    <div className="font-bold whitespace-nowrap">{g.name}</div>
                    {g.description && <div className="text-xs text-slate-400 max-w-sm truncate">{g.description}</div>}
                  </td>
                  <td className="px-4 py-4 text-sm whitespace-nowrap">{g.leaderUsername || `user ${g.leaderId}`}</td>
                  <td className="px-4 py-4 text-sm whitespace-nowrap">{g.memberCount}</td>
                  <td className="px-4 py-4 whitespace-nowrap">
                    <span className={`text-[10px] font-black px-2 py-1 rounded-md uppercase tracking-widest whitespace-nowrap ${g.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{g.status}</span>
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap">
                    <div className="inline-flex items-center gap-1 whitespace-nowrap">
                      <input
                        type="number"
                        min={1}
                        value={draft ?? (g.modelCap == null ? '' : String(g.modelCap))}
                        onChange={(e) => setCapDraft({ ...capDraft, [g.groupId]: e.target.value })}
                        placeholder="30"
                        className="w-20 px-2 py-1 text-sm bg-slate-50 border border-slate-200 rounded focus:ring-2 focus:ring-indigo-500 outline-none"
                      />
                      {dirty && (
                        <button onClick={() => onSaveCap(g.groupId)} className="p-1 bg-emerald-600 text-white rounded hover:bg-emerald-700" title="保存">
                          <Check className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {dirty && (
                        <button onClick={() => setCapDraft(prev => { const n = { ...prev }; delete n[g.groupId]; return n; })} className="p-1 bg-slate-200 text-slate-600 rounded hover:bg-slate-300" title="取消">
                          <XIcon className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-4 text-xs text-slate-400 whitespace-nowrap">{new Date(g.createTime).toLocaleString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
       </div>
      </div>

      {/* 建组弹窗 */}
      {showCreate && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowCreate(false)}>
          <form onClick={(e) => e.stopPropagation()} onSubmit={onCreate} className="w-full max-w-md bg-white rounded-3xl p-8 shadow-2xl space-y-4">
            <h3 className="text-xl font-black">直接建组（管理员）</h3>
            <p className="text-xs text-slate-500">你将成为新组的组长；建组后需刷新页面同步身份。</p>
            <div>
              <label className="block text-xs text-slate-500 mb-1">组名</label>
              <input required minLength={2} maxLength={64}
                value={newName} onChange={(e) => setNewName(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">简介（选填）</label>
              <textarea maxLength={1000}
                value={newDesc} onChange={(e) => setNewDesc(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none min-h-[80px]"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 bg-slate-100 text-slate-600 text-sm font-bold rounded-lg hover:bg-slate-200">取消</button>
              <button type="submit" className="px-4 py-2 bg-indigo-600 text-white text-sm font-bold rounded-lg hover:bg-indigo-700">建组</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default GroupList;
