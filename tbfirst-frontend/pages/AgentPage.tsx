/**
 * V6.M3.Slide: /agent 三栏对话页 — 响应式滑动面板
 *
 * 布局行为：
 *   Mobile  (<lg): 主聊天区全宽 + 左/右 固定覆层抽屉（滑入滑出）
 *   Desktop (lg+): 左侧会话列表常驻 240px | 主聊天区 | 右侧工具面板可折叠 280px
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import ServiceSwitcher from '../components/ServiceSwitcher';
import { ChevronDown, ChevronRight, Menu, X } from 'lucide-react';
import {
  AgentSession,
  ChatStreamPayload,
  SessionMeta,
  ToolBlock,
  ToolMeta,
  chatStream,
  createSession,
  deleteSession,
  getMessages,
  listSessions,
  listTools,
} from '../services/agent';

const SESSION_KEY = 'tbfirst_agent_session';

interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
  blocks?: ToolBlock[];
}

function relTime(iso: string | null): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} 天前`;
  return iso.slice(0, 10);
}

const ICON_MAP: Record<string, string> = {
  globe: '🌐',
  book: '📚',
  brain: '🧠',
  image: '🖼️',
};

const AgentPage: React.FC = () => {
  const [sessionUuid, setSessionUuid] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [tools, setTools] = useState<ToolMeta[]>([]);
  const [expandedTool, setExpandedTool] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [metaEvents, setMetaEvents] = useState<string[]>([]);
  const [toolBlocks, setToolBlocks] = useState<Map<number, ToolBlock[]>>(new Map());
  const abortRef = useRef<AbortController | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const seqRef = useRef(0);

  // Sliding UI state — separate mobile drawers from desktop panel visibility
  const [leftOpen, setLeftOpen] = useState(false);       // mobile left drawer
  const [rightDrawer, setRightDrawer] = useState(false); // mobile right drawer
  const [rightPanel, setRightPanel] = useState(true);    // desktop right panel (default open)

  const loadSessions = useCallback(async () => {
    try {
      const list = await listSessions();
      setSessions(list);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    const cached = sessionStorage.getItem(SESSION_KEY);
    if (cached) setSessionUuid(cached);
    loadSessions();
    listTools().then(setTools).catch(() => {});
  }, [loadSessions]);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [messages, metaEvents]);

  const handleNewSession = async () => {
    setErr(null);
    try {
      const s: AgentSession = await createSession();
      sessionStorage.setItem(SESSION_KEY, s.session_uuid);
      setSessionUuid(s.session_uuid);
      setMessages([]);
      setMetaEvents([]);
      setToolBlocks(new Map());
      seqRef.current = 0;
      await loadSessions();
    } catch (e: any) {
      setErr(e?.message || String(e));
    }
  };

  const handleSwitchSession = useCallback(async (uuid: string) => {
    if (uuid === sessionUuid) return;
    setErr(null);
    setMessages([]);
    setMetaEvents([]);
    setToolBlocks(new Map());
    setSessionUuid(uuid);
    sessionStorage.setItem(SESSION_KEY, uuid);
    try {
      const msgs = await getMessages(uuid);
      const loaded: ChatMessage[] = msgs
        .filter(m => m.role !== 'system')
        .map((m, i) => ({ id: i + 1, role: m.role as 'user' | 'assistant', content: m.content }));
      seqRef.current = loaded.length;
      setMessages(loaded);
    } catch (e: any) {
      setErr(e?.message || String(e));
    }
  }, [sessionUuid]);

  const handleDeleteSession = useCallback(async (uuid: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await deleteSession(uuid);
      if (uuid === sessionUuid) {
        setSessionUuid(null);
        sessionStorage.removeItem(SESSION_KEY);
        setMessages([]);
        setMetaEvents([]);
        seqRef.current = 0;
      }
      await loadSessions();
    } catch (err2: any) {
      setErr(err2?.message || String(err2));
    }
  }, [sessionUuid, loadSessions]);

  const handleAbort = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
  };

  const handleSend = async () => {
    if (!sessionUuid) { setErr('请先在左侧创建或选择会话'); return; }
    const text = draft.trim();
    if (!text || busy) return;
    setErr(null);

    const userMsg: ChatMessage = { id: ++seqRef.current, role: 'user', content: text };
    const assistantMsg: ChatMessage = { id: ++seqRef.current, role: 'assistant', content: '', streaming: true };
    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setDraft('');
    setBusy(true);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const payload: ChatStreamPayload = { session_uuid: sessionUuid, message: text };

    try {
      await chatStream(
        payload,
        {
          onChunk: (chunk) => {
            setMessages(prev =>
              prev.map(m => (m.id === assistantMsg.id ? { ...m, content: m.content + chunk } : m)),
            );
          },
          onMeta: (event) => setMetaEvents(prev => [...prev, event]),
          onToolStart: (tool, input) => {
            setToolBlocks(prev => {
              const next: Map<number, ToolBlock[]> = new Map(prev);
              const existing: ToolBlock[] = next.get(assistantMsg.id) ?? [];
              next.set(assistantMsg.id, [...existing, { tool, input, status: 'running' }]);
              return next;
            });
          },
          onToolEnd: (tool, output) => {
            setToolBlocks(prev => {
              const next: Map<number, ToolBlock[]> = new Map(prev);
              const existing: ToolBlock[] = next.get(assistantMsg.id) ?? [];
              const updated = existing.map(b =>
                b.tool === tool && b.status === 'running' ? { ...b, output, status: 'done' as const } : b,
              );
              next.set(assistantMsg.id, updated);
              return next;
            });
          },
          onDone: () => {
            setMessages(prev =>
              prev.map(m => (m.id === assistantMsg.id ? { ...m, streaming: false } : m)),
            );
            loadSessions();
          },
          onError: (e) => {
            setErr(e.message);
            setMessages(prev =>
              prev.map(m => (m.id === assistantMsg.id ? { ...m, streaming: false } : m)),
            );
          },
        },
        ctrl.signal,
      );
    } catch (e: any) {
      if (e?.name !== 'AbortError') setErr(e?.message || String(e));
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const activeTitle = sessions.find(s => s.session_uuid === sessionUuid)?.title;

  // Shared tools list rendered in both mobile drawer and desktop panel
  const toolsList = (
    <>
      {tools.length === 0 && (
        <div className="text-xs text-text-faint text-center mt-6">加载中…</div>
      )}
      {tools.map(t => (
        <div
          key={t.name}
          className="mb-2 rounded-lg border border-border bg-surface overflow-hidden shadow-sm"
        >
          <button
            className="w-full flex items-center gap-2 px-3 py-2 cursor-pointer select-none hover:bg-gray-50 transition-colors text-left border-0 bg-transparent"
            onClick={() => setExpandedTool(prev => prev === t.name ? null : t.name)}
          >
            <span className="text-base w-6 text-center flex-shrink-0">
              {ICON_MAP[t.icon_hint] ?? '🔧'}
            </span>
            <span className="flex-1 text-[13px] font-medium text-gray-700">{t.label}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full border flex-shrink-0 ${
              t.status === 'ready'
                ? 'text-green-600 border-green-200 bg-green-50'
                : 'text-gray-400 border-gray-200 bg-gray-50'
            }`}>
              {t.status === 'ready' ? '就绪' : '开发中'}
            </span>
            <ChevronDown
              size={14}
              className={`text-gray-400 transition-transform duration-200 flex-shrink-0 ${
                expandedTool === t.name ? 'rotate-180' : ''
              }`}
            />
          </button>
          {expandedTool === t.name && (
            <div className="px-3 pb-2.5 text-xs text-text-muted leading-relaxed animate-in fade-in">
              <div>{t.description}</div>
              {t.status !== 'ready' && (
                <div className="mt-1.5 text-[11px] text-text-faint italic">
                  🚧 功能即将上线
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </>
  );

  return (
    <div className="flex h-[calc(100vh-56px)] bg-canvas relative overflow-hidden">

      {/* ── Mobile backdrop — covers both drawers ── */}
      <div
        className={`
          fixed inset-0 z-20 bg-black/25 backdrop-blur-[1px]
          transition-opacity duration-300 lg:hidden
          ${(leftOpen || rightDrawer) ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}
        `}
        onClick={() => { setLeftOpen(false); setRightDrawer(false); }}
      />

      {/* ══════════════ Left Sidebar ══════════════
          Mobile: fixed overlay drawer sliding from left
          Desktop: always-visible relative sidebar
      */}
      <aside
        className={`
          fixed top-14 bottom-0 left-0 z-30 w-[260px]
          lg:relative lg:top-auto lg:bottom-auto lg:z-auto lg:w-60
          flex flex-col flex-shrink-0
          border-r border-border bg-surface-muted
          transition-transform duration-300 ease-out
          lg:translate-x-0
          ${leftOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        {/* New session + mobile close */}
        <div className="sticky top-0 z-10 flex items-center gap-2 p-3 border-b border-border-muted bg-surface-muted">
          <button
            className="flex-1 px-3 py-2 rounded-md text-white text-[13px] font-medium hover:bg-accent-dark active:scale-[0.98] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 cursor-pointer border-0"
            style={{ backgroundColor: 'var(--color-accent, #6366f1)' }}
            onClick={() => { handleNewSession(); setLeftOpen(false); }}
          >
            + 新建会话
          </button>
          <button
            className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors border-0 bg-transparent cursor-pointer lg:hidden"
            onClick={() => setLeftOpen(false)}
            aria-label="关闭侧边栏"
          >
            <X size={14} />
          </button>
        </div>

        {/* Session list */}
        <div className="flex-1 overflow-y-auto p-2">
          {sessions.length === 0 && (
            <div className="text-xs text-text-faint text-center mt-6">无历史会话</div>
          )}
          {sessions.map(s => (
            <div
              key={s.session_uuid}
              className={`group relative px-2.5 py-2 mb-1.5 rounded-md cursor-pointer border transition-all ${
                s.session_uuid === sessionUuid
                  ? 'bg-accent-light border-accent-muted shadow-sm'
                  : 'bg-transparent border-transparent hover:bg-gray-50 hover:shadow-sm'
              }`}
              onClick={() => { handleSwitchSession(s.session_uuid); setLeftOpen(false); }}
            >
              <div className="text-[13px] text-gray-800 truncate pr-5">
                {s.title || '未命名会话'}
              </div>
              <div className="text-[11px] text-text-faint mt-0.5">
                {relTime(s.last_active_at)}
              </div>
              <button
                className="absolute top-1.5 right-1.5 p-0.5 rounded opacity-0 group-hover:opacity-100 text-rose-400 hover:text-rose-600 hover:bg-rose-50 transition-all cursor-pointer border-0 bg-transparent"
                onClick={e => handleDeleteSession(s.session_uuid, e)}
                aria-label="删除会话"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      </aside>

      {/* ══════════════ Main Chat Area ══════════════ */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Mobile top bar — hamburger | session title | tools trigger */}
        <div className="flex items-center gap-2 px-3 h-11 border-b border-border bg-surface shrink-0 lg:hidden">
          <button
            className="p-1.5 rounded-md text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors border-0 bg-transparent cursor-pointer"
            onClick={() => setLeftOpen(true)}
            aria-label="会话列表"
          >
            <Menu size={18} />
          </button>
          <div className="flex-1 text-[13px] font-medium text-gray-700 truncate text-center">
            {activeTitle || (sessionUuid ? '对话中' : 'Agent 对话')}
          </div>
          <button
            className="p-1.5 rounded-md text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors border-0 bg-transparent cursor-pointer text-[15px] leading-none"
            onClick={() => setRightDrawer(true)}
            aria-label="工具面板"
          >
            🔧
          </button>
        </div>

        {/* Desktop sub-header — right panel toggle */}
        <div className="hidden lg:flex items-center justify-end px-3 h-8 border-b border-border-muted bg-surface-muted shrink-0">
          <button
            className="flex items-center gap-1 text-[11px] text-text-faint hover:text-text-muted hover:bg-gray-100 transition-colors px-1.5 py-0.5 rounded border-0 bg-transparent cursor-pointer select-none"
            onClick={() => setRightPanel(prev => !prev)}
          >
            工具面板
            <ChevronRight
              size={11}
              className={`transition-transform duration-300 ${rightPanel ? 'rotate-180' : ''}`}
            />
          </button>
        </div>

        {/* Message scroll area */}
        <div className="flex-1 overflow-y-auto py-5" ref={bodyRef}>
          {messages.length === 0 && (
            <div className="text-xs text-text-muted p-6">
              {sessionUuid
                ? '说点什么开始对话…（Enter 发送 / Shift+Enter 换行）'
                : '在左侧点击 "+ 新建会话" 或选择历史会话。'}
            </div>
          )}
          {messages.map(m => {
            const blocks = toolBlocks.get(m.id) ?? [];
            return (
              <div
                key={m.id}
                className={`flex flex-col py-1.5 px-5 ${m.role === 'user' ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={
                    m.role === 'user'
                      ? 'max-w-[70%] px-3.5 py-2.5 rounded-xl text-sm leading-relaxed bg-accent text-white whitespace-pre-wrap break-words'
                      : 'max-w-[70%] px-3.5 py-2.5 rounded-xl text-sm leading-relaxed bg-surface text-gray-900 border border-border shadow-sm whitespace-pre-wrap break-words'
                  }
                >
                  {m.content}
                  {m.streaming && (
                    <span className="animate-caret-blink ml-0.5 inline-block align-text-bottom text-current opacity-70">▋</span>
                  )}
                </div>
                {blocks.length > 0 && (
                  <div className="mt-1.5 max-w-[70%] space-y-1">
                    {blocks.map((b, idx) => (
                      <div
                        key={idx}
                        className="flex items-start gap-1.5 px-3 py-1.5 rounded-lg bg-gray-50 border border-gray-200 text-[12px] text-gray-600"
                      >
                        <span className="flex-shrink-0">{b.status === 'running' ? '⏳' : '✅'}</span>
                        <span className="font-medium">{b.tool}</span>
                        {b.status === 'done' && b.output && (
                          <span className="text-gray-400 truncate max-w-[200px]">
                            {JSON.stringify(b.output).slice(0, 60)}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {metaEvents.length > 0 && (
            <div className="text-[11px] text-text-muted px-5 py-1 italic">
              后台事件：{metaEvents.join(' · ')}
            </div>
          )}
          {err && (
            <div className="text-[11px] text-danger px-5 py-1 italic">
              错误：{err}
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="flex gap-2 p-3 border-t border-border bg-surface">
          <textarea
            className="flex-1 resize-none min-h-[44px] max-h-[160px] p-2.5 text-sm [font-family:inherit] border border-gray-200 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:border-accent transition-colors disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={sessionUuid ? '输入消息…' : '请先在左侧新建会话'}
            disabled={!sessionUuid || busy}
            rows={2}
          />
          {busy && (
            <button
              className="px-3.5 py-1.5 rounded-md bg-danger text-white text-[13px] font-medium hover:bg-danger-dark active:scale-[0.98] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger focus-visible:ring-offset-1 cursor-pointer border-0 self-end"
              onClick={handleAbort}
            >
              中断
            </button>
          )}
          <button
            className="px-3.5 py-1.5 rounded-md bg-accent text-white text-[13px] font-medium hover:bg-accent-dark active:scale-[0.98] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 cursor-pointer border-0 self-end disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100"
            onClick={handleSend}
            disabled={!sessionUuid || busy || !draft.trim()}
          >
            {busy ? '生成中…' : '发送'}
          </button>
        </div>
      </div>

      {/* ══════════════ Right Panel — Mobile Drawer ══════════════
          Fixed overlay, slides in from right on mobile only
      */}
      <div
        className={`
          fixed top-14 bottom-0 right-0 z-30 w-[280px]
          flex flex-col border-l border-border bg-surface-muted
          transition-transform duration-300 ease-out
          lg:hidden
          ${rightDrawer ? 'translate-x-0' : 'translate-x-full'}
        `}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-muted flex-shrink-0">
          <span className="text-[13px] font-semibold text-gray-500">工具槽位</span>
          <button
            className="p-0.5 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors border-0 bg-transparent cursor-pointer"
            onClick={() => setRightDrawer(false)}
          >
            <X size={14} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {toolsList}
        </div>
      </div>

      {/* ══════════════ Right Panel — Desktop Inline ══════════════
          Collapses horizontally via width transition, always in normal flow
      */}
      <div
        className="hidden lg:flex flex-col overflow-hidden border-l border-border bg-surface-muted flex-shrink-0"
        style={{
          width: rightPanel ? 280 : 0,
          transition: 'width 300ms cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        {/* Inner wrapper keeps content at fixed width so it doesn't reflow during collapse */}
        <div className="w-[280px] flex flex-col h-full">
          <div className="px-4 py-3 text-[13px] font-semibold text-gray-500 border-b border-border-muted flex-shrink-0">
            工具槽位
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {toolsList}
          </div>
        </div>
      </div>

      <ServiceSwitcher currentHref="/agent" />
    </div>
  );
};

export default AgentPage;
