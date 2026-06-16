
import React, { useState, useEffect, useMemo } from 'react';
import { BrandConfig, CopilotContext } from './types';
import { ChatWindow } from './ChatWindow';
import { BrandSettings } from './BrandSettings';
import { InputFiles, Phase1Settings, Phase2Settings, Phase3Settings } from '../../types';

/**
 * Copilot 容器组件：CopilotContainer
 */
interface CopilotContainerProps {
  inputs: InputFiles;
  p1Settings: Phase1Settings;
  p2Settings: Phase2Settings;
  p3Settings?: Phase3Settings;
  onApplyPrompt: (prompt: string) => void;
}

export const CopilotContainer: React.FC<CopilotContainerProps> = ({
  inputs,
  p1Settings,
  p2Settings,
  p3Settings,
  onApplyPrompt
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState<'chat' | 'settings'>('chat');
  const [brandConfig, setBrandConfig] = useState<BrandConfig>({
    url: '',
    audience: '',
    tone: '',
    description: ''
  });

  // Load brand config from local storage
  useEffect(() => {
    const saved = localStorage.getItem('BRAND_COPILOT_CONFIG');
    if (saved) {
      try {
        setBrandConfig(JSON.parse(saved));
      } catch (e) {
        console.error(e);
      }
    }
  }, []);

  const handleBrandChange = (newConfig: BrandConfig) => {
    setBrandConfig(newConfig);
    localStorage.setItem('BRAND_COPILOT_CONFIG', JSON.stringify(newConfig));
  };

  // V5.XVII.D：activePhase 改用 IntersectionObserver 探视口中线判断，
  // 替换 V5.XVI 前的硬编码 scrollY 像素阈值（< 800 / < 1800 / < 2800 / else）。
  //
  // 问题背景：原阈值不区分屏幕尺寸 / 字号 / 各 Phase 模块高度，用户实际滑到 Phase 2
  // 区域时 scrollY 常已 > 2800，被误判为 Phase 3，导致 Copilot 在 Phase 2 提示
  // "当前处于 Phase 3"。
  //
  // 新算法：
  //   1. Workspace 给 4 个 Phase 区块挂 `data-phase="N"` 标记
  //   2. IO rootMargin 把视口压成中央 20% 高度的"探测带"
  //      （顶 40% + 底 40% 裁掉），元素只有 bounding box 与该探测带相交才算 active
  //   3. 多个 phase 同时活跃时取**最大编号**（最靠下）——
  //      与用户预期"滑到影调大师才识别为 Phase 3"一致
  //   4. 没有任何元素进入探测带时保持上一帧值，不退回到 Phase 0
  const [activePhase, setActivePhase] = useState<0 | 1 | 2 | 3>(1);

  useEffect(() => {
    const phaseEls = Array.from(
      document.querySelectorAll<HTMLElement>('[data-phase]')
    );
    if (phaseEls.length === 0) {
      // 兜底：DOM 还没挂好（极少触发），保持 useState 默认 Phase 1
      return;
    }

    // 记录每个 phase 当前与探测带的相交比，决策时找"既相交又最靠下"的
    const ratios = new Map<number, number>();
    for (const el of phaseEls) {
      const n = Number(el.dataset.phase);
      if (Number.isInteger(n) && n >= 0 && n <= 3) ratios.set(n, 0);
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const n = Number((e.target as HTMLElement).dataset.phase);
          if (!Number.isInteger(n)) continue;
          ratios.set(n, e.isIntersecting ? e.intersectionRatio || 0.001 : 0);
        }
        // 在已相交的 phase 里挑编号最大的 —— 视觉上更"靠下"的 Phase
        let best: number | null = null;
        for (const [n, r] of ratios.entries()) {
          if (r > 0 && (best === null || n > best)) best = n;
        }
        if (best !== null) {
          setActivePhase(best as 0 | 1 | 2 | 3);
        }
      },
      {
        rootMargin: '-40% 0px -40% 0px',
        threshold: [0, 0.01, 0.5, 1],
      },
    );

    phaseEls.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  // 用 useMemo 稳定 context 引用：避免每次 parent 渲染都创建新对象 + 新 timestamp，
  // 误触发 ChatWindow 里的 scopeKey / 持久化 useEffect。
  // timestamp 只在真正需要的输入变化时刷新（用于 UI 调试显示），而非每次渲染。
  const context: CopilotContext = useMemo(() => ({
    brand: brandConfig,
    inputs,
    p1Settings,
    p2Settings,
    p3Settings,
    activePhase,
    timestamp: 0,
  }), [brandConfig, inputs, p1Settings, p2Settings, p3Settings, activePhase]);

  return (
    <div className="fixed bottom-6 right-6 z-[60] flex flex-col items-end gap-4">
      {/* Chat Window */}
      {isOpen && (
        <div className="w-[420px] h-[650px] bg-white rounded-[2.5rem] shadow-2xl border border-slate-100 overflow-hidden flex flex-col animate-in slide-in-from-bottom-4 duration-300">
          {view === 'chat' ? (
            <ChatWindow
              context={context}
              onApply={onApplyPrompt}
              onOpenSettings={() => setView('settings')}
            />
          ) : (
            <BrandSettings
              config={brandConfig}
              onChange={handleBrandChange}
              onBack={() => setView('chat')}
            />
          )}
        </div>
      )}

      {/* Floating Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`w-16 h-16 rounded-full flex items-center justify-center shadow-2xl transition-all duration-500 active:scale-90 ${
          isOpen ? 'bg-slate-800 rotate-90' : 'bg-indigo-600 hover:bg-indigo-700'
        }`}
      >
        {isOpen ? (
          <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <div className="relative">
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
            <div className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-400 border-2 border-indigo-600 rounded-full"></div>
          </div>
        )}
      </button>
    </div>
  );
};
