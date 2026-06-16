
import React, { useState } from 'react';
import { BrandConfig } from './types';
import { CopilotService } from '../../services/copilotService';

/**
 * 品牌记忆配置组件：BrandSettings
 */
interface BrandSettingsProps {
  config: BrandConfig;
  onChange: (config: BrandConfig) => void;
  onBack: () => void;
}

export const BrandSettings: React.FC<BrandSettingsProps> = ({ config, onChange, onBack }) => {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = (field: keyof BrandConfig, value: string) => {
    onChange({ ...config, [field]: value });
  };

  const handleAnalyze = async () => {
    if (!config.url || isAnalyzing) return;
    setIsAnalyzing(true);
    setError(null);
    try {
      const service = new CopilotService();
      const result = await service.analyzeBrand(config.url);
      onChange({
        ...config,
        audience: result.audience,
        tone: result.tone,
        description: result.description
      });
    } catch (err: any) {
      console.error(err);
      setError(err.message || "分析失败，请检查网址或 API Key");
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="flex flex-col h-full p-4 bg-white">
      <div className="flex items-center gap-2 mb-6">
        <button onClick={onBack} className="p-1 hover:bg-slate-100 rounded-lg transition-colors">
          <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h3 className="font-bold text-slate-800">品牌记忆配置</h3>
      </div>

      <div className="space-y-4 flex-1 overflow-y-auto pr-1">
        <div>
          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">品牌官网 / 参考链接</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={config.url}
              onChange={(e) => handleChange('url', e.target.value)}
              placeholder="https://example.com"
              disabled={isAnalyzing}
              className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all disabled:opacity-50"
            />
            <button
              onClick={handleAnalyze}
              disabled={!config.url || isAnalyzing}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
                !config.url || isAnalyzing
                  ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                  : 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100 shadow-sm'
              }`}
            >
              {isAnalyzing ? (
                <>
                  <div className="w-3 h-3 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
                  分析中...
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  AI 分析
                </>
              )}
            </button>
          </div>
          {error && <p className="mt-1.5 text-[10px] text-red-500 font-bold">{error}</p>}
        </div>

        <div className={isAnalyzing ? 'opacity-50 pointer-events-none' : ''}>
          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">目标受众</label>
          <input
            type="text"
            value={config.audience}
            onChange={(e) => handleChange('audience', e.target.value)}
            placeholder={isAnalyzing ? "AI 正在深度解析网页内容..." : "例如：25-35岁 职场女性"}
            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
          />
        </div>

        <div className={isAnalyzing ? 'opacity-50 pointer-events-none' : ''}>
          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">品牌调性</label>
          <input
            type="text"
            value={config.tone}
            onChange={(e) => handleChange('tone', e.target.value)}
            placeholder={isAnalyzing ? "AI 正在提取品牌性格关键词..." : "例如：极简、高冷、活力"}
            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
          />
        </div>

        <div className={isAnalyzing ? 'opacity-50 pointer-events-none' : ''}>
          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">额外描述</label>
          <textarea
            value={config.description}
            onChange={(e) => handleChange('description', e.target.value)}
            placeholder={isAnalyzing ? "AI 正在总结视觉风格与设计理念..." : "输入更多关于品牌的视觉规范或故事..."}
            rows={4}
            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all resize-none"
          />
        </div>
      </div>

      <button
        onClick={onBack}
        className="mt-4 w-full py-3 bg-indigo-600 text-white rounded-xl font-bold text-sm shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition-all"
      >
        保存并开始对话
      </button>
    </div>
  );
};
