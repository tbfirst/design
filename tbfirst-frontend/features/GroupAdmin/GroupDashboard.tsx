import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users, Crown, UserMinus, UserPlus, LogOut, ShieldAlert,
  Send, ArrowLeft, Mail, Check, X as XIcon,
} from 'lucide-react';
import { authService } from '../Auth/authService';
import CurrentUserBadge from '../Auth/CurrentUserBadge';
import { groupService, MyGroup, GroupInvitation, CapacityApplication } from './groupAdminService';

/**
 * 资源共享组管理页 —— 组长与组员共用。
 *
 * - 组长（leader）：可见邀请表单、踢人按钮、解散按钮
 * - 组员（member）：仅看到成员列表 + 自己的退组按钮
 * - 未加入组：显示一个"我的邀请"入口（若有待响应邀请）+ 申请成立组入口
 *
 * 所有写操作成功后调 authService.refresh() 同步新 JWT（带上最新 groupId claim）。
 */
const GroupDashboard: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [group, setGroup] = useState<MyGroup | null>(null);
  const [invitation, setInvitation] = useState<GroupInvitation | null>(null);

  // 组长邀请表单
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);

  // 自申请建组表单（给无组的用户在这里直接提交一条 pending）
  const [showApply, setShowApply] = useState(false);
  const [applyName, setApplyName] = useState('');
  const [applyDescription, setApplyDescription] = useState('');

  // T6：组长扩容申请
  const [capApps, setCapApps] = useState<CapacityApplication[]>([]);
  const [showCapForm, setShowCapForm] = useState(false);
  const [capRequested, setCapRequested] = useState('');
  const [capReason, setCapReason] = useState('');
  const [capFee, setCapFee] = useState('');
  const [submittingCap, setSubmittingCap] = useState(false);

  const fetchAll = async () => {
    try {
      setLoading(true);
      const [g, inv] = await Promise.all([
        groupService.getMyGroup(),
        groupService.getMyPendingInvitation(),
      ]);
      setGroup(g);
      setInvitation(inv);
      // 只有有组时再拉扩容申请（无组时后端会返回空数组，省一次请求）
      if (g) {
        try {
          const apps = await groupService.myCapacityApplications();
          setCapApps(apps);
        } catch {
          // 扩容申请加载失败不阻塞主视图
          setCapApps([]);
        }
      } else {
        setCapApps([]);
      }
    } catch (err: any) {
      setError(err?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
  }, []);

  const refreshJwtAndReload = async () => {
    // 刷新 JWT 以同步新的 groupId claim，随后**整页重载**。
    // 采用 reload 是因为 Phase1 / Workspace / HistoryModal 都直接读 authService.getCurrentUser()，
    // 引入 Context 的重构面较大；reload 对 SPA 不优雅但 100% 可靠（errorConclude #39）。
    try {
      await authService.refresh();
    } catch (err: any) {
      // 不再静默吞错：refresh 失败时旧 token 的 groupId claim 不会被刷新，
      // reload 后可能仍以"有组"态渲染，让用户/排查者拿到诊断信息。
      console.error('[GroupDashboard] refresh JWT failed before reload', err);
      setError(err?.message || '刷新登录态失败，将整页重载');
    }
    window.location.reload();
  };

  const onAccept = async (id: number) => {
    setError(''); setInfo('');
    try {
      await groupService.respondInvitation(id, true);
      setInfo('已加入组');
      await refreshJwtAndReload();
    } catch (err: any) { setError(err?.message || '操作失败'); }
  };
  const onReject = async (id: number) => {
    try { await groupService.respondInvitation(id, false); await fetchAll(); }
    catch (err: any) { setError(err?.message || '操作失败'); }
  };

  const onInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!group) return;
    const email = inviteEmail.trim();
    // 前端简易格式兜底；后端按邮箱查 user 失败会返回 NOT_FOUND
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('请输入合法邮箱');
      return;
    }
    setInviting(true); setError(''); setInfo('');
    try {
      await groupService.invite(group.groupId, { inviteeEmail: email });
      setInviteEmail('');
      // TODO(errorConclude #40): 当前只是站内邀请，后续接 SMTP 后改提示 "邀请邮件已发送"
      setInfo('邀请已发出');
      await fetchAll();
    } catch (err: any) { setError(err?.message || '邀请失败'); }
    finally { setInviting(false); }
  };

  const onKick = async (userId: number) => {
    if (!group) return;
    if (!confirm('确定把该成员踢出组？踢出后该成员仍可看到自己的历史，但无法访问组内资源。')) return;
    try { await groupService.kick(group.groupId, userId); await fetchAll(); }
    catch (err: any) { setError(err?.message || '操作失败'); }
  };

  const onLeave = async () => {
    if (!confirm('确定退出当前组？退出后无法访问组内模特与历史。')) return;
    try { await groupService.leave(); await refreshJwtAndReload(); }
    catch (err: any) { setError(err?.message || '退组失败'); }
  };

  const onDissolve = async () => {
    if (!group) return;
    if (!confirm(`确定解散 ${group.name}？所有成员将被移出，组内模特库被软删。`)) return;
    try { await groupService.dissolve(group.groupId); await refreshJwtAndReload(); }
    catch (err: any) { setError(err?.message || '解散失败'); }
  };

  const onApply = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setInfo('');
    try {
      const id = await groupService.apply(applyName.trim(), applyDescription.trim() || undefined);
      setInfo(`申请已提交（编号 ${id}），等待一级管理员批准`);
      setShowApply(false);
      setApplyName(''); setApplyDescription('');
    } catch (err: any) { setError(err?.message || '提交失败'); }
  };

  // 功能开关：扩容申请暂未上线。改为 true 时恢复完整流程（表单 + 提交 API）。
  // 同步控制：GroupDashboard 内的"申请扩容"按钮 disabled、本 handler 入口拦截、submit button 按钮文案。
  const CAPACITY_APP_ENABLED = false;

  const onSubmitCapApp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setInfo('');
    if (!CAPACITY_APP_ENABLED) {
      // 兜底：即使有人绕过 disabled 按钮（DevTools / 热重载残留 state）把表单调出来也拦下，
      // 不发任何 API 请求，避免在功能未上线期间产生 DB 噪声 / 后台审批面板的"幽灵 pending"。
      setError('扩容申请功能暂未上线');
      return;
    }
    const n = Number(capRequested);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
      setError('目标容量必须是正整数');
      return;
    }
    if (capReason.trim().length === 0) {
      setError('请填写扩容理由');
      return;
    }
    let fee: number | null = null;
    if (capFee.trim() !== '') {
      const f = Number(capFee);
      if (!Number.isFinite(f) || f < 0) {
        setError('费用金额格式错误（留空表示暂不填）');
        return;
      }
      fee = f;
    }
    setSubmittingCap(true);
    try {
      const id = await groupService.submitCapacityApplication({
        requestedCap: n,
        reason: capReason.trim(),
        feeAmount: fee,
      });
      setInfo(`扩容申请已提交（编号 ${id}），等待一级管理员审批`);
      setShowCapForm(false);
      setCapRequested(''); setCapReason(''); setCapFee('');
      await fetchAll();
    } catch (err: any) {
      setError(err?.message || '提交失败');
    } finally {
      setSubmittingCap(false);
    }
  };

  const isLeader = group?.myRole === 'leader';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={() => navigate('/workspace')} className="text-sm font-bold text-slate-500 hover:text-indigo-600 flex items-center gap-1">
              <ArrowLeft className="w-4 h-4" /> 返回工作台
            </button>
            <h1 className="text-xl font-black tracking-tight">资源共享组</h1>
          </div>
          <div className="flex items-center gap-4">
            <CurrentUserBadge />
            <button onClick={() => authService.logout()} className="text-sm font-bold text-slate-500 hover:text-red-600 flex items-center gap-1">
              <LogOut className="w-4 h-4" /> 退出登录
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-10 space-y-6">
        {error && <div className="p-3 rounded-xl bg-red-50 border border-red-100 text-red-600 text-sm">{error}</div>}
        {info && <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-700 text-sm">{info}</div>}

        {loading ? (
          <div className="bg-white rounded-3xl p-12 text-center text-slate-400 border border-slate-100">加载中...</div>
        ) : invitation && !group ? (
          <section className="bg-white rounded-3xl border border-slate-100 p-6 shadow-sm">
            <div className="flex items-center gap-3 mb-2">
              <Mail className="w-5 h-5 text-indigo-500" />
              <h2 className="font-black">你有一条组邀请</h2>
            </div>
            <p className="text-slate-700 mb-4">
              <span className="font-bold">{invitation.inviterUsername}</span> 邀请你加入
              <span className="font-bold text-indigo-600 ml-1">{invitation.groupName}</span>。
            </p>
            <div className="flex gap-3">
              <button onClick={() => onAccept(invitation.id)} className="px-4 py-2 bg-emerald-600 text-white text-sm font-bold rounded-lg hover:bg-emerald-700 flex items-center gap-1">
                <Check className="w-4 h-4" /> 接受
              </button>
              <button onClick={() => onReject(invitation.id)} className="px-4 py-2 bg-slate-100 text-slate-600 text-sm font-bold rounded-lg hover:bg-slate-200 flex items-center gap-1">
                <XIcon className="w-4 h-4" /> 拒绝
              </button>
            </div>
          </section>
        ) : !group ? (
          <section className="bg-white rounded-3xl border border-slate-100 p-6 shadow-sm">
            <div className="flex items-center gap-3 mb-2">
              <Users className="w-5 h-5 text-slate-400" />
              <h2 className="font-black">你尚未加入任何共享组</h2>
            </div>
            <p className="text-sm text-slate-500 mb-4">
              可以等组长发出邀请；也可以自己提交一份申请，由一级管理员批准后即可成为组长。
            </p>
            {!showApply ? (
              <button onClick={() => setShowApply(true)} className="px-4 py-2 bg-indigo-600 text-white text-sm font-bold rounded-lg hover:bg-indigo-700">
                提交成立共享组申请
              </button>
            ) : (
              <form onSubmit={onApply} className="space-y-3 mt-2">
                <input
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                  placeholder="组名（2-64 字）"
                  minLength={2} maxLength={64}
                  value={applyName} onChange={(e) => setApplyName(e.target.value)} required
                />
                <textarea
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none min-h-[80px]"
                  placeholder="简介（选填）"
                  maxLength={1000}
                  value={applyDescription} onChange={(e) => setApplyDescription(e.target.value)}
                />
                <div className="flex gap-2">
                  <button type="submit" className="px-4 py-2 bg-indigo-600 text-white text-sm font-bold rounded-lg hover:bg-indigo-700">提交申请</button>
                  <button type="button" onClick={() => setShowApply(false)} className="px-4 py-2 bg-slate-100 text-slate-600 text-sm font-bold rounded-lg hover:bg-slate-200">取消</button>
                </div>
              </form>
            )}
          </section>
        ) : (
          <>
            {/* 组概览 */}
            <section className="bg-white rounded-3xl border border-slate-100 p-6 shadow-sm">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-2xl font-black">{group.name}</h2>
                    <span className={`text-[10px] font-black px-2 py-1 rounded-md uppercase tracking-widest ${isLeader ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-600'}`}>
                      {isLeader ? '组长' : '组员'}
                    </span>
                    <span className="text-[10px] font-black px-2 py-1 rounded-md uppercase tracking-widest bg-emerald-100 text-emerald-700">
                      {group.status}
                    </span>
                  </div>
                  {group.description && <p className="text-sm text-slate-500 mt-2">{group.description}</p>}
                  <p className="text-xs text-slate-400 mt-2">成员数：{group.memberCount}</p>
                </div>
                <div className="flex gap-2">
                  {isLeader ? (
                    <button onClick={onDissolve} className="px-3 py-2 bg-red-50 text-red-600 text-sm font-bold rounded-lg hover:bg-red-100 flex items-center gap-1">
                      <ShieldAlert className="w-4 h-4" /> 解散组
                    </button>
                  ) : (
                    <button onClick={onLeave} className="px-3 py-2 bg-slate-100 text-slate-600 text-sm font-bold rounded-lg hover:bg-slate-200 flex items-center gap-1">
                      <LogOut className="w-4 h-4" /> 退出组
                    </button>
                  )}
                </div>
              </div>
            </section>

            {/* 组长：邀请表单 + 待响应邀请 */}
            {isLeader && (
              <section className="bg-white rounded-3xl border border-slate-100 p-6 shadow-sm space-y-4">
                <div className="flex items-center gap-2">
                  <UserPlus className="w-5 h-5 text-indigo-500" />
                  <h3 className="font-black">邀请新成员</h3>
                </div>
                <form onSubmit={onInvite} className="flex gap-2">
                  <input
                    type="email"
                    className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                    placeholder="输入被邀请人的邮箱"
                    value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)}
                    maxLength={64}
                    required
                  />
                  <button type="submit" disabled={inviting} className="px-4 py-2 bg-indigo-600 text-white text-sm font-bold rounded-lg hover:bg-indigo-700 disabled:opacity-70 flex items-center gap-1">
                    <Send className="w-4 h-4" /> 发送邀请
                  </button>
                </form>

                {group.pendingInvitations.length > 0 && (
                  <div>
                    <h4 className="text-xs font-black text-slate-500 uppercase tracking-widest mb-2">待响应邀请</h4>
                    <ul className="divide-y divide-slate-100 border border-slate-100 rounded-lg">
                      {group.pendingInvitations.map(inv => (
                        <li key={inv.id} className="px-4 py-3 flex justify-between items-center text-sm">
                          <span>
                            {inv.inviteeUsername}
                            <span className="text-slate-400 ml-2 text-xs">发于 {new Date(inv.createTime).toLocaleString()}</span>
                          </span>
                          <span className="text-[10px] font-black px-2 py-1 rounded-md uppercase tracking-widest bg-amber-100 text-amber-700">pending</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>
            )}

            {/* 组长：扩容申请（T6） —— 暂不上线，灰显入口（保留历史可读） */}
            {isLeader && (
              <section className="bg-white rounded-3xl border border-slate-100 p-6 shadow-sm space-y-4 opacity-90">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-black text-slate-500">组模特库扩容</h3>
                      <span className="text-[10px] font-black px-2 py-0.5 rounded-md uppercase tracking-widest bg-slate-100 text-slate-500 border border-slate-200">
                        暂未上线
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1">
                      向一级管理员申请把本组 model_cap 提升到更高值；批准后立刻生效。
                      <span className="text-amber-600 font-bold">（该功能暂未开放，敬请期待）</span>
                    </p>
                  </div>
                  {!showCapForm && (
                    <button
                      type="button"
                      disabled
                      title="该功能暂未上线"
                      aria-disabled="true"
                      className="px-4 py-2 bg-slate-200 text-slate-400 text-sm font-bold rounded-lg flex items-center gap-1 cursor-not-allowed"
                    >
                      <Send className="w-4 h-4" /> 申请扩容
                    </button>
                  )}
                </div>

                {showCapForm && (
                  <form onSubmit={onSubmitCapApp} className="space-y-3 border-t border-slate-100 pt-4">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">目标容量 *</label>
                        <input
                          type="number"
                          min={1}
                          className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                          placeholder="正整数"
                          value={capRequested}
                          onChange={(e) => setCapRequested(e.target.value)}
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">费用（TODO，可空）</label>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                          placeholder="支付金额，¥"
                          value={capFee}
                          onChange={(e) => setCapFee(e.target.value)}
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">扩容理由 *</label>
                      <textarea
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none min-h-[60px]"
                        placeholder="说明为什么需要扩容（组内业务量增长 / 人员扩张 / ...）"
                        maxLength={1000}
                        value={capReason}
                        onChange={(e) => setCapReason(e.target.value)}
                        required
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="submit"
                        disabled={submittingCap}
                        className="px-4 py-2 bg-indigo-600 text-white text-sm font-bold rounded-lg hover:bg-indigo-700 disabled:opacity-70"
                      >
                        {submittingCap ? '提交中...' : '提交申请'}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setShowCapForm(false); setCapRequested(''); setCapReason(''); setCapFee(''); }}
                        className="px-4 py-2 bg-slate-100 text-slate-600 text-sm font-bold rounded-lg hover:bg-slate-200"
                      >
                        取消
                      </button>
                    </div>
                  </form>
                )}

                {capApps.length > 0 && (
                  <div>
                    <h4 className="text-xs font-black text-slate-500 uppercase tracking-widest mb-2">我的扩容申请历史</h4>
                    <ul className="divide-y divide-slate-100 border border-slate-100 rounded-lg">
                      {capApps.map(app => (
                        <li key={app.id} className="px-4 py-3 text-sm">
                          <div className="flex items-center justify-between">
                            <span className="font-mono text-slate-700">
                              {app.currentCap ?? '默认 30'} → <span className="font-bold text-indigo-600">{app.requestedCap}</span>
                              {app.feeAmount != null && <span className="text-slate-400 ml-2">¥ {app.feeAmount}</span>}
                            </span>
                            <span className={`text-[10px] font-black px-2 py-1 rounded-md uppercase tracking-widest ${
                              app.status === 'pending' ? 'bg-amber-100 text-amber-700' :
                              app.status === 'approved' ? 'bg-emerald-100 text-emerald-700' :
                              'bg-red-100 text-red-700'
                            }`}>
                              {app.status}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 mt-1 line-clamp-2">{app.reason}</p>
                          {app.reviewNote && <p className="text-[11px] text-slate-400 mt-1 italic">审批：{app.reviewNote}</p>}
                          <p className="text-[11px] text-slate-400 mt-1">
                            {app.createTime ? new Date(app.createTime).toLocaleString() : ''}
                            {app.reviewTime && <> · 审批 {new Date(app.reviewTime).toLocaleString()}</>}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>
            )}

            {/* 成员列表 */}
            <section className="bg-white rounded-3xl border border-slate-100 p-6 shadow-sm">
              <div className="flex items-center gap-2 mb-4">
                <Users className="w-5 h-5 text-slate-400" />
                <h3 className="font-black">成员 ({group.members.length})</h3>
              </div>
              <ul className="divide-y divide-slate-100">
                {group.members.map(m => (
                  <li key={m.userId} className="py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {m.role === 'leader' ? (
                        <Crown className="w-4 h-4 text-amber-500" />
                      ) : (
                        <Users className="w-4 h-4 text-slate-300" />
                      )}
                      <div>
                        <div className="text-sm font-bold">{m.username}{m.nickname ? ` · ${m.nickname}` : ''}</div>
                        <div className="text-xs text-slate-400">{m.role === 'leader' ? '组长 / 二级管理员' : '组员'}</div>
                      </div>
                    </div>
                    {isLeader && m.role !== 'leader' && (
                      <button
                        onClick={() => onKick(m.userId)}
                        className="px-3 py-1.5 text-xs font-bold text-red-600 hover:bg-red-50 rounded-lg flex items-center gap-1"
                      >
                        <UserMinus className="w-3.5 h-3.5" /> 踢出
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </main>
    </div>
  );
};

export default GroupDashboard;
