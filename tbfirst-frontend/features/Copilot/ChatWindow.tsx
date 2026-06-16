
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Message, CopilotContext } from './types';
import { CopilotService } from '../../services/copilotService';
import { authService } from '../Auth/authService';
import { RotateCcw, Settings, Send, Check, Lightbulb, Box, Layout } from 'lucide-react';

/**
 * 聊天窗口组件：ChatWindow
 */
interface ChatWindowProps {
  context: CopilotContext;
  onApply: (prompt: string) => void;
  onOpenSettings: () => void;
}

// localStorage 持久化 schema —— 按用户隔离（memoryId = userId），
// 每个用户一个独立 slot：`COPILOT_CHAT_HISTORY:{userId}`
// - 换号：slot 不同，新用户看不到旧对话；旧用户重新登录能继续
// - 同一用户内：scopeKey=brand.url 控制是否重置；Phase 切换不触发重置
const STORAGE_KEY_PREFIX = 'COPILOT_CHAT_HISTORY';
const ANON_USER_KEY = '__anon__';

// 灵感历史独立持久化 —— key: COPILOT_INSPIRE_HISTORY:{userId}:{phase}
// 与聊天记录完全解耦：对话重置、品牌URL切换均不会清除灵感历史；
// 按 Phase 分槽，跨会话积累，最多保留 MAX 条最新灵感用于去重。
const INSPIRE_HISTORY_KEY_PREFIX = 'COPILOT_INSPIRE_HISTORY';
const INSPIRE_HISTORY_MAX = 30;

const inspireHistoryKey = (userKey: string, phase: number): string =>
  `${INSPIRE_HISTORY_KEY_PREFIX}:${userKey}:${phase}`;

const loadInspireHistory = (userKey: string, phase: number): string[] => {
  try {
    const raw = localStorage.getItem(inspireHistoryKey(userKey, phase));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const saveInspireHistory = (userKey: string, phase: number, history: string[]): void => {
  try {
    localStorage.setItem(inspireHistoryKey(userKey, phase), JSON.stringify(history));
  } catch (e) {
    console.warn('[Copilot] persist inspire history failed:', e);
  }
};

interface StoredChat {
  scopeKey: string;
  messages: Message[];
  updatedAt: number;
}

const welcomeMessage = (phase: 0 | 1 | 2 | 3): Message => {
  if (phase === 3) {
    return {
      role: 'model',
      text: '你好！我是你的品牌专属 Prompt Copilot。检测到您已进入 Phase 3 影调大师，可基于灵感参考图的视觉 DNA 与当前控制面板参数（影调浓度 / 颗粒感 / 对比度），帮你写一条达芬奇式整体调色的补充描述（如冷暖偏移、光影氛围、保留服装本色等）。',
    };
  }
  return {
    role: 'model',
    text: `你好！我是你的品牌专属 Prompt Copilot。已感知到您当前处于 Phase ${phase}，可基于你的品牌基因和当前素材为你优化提示词。`,
  };
};

const computeScopeKey = (context: CopilotContext): string => {
  return (context.brand?.url || '').trim() || '__no_brand__';
};

const computeUserKey = (): string => {
  const user = authService.getCurrentUser();
  return user?.userId != null ? String(user.userId) : ANON_USER_KEY;
};

const storageKeyFor = (userKey: string): string => `${STORAGE_KEY_PREFIX}:${userKey}`;

const loadStored = (userKey: string, scopeKey: string, phase: 0 | 1 | 2 | 3): Message[] => {
  try {
    const raw = localStorage.getItem(storageKeyFor(userKey));
    if (!raw) return [welcomeMessage(phase)];
    const parsed: StoredChat = JSON.parse(raw);
    if (parsed.scopeKey === scopeKey && Array.isArray(parsed.messages) && parsed.messages.length > 0) {
      return parsed.messages;
    }
    return [welcomeMessage(phase)];
  } catch {
    return [welcomeMessage(phase)];
  }
};

export const ChatWindow: React.FC<ChatWindowProps> = ({ context, onApply, onOpenSettings }) => {
  const scopeKey = useMemo(() => computeScopeKey(context), [context.brand?.url]);
  // userKey 不能 useMemo（无稳定依赖），每次 render 从 authService 读当前值；
  // 配合下面的 prevUserKeyRef + useEffect 检测用户切换
  const userKey = computeUserKey();
  const [messages, setMessages] = useState<Message[]>(() => loadStored(userKey, scopeKey, context.activePhase));
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isInspiring, setIsInspiring] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 滚动到底
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // 用户切换（登录 / 登出 / 换号）→ 切到目标用户自己的记忆槽
  // brand.url 变化 → 在当前用户槽内重置为欢迎语（但不清空 localStorage，方便原 URL 再填回时仍可恢复）
  const prevUserKeyRef = useRef(userKey);
  const prevScopeKeyRef = useRef(scopeKey);
  useEffect(() => {
    const userChanged = prevUserKeyRef.current !== userKey;
    const scopeChanged = prevScopeKeyRef.current !== scopeKey;
    prevUserKeyRef.current = userKey;
    prevScopeKeyRef.current = scopeKey;

    if (userChanged) {
      // 换号：从新用户自己的 slot 读取；没有就给欢迎语
      setMessages(loadStored(userKey, scopeKey, context.activePhase));
    } else if (scopeChanged) {
      // 同一用户但换了 brand URL：重置为欢迎语
      setMessages([welcomeMessage(context.activePhase)]);
    }
  }, [userKey, scopeKey, context.activePhase]);

  // messages 变化 → 持久化到当前用户的 slot
  useEffect(() => {
    try {
      const payload: StoredChat = { scopeKey, messages, updatedAt: Date.now() };
      localStorage.setItem(storageKeyFor(userKey), JSON.stringify(payload));
    } catch (e) {
      console.warn('[Copilot] persist chat failed:', e);
    }
  }, [messages, scopeKey, userKey]);

  const handleReset = () => {
    setIsSyncing(true);
    const reset: Message[] = [{
      role: 'model',
      text: `会话已重置。我已重新感知到您当前处于 Phase ${context.activePhase}，检测到资产已就绪。请问需要我如何协助？`,
    }];
    setMessages(reset);
    setTimeout(() => setIsSyncing(false), 800);
  };

  // V5.XVII.C: 从消息历史里抽出最近 N 条灵感文本，回传后端用于去重。
  // 识别锚点：消息以 "💡 **灵感提示词**" 开头 + ```prompt 代码块。
  const extractRecentInspirations = (history: Message[], limit = 8): string[] => {
    const out: string[] = [];
    for (let i = history.length - 1; i >= 0 && out.length < limit; i--) {
      const m = history[i];
      if (m.role !== 'model') continue;
      if (!m.text.startsWith('💡')) continue;
      const match = m.text.match(/```(?:prompt)?\n([\s\S]*?)\n```/);
      const body = (match ? match[1] : '').trim();
      if (body) out.unshift(body);
    }
    return out;
  };

  const handleInspire = async () => {
    if (isInspiring || isLoading) return;
    setIsInspiring(true);
    try {
      const service = new CopilotService();
      // 优先使用跨会话持久化的灵感历史（不受对话重置/品牌切换影响），
      // 兜底合并本轮消息中尚未写入历史的灵感（极端情况：storage 写入失败）
      const persisted = loadInspireHistory(userKey, context.activePhase);
      const fromMessages = extractRecentInspirations(messages);
      const deduped = [...new Set([...persisted, ...fromMessages])];
      const recent = deduped.slice(-20);

      const inspiration = await service.inspire(context, recent);
      const text = inspiration.trim() || '（模型没有给出灵感，试试再点一次？）';

      // 写入持久化灵感历史
      const updated = [...persisted, text].slice(-INSPIRE_HISTORY_MAX);
      saveInspireHistory(userKey, context.activePhase, updated);

      // 用标准 ```prompt 代码块包裹，天然命中 extractPrompt 正则 → "应用到当前描述" 按钮可用
      setMessages(prev => [
        ...prev,
        { role: 'model', text: `💡 **灵感提示词**\n\n\`\`\`prompt\n${text}\n\`\`\`` },
      ]);
    } catch (err) {
      console.error('Copilot Inspire Error:', err);
      setMessages(prev => [...prev, { role: 'model', text: '抱歉，灵感生成失败，请检查网络或稍后重试。' }]);
    } finally {
      setIsInspiring(false);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMsg = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    setIsLoading(true);

    try {
      const service = new CopilotService();
      const response = await service.generateResponse(messages, userMsg, context);
      setMessages(prev => [...prev, { role: 'model', text: response }]);
    } catch (err) {
      console.error("Copilot Error:", err);
      setMessages(prev => [...prev, { role: 'model', text: "抱歉，生成回复时出错了。请检查 API Key 或网络连接。" }]);
    } finally {
      setIsLoading(false);
    }
  };

  const extractPrompt = (text: string): string | null => {
    const codeBlockMatch = text.match(/```(?:prompt)?\n([\s\S]*?)\n```/);
    if (codeBlockMatch) return codeBlockMatch[1].trim();
    const markerMatch = text.match(/(?:提示词|Prompt)[:：]\s*([\s\S]*)/i);
    if (markerMatch) return markerMatch[1].trim();
    return null;
  };

  const getStatusTags = () => {
    const tags = [];
    tags.push({ label: `Phase ${context.activePhase}`, icon: <Layout className="w-3 h-3" />, color: 'bg-indigo-50 text-indigo-600' });

    const hasModel = !!context.inputs.model;
    const hasProduct = context.inputs.product && (Array.isArray(context.inputs.product) ? context.inputs.product.length > 0 : !!context.inputs.product);

    if (hasModel || hasProduct) {
      tags.push({ label: '资产已就绪', icon: <Box className="w-3 h-3" />, color: 'bg-emerald-50 text-emerald-600' });
    }

    if (context.activePhase === 1) {
      if (context.p1Settings.shotType) tags.push({ label: context.p1Settings.shotType, color: 'bg-slate-100 text-slate-600' });
      if (context.p1Settings.tone) tags.push({ label: context.p1Settings.tone, color: 'bg-slate-100 text-slate-600' });
      const p1Scope = context.p1Settings.compositionScope;
      if (p1Scope && p1Scope !== 'inherit') {
        const scopeLabel = context.p1Settings.compositionTarget ? `构图: ${context.p1Settings.compositionTarget}` : `构图已选`;
        tags.push({ label: scopeLabel, color: 'bg-indigo-50 text-indigo-600' });
      } else if (p1Scope === 'inherit') {
        tags.push({ label: '继承构图', color: 'bg-slate-100 text-slate-400' });
      }
    } else if (context.activePhase === 2) {
      if (context.p2Settings.poseAction && context.p2Settings.poseAction !== 'Maintain original pose') {
        tags.push({ label: context.p2Settings.poseAction, color: 'bg-slate-100 text-slate-600' });
      } else if (context.p2Settings.actions.length > 0) {
        tags.push({ label: '动作已选', color: 'bg-slate-100 text-slate-600' });
      }
      if (context.p2Settings.gestureAction) tags.push({ label: `手势: ${context.p2Settings.gestureAction}`, color: 'bg-slate-100 text-slate-600' });
      const p2Scope = context.p2Settings.compositionScope;
      if (p2Scope && p2Scope !== 'inherit') {
        const scopeLabel = context.p2Settings.compositionTarget ? `构图: ${context.p2Settings.compositionTarget}` : `构图已选`;
        tags.push({ label: scopeLabel, color: 'bg-indigo-50 text-indigo-600' });
      } else if (p2Scope === 'inherit') {
        tags.push({ label: '继承构图', color: 'bg-slate-100 text-slate-400' });
      }
      if (context.p2Settings.focus) tags.push({ label: context.p2Settings.focus, color: 'bg-slate-100 text-slate-600' });
    } else if (context.activePhase === 3 && context.p3Settings) {
      const p3 = context.p3Settings;
      // 影调大师签名：DNA / 强度 / 对比 / 颗粒 / 补充描述
      if (p3.styleDNA) {
        tags.push({ label: 'DNA 已就绪', color: 'bg-rose-50 text-rose-600' });
      } else {
        tags.push({ label: '待提取 DNA', color: 'bg-slate-100 text-slate-400' });
      }
      tags.push({ label: `浓度 ${Math.round((p3.intensity || 0) * 100)}%`, color: 'bg-rose-50 text-rose-600' });
      tags.push({ label: `对比度 ${p3.contrast}`, color: 'bg-slate-100 text-slate-600' });
      if (p3.grain) tags.push({ label: '颗粒感', color: 'bg-slate-100 text-slate-600' });
      if (p3.remark && p3.remark.trim()) tags.push({ label: '补充描述已填', color: 'bg-rose-50 text-rose-600' });
    }

    return tags;
  };

  return (
    <div className="flex flex-col h-full bg-slate-50">
      {/* Header */}
      <div className="p-4 bg-white border-b border-slate-100 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
          <span className="font-bold text-slate-700 text-sm">Prompt Copilot</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleInspire}
            disabled={isInspiring || isLoading}
            className="p-1.5 hover:bg-amber-50 rounded-lg transition-colors text-amber-500 disabled:text-slate-300 disabled:hover:bg-transparent"
            title="获取灵感提示词"
          >
            <Lightbulb className={`w-4 h-4 ${isInspiring ? 'animate-pulse' : ''}`} />
          </button>
          <button
            onClick={handleReset}
            className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors text-slate-400"
            title="重置对话"
          >
            <RotateCcw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={onOpenSettings}
            className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors text-slate-400"
            title="品牌设置"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Status Board (Capsule UI) */}
      <div className="px-4 py-2 bg-white/50 backdrop-blur-sm border-b border-slate-100 flex flex-wrap gap-1.5 shrink-0">
        {isSyncing ? (
          <div className="flex items-center gap-2 py-1">
            <div className="w-3 h-3 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
            <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-widest">Re-Syncing Workspace...</span>
          </div>
        ) : (
          getStatusTags().map((tag, i) => (
            <div key={i} className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border border-transparent ${tag.color}`}>
              {tag.icon}
              {tag.label}
            </div>
          ))
        )}
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] p-3 rounded-2xl text-sm ${
              msg.role === 'user'
                ? 'bg-indigo-600 text-white rounded-tr-none shadow-md'
                : 'bg-white text-slate-700 rounded-tl-none border border-slate-100 shadow-sm'
            }`}>
              <div className="whitespace-pre-wrap leading-relaxed">{msg.text}</div>

              {msg.role === 'model' && extractPrompt(msg.text) && (
                <button
                  onClick={() => onApply(extractPrompt(msg.text)!)}
                  className="mt-3 w-full py-2 bg-emerald-50 text-emerald-600 border border-emerald-100 rounded-xl font-bold text-[10px] uppercase tracking-widest hover:bg-emerald-100 transition-all flex items-center justify-center gap-1.5"
                >
                  <Check className="w-3 h-3" />
                  应用到当前描述
                </button>
              )}
            </div>
          </div>
        ))}
        {(isLoading || isInspiring) && (
          <div className="flex justify-start">
            <div className="bg-white p-3 rounded-2xl rounded-tl-none border border-slate-100 shadow-sm flex gap-1">
              <div className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce"></div>
              <div className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce [animation-delay:0.2s]"></div>
              <div className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce [animation-delay:0.4s]"></div>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="p-4 bg-white border-t border-slate-100 shrink-0">
        <div className="relative">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="输入你的想法，例如：'改一下动作'..."
            className="w-full pl-4 pr-12 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all resize-none max-h-32"
            rows={2}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            className={`absolute right-2 bottom-2 p-2 rounded-xl transition-all ${
              !input.trim() || isLoading ? 'text-slate-300' : 'text-indigo-600 hover:bg-indigo-50'
            }`}
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
        <p className="mt-2 text-[10px] text-slate-400 text-center">
          Shift + Enter 换行 | 已自动同步当前界面素材
        </p>
      </div>
    </div>
  );
};
