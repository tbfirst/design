/**
 * 资源共享组服务 — 对接 tbfirst-auth /api/auth/groups/* 与 /api/auth/admin/group-applications/*
 *
 * 使用场景：
 *  - GroupDashboard 页（二级管理员 + 组员）调 my / invite / kick / leave / dissolve / respondInvite
 *  - AdminDashboard 的"组申请"Tab（一级管理员）调 listApplications / approve / reject
 */
import { api } from '@/services/api';

export interface GroupMember {
  userId: number;
  username: string;
  nickname: string;
  role: 'leader' | 'member';
  joinTime: string;
}

export interface GroupInvitation {
  id: number;
  groupId: number;
  groupName: string;
  inviterId: number;
  inviterUsername: string;
  inviteeId: number;
  inviteeUsername: string;
  status: 'pending' | 'accepted' | 'rejected' | 'canceled';
  createTime: string;
  respondTime?: string;
}

export interface MyGroup {
  groupId: number;
  name: string;
  description: string;
  status: 'active' | 'archived';
  memberCount: number;
  leaderId: number;
  myRole: 'leader' | 'member';
  members: GroupMember[];
  pendingInvitations: GroupInvitation[];
}

export interface GroupApplication {
  id: number;
  applicantId: number;
  applicantUsername: string;
  applicantNickname: string;
  proposedName: string;
  proposedDescription: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewerId?: number;
  reviewNote?: string;
  reviewTime?: string;
  approvedGroupId?: number;
  createTime: string;
}

/**
 * 组模特库扩容申请（T6）：组长提交 → 一级管理员审批。
 * 批准后 share_group.model_cap 一次性覆盖为 requestedCap，组员 /auth/refresh 后生效。
 */
export interface CapacityApplication {
  id: number;
  groupId: number;
  groupName: string;
  applicantId: number;
  applicantUsername: string;
  /** 提交时 model_cap 的快照；null = 当时走默认 30 */
  currentCap: number | null;
  /** 申请扩容到的目标容量（正整数） */
  requestedCap: number;
  reason: string;
  /** TODO 费用；当前允许空 */
  feeAmount: number | null;
  status: 'pending' | 'approved' | 'rejected';
  reviewerId?: number;
  reviewNote?: string;
  reviewTime?: string;
  createTime: string;
}

export const groupService = {
  // --- 组员 & 组长视角 ---

  /** 我的组详情；未加入任何组返回 null */
  async getMyGroup(): Promise<MyGroup | null> {
    return api.get<MyGroup | null>('/api/auth/groups/my');
  },

  /** 我的待响应邀请；无则 null */
  async getMyPendingInvitation(): Promise<GroupInvitation | null> {
    return api.get<GroupInvitation | null>('/api/auth/groups/invitations/mine');
  },

  /** 主动提交成立组申请（登录后也可用，不限于注册页） */
  async apply(name: string, description?: string): Promise<number> {
    return api.post<number>('/api/auth/groups/apply', { name, description });
  },

  /**
   * 组长邀请新成员。
   * 2026-04 起主路径是邮箱：{ inviteeEmail }；inviteeUsername / inviteeId 仅脚本 / admin 兼容用。
   * 后端按 inviteeEmail → inviteeId → inviteeUsername 的顺序解析。
   */
  async invite(groupId: number, payload: { inviteeEmail?: string; inviteeUsername?: string; inviteeId?: number }): Promise<number> {
    return api.post<number>(`/api/auth/groups/${groupId}/invite`, payload);
  },

  /** 响应邀请 */
  async respondInvitation(invitationId: number, accept: boolean): Promise<void> {
    await api.post<void>(`/api/auth/groups/invitations/${invitationId}/respond`, { accept });
  },

  /** 组长踢人 */
  async kick(groupId: number, userId: number): Promise<void> {
    await api.delete(`/api/auth/groups/${groupId}/members/${userId}`);
  },

  /** 组员退组 */
  async leave(): Promise<void> {
    await api.post<void>('/api/auth/groups/leave', {});
  },

  /** 组长解散组 */
  async dissolve(groupId: number): Promise<void> {
    await api.post<void>(`/api/auth/groups/${groupId}/dissolve`, {});
  },

  // --- 一级管理员视角 ---

  /** 列出组申请；默认 pending */
  async listApplications(status: 'pending' | 'approved' | 'rejected' = 'pending'): Promise<GroupApplication[]> {
    return api.get<GroupApplication[]>(`/api/auth/admin/group-applications?status=${status}`);
  },

  /** 批准申请；finalName 可选（改名） */
  async approveApplication(id: number, finalName?: string): Promise<number> {
    return api.post<number>(`/api/auth/admin/group-applications/${id}/approve`, finalName ? { finalName } : {});
  },

  /** 拒绝申请；可带 reviewNote */
  async rejectApplication(id: number, reviewNote?: string): Promise<void> {
    await api.post<void>(`/api/auth/admin/group-applications/${id}/reject`, reviewNote ? { reviewNote } : {});
  },

  // --- T6：组扩容申请 ---

  /** 组长提交扩容申请（后端自动定位申请人当前所属组）。 */
  async submitCapacityApplication(payload: {
    requestedCap: number;
    reason: string;
    feeAmount?: number | null;
  }): Promise<number> {
    return api.post<number>('/api/auth/groups/capacity-applications', payload);
  },

  /** 我的组历史扩容申请（pending + 已审批）。 */
  async myCapacityApplications(): Promise<CapacityApplication[]> {
    return api.get<CapacityApplication[]>('/api/auth/groups/capacity-applications/mine');
  },

  /** 一级管理员：按 status 列出扩容申请（默认 pending）。 */
  async listCapacityApplications(
    status: 'pending' | 'approved' | 'rejected' = 'pending',
  ): Promise<CapacityApplication[]> {
    return api.get<CapacityApplication[]>(`/api/auth/admin/group-capacity-applications?status=${status}`);
  },

  /** 一级管理员：批准扩容。 */
  async approveCapacityApplication(id: number, reviewNote?: string): Promise<void> {
    await api.post<void>(`/api/auth/admin/group-capacity-applications/${id}/approve`, reviewNote ? { reviewNote } : {});
  },

  /** 一级管理员：拒绝扩容。 */
  async rejectCapacityApplication(id: number, reviewNote?: string): Promise<void> {
    await api.post<void>(`/api/auth/admin/group-capacity-applications/${id}/reject`, reviewNote ? { reviewNote } : {});
  },
};
