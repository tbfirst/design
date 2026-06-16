/**
 * V6.M2.C.5: L4 用户偏好 + L3/L5 个人记忆 API client。
 *
 * 后端契约（C.4）：
 *   GET    /api/agent/profile/memory                              → ProfileMemoryResponse
 *   PUT    /api/agent/profile/memory/preference/{id}              → Preference
 *   DELETE /api/agent/profile/memory/preference/{id}              → 204 NoContent
 *
 * recall / procedural 字段在本 Sprint 是空数组（D.9 / E.x 填充）；前端类型保留以便后续扩展。
 */
import { api } from './api';

export type PreferenceKey =
  | 'color_preference'
  | 'audience'
  | 'tone'
  | 'avoid'
  | 'aspect_ratio'
  | 'style';

export interface Preference {
  id: number;
  user_id: number;
  key: PreferenceKey | string;
  value: string;
  confidence: number | null;
  source_session_id: number | null;
  evidence: Array<{ snippet?: string; session_id?: number } | unknown> | null;
  user_locked: boolean;
  last_injected_at: string | null;
  create_time: string;
  update_time: string;
}

export interface RecallItem {
  // D.9 填充：{id, summary, quality_score, recall_count, ...}
  [k: string]: unknown;
}

export interface ProceduralItem {
  // E.x 填充：{id, name, phase_chain, quality_score, ...}
  [k: string]: unknown;
}

export interface ProfileMemoryResponse {
  preferences: Preference[];
  recall: RecallItem[];
  procedural: ProceduralItem[];
}

export interface UpdatePreferencePayload {
  value?: string;
  user_locked?: boolean;
}

const BASE = '/api/image/agent/profile/memory';

export async function listMemory(): Promise<ProfileMemoryResponse> {
  return api.get<ProfileMemoryResponse>(BASE);
}

export async function updatePreference(
  id: number,
  payload: UpdatePreferencePayload,
): Promise<Preference> {
  return api.put<Preference>(`${BASE}/preference/${id}`, payload);
}

export async function deletePreference(id: number): Promise<void> {
  await api.delete<void>(`${BASE}/preference/${id}`);
}
