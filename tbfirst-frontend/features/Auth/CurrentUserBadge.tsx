import React, { useEffect, useState } from 'react';
import { ShieldCheck, User as UserIcon } from 'lucide-react';
import { authService, User } from './authService';

/**
 * 顶栏当前用户徽章。
 *
 * 显示 `<role-badge?> 用户名`，admin 用紫色 `Admin` 角标，普通用户仅显示用户名。
 *
 * 设计约束（errorConclude #39 Task 5）：
 * - 无副作用：不做任何网络请求；只读 sessionStorage 快照。
 * - 即使没有登录（getCurrentUser 返回 null）也返回一个"未登录"占位，避免 Workspace 布局塌陷。
 *
 * 注：存储已从 localStorage 迁到 sessionStorage（errorConclude #41），
 * 每个标签页各自持账号，跨标签同步已无意义；原先的 'storage' 监听（localStorage 才会 fire）
 * 此时成死代码，一并移除。若账号在本 tab 内更新（refresh / 登录成功后跳转），那条路径走
 * window.location 重载，自然会重新 mount 本组件读到最新快照。
 */
const CurrentUserBadge: React.FC<{ className?: string }> = ({ className = '' }) => {
  const [user, _setUser] = useState<User | null>(() => authService.getCurrentUser());

  // 保留一个空 effect 占位以便后续如需订阅其他事件（例如 BroadcastChannel）时扩展，
  // 当前 sessionStorage 场景下无需跨 tab 同步。
  useEffect(() => {
    return () => { /* noop */ };
  }, []);

  if (!user) {
    return (
      <span className={`inline-flex items-center gap-1 text-xs font-bold text-slate-400 ${className}`}>
        <UserIcon className="w-3.5 h-3.5" /> 未登录
      </span>
    );
  }

  const isAdmin = user.role === 'admin';
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-bold ${isAdmin ? 'text-purple-700' : 'text-slate-600'} ${className}`}
      title={[
        `用户：${user.username}`,
        user.roles ? `角色：${user.roles}` : null,
        user.groupName ? `组：${user.groupName} · ${user.groupRole === 'leader' ? '组长' : '组员'}` : '无共享组',
      ].filter(Boolean).join('\n')}
    >
      {isAdmin ? (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-purple-100 rounded-md text-[10px] font-black uppercase tracking-widest">
          <ShieldCheck className="w-3 h-3" /> Admin
        </span>
      ) : (
        <UserIcon className="w-3.5 h-3.5 text-slate-400" />
      )}
      <span>{user.username}</span>
    </span>
  );
};

export default CurrentUserBadge;
