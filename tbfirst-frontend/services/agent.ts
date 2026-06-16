/**
 * V6.M2.B.9: Agent API client。基于 @microsoft/fetch-event-source 支持 POST + SSE。
 *
 * 注：token 键名沿用本项目既有 sessionStorage `token`（见 api.ts:28），spec 里写的
 * `tbfirst_token` 与本项目不一致；统一使用 `token` 避免 SSE 请求漏带 Authorization。
 */
import { fetchEventSource } from '@microsoft/fetch-event-source';
import { api } from './api';

export interface AgentSession {
  session_uuid: string;
}

export interface ToolBlock {
  tool: string;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  status: 'running' | 'done';
}

export interface ChatStreamHandlers {
  onChunk: (text: string) => void;
  onMeta?: (event: string) => void;
  onToolStart?: (tool: string, input: Record<string, unknown>) => void;
  onToolEnd?: (tool: string, output: Record<string, unknown>) => void;
  onDone?: () => void;
  onError?: (err: Error) => void;
}

export interface ChatStreamPayload {
  session_uuid: string;
  message: string;
  brand_id?: number;
  group_id?: number;
  phase?: string;
}

export interface SessionMeta {
  session_uuid: string;
  title: string | null;
  scope: string | null;
  started_at: string | null;
  last_active_at: string | null;
}

export interface SessionMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export async function createSession(scope?: string): Promise<AgentSession> {
  return api.post<AgentSession>('/api/image/agent/sessions', { scope });
}

export async function listSessions(limit = 20, offset = 0): Promise<SessionMeta[]> {
  const r = await api.get<{ sessions: SessionMeta[] }>(
    `/api/image/agent/sessions?limit=${limit}&offset=${offset}`,
  );
  return r.sessions;
}

export async function getMessages(sessionUuid: string): Promise<SessionMessage[]> {
  const r = await api.get<{ messages: SessionMessage[] }>(
    `/api/image/agent/sessions/${encodeURIComponent(sessionUuid)}/messages`,
  );
  return r.messages;
}

export async function deleteSession(sessionUuid: string): Promise<void> {
  await api.delete<void>(`/api/image/agent/sessions/${encodeURIComponent(sessionUuid)}`);
}

export interface ToolMeta {
  name: string;
  label: string;
  description: string;
  status: 'stub' | 'ready';
  icon_hint: string;
}

export async function listTools(): Promise<ToolMeta[]> {
  const r = await api.get<{ tools: ToolMeta[] }>('/api/image/agent/tools');
  return r.tools;
}

export async function chatStream(
  payload: ChatStreamPayload,
  handlers: ChatStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const token = sessionStorage.getItem('token') || '';
  await fetchEventSource('/api/image/agent/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token ? `Bearer ${token}` : '',
    },
    body: JSON.stringify(payload),
    signal,
    onmessage(ev) {
      if (!ev.data || ev.data === '[DONE]') {
        handlers.onDone?.();
        return;
      }
      try {
        const parsed = JSON.parse(ev.data);
        if (parsed.type === 'chunk') handlers.onChunk(parsed.content);
        else if (parsed.type === 'meta') handlers.onMeta?.(parsed.event);
        else if (parsed.type === 'tool_start') handlers.onToolStart?.(parsed.tool, parsed.input ?? {});
        else if (parsed.type === 'tool_end') handlers.onToolEnd?.(parsed.tool, parsed.output ?? {});
        else if (parsed.type === 'error') handlers.onError?.(new Error(parsed.detail));
      } catch (e) {
        handlers.onError?.(e as Error);
      }
    },
    onerror(err) {
      handlers.onError?.(err);
      throw err; // 不让库自动重连
    },
  });
}
