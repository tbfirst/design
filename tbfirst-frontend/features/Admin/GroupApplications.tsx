import React, { useEffect, useState } from 'react';
import { CheckCircle2, XCircle, RefreshCcw, Pencil } from 'lucide-react';
import { groupService, GroupApplication } from '../GroupAdmin/groupAdminService';

/**
 * 一级管理员的"组申请"审批 Tab。
 * 嵌入 {@link AdminDashboard}；对接 /api/auth/admin/group-applications/*。
 */
const GroupApplications: React.FC = () => {
  const [tab, setTab] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [list, setList] = useState<GroupApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingName, setEditingName] = useState<Record<number, string>>({});

  const fetch = async () => {
    try {
      setLoading(true);
      setError('');
      const data = await groupService.listApplications(tab);
      setList(data);
    } catch (err: any) {
      setError(err?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetch(); }, [tab]);

  const onApprove = async (app: GroupApplication) => {
    const finalName = (editingName[app.id] ?? '').trim();
    try {
      await groupService.approveApplication(app.id, finalName ? finalName : undefined);
      await fetch();
    } catch (err: any) { alert(err?.message || '批准失败'); }
  };
  const onReject = async (app: GroupApplication) => {
    const note = prompt('拒绝理由（选填）：') ?? '';
    try {
      await groupService.rejectApplication(app.id, note || undefined);
      await fetch();
    } catch (err: any) { alert(err?.message || '拒绝失败'); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {(['pending', 'approved', 'rejected'] as const).map(s => (
            <button
              key={s}
              onClick={() => setTab(s)}
              className={`px-4 py-2 text-xs font-black uppercase tracking-widest rounded-lg ${
                tab === s ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >{s}</button>
          ))}
        </div>
        <button onClick={fetch} className="text-xs font-bold text-slate-500 hover:text-indigo-600 flex items-center gap-1">
          <RefreshCcw className="w-3.5 h-3.5" /> 刷新
        </button>
      </div>

      {error && <div className="p-3 rounded-xl bg-red-50 text-red-600 text-sm">{error}</div>}

      <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
       <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50/50 border-b border-slate-100">
              <th className="px-4 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap">申请人</th>
              <th className="px-4 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap">拟定组名</th>
              <th className="px-4 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest">简介</th>
              <th className="px-4 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap">提交时间</th>
              <th className="px-4 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap">状态 / 备注</th>
              <th className="px-4 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={6} className="px-6 py-12 text-center text-slate-400">加载中...</td></tr>
            ) : list.length === 0 ? (
              <tr><td colSpan={6} className="px-6 py-12 text-center text-slate-400">暂无 {tab} 申请</td></tr>
            ) : list.map(a => (
              <tr key={a.id} className="hover:bg-slate-50/50">
                <td className="px-4 py-4 whitespace-nowrap">
                  <div className="font-bold">{a.applicantUsername}</div>
                  <div className="text-xs text-slate-400">{a.applicantNickname}</div>
                </td>
                <td className="px-4 py-4 whitespace-nowrap">
                  {tab === 'pending' ? (
                    <div className="inline-flex items-center gap-1 whitespace-nowrap">
                      <Pencil className="w-3 h-3 text-slate-300" />
                      <input
                        className="px-2 py-1 text-sm bg-slate-50 border border-slate-200 rounded focus:ring-2 focus:ring-indigo-500 outline-none w-40"
                        placeholder={a.proposedName}
                        value={editingName[a.id] ?? ''}
                        onChange={(e) => setEditingName({ ...editingName, [a.id]: e.target.value })}
                      />
                    </div>
                  ) : (
                    <span className="whitespace-nowrap">{a.proposedName}</span>
                  )}
                </td>
                <td className="px-4 py-4 text-sm text-slate-600 max-w-md truncate">{a.proposedDescription}</td>
                <td className="px-4 py-4 text-xs text-slate-400 whitespace-nowrap">{new Date(a.createTime).toLocaleString()}</td>
                <td className="px-4 py-4 text-sm whitespace-nowrap">
                  <div>
                    <span className={`text-[10px] font-black px-2 py-1 rounded-md uppercase tracking-widest whitespace-nowrap ${
                      a.status === 'pending' ? 'bg-amber-100 text-amber-700' :
                      a.status === 'approved' ? 'bg-emerald-100 text-emerald-700' :
                      'bg-red-100 text-red-700'
                    }`}>{a.status}</span>
                  </div>
                  {a.reviewNote && <div className="text-xs text-slate-400 mt-1">{a.reviewNote}</div>}
                </td>
                <td className="px-4 py-4 text-right whitespace-nowrap">
                  {a.status === 'pending' ? (
                    <div className="inline-flex justify-end gap-2 whitespace-nowrap">
                      <button onClick={() => onApprove(a)} className="px-3 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded-lg hover:bg-emerald-700 inline-flex items-center gap-1 whitespace-nowrap">
                        <CheckCircle2 className="w-3.5 h-3.5" /> 批准
                      </button>
                      <button onClick={() => onReject(a)} className="px-3 py-1.5 bg-red-50 text-red-600 text-xs font-bold rounded-lg hover:bg-red-100 inline-flex items-center gap-1 whitespace-nowrap">
                        <XCircle className="w-3.5 h-3.5" /> 拒绝
                      </button>
                    </div>
                  ) : (
                    <span className="text-xs text-slate-300">已处理</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
       </div>
      </div>
    </div>
  );
};

export default GroupApplications;
