/**
 * 一级管理员审批"共享组模特库扩容"申请（T6）。
 *
 * 列出 pending / approved / rejected 三种状态；对 pending 提供批准 / 拒绝按钮。
 * 批准时会覆盖 share_group.model_cap = requestedCap，组员 /auth/refresh 后生效。
 */
import React, { useEffect, useState } from 'react';
import { Check, X, RefreshCw } from 'lucide-react';
import { groupService, CapacityApplication } from '../GroupAdmin/groupAdminService';

type Status = 'pending' | 'approved' | 'rejected';

const STATUS_LABEL: Record<Status, string> = {
  pending: '待审批',
  approved: '已批准',
  rejected: '已拒绝',
};

const GroupCapacityApplications: React.FC = () => {
  const [status, setStatus] = useState<Status>('pending');
  const [apps, setApps] = useState<CapacityApplication[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchList = async () => {
    try {
      setLoading(true);
      setError('');
      const list = await groupService.listCapacityApplications(status);
      setApps(list);
    } catch (err: any) {
      setError(err?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const handleApprove = async (app: CapacityApplication) => {
    if (!confirm(`确认批准 ${app.groupName} 的扩容：${app.currentCap ?? '默认 30'} → ${app.requestedCap}？`)) return;
    try {
      await groupService.approveCapacityApplication(app.id);
      fetchList();
    } catch (err: any) {
      alert(err?.message || '批准失败');
    }
  };

  const handleReject = async (app: CapacityApplication) => {
    const note = prompt(`拒绝 ${app.groupName} 的扩容申请。可填备注：`, '');
    if (note === null) return;
    try {
      await groupService.rejectCapacityApplication(app.id, note.trim() || undefined);
      fetchList();
    } catch (err: any) {
      alert(err?.message || '拒绝失败');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-black tracking-tight">组模特库扩容审批</h2>
          <p className="text-sm text-slate-500 mt-1">组长（二级管理员）发起的扩容请求，批准后一次性覆盖组容量</p>
        </div>
        <div className="flex items-center gap-2">
          {(['pending', 'approved', 'rejected'] as Status[]).map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-widest ${
                status === s ? 'bg-indigo-600 text-white shadow-md shadow-indigo-200' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {STATUS_LABEL[s]}
            </button>
          ))}
          <button
            onClick={fetchList}
            className="p-2 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200"
            title="刷新"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {error && <div className="p-3 bg-red-50 text-red-600 rounded-xl text-sm font-bold">{error}</div>}

      <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50 border-b border-slate-100">
                <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap">组名</th>
                <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap">组长</th>
                <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap">当前容量</th>
                <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap">申请容量</th>
                <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap">费用</th>
                <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-widest">理由 / 备注</th>
                <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap">提交时间</th>
                <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={8} className="px-6 py-12 text-center text-slate-400">加载中...</td></tr>
              ) : apps.length === 0 ? (
                <tr><td colSpan={8} className="px-6 py-12 text-center text-slate-400">暂无申请</td></tr>
              ) : (
                apps.map((app) => (
                  <tr key={app.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-4 py-3 font-medium text-slate-900 whitespace-nowrap">{app.groupName}</td>
                    <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">{app.applicantUsername}</td>
                    <td className="px-4 py-3 font-mono text-sm text-slate-600 whitespace-nowrap">{app.currentCap ?? '默认 30'}</td>
                    <td className="px-4 py-3 font-mono text-sm font-bold text-indigo-600 whitespace-nowrap">{app.requestedCap}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500 whitespace-nowrap">{app.feeAmount == null ? '—' : `¥ ${app.feeAmount}`}</td>
                    <td className="px-4 py-3 text-xs text-slate-600 max-w-xs">
                      <div className="line-clamp-2" title={app.reason}>{app.reason}</div>
                      {app.reviewNote && (
                        <div className="mt-1 text-[11px] text-slate-400 italic">审批：{app.reviewNote}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{app.createTime ? new Date(app.createTime).toLocaleString() : '—'}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                     <div className="inline-flex items-center gap-1 whitespace-nowrap">
                      {app.status === 'pending' ? (
                        <>
                          <button
                            onClick={() => handleApprove(app)}
                            className="p-2 text-emerald-500 hover:text-emerald-700 transition-colors"
                            title="批准"
                          >
                            <Check className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleReject(app)}
                            className="p-2 text-red-500 hover:text-red-700 transition-colors"
                            title="拒绝"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </>
                      ) : (
                        <span className={`text-[10px] font-black px-2 py-1 rounded-md uppercase tracking-widest whitespace-nowrap ${
                          app.status === 'approved' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                        }`}>
                          {app.status === 'approved' ? '已批准' : '已拒绝'}
                        </span>
                      )}
                     </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default GroupCapacityApplications;
