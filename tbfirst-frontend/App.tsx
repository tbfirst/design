import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import Workspace from './Workspace';
import Login from './features/Auth/Login';
import Register from './features/Auth/Register';
import AdminDashboard from './features/Admin/AdminDashboard';
import GroupDashboard from './features/GroupAdmin/GroupDashboard';
import AgentPage from './pages/AgentPage';
import ProfileMemoryPage from './pages/ProfileMemoryPage';
import AppHeader from './components/AppHeader';
import EmbossRevealCanvas from './components/EmbossRevealCanvas';
import { authService } from './features/Auth/authService';

const WithHeader = () => (
  <>
    <AppHeader />
    <Outlet />
  </>
);

const StoryboardWizard = React.lazy(() => import('./features/Storyboard'));
// 沉浸式 3D 首页（相机 → 卢浮宫式画廊）；内部按设备能力决定渲染 3D 或无障碍回退页
const GalleryHome = React.lazy(() => import('./features/GalleryHome'));

// 受保护的路由组件，根据用户登录状态和权限进行访问控制
const ProtectedRoute = ({ children, requireAdmin = false }: { children: React.ReactNode, requireAdmin?: boolean }) => {
  const user = authService.getCurrentUser();
  const isAllowed = !!user && (!requireAdmin || user.role === 'admin');

  if (!isAllowed) return <Navigate to="/login" replace />;

  return <>{children}</>;
};

function App() {
  return (
    <BrowserRouter>
      <EmbossRevealCanvas style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', zIndex: -1 }} />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route
          path="/group"
          element={
            <ProtectedRoute>
              <GroupDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/workspace"
          element={
            <ProtectedRoute>
              <Workspace />
            </ProtectedRoute>
          }
        />
        <Route
          path="/home"
          element={
            <ProtectedRoute>
              <React.Suspense fallback={<div style={{ position: 'fixed', inset: 0, background: '#0c0a07' }} />}>
                <GalleryHome />
              </React.Suspense>
            </ProtectedRoute>
          }
        />
        <Route element={<WithHeader />}>
          <Route
            path="/agent"
            element={
              <ProtectedRoute>
                <AgentPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/profile/memory"
            element={
              <ProtectedRoute>
                <ProfileMemoryPage />
              </ProtectedRoute>
            }
          />
        </Route>
        <Route
          path="/admin"
          element={
            <ProtectedRoute requireAdmin>
              <AdminDashboard />
            </ProtectedRoute>
          }
        />
        {/* 主分镜流程：新四阶段向导现位于 /cinestitch（旧单页 CinestitchPage 已下线） */}
        <Route
          path="/cinestitch"
          element={
            <ProtectedRoute>
              <React.Suspense fallback={<div style={{ padding: 24, color: '#9ca3af' }}>加载中...</div>}>
                <StoryboardWizard />
              </React.Suspense>
            </ProtectedRoute>
          }
        />
        {/* 旧路径兼容：/storyboard → /cinestitch */}
        <Route path="/storyboard" element={<Navigate to="/cinestitch" replace />} />
        <Route path="/" element={<Navigate to="/home" replace />} />
        <Route path="*" element={<Navigate to="/home" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
