/**
 * Admin 管理服务 — 对接 tbfirst-auth /api/auth/admin
 */
import { api } from '@/services/api';

export interface AdminUser {
  id: number;
  username: string;
  nickname: string;
  email?: string | null;
  roles: string;
  status: string;
  lastActiveAt: string;
  createTime: string;
  // 后端实时聚合：auth 通过 Feign 调 image 的 /api/image/internal/generation-count 获得
  totalGenerations: number;
  /** 组信息（V5 起） */
  groupId?: number | null;
  groupRole?: 'leader' | 'member' | null;
  groupName?: string | null;
  /** 个人模特库容量覆盖值；null = 按角色默认 */
  personalModelCap?: number | null;

  // 兼容旧前端的派生字段
  role?: 'admin' | 'employee';
}

/** 一级管理员浏览的组列表条目。 */
export interface AdminGroupBrief {
  groupId: number;
  name: string;
  description: string;
  status: 'active' | 'archived';
  memberCount: number;
  leaderId: number;
  leaderUsername?: string;
  /** 组模特库容量覆盖值；null = 默认 30 */
  modelCap?: number | null;
  createTime: string;
}

/** 一级管理员模特总览条目。 */
export interface AdminBrandModel {
  id: number;
  name: string;
  url: string;
  mimeType: string;
  fileSize: number;
  userId: number;
  /** null = 个人库；非 null = 组库 */
  groupId: number | null;
  createTime: string;
}

function enrich(u: AdminUser): AdminUser {
  return {
    ...u,
    role: (u.roles || '').includes('ADMIN') ? 'admin' : 'employee',
    totalGenerations: u.totalGenerations ?? 0,
  };
}

export interface CreateUserPayload {
  username: string;
  password: string;
  nickname?: string;
  email?: string;
  role?: string;
  /** 可选：直接指定个人模特库容量覆盖值；null/undefined = 角色默认 */
  personalModelCap?: number | null;
}

export const adminService = {
  async getUsers(): Promise<AdminUser[]> {
    const list = await api.get<AdminUser[]>('/api/auth/admin/users');
    return list.map(enrich);
  },

  async createUser(data: CreateUserPayload) {
    return api.post<AdminUser>('/api/auth/admin/users', data);
  },

  async toggleStatus(id: number | string, status: 'active' | 'disabled') {
    return api.put(`/api/auth/admin/users/${id}/status`, { status });
  },

  /** 列出所有 status='pending' 的待审核注册用户。 */
  async listPendingRegistrations(): Promise<AdminUser[]> {
    const list = await api.get<AdminUser[]>('/api/auth/admin/users/pending');
    return list.map(enrich);
  },

  /** 一级管理员批准注册（status: pending → active）。 */
  async approveRegistration(id: number | string) {
    return api.post(`/api/auth/admin/users/${id}/approve-registration`, {});
  },

  /** 一级管理员拒绝注册（status: pending → disabled），可选 note 仅落日志。 */
  async rejectRegistration(id: number | string, note?: string) {
    return api.post(`/api/auth/admin/users/${id}/reject-registration`, { note });
  },

  async resetPassword(id: number | string, password: string) {
    return api.put(`/api/auth/admin/users/${id}/password`, { password });
  },

  async deleteUser(id: number | string) {
    return api.delete(`/api/auth/admin/users/${id}`);
  },

  // ============================================================
  // V5: 容量设置 + 组管理 + 模特总览
  // ============================================================

  /** 设置某用户的个人模特库容量（null = 清除覆盖，回落到角色默认） */
  async updatePersonalCap(id: number | string, cap: number | null) {
    return api.put(`/api/auth/admin/users/${id}/personal-cap`, { cap });
  },

  /** 设置某组的模特库容量（null = 清除覆盖，回落到默认 30） */
  async updateGroupCap(groupId: number | string, cap: number | null) {
    return api.put(`/api/auth/admin/groups/${groupId}/model-cap`, { cap });
  },

  /** 一级管理员浏览所有组 */
  async listAllGroups(): Promise<AdminGroupBrief[]> {
    return api.get<AdminGroupBrief[]>('/api/auth/admin/groups');
  },

  /** admin 直接建组（admin 成为组长，跳过申请审批） */
  async adminCreateGroup(name: string, description?: string): Promise<number> {
    return api.post<number>('/api/auth/admin/groups', { name, description });
  },

  /** admin 模特总览：scope = all | personal | group；userId/groupId 可选过滤 */
  async listAllBrandModels(
    scope: 'all' | 'personal' | 'group' = 'all',
    userId?: number | null,
    groupId?: number | null,
  ): Promise<AdminBrandModel[]> {
    const params = new URLSearchParams({ scope });
    if (userId != null) params.set('userId', String(userId));
    if (groupId != null) params.set('groupId', String(groupId));
    return api.get<AdminBrandModel[]>(`/api/image/models/admin/all?${params.toString()}`);
  },

  /** admin 删除任意模特（走普通 delete 端点，Service 层对 ADMIN 全局放行） */
  async deleteBrandModel(id: number | string) {
    return api.delete(`/api/image/models/${id}`);
  },
};
