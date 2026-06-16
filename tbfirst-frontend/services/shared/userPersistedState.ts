/**
 * userPersistedState.ts — V5.XII.4 账号配置跨会话持久化（localStorage by userId）
 *
 * 行为约定：
 *   - 命名空间 key：`tbfirst:user:<userId>:<key>`，每个账号独占一份 storage。
 *   - 用户未登录（userId == null）时 **不读不写** storage，hook 退化为纯内存 useState。
 *   - userId 变化（登录 / 登出 / 切换账号）时：
 *       · 新 userId 非空 → 从 storage 重新加载该账号下的 key
 *       · 新 userId 为空 → 重置为 initialValue
 *       · 切换过程中不会把上一账号的值写入新账号的 namespace
 *   - 写入用 requestAnimationFrame 节流，同一帧内的多次 setValue 只触发一次 localStorage.setItem。
 *   - JSON.parse / stringify 失败（quota / privacy 模式）静默退回 initialValue / 跳过写入。
 *   - 不依赖 React Context；可在任意组件独立调用，互相之间通过 localStorage 同步。
 *
 * authService.getCurrentUser() 优先取 userId 字段，回退到 id（兼容 v4 旧返回结构）。
 */
import { useState, useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { authService } from '../../features/Auth/authService';

const NAMESPACE = 'tbfirst:user';
const POLL_INTERVAL_MS = 500;

function readUserId(): string | null {
  const u = authService.getCurrentUser() as { userId?: number | string; id?: number | string } | null;
  if (!u) return null;
  const raw = u.userId ?? u.id;
  return raw != null ? String(raw) : null;
}

function storageKey(userId: string, key: string): string {
  return `${NAMESPACE}:${userId}:${key}`;
}

function readPersisted<T>(userId: string, key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(storageKey(userId, key));
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function useUserPersistedState<T>(
  key: string,
  initialValue: T,
): [T, Dispatch<SetStateAction<T>>] {
  // initialUserId 只读一次；后续切换由轮询 + storage 事件驱动
  const initialUserIdRef = useRef<string | null | undefined>(undefined);
  if (initialUserIdRef.current === undefined) {
    initialUserIdRef.current = readUserId();
  }
  const [userId, setUserId] = useState<string | null>(initialUserIdRef.current);
  const [value, setValue] = useState<T>(() => {
    const uid = initialUserIdRef.current;
    return uid ? readPersisted(uid, key, initialValue) : initialValue;
  });

  // initialValue 引用快照（不参与 deps，避免每次 render 都重置）
  const initialValueRef = useRef(initialValue);

  // 轮询 + storage 事件双通道跟踪 userId 变化（sessionStorage 不发 storage 事件）
  useEffect(() => {
    const tick = () => {
      const next = readUserId();
      setUserId(prev => (prev === next ? prev : next));
    };
    const intervalId = window.setInterval(tick, POLL_INTERVAL_MS);
    window.addEventListener('storage', tick);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('storage', tick);
    };
  }, []);

  // userId 切换 → 加载新 namespace 的值并标记"不要把这次 reload 当成 user 修改写回去"
  // pendingSwitchRef 用 2-step 计数：当前 render（value 还是 OLD）+ setValue 触发的下一 render
  const lastUserIdRef = useRef<string | null>(initialUserIdRef.current);
  const pendingSwitchRef = useRef(0);
  useEffect(() => {
    if (userId === lastUserIdRef.current) return;
    lastUserIdRef.current = userId;
    pendingSwitchRef.current = 2;
    if (userId) {
      setValue(readPersisted(userId, key, initialValueRef.current));
    } else {
      setValue(initialValueRef.current);
    }
  }, [userId, key]);

  // rAF 节流写入：同一帧内多次 setValue 只 flush 最后一次
  const rafIdRef = useRef<number | null>(null);
  const pendingValueRef = useRef<T>(value);
  const firstWriteEffectRef = useRef(true);
  useEffect(() => {
    // 首次 mount 时 value 已是从 storage 读到的值，跳过回写
    if (firstWriteEffectRef.current) {
      firstWriteEffectRef.current = false;
      return;
    }
    // userId 切换 2-step skip：跳过 OLD-value 的 render 与紧接的 reload-value re-render
    if (pendingSwitchRef.current > 0) {
      pendingSwitchRef.current -= 1;
      return;
    }
    if (!userId) return;
    pendingValueRef.current = value;
    if (rafIdRef.current != null) return;
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      try {
        localStorage.setItem(storageKey(userId, key), JSON.stringify(pendingValueRef.current));
      } catch {
        // quota / privacy 模式 → 静默忽略
      }
    });
  }, [value, userId, key]);

  // 卸载时取消挂起的 rAF
  useEffect(() => {
    return () => {
      if (rafIdRef.current != null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, []);

  return [value, setValue];
}
