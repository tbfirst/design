/**
 * ConnectionManager.tsx — 网络连接状态监控组件
 *
 * 职责：
 *   1. 监听浏览器 online/offline 事件，实时感知用户网络变化
 *   2. 每 30 秒向后端发送心跳（/api/heartbeat），探测服务端可达性
 *   3. 心跳同时通过 fetchWithAuth 验证 JWT Token 有效性
 *   4. 连接异常时在页面右下角渲染悬浮提示条，支持手动重试
 *   5. 连接恢复后自动回调 onReconnect，通知父组件刷新数据
 *
 * 设计要点：
 *   - 心跳请求设置 5 秒超时（AbortController），避免长时间挂起
 *   - 401/403 错误由 authService 内部处理（自动登出），此处不重复拦截
 *   - 仅在 "断网" 或 "服务端不可达" 时展示 UI，正常状态返回 null
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Wifi, WifiOff, RefreshCw, AlertCircle } from 'lucide-react';

import { authService } from '../features/Auth/authService';

/** 组件 Props */
interface ConnectionManagerProps {
  /** 连接恢复后的回调，父组件可在此触发数据重新拉取 */
  onReconnect?: () => void;
}

export const ConnectionManager: React.FC<ConnectionManagerProps> = ({ onReconnect }) => {
  /** 浏览器网络在线状态 */
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  /** 后端服务端心跳是否正常 */
  const [isServerAlive, setIsServerAlive] = useState(true);
  /** 手动重试按钮的 loading 状态 */
  const [isRetrying, setIsRetrying] = useState(false);
  /** 上一次成功心跳的时间戳（ms），可用于判断断联时长 */
  const [lastHeartbeat, setLastHeartbeat] = useState<number>(Date.now());

  /**
   * 心跳探测函数
   * - 发送 GET /api/heartbeat，附带 JWT Token
   * - 5 秒内未响应则通过 AbortController 中止请求
   * - 成功时更新时间戳；若从 "断开" 恢复则触发 onReconnect
   * - 401/403 交由 authService 处理登出，此处静默忽略
   */
  const checkHeartbeat = useCallback(async () => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      // 使用 fetchWithAuth 同时验证 Token 有效性
      // tbfirst 无专用 heartbeat，改用 /api/auth/me（轻量、无副作用、Gateway 已路由）
      const response = await authService.fetchWithAuth('/api/auth/me', {
        signal: controller.signal,
        cache: 'no-store'
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        // 从断开状态恢复 → 通知父组件
        if (!isServerAlive) {
          console.log('[Connection] Server connection restored');
          onReconnect?.();
        }
        setIsServerAlive(true);
        setLastHeartbeat(Date.now());
      } else {
        setIsServerAlive(false);
      }
    } catch (error: any) {
      // 401/403 由 authService.fetchWithAuth 内部处理登出
      // 此处只关心 "网络不通" 的场景
      if (error.message === 'Session expired or unauthorized' || error.message === 'No token found') {
        return;
      }
      console.warn('[Connection] Heartbeat failed:', error);
      setIsServerAlive(false);
    }
  }, [isServerAlive, onReconnect]);

  /**
   * 副作用：注册浏览器 online/offline 监听 + 定时心跳
   * - 组件挂载时立即发一次心跳
   * - 此后每 30 秒轮询，保持 Sandbox 沙箱环境不超时
   * - 组件卸载时清除监听与定时器，防止内存泄漏
   */
  useEffect(() => {
    const handleOnline = () => {
      console.log('[Connection] Browser online');
      setIsOnline(true);
      checkHeartbeat();
    };
    const handleOffline = () => {
      console.warn('[Connection] Browser offline');
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // 组件挂载后立即检测一次
    checkHeartbeat();

    // 每 30 秒发送一次心跳，维持后端沙箱活跃
    const interval = setInterval(checkHeartbeat, 30000);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(interval);
    };
  }, [checkHeartbeat]);

  /** 用户点击"重试"按钮时触发手动心跳检测 */
  const handleManualRetry = async () => {
    setIsRetrying(true);
    await checkHeartbeat();
    setTimeout(() => setIsRetrying(false), 1000);
  };

  // 正常连接状态下不渲染任何 UI，仅在异常时展示悬浮提示条
  if (isOnline && isServerAlive) return null;

  return (
    <div className="fixed top-6 right-6 z-[100] animate-in slide-in-from-bottom-4 duration-300">
      <div className={`flex items-center gap-4 px-5 py-3 rounded-2xl shadow-2xl border backdrop-blur-md transition-all ${
        !isOnline || !isServerAlive ? 'bg-red-50 border-red-100 text-red-900' : 'bg-white border-slate-100 text-slate-900'
      }`}>
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
          !isOnline || !isServerAlive ? 'bg-red-100 text-red-600' : 'bg-slate-100 text-slate-600'
        }`}>
          {!isOnline ? <WifiOff className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
        </div>

        <div className="flex flex-col">
          <span className="text-sm font-black">
            {!isOnline ? '网络连接已断开' : '服务器连接异常'}
          </span>
          <span className="text-[10px] font-bold text-red-500/80 uppercase tracking-widest">
            正在尝试自动重连...
          </span>
        </div>

        <button
          onClick={handleManualRetry}
          disabled={isRetrying}
          className={`p-2 rounded-lg transition-all ${
            isRetrying ? 'animate-spin opacity-50' : 'hover:bg-red-100 active:scale-90'
          }`}
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
