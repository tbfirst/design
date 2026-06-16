import React, { useEffect, useState } from 'react';
import { adminService } from './adminService';
import { authService } from '../Auth/authService';
import { useNavigate } from 'react-router-dom';
import { Trash2, Plus, Key, ShieldAlert, LogOut, LayoutDashboard, Eye, EyeOff, Users as UsersIcon, ClipboardList, Image as ImageIcon, Folders, Check, X as XIcon, UserCheck, UserX } from 'lucide-react';
import GroupApplications from './GroupApplications';
import GroupCapacityApplications from './GroupCapacityApplications';
import BrandModelOverview from './BrandModelOverview';
import GroupList from './GroupList';
import CurrentUserBadge from '../Auth/CurrentUserBadge';

/**
 * 行内"个人库容量覆盖"编辑器。
 * currentCap=null 时占位显示"默认"+ 角色默认值提示；填数字后出现保存 / 取消按钮。
 */
const PersonalCapEditor: React.FC<{
  userId: number;
  currentCap: number | null | undefined;
  isAdmin: boolean;
  onSaved: (cap: number | null) => void;
}> = ({ userId, currentCap, isAdmin, onSaved }) => {
  const [draft, setDraft] = useState<string>(currentCap == null ? '' : String(currentCap));
  const [saving, setSaving] = useState(false);
  const dirty = draft !== (currentCap == null ? '' : String(currentCap));
  const defaultCap = isAdmin ? 50 : 5;

  const onSave = async () => {
    let cap: number | null;
    if (draft.trim() === '') {
      cap = null;
    } else {
      const n = Number(draft);
      if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
        alert('容量必须是正整数，留空表示清除覆盖');
        return;
      }
      cap = n;
    }
    try {
      setSaving(true);
      await adminService.updatePersonalCap(userId, cap);
      onSaved(cap);
    } catch (err: any) {
      alert(err?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-1">
      <input
        type="number"
        min={1}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={`默认 ${defaultCap}`}
        className="w-20 px-2 py-1 text-sm bg-slate-50 border border-slate-200 rounded focus:ring-2 focus:ring-indigo-500 outline-none"
      />
      {dirty && (
        <>
          <button onClick={onSave} disabled={saving} className="p-1 bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50" title="保存">
            <Check className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => setDraft(currentCap == null ? '' : String(currentCap))} className="p-1 bg-slate-200 text-slate-600 rounded hover:bg-slate-300" title="取消">
            <XIcon className="w-3.5 h-3.5" />
          </button>
        </>
      )}
    </div>
  );
};

/**
 * 前端管理员仪表盘组件：AdminDashboard
 * 其中的组件与前端管理员功能相关，交互时可发送请求
 */

const AdminDashboard: React.FC = () => {
  const [tab, setTab] = useState<'users' | 'groupApps' | 'groups' | 'capApps' | 'models'>('users');
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showResetModal, setShowResetModal] = useState<string | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState<string | null>(null);

  // 新增用户表单：补全字段到 username / password / nickname / email / role / personalModelCap
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showCreatePassword, setShowCreatePassword] = useState(false);
  const [newNickname, setNewNickname] = useState('');
  const [newEmail, setNewEmail] = useState('');
  /** 后端 User.roles 约定 "ADMIN" / "USER"，与 seed 数据保持一致 */
  const [newRole, setNewRole] = useState<'USER' | 'ADMIN'>('USER');
  const [newPersonalCap, setNewPersonalCap] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [showResetPassword, setShowResetPassword] = useState(false);

  const navigate = useNavigate();

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const data = await adminService.getUsers();
      setUsers(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    let capValue: number | null = null;
    if (newPersonalCap.trim() !== '') {
      const n = Number(newPersonalCap);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
        alert('个人模特库容量必须是正整数，留空表示按角色默认');
        return;
      }
      capValue = n;
    }
    try {
      await adminService.createUser({
        username: newUsername,
        password: newPassword,
        nickname: newNickname.trim() || undefined,
        email: newEmail.trim() || undefined,
        role: newRole,
        personalModelCap: capValue,
      });
      setShowCreateModal(false);
      setNewUsername('');
      setNewPassword('');
      setNewNickname('');
      setNewEmail('');
      setNewPersonalCap('');
      setNewRole('USER');
      fetchUsers();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleToggleStatus = async (id: string, currentStatus: string) => {
    const newStatus = currentStatus === 'active' ? 'disabled' : 'active';
    try {
      await adminService.toggleStatus(id, newStatus);
      fetchUsers();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleApproveRegistration = async (id: string, username: string) => {
    if (!confirm(`批准 ${username} 的注册申请？批准后用户即可登录。`)) return;
    try {
      await adminService.approveRegistration(id);
      fetchUsers();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleRejectRegistration = async (id: string, username: string) => {
    const note = prompt(`拒绝 ${username} 的注册？可填备注（仅日志）：`, '');
    if (note === null) return; // 用户取消
    try {
      await adminService.rejectRegistration(id, note.trim() || undefined);
      fetchUsers();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showResetModal) return;
    try {
      await adminService.resetPassword(showResetModal, resetPassword);
      setShowResetModal(null);
      setResetPassword('');
      alert('密码重置成功');
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleDeleteUser = async () => {
    if (!showDeleteModal) return;
    try {
      await adminService.deleteUser(showDeleteModal);
      // Immediate UI update
      setUsers(prev => prev.filter(u => u.id !== showDeleteModal));
      setShowDeleteModal(null);
    } catch (err: any) {
      alert(err.message);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-black tracking-tight text-slate-900">Admin Dashboard</h1>
            <span className="px-2 py-1 bg-indigo-100 text-indigo-700 text-[10px] font-bold rounded-md uppercase tracking-widest">上帝视角</span>
          </div>
          <div className="flex items-center gap-4">
            <CurrentUserBadge />
            <button onClick={() => navigate('/workspace')} className="text-sm font-bold text-slate-500 hover:text-indigo-600 transition-colors flex items-center gap-1">
              <LayoutDashboard className="w-4 h-4" />
              进入工作台
            </button>
            <button onClick={() => authService.logout()} className="text-sm font-bold text-slate-500 hover:text-red-600 transition-colors flex items-center gap-1">
              <LogOut className="w-4 h-4" />
              退出登录
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-12">
        {/* 顶部 Tab 切换 */}
        <div className="mb-8 flex items-center gap-2">
          <button
            onClick={() => setTab('users')}
            className={`px-4 py-2 text-xs font-black uppercase tracking-widest rounded-lg flex items-center gap-2 ${
              tab === 'users' ? 'bg-indigo-600 text-white shadow-md shadow-indigo-200' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <UsersIcon className="w-4 h-4" /> 员工账号
          </button>
          <button
            onClick={() => setTab('groupApps')}
            className={`px-4 py-2 text-xs font-black uppercase tracking-widest rounded-lg flex items-center gap-2 ${
              tab === 'groupApps' ? 'bg-indigo-600 text-white shadow-md shadow-indigo-200' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <ClipboardList className="w-4 h-4" /> 组申请
          </button>
          <button
            onClick={() => setTab('groups')}
            className={`px-4 py-2 text-xs font-black uppercase tracking-widest rounded-lg flex items-center gap-2 ${
              tab === 'groups' ? 'bg-indigo-600 text-white shadow-md shadow-indigo-200' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <Folders className="w-4 h-4" /> 组管理
          </button>
          <button
            onClick={() => setTab('capApps')}
            className={`px-4 py-2 text-xs font-black uppercase tracking-widest rounded-lg flex items-center gap-2 ${
              tab === 'capApps' ? 'bg-indigo-600 text-white shadow-md shadow-indigo-200' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <ClipboardList className="w-4 h-4" /> 扩容审批
          </button>
          <button
            onClick={() => setTab('models')}
            className={`px-4 py-2 text-xs font-black uppercase tracking-widest rounded-lg flex items-center gap-2 ${
              tab === 'models' ? 'bg-indigo-600 text-white shadow-md shadow-indigo-200' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <ImageIcon className="w-4 h-4" /> 模特总览
          </button>
        </div>

        {tab === 'groupApps' ? (
          <GroupApplications />
        ) : tab === 'groups' ? (
          <GroupList />
        ) : tab === 'capApps' ? (
          <GroupCapacityApplications />
        ) : tab === 'models' ? (
          <BrandModelOverview />
        ) : (
        <>
        <div className="flex justify-between items-center mb-8">
          <div>
            <h2 className="text-2xl font-black tracking-tight">员工账号管理</h2>
            <p className="text-sm text-slate-500 mt-1">管理团队成员、权限及查看使用情况</p>
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-6 py-3 bg-indigo-600 text-white rounded-xl font-bold text-sm hover:bg-indigo-700 shadow-lg shadow-indigo-200 transition-all active:scale-95 flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            新增员工账号
          </button>
        </div>

        {error && <div className="mb-6 p-4 bg-red-50 text-red-600 rounded-xl text-sm font-bold">{error}</div>}

        <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/50 border-b border-slate-100">
                  <th className="px-4 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap">账号</th>
                  <th className="px-4 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap">邮箱</th>
                  <th className="px-4 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap">角色</th>
                  <th className="px-4 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap">状态</th>
                  <th className="px-4 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap" title="null = 按角色默认 USER=5/ADMIN=50；填整数覆盖">个人库上限</th>
                  <th className="px-4 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap">所属组</th>
                  <th className="px-4 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap">累计生图</th>
                  <th className="px-4 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap">最后活跃</th>
                  <th className="px-4 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr><td colSpan={9} className="px-6 py-12 text-center text-slate-400">加载中...</td></tr>
                ) : users.length === 0 ? (
                  <tr><td colSpan={9} className="px-6 py-12 text-center text-slate-400">暂无数据</td></tr>
                ) : (
                  users.map(user => (
                    <tr key={user.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-4 py-4 font-medium text-slate-900 whitespace-nowrap">{user.username}</td>
                      <td className="px-4 py-4 text-xs text-slate-500 whitespace-nowrap max-w-[200px] overflow-hidden text-ellipsis">
                        {user.email ? <span title={user.email}>{user.email}</span> : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap">
                        <span className={`text-[10px] font-black px-2 py-1 rounded-md uppercase tracking-widest whitespace-nowrap ${user.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-600'}`}>
                          {user.role}
                        </span>
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap">
                        {(() => {
                          const s = user.status;
                          if (s === 'active') return <span className="text-[10px] font-black px-2.5 py-1 rounded-md uppercase tracking-widest whitespace-nowrap bg-emerald-100 text-emerald-700">启用中</span>;
                          if (s === 'pending') return <span className="text-[10px] font-black px-2.5 py-1 rounded-md uppercase tracking-widest whitespace-nowrap bg-amber-100 text-amber-700">待审核</span>;
                          return <span className="text-[10px] font-black px-2.5 py-1 rounded-md uppercase tracking-widest whitespace-nowrap bg-red-100 text-red-700">已停用</span>;
                        })()}
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap">
                        <PersonalCapEditor
                          userId={user.id}
                          currentCap={user.personalModelCap}
                          isAdmin={user.role === 'admin'}
                          onSaved={(cap) => setUsers(prev => prev.map(u => u.id === user.id ? { ...u, personalModelCap: cap } : u))}
                        />
                      </td>
                      <td className="px-4 py-4 text-xs text-slate-500 whitespace-nowrap">
                        {user.groupName ? (
                          <span className="whitespace-nowrap">
                            {user.groupName}
                            <span className="ml-1 text-slate-400">· {user.groupRole === 'leader' ? '组长' : '组员'}</span>
                          </span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-4 font-mono text-sm text-slate-600 whitespace-nowrap">{user.totalGenerations ?? 0}</td>
                      <td className="px-4 py-4 text-sm text-slate-500 whitespace-nowrap">{user.lastActiveAt ? new Date(user.lastActiveAt).toLocaleString() : '从未登录'}</td>
                      <td className="px-4 py-4 text-right whitespace-nowrap">
                       <div className="inline-flex items-center gap-1 whitespace-nowrap">
                        {user.status === 'pending' && (
                          <>
                            <button
                              onClick={() => handleApproveRegistration(user.id, user.username)}
                              className="p-2 text-emerald-500 hover:text-emerald-700 transition-colors"
                              title="批准注册"
                            >
                              <UserCheck className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleRejectRegistration(user.id, user.username)}
                              className="p-2 text-amber-500 hover:text-amber-700 transition-colors"
                              title="拒绝注册"
                            >
                              <UserX className="w-4 h-4" />
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => setShowResetModal(user.id)}
                          className="p-2 text-slate-400 hover:text-indigo-600 transition-colors"
                          title="重置密码"
                        >
                          <Key className="w-4 h-4" />
                        </button>
                        {user.username !== 'admin' && user.status !== 'pending' && (
                          <>
                            <button
                              onClick={() => handleToggleStatus(user.id, user.status)}
                              className={`p-2 transition-colors ${user.status === 'active' ? 'text-slate-400 hover:text-amber-600' : 'text-slate-400 hover:text-emerald-600'}`}
                              title={user.status === 'active' ? '停用账号' : '启用账号'}
                            >
                              <ShieldAlert className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => setShowDeleteModal(user.id)}
                              className="p-2 text-slate-400 hover:text-red-600 transition-colors"
                              title="永久删除"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </>
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
        </>
        )}
      </main>

      {/* Create User Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-8 border border-slate-100">
            <h3 className="text-xl font-black mb-6">新增员工账号</h3>
            <p className="text-xs text-slate-500 mb-4">
              管理员创建的账号<strong className="text-slate-700">直接生效（status=active）</strong>，不走注册审批流程。
            </p>
            <form onSubmit={handleCreateUser} className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">账号名称 *</label>
                <input type="text" value={newUsername} onChange={e => setNewUsername(e.target.value)} required minLength={3} maxLength={32} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none" />
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-bold text-slate-700">初始密码 *</label>
                  <button type="button" onClick={() => setShowCreatePassword(!showCreatePassword)} className="text-slate-400 hover:text-slate-600">
                    {showCreatePassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
                <input type={showCreatePassword ? "text" : "password"} value={newPassword} onChange={e => setNewPassword(e.target.value)} required minLength={6} maxLength={64} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">昵称</label>
                <input type="text" value={newNickname} onChange={e => setNewNickname(e.target.value)} maxLength={64} placeholder="可选" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">邮箱</label>
                <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} maxLength={64} placeholder="可选；用于按邮箱邀请入组" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">角色</label>
                <select value={newRole} onChange={e => setNewRole(e.target.value as 'USER' | 'ADMIN')} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none">
                  <option value="USER">普通员工（USER）</option>
                  <option value="ADMIN">一级管理员（ADMIN）</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2" title="null = 按角色默认 USER=5/ADMIN=50">个人模特库上限</label>
                <input type="number" min={1} value={newPersonalCap} onChange={e => setNewPersonalCap(e.target.value)} placeholder="留空 = 按角色默认" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none" />
              </div>
              <div className="flex gap-3 mt-8">
                <button type="button" onClick={() => setShowCreateModal(false)} className="flex-1 py-3 bg-slate-100 text-slate-700 rounded-xl font-bold hover:bg-slate-200 transition-colors">取消</button>
                <button type="submit" className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-colors">确认创建</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {showResetModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-8 border border-slate-100">
            <h3 className="text-xl font-black mb-6">重置密码</h3>
            <form onSubmit={handleResetPassword} className="space-y-5">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-bold text-slate-700">新密码</label>
                  <button type="button" onClick={() => setShowResetPassword(!showResetPassword)} className="text-slate-400 hover:text-slate-600">
                    {showResetPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
                <input type={showResetPassword ? "text" : "password"} value={resetPassword} onChange={e => setResetPassword(e.target.value)} required className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none" />
              </div>
              <div className="flex gap-3 mt-8">
                <button type="button" onClick={() => setShowResetModal(null)} className="flex-1 py-3 bg-slate-100 text-slate-700 rounded-xl font-bold hover:bg-slate-200 transition-colors">取消</button>
                <button type="submit" className="flex-1 py-3 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 transition-colors">确认重置</button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-8 border border-slate-100">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-6 mx-auto">
              <Trash2 className="w-8 h-8 text-red-600" />
            </div>
            <h3 className="text-xl font-black mb-2 text-center">确认永久删除？</h3>
            <p className="text-slate-500 text-center mb-8 text-sm leading-relaxed">
              此操作将永久移除该员工账号及其所有审计记录，确定删除吗？该操作不可撤销。
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowDeleteModal(null)}
                className="flex-1 py-3 bg-slate-100 text-slate-700 rounded-xl font-bold hover:bg-slate-200 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleDeleteUser}
                className="flex-1 py-3 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 transition-colors"
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminDashboard;
