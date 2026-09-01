import { fetchEventSource } from '@microsoft/fetch-event-source';
import { api } from './api';

export interface DesignBrief {
  objective: string;
  deliverable: 'ecommerce_ad';
  product_images: string[];
  reference_images: string[];
  audience?: string | null;
  channel?: string | null;
  aspect_ratios: string[];
  creative_direction?: string | null;
  copywriting: Record<string, string>;
  hard_constraints: string[];
  acceptance_criteria: string[];
  unknown_fields: string[];
  status: 'draft' | 'ready' | 'approved';
  version: number;
}

export interface DesignProject {
  id: number;
  project_uuid: string;
  title: string;
  status: 'draft' | 'active' | 'waiting_approval' | 'completed' | 'failed';
  brief: DesignBrief;
  brief_version: number;
  selected_artifact_id?: number | null;
  update_time?: string | null;
}

export interface EvaluationReport {
  status: 'passed' | 'needs_review' | 'failed' | 'unknown';
  overall_score?: number | null;
  dimensions: Record<string, number | null>;
  hard_violations: string[];
  observations: string[];
  suggested_changes: string[];
}

export interface DesignArtifact {
  id: number;
  project_id: number;
  run_id?: number | null;
  parent_artifact_id?: number | null;
  role: 'source' | 'reference' | 'candidate' | 'revision' | 'final';
  revision: number;
  url?: string | null;
  width?: number | null;
  height?: number | null;
  status: 'creating' | 'ready' | 'failed' | 'selected' | 'final';
  evaluation?: EvaluationReport | null;
}

export interface DesignPlan {
  version: number;
  brief_version: number;
  candidate_count: number;
  max_generation_calls: number;
  estimated_cost_level: 'low' | 'medium' | 'high';
  steps: Array<{ id: string; title: string; kind: string; tool_name?: string | null; status: string }>;
}

export interface PlanApproval {
  action_uuid: string;
  payload_hash: string;
  risk_level: string;
  status: string;
  expires_at?: string | null;
  tool_name?: string | null;
}

export interface PlanResponse {
  run: { id: number; status: string; plan: DesignPlan };
  approval: PlanApproval;
}

export interface DesignRunEvent {
  type: string;
  request_id?: string;
  project_uuid?: string;
  run_id?: number;
  sequence?: number;
  tool?: string;
  summary?: string;
  artifact?: DesignArtifact;
  artifact_id?: number;
  evaluation?: EvaluationReport;
  artifact_ids?: number[];
  error?: string;
}

const base = '/api/image/agent/design';

export const designAgentService = {
  createProject: (title = '未命名设计') =>
    api.post<DesignProject>(`${base}/projects`, { title, brief: {} }),

  listProjects: async () => {
    const data = await api.get<{ projects: DesignProject[] }>(`${base}/projects`);
    return data.projects;
  },

  getProject: (uuid: string) =>
    api.get<{ project: DesignProject; artifacts: DesignArtifact[]; pending?: PlanResponse | null }>(`${base}/projects/${uuid}`),

  updateBrief: (uuid: string, brief: Partial<DesignBrief> & { expected_version: number }) =>
    api.patch<DesignProject>(`${base}/projects/${uuid}/brief`, brief),

  createPlan: (
    uuid: string,
    request: { request_id: string; candidate_count: number; revision_of_artifact_id?: number; revision_instruction?: string },
  ) => api.post<PlanResponse>(`${base}/projects/${uuid}/plans`, request),

  approve: (uuid: string, approval: PlanApproval) =>
    api.post(`${base}/projects/${uuid}/actions/${approval.action_uuid}/approve`, {
      payload_hash: approval.payload_hash,
    }),

  reject: (uuid: string, approval: PlanApproval) =>
    api.post(`${base}/projects/${uuid}/actions/${approval.action_uuid}/reject`, {
      payload_hash: approval.payload_hash,
    }),

  registerAsset: (uuid: string, url: string, role: 'source' | 'reference') =>
    api.post<DesignArtifact>(`${base}/projects/${uuid}/assets`, { url, role }),

  selectArtifact: (uuid: string, artifactId: number) =>
    api.post<DesignArtifact>(`${base}/projects/${uuid}/artifacts/${artifactId}/select`),

  finalize: (uuid: string) =>
    api.post<DesignArtifact>(`${base}/projects/${uuid}/finalize`),

  execute: async (
    uuid: string,
    runId: number,
    onEvent: (event: DesignRunEvent) => void,
    signal?: AbortSignal,
  ) => {
    const token = sessionStorage.getItem('token') || '';
    await fetchEventSource(`${base}/projects/${uuid}/runs/${runId}/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token ? `Bearer ${token}` : '',
      },
      body: '{}',
      signal,
      onmessage(message) {
        if (!message.data || message.data === '[DONE]') return;
        const event = JSON.parse(message.data) as DesignRunEvent;
        onEvent(event);
      },
      onerror(error) {
        throw error;
      },
    });
  },
};
