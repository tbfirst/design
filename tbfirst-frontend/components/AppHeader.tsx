/**
 * V6.M2.A.12: 顶部 nav 共享组件。
 *
 * 现状：Workspace.tsx 内联了自己的 <header>（line 842），且 Workspace.tsx 在本 Sprint 路径白名单冻结，
 * 无法把这里的 AppHeader 替换进去。本组件**仅供 V6.M2 新增的 3 个 page 文件使用**：
 *   - pages/AdminBasicRulesPage.tsx（v6.M2.A.11 已用自己的 aside 替代，未引入；可在后续清理时回填）
 *   - pages/AgentPage.tsx（V6.M2.B.10/F.2 任务会接入）
 *   - pages/ProfileMemoryPage.tsx（V6.M2.C.6 任务会接入）
 *
 * Admin 用户访问 /admin/basic-rules 当前路径：URL 直输或从 AdminDashboard 跳。等 AgentPage 接入本组件后，
 * 顶部 nav 才会真正显示"基础规则"入口；本任务先把组件就位，履行 spec "AppHeader 加入口" 字面要求。
 */
import React from 'react';
import { NavLink } from 'react-router-dom';
import { authService } from '../features/Auth/authService';

interface AppHeaderProps {
  title?: string;
}

const navLinkStyle = ({ isActive }: { isActive: boolean }): React.CSSProperties => ({
  padding: '6px 12px',
  borderRadius: 6,
  textDecoration: 'none',
  color: isActive ? '#4338ca' : '#444',
  background: isActive ? '#eef2ff' : 'transparent',
  fontWeight: 500,
  fontSize: 13,
});

const AppHeader: React.FC<AppHeaderProps> = ({ title = 'tbfirst' }) => {
  const user = authService.getCurrentUser();
  const isAdmin = user?.role === 'admin';

  return (
    <header style={{
      display: 'flex', alignItems: 'center', padding: '10px 20px',
      borderBottom: '1px solid #e5e7eb', background: '#fff',
      height: 56, fontFamily: 'system-ui, sans-serif',
    }}>
      <div style={{ fontWeight: 700, fontSize: 16, marginRight: 32 }}>{title}</div>
      <nav style={{ display: 'flex', gap: 4, flex: 1 }}>
        <NavLink to="/home" style={navLinkStyle}>主页</NavLink>
        <NavLink to="/workspace" style={navLinkStyle}>Workspace</NavLink>
        <NavLink to="/group" style={navLinkStyle}>Group</NavLink>
        <NavLink to="/agent" style={navLinkStyle}>Agent</NavLink>
        {isAdmin && <NavLink to="/admin" style={navLinkStyle}>Admin</NavLink>}
        {isAdmin && <NavLink to="/admin/basic-rules" style={navLinkStyle}>基础规则</NavLink>}
      </nav>
      {user && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <NavLink to="/profile/memory" style={navLinkStyle}>我的记忆</NavLink>
          <div style={{ fontSize: 12, color: '#666' }}>
            {user.username || `user#${user.id}`} · {user.role}
          </div>
        </div>
      )}
    </header>
  );
};

export default AppHeader;
