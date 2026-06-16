import React, { useRef, useState } from 'react';
import { Phase4Settings, VideoJob } from '../types';

interface Phase4Props {
  p4Settings: Phase4Settings;
  setP4Settings: (s: Phase4Settings | ((prev: Phase4Settings) => Phase4Settings)) => void;
  videoJobs: VideoJob[];
  /** 当前是否正在触发生成（仅控制按钮 loading；具体任务的"渲染中"由 job.status 自描述） */
  isGenerating: boolean;
  onGenerate: () => void;
  onClearJob: (localId: string) => void;
  sectionRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * Phase 4：视频生成（淡粉色 UI）。
 *
 * 字号与间距完全沿用 Phase3：
 *   - 头部：text-3xl font-bold tracking-tight + text-slate-500 副标
 *   - 区块卡片：bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm
 *   - 区块间距：space-y-12 + gap-8
 *   - 主色：rose → pink（pink-400/500/600 + pink-50/100，更柔和偏蓝调）
 *
 * 区块：
 *   ① 控制面板（prompt + model + duration + aspectRatio + 可选参考图 + 生成按钮）
 *   ② 视频任务库（pending/running/success/failed 四态卡片）
 */
export const Phase4: React.FC<Phase4Props> = ({
  p4Settings,
  setP4Settings,
  videoJobs,
  isGenerating,
  onGenerate,
  onClearJob,
  sectionRef,
}) => {
  const referenceInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const readFileAsDataUri = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target?.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const handleReferenceFile = async (file: File) => {
    const dataUri = await readFileAsDataUri(file);
    setP4Settings(prev => ({ ...prev, referenceImage: dataUri }));
  };

  const promptLen = (p4Settings.prompt || '').length;
  const canGenerate = !isGenerating && promptLen > 0 && p4Settings.model !== 'gpt-image-2';

  // 16:9 / 9:16 / 1:1 → 用于预览框 aspect 类（Tailwind 不支持任意比例，按枚举映射）
  const aspectClassMap: Record<Phase4Settings['aspectRatio'], string> = {
    '16:9': 'aspect-video',
    '9:16': 'aspect-[9/16]',
    '1:1': 'aspect-square',
  };

  return (
    <section ref={sectionRef} className="w-full space-y-12">
      {/* 头部：徽章 + h1 + 副标题（结构 / 字号完全沿用 Phase3） */}
      <div className="flex items-center gap-4">
        <span className="flex items-center justify-center w-12 h-12 rounded-2xl bg-pink-500 text-white font-bold text-2xl shadow-lg shadow-pink-100">4</span>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">视频生成</h1>
          <p className="text-slate-500">输入提示词生成 8 秒短视频（Veo 3 GA 引擎）</p>
        </div>
      </div>

      <div className="flex flex-col gap-8">

        {/* ① 控制面板（独立卡片） */}
        <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm flex flex-col">
          <div className="flex items-center justify-between mb-4 shrink-0">
            <h3 className="font-bold text-slate-700 text-lg">控制面板</h3>
            <span className="bg-pink-500/10 text-pink-500 text-xs font-black px-3 py-1 rounded-full">Veo 3 视频引擎</span>
          </div>

          {/* prompt textarea —— 必填，最高权重 */}
          <div className="mb-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-black text-slate-500">
                视频描述 <span className="text-pink-600 ml-1">必填</span>
              </span>
              <span className="text-[10px] text-slate-400">{promptLen}/500</span>
            </div>
            <textarea
              value={p4Settings.prompt}
              maxLength={500}
              onChange={e => setP4Settings(prev => ({ ...prev, prompt: e.target.value }))}
              placeholder="例：一只白色的猫坐在窗台上，阳光斜射进来，慢动作摇尾巴，电影级浅景深"
              className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2 bg-slate-50/50 focus:bg-white focus:border-pink-400 focus:ring-2 focus:ring-pink-100 outline-none transition-all resize-none"
              rows={3}
            />
            <p className="text-[10px] text-slate-400 mt-1">描述视频内容、镜头运动、光影氛围。中英文均可，Veo 对英文响应更精准。</p>
          </div>

          {/* 三行参数：模型 / 时长 / 宽高比 */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-5">
            {/* 模型 */}
            <div>
              <div className="text-xs font-black text-slate-500 mb-2">模型</div>
              <select
                value={p4Settings.model}
                onChange={e => setP4Settings(prev => ({ ...prev, model: e.target.value as Phase4Settings['model'] }))}
                className="w-full text-xs border border-slate-200 rounded-lg px-2 py-2 bg-white text-slate-600 focus:border-pink-400 focus:ring-2 focus:ring-pink-100 outline-none transition-all"
              >
                <option value="veo-3">Veo 3（推荐）</option>
                <option value="gpt-image-2">GPT-Image-2（占位，暂未启用）</option>
              </select>
              {p4Settings.model === 'gpt-image-2' && (
                <p className="text-[10px] text-amber-500 mt-1">该模型尚未接入，后端会返回 501</p>
              )}
            </div>

            {/* 时长（Veo 3 GA 固定 8s；待 Veo 2 接入后解锁可选项） */}
            <div>
              <div className="text-xs font-black text-slate-500 mb-2">时长</div>
              <div className="flex gap-3 opacity-70">
                <label className="flex items-center gap-1.5 cursor-not-allowed">
                  <input
                    type="radio"
                    name="p4Duration"
                    checked={true}
                    disabled
                    readOnly
                    className="accent-pink-500"
                  />
                  <span className="text-xs font-black text-slate-600">8s</span>
                </label>
              </div>
              <p className="text-[10px] text-slate-400 mt-1">Veo 3 GA 当前固定 8 秒；待 Veo 2 接入后解锁 4-8s 可选</p>
            </div>

            {/* 宽高比 */}
            <div>
              <div className="text-xs font-black text-slate-500 mb-2">宽高比</div>
              <div className="flex gap-3">
                {(['16:9', '9:16', '1:1'] as const).map(ar => (
                  <label key={ar} className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="p4Aspect"
                      checked={p4Settings.aspectRatio === ar}
                      onChange={() => setP4Settings(prev => ({ ...prev, aspectRatio: ar }))}
                      className="accent-pink-500"
                    />
                    <span className="text-xs font-black text-slate-600">{ar}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* 可选参考图（image-to-video 起始帧） */}
          <div
            className={`mb-5 border-2 border-dashed rounded-2xl p-4 transition-colors ${isDragOver ? 'border-pink-400 bg-pink-50/40' : 'border-slate-200 bg-slate-50/30'}`}
            onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={e => {
              e.preventDefault();
              setIsDragOver(false);
              const file = e.dataTransfer.files[0];
              if (file?.type.startsWith('image/')) handleReferenceFile(file);
            }}
            onPaste={e => {
              const items = Array.from(e.clipboardData.items) as DataTransferItem[];
              const item = items.find(i => i.kind === 'file' && i.type.startsWith('image/'));
              if (item) { const f = item.getAsFile(); if (f) handleReferenceFile(f); }
            }}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-black text-pink-600 bg-pink-50 px-2 py-0.5 rounded">可选</span>
                <span className="text-sm font-black text-slate-700">参考图（起始帧）</span>
              </div>
              {p4Settings.referenceImage && (
                <button
                  onClick={() => setP4Settings(prev => ({ ...prev, referenceImage: undefined }))}
                  className="text-xs text-slate-400 hover:text-pink-500 transition-colors"
                >移除</button>
              )}
            </div>
            <input
              ref={referenceInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={e => { if (e.target.files?.[0]) { handleReferenceFile(e.target.files[0]); e.target.value = ''; } }}
            />
            {p4Settings.referenceImage ? (
              <div className="w-[200px] h-[200px] max-w-full rounded-xl border border-pink-100 bg-white overflow-hidden">
                <img src={p4Settings.referenceImage} alt="参考起始帧" className="w-full h-full object-cover" />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => referenceInputRef.current?.click()}
                className="w-full py-6 flex flex-col items-center justify-center text-slate-400 text-xs gap-1 hover:text-pink-500 transition-colors"
              >
                <span className="text-2xl">🎬</span>
                <span>点击 / 拖拽 / 粘贴 图片</span>
                <span className="text-[10px] text-slate-300">留空 = 纯文本驱动（text-to-video）</span>
              </button>
            )}
          </div>

          {/* 生成按钮 */}
          <button
            disabled={!canGenerate}
            onClick={onGenerate}
            className="w-full py-3 rounded-xl bg-pink-500 text-white text-sm font-black disabled:opacity-40 disabled:cursor-not-allowed hover:bg-pink-600 transition-colors shadow-sm shadow-pink-100"
          >
            {isGenerating ? (
              <span className="flex items-center justify-center gap-2">
                <span className="inline-block w-3 h-3 border-2 border-pink-200 border-t-white rounded-full animate-spin" />
                正在提交任务...
              </span>
            ) : '生成视频'}
          </button>
          {promptLen === 0 && (
            <p className="text-[11px] text-slate-400 text-center mt-2">请先在「视频描述」填入提示词</p>
          )}
        </div>

        {/* ② 视频任务库 */}
        <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm flex flex-col">
          <div className="flex items-center justify-between mb-4 shrink-0">
            <h3 className="font-bold text-slate-700 text-lg">视频任务库</h3>
            {videoJobs.length > 0 && (
              <span className="bg-pink-500 text-white text-xs font-black rounded-full px-2 py-0.5">{videoJobs.length}</span>
            )}
          </div>

          {videoJobs.length === 0 ? (
            <div className="h-40 flex items-center justify-center text-slate-400 text-sm border border-dashed border-slate-200 rounded-2xl">
              <span>生成的视频会展示在此（任务 24h 后过期）</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {videoJobs.map(job => {
                const statusMeta = {
                  pending:  { label: '排队中', cls: 'bg-slate-100 text-slate-500' },
                  running:  { label: '渲染中', cls: 'bg-pink-100 text-pink-600' },
                  success:  { label: '已完成', cls: 'bg-emerald-100 text-emerald-600' },
                  failed:   { label: '失败',   cls: 'bg-red-100 text-red-500' },
                }[job.status];
                const aspectCls = aspectClassMap[job.aspectRatio as Phase4Settings['aspectRatio']] || 'aspect-video';

                return (
                  <div key={job.localId} className="border border-pink-100 rounded-2xl p-4 bg-pink-50/30 flex flex-col gap-3">
                    {/* 顶部 meta */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-black px-2 py-0.5 rounded ${statusMeta.cls}`}>{statusMeta.label}</span>
                        <span className="text-[10px] text-slate-500 font-black">{job.modelSnapshot} · {job.durationSec}s · {job.aspectRatio}</span>
                      </div>
                      <button
                        onClick={() => onClearJob(job.localId)}
                        className="text-xs text-slate-400 hover:text-red-500 transition-colors"
                        title="从列表移除（不影响后端记录）"
                      >×</button>
                    </div>

                    {/* prompt 摘要 */}
                    <p className="text-[11px] text-slate-600 line-clamp-2 leading-relaxed" title={job.promptSnapshot}>
                      {job.promptSnapshot}
                    </p>

                    {/* 视频 / loading / error */}
                    <div className={`w-full ${aspectCls} rounded-xl overflow-hidden bg-slate-100 border border-pink-100 relative`}>
                      {job.status === 'success' && job.videoUrl ? (
                        <video
                          src={job.videoUrl}
                          controls
                          className="w-full h-full object-contain bg-black"
                        />
                      ) : job.status === 'failed' ? (
                        <div className="absolute inset-0 flex items-center justify-center text-red-500 text-xs p-3 text-center">
                          {job.errorMsg || '渲染失败'}
                        </div>
                      ) : (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                          <span className="inline-block w-6 h-6 border-2 border-pink-200 border-t-pink-500 rounded-full animate-spin" />
                          <span className="text-[10px] text-slate-500">{statusMeta.label}（约 1-3 分钟）</span>
                        </div>
                      )}
                    </div>

                    {/* 底部时间 + jobId 短码 */}
                    <div className="flex items-center justify-between text-[10px] text-slate-400">
                      <span>{new Date(job.createdAt).toLocaleString('zh-CN', { hour12: false })}</span>
                      <span className="font-mono" title={job.jobId}>#{job.jobId.slice(0, 8)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </div>
    </section>
  );
};
