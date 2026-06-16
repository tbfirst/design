import React, { useEffect, useMemo, useState } from 'react';
import { Trash2, RefreshCcw, Filter } from 'lucide-react';
import { adminService, AdminUser, AdminGroupBrief, AdminBrandModel } from './adminService';
import { toProxiedSrc, makeImgErrorFallback } from '../../services/shared/imageSrc';

/**
 * 一级管理员专属：全站模特总览 Tab。
 *
 * 数据源：
 *  - 主表：GET /api/image/models/admin/all（scope + userId + groupId 过滤）
 *  - userId→username 映射：/api/auth/admin/users
 *  - groupId→groupName 映射：/api/auth/admin/groups
 *
 * 合并在客户端做；500 条以内数据量足够。
 */
const BrandModelOverview: React.FC = () => {
  const [scope, setScope] = useState<'all' | 'personal' | 'group'>('all');
  const [filterUserId, setFilterUserId] = useState<number | ''>('');
  const [filterGroupId, setFilterGroupId] = useState<number | ''>('');
  const [models, setModels] = useState<AdminBrandModel[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [groups, setGroups] = useState<AdminGroupBrief[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const userMap = useMemo(() => {
    const m = new Map<number, string>();
    users.forEach(u => m.set(u.id, u.username));
    return m;
  }, [users]);

  const groupMap = useMemo(() => {
    const m = new Map<number, string>();
    groups.forEach(g => m.set(g.groupId, g.name));
    return m;
  }, [groups]);

  const fetchAll = async () => {
    try {
      setLoading(true);
      setError('');
      const [ms, us, gs] = await Promise.all([
        adminService.listAllBrandModels(
          scope,
          filterUserId === '' ? null : Number(filterUserId),
          filterGroupId === '' ? null : Number(filterGroupId),
        ),
        users.length === 0 ? adminService.getUsers() : Promise.resolve(users),
        groups.length === 0 ? adminService.listAllGroups() : Promise.resolve(groups),
      ]);
      setModels(ms);
      if (users.length === 0) setUsers(us);
      if (groups.length === 0) setGroups(gs);
    } catch (err: any) {
      setError(err?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); /* eslint-disable-line */ }, [scope, filterUserId, filterGroupId]);

  const handleDelete = async (m: AdminBrandModel) => {
    if (!confirm(`确定删除「${m.name || m.id}」？该操作不可撤销（软删）。`)) return;
    try {
      await adminService.deleteBrandModel(m.id);
      setModels(prev => prev.filter(x => x.id !== m.id));
    } catch (err: any) { alert(err?.message || '删除失败'); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="w-4 h-4 text-slate-400" />
          <div className="inline-flex p-0.5 bg-slate-100 rounded-lg">
            {(['all', 'personal', 'group'] as const).map(s => (
              <button
                key={s}
                onClick={() => setScope(s)}
                className={`px-3 py-1 text-[11px] font-black uppercase tracking-widest rounded-md ${scope === s ? 'bg-white shadow text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
              >{s === 'all' ? '全部' : s === 'personal' ? '个人库' : '组库'}</button>
            ))}
          </div>
          <select
            value={filterUserId}
            onChange={(e) => setFilterUserId(e.target.value === '' ? '' : Number(e.target.value))}
            className="px-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-indigo-500 outline-none"
          >
            <option value="">所有上传者</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.username}</option>)}
          </select>
          <select
            value={filterGroupId}
            onChange={(e) => setFilterGroupId(e.target.value === '' ? '' : Number(e.target.value))}
            className="px-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-indigo-500 outline-none"
          >
            <option value="">所有组</option>
            {groups.map(g => <option key={g.groupId} value={g.groupId}>{g.name}</option>)}
          </select>
        </div>
        <button onClick={fetchAll} className="text-xs font-bold text-slate-500 hover:text-indigo-600 flex items-center gap-1">
          <RefreshCcw className="w-3.5 h-3.5" /> 刷新
        </button>
      </div>

      {error && <div className="p-3 rounded-xl bg-red-50 text-red-600 text-sm">{error}</div>}

      <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
        {loading ? (
          <div className="py-12 text-center text-slate-400 text-sm">加载中...</div>
        ) : models.length === 0 ? (
          <div className="py-12 text-center text-slate-400 text-sm">暂无匹配的模特</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 p-4">
            {models.map(m => (
              <div key={m.id} className="group relative aspect-[3/4] rounded-2xl overflow-hidden border border-slate-100 bg-slate-50 shadow-sm hover:shadow-lg transition-all">
                <img src={toProxiedSrc(m.url)} onError={makeImgErrorFallback()} loading="lazy" className="w-full h-full object-cover" alt={m.name || String(m.id)} />
                <div className="absolute top-2 left-2 flex flex-col gap-1">
                  <span className="px-2 py-0.5 bg-slate-900/70 text-white text-[10px] font-black rounded-md">
                    {userMap.get(m.userId) || `user ${m.userId}`}
                  </span>
                  {m.groupId != null && (
                    <span className="px-2 py-0.5 bg-emerald-600/90 text-white text-[10px] font-black rounded-md">
                      {groupMap.get(m.groupId) || `group ${m.groupId}`}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => handleDelete(m)}
                  title="管理员删除（全局放行）"
                  className="absolute top-2 right-2 p-1.5 bg-red-500 text-white rounded-lg shadow-xl opacity-0 group-hover:opacity-100 transition-opacity hover:scale-110"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
                <div className="absolute bottom-0 left-0 right-0 px-2 py-1.5 bg-gradient-to-t from-black/60 to-transparent text-[10px] text-white font-bold">
                  {m.name || '(未命名)'}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default BrandModelOverview;
