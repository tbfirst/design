/**
 * ImageTagger —— 参考图下方的标签输入条。
 *
 * 设计目标：让用户为每一张上传的参考图打一句简短提示词（如"正面"/"背面"/"面料纹理"），
 * 下游把标签作为 "[Reference Image: <label>]" 插入到 Gemini 多模态 parts 之前，帮助大模型
 * 区分同一请求中的多张参考图，降低混淆幻觉。
 *
 * 形态：
 *   ┌──────────────────────────────────────────────┐
 *   │  [正面] [侧面] [背面] [细节] [纹理] [整体]    │   ← 快捷 chip（点一下覆写 value）
 *   │  ┌─────────────────────────────────────────┐ │
 *   │  │  标签（自定义可直接输入）              │ │  ← 文本输入；空 = 走后端默认位置性标签
 *   │  └─────────────────────────────────────────┘ │
 *   └──────────────────────────────────────────────┘
 *
 * 契约：
 *   - value: 当前标签文本；空字符串表示"没打标"，由后端按索引落到默认 label_map
 *   - onChange: 文本变化时回调；父组件负责持久化到数组/对象里
 *   - presets: 可点选项；传空数组就只剩文本输入
 *   - maxLength: 可选；默认 32，避免 label 过长挤占 prompt token 预算
 *
 * 约束：
 *   - 纯受控组件，不自带本地 state
 *   - 不负责持久化（关标签不应入 localStorage；一次性会话内有效）
 */
import React from 'react';

export interface ImageTaggerProps {
  value: string;
  onChange: (next: string) => void;
  presets?: string[];
  placeholder?: string;
  maxLength?: number;
  className?: string;
}

const DEFAULT_PRESETS = ['正面', '侧面', '背面', '细节', '纹理', '整体'];

export const ImageTagger: React.FC<ImageTaggerProps> = ({
  value,
  onChange,
  presets = DEFAULT_PRESETS,
  placeholder = '标签（可选，帮助模型区分多图）',
  maxLength = 32,
  className = '',
}) => {
  return (
    <div className={`flex flex-col gap-1 mt-1 ${className}`}>
      {presets.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {presets.map((p) => (
            <button
              key={p}
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onChange(p);
              }}
              className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold border transition-all ${
                value === p
                  ? 'bg-indigo-600 border-indigo-600 text-white'
                  : 'bg-white border-slate-200 text-slate-500 hover:border-indigo-300 hover:text-indigo-600'
              }`}
              title={`将标签设为"${p}"`}
            >
              {p}
            </button>
          ))}
        </div>
      )}
      <input
        type="text"
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        // placeholder 比正文字小 2px（11 → 9），避免占位短语把小框挤得像"必填"一样视觉抢戏
        className="w-full px-2 py-1 text-[11px] placeholder:text-[9px] bg-slate-50 border border-slate-200 rounded-md focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 outline-none transition-all"
      />
    </div>
  );
};

export default ImageTagger;
