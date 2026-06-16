/**
 * 登录 Auth 服务 — 对接 tbfirst-auth
 *
 * 兼容层：tbfirst-auth 的 /api/auth/me 返回 UserContext {userId, username, roles: ["ADMIN"]}，
 * 而原前端组件预期 User {id, role: 'admin'|'employee'}。
 * 在 toUser / getUserData 中做双向转换，避免改动业务组件。详见 errorConclude #14。
 *
 * 2026-04-21 起 permissions 细粒度字段下线：所有场景按 role 判权，ADMIN 全开，USER 默认具备
 * 基础业务权限；"管理模特库"等后台动作等价于"是 ADMIN"。前端 canManageModels 等派生字段一并移除。
 */
import { api } from '@/services/api';

export interface User {
  userId: number;
  username: string;
  roles: string;           // "USER" | "ADMIN"
  status: string;          // "active" | "disabled" | "pending"

  /** 所属共享组 ID；null = 无组 */
  groupId?: number | null;
  /** 组内角色：leader | member；无组为 null */
  groupRole?: 'leader' | 'member' | null;
  /** 组名（徽章展示） */
  groupName?: string | null;
  /** 个人模特库容量覆盖值；null = 按角色默认 USER=5/ADMIN=50 */
  personalModelCap?: number | null;
  /** 当前组的模特库容量覆盖值；null = 默认 30 */
  groupModelCap?: number | null;

  // 兼容旧前端派生字段
  id: string;
  role: 'admin' | 'employee';
}

interface TokenResponse {
  token?: string;
  expiresAt?: number;
  username: string;
  userId: number;
  roles: string;
  status: string;
  groupId?: number | null;
  groupRole?: 'leader' | 'member' | null;
  groupName?: string | null;
  personalModelCap?: number | null;
  groupModelCap?: number | null;
  /** 注册时勾选 applyGroup 的情况下，返回 pending 建组申请 id，此时不带 token */
  pendingApplicationId?: number | null;
  /** 普通注册（无 applyGroup）时返回的 pending 注册申请 id，此时同样不带 token，需等 admin 审批 */
  pendingRegistrationId?: number | null;
}

/** 注册请求体；applyGroup 为可选结构；email 自 2026-04 起必填（作为按邮箱邀请入组的查找键）。 */
export interface RegisterPayload {
  username: string;
  password: string;
  nickname?: string;
  email: string;
  applyGroup?: {
    name: string;
    description?: string;
  };
}

function toUser(t: TokenResponse): User {
  return {
    userId: t.userId,
    username: t.username,
    roles: t.roles || 'USER',
    status: t.status || 'active',
    groupId: t.groupId ?? null,
    groupRole: (t.groupRole as any) ?? null,
    groupName: t.groupName ?? null,
    personalModelCap: t.personalModelCap ?? null,
    groupModelCap: t.groupModelCap ?? null,
    // 兼容旧前端
    id: String(t.userId),
    role: (t.roles || '').includes('ADMIN') ? 'admin' : 'employee',
  };
}

const TOKEN_EXPIRES_KEY = 'tokenExpiresAt';

/**
 * 为什么用 sessionStorage 而非 localStorage：
 * 用户要求"关闭网页后下次重启项目重新跳到登录页"，而不是静默恢复上一次会话。
 * sessionStorage 的生命周期天然契合该语义 —— 标签页关闭即清空、浏览器重启也不残留。
 * 副作用：在同一浏览器里新开一个标签页会要求重新登录（sessionStorage 是按 tab 隔离的）。
 * 这是可接受的 trade-off（用户明确选择"关站重登"语义）。
 *
 * 迁移兼容：旧用户可能在 localStorage 里还残留有 token / user 条目，启动时一并清掉，避免
 * 仓库里新旧键混存让本地 dev 体验飘忽不定。
 */
function migrateLegacyLocalStorage() {
  try {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem(TOKEN_EXPIRES_KEY);
  } catch {
    // 老浏览器 / 隐私模式下 localStorage 可能不可用；静默忽略
  }
}
migrateLegacyLocalStorage();

function isTokenValid(): boolean {
  const token = sessionStorage.getItem('token');
  if (!token) return false;
  const raw = sessionStorage.getItem(TOKEN_EXPIRES_KEY);
  if (!raw) return false;
  const expiresAt = Number(raw);
  if (!Number.isFinite(expiresAt)) return false;
  return expiresAt - Date.now() > 5_000;
}

function clearSessionStorage() {
  sessionStorage.removeItem('token');
  sessionStorage.removeItem('user');
  sessionStorage.removeItem(TOKEN_EXPIRES_KEY);
}

function persistToken(data: TokenResponse): User {
  if (data.token) sessionStorage.setItem('token', data.token);
  if (data.expiresAt) sessionStorage.setItem(TOKEN_EXPIRES_KEY, String(data.expiresAt));
  const user = toUser(data);
  sessionStorage.setItem('user', JSON.stringify(user));
  return user;
}

export const authService = {
  async login(username: string, password: string): Promise<User> {
    const data = await api.post<TokenResponse>('/api/auth/login', { username, password });
    return persistToken(data);
  },

  /**
   * 用户注册。支持可选 applyGroup：
   *  - 未填 applyGroup → 后端即时签发 token，前端 persistToken 直接写入 localStorage，返回 User；
   *  - 填了 applyGroup → 后端不下发 token（等审批后再用用户名密码登录），
   *    前端 persistToken 不会写 token；返回 User 中 userId 有值但 token 缺失，
   *    调用方要用 pendingApplicationId 判断是否处于等待审批状态。
   */
  async register(payload: RegisterPayload): Promise<TokenResponse> {
    const data = await api.post<TokenResponse>('/api/auth/register', payload);
    if (data.token) {
      persistToken(data);
    }
    return data;
  },

  /**
   * 拿新 JWT（组成员关系变化后同步 groupId claim）。
   * 组加入 / 被踢 / 建组 / 解散组等动作完成后，前端应调用本方法。
   */
  async refresh(): Promise<User> {
    const data = await api.post<TokenResponse>('/api/auth/refresh', {});
    return persistToken(data);
  },

  /**
   * 登出。
   * @param opts.silent true = 只清本地 storage，不做任何跳转、不调后端（Login 页 mount 时调用，避免死循环）
   *
   * 非 silent 模式下先调一次后端 /api/auth/logout 清掉 Redis 中的会话 jti——
   * 这样即便用户的 token 被人复制走，远端仍能立即作废。失败不阻塞跳转（best-effort）。
   */
  async logout(opts: { silent?: boolean } = {}) {
    if (!opts.silent) {
      try {
        await api.post('/api/auth/logout', {});
      } catch {
        // 后端可能已不可达 / token 已失效，本地清场仍要继续。
      }
    }
    clearSessionStorage();
    if (!opts.silent) {
      window.location.replace('/login');
    }
  },

  isAuthenticated(): boolean {
    return isTokenValid();
  },

  getCurrentUser(): User | null {
    if (!isTokenValid()) {
      clearSessionStorage();
      return null;
    }
    const raw = sessionStorage.getItem('user');
    return raw ? JSON.parse(raw) : null;
  },

  async fetchWithAuth(url: string, options: RequestInit = {}) {
    const token = sessionStorage.getItem('token');
    if (!token) {
      this.logout();
      throw new Error('No token');
    }
    const headers = {
      ...options.headers,
      'Authorization': `Bearer ${token}`,
    };
    const response = await fetch(url, { ...options, headers });
    if (response.status === 401 || response.status === 403) {
      this.logout();
      throw new Error('Session expired');
    }
    return response;
  },

  async getUserData(_uid: string): Promise<User | null> {
    try {
      const ctx = await api.get<any>('/api/auth/me');
      const roles = Array.isArray(ctx.roles) ? ctx.roles.join(',') : (ctx.roles || '');
      const isAdmin = roles.includes('ADMIN');
      return {
        userId: ctx.userId,
        username: ctx.username,
        roles,
        status: 'active',
        groupId: ctx.groupId ?? null,
        groupRole: ctx.groupRole ?? null,
        groupName: null,
        id: String(ctx.userId),
        role: isAdmin ? 'admin' : 'employee',
      };
    } catch {
      return null;
    }
  },
};
