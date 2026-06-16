import React, { useRef, useState } from 'react';
import { Phase3Settings, GeneratedImage } from '../types';
import type { GarmentAttrs } from '../types';
import GarmentAttrsForm from './GarmentAttrsForm';
import { toProxiedSrc, makeImgErrorFallback } from '../services/shared/imageSrc';
import { uploadFilesToGcs } from '../services/uploadService';

interface Phase3Props {
  p3Settings: Phase3Settings;
  setP3Settings: (s: Phase3Settings | ((prev: Phase3Settings) => Phase3Settings)) => void;
  p3Queue: GeneratedImage[];
  resultsPhase3: GeneratedImage[];
  setResultsPhase3: React.Dispatch<React.SetStateAction<GeneratedImage[]>>;
  removeFromP3Queue: (id: string) => void;
  onLocalImport: (file: File) => void;
  onInspirationChange: (dataUri: string) => void;
  // V5.XVII.K.2：forceRefresh=true 时旁路 ai-python DNA Redis 缓存，强制重新调 Gemini
  onExtractDNA: (forceRefresh?: boolean) => void;
  onBatchRender: () => void;
  isAnalyzing: boolean;
  isRendering: boolean;
  sectionRef: React.RefObject<HTMLDivElement>;
  onOpenModal?: (images: GeneratedImage[], index: number) => void;
  /** 当前控制面板的影调签名（styleDNA + intensity + grain + contrast + imageSize） */
  currentRenderSig?: string;
  /** 上次"一键复刻渲染"使用的影调签名；与 currentRenderSig 不同则允许在队列空时对结果库 originalUrl 再渲染 */
  lastRenderSig?: string | null;
}

export const Phase3: React.FC<Phase3Props> = ({
  p3Settings,
  setP3Settings,
  p3Queue,
  resultsPhase3,
  removeFromP3Queue,
  onLocalImport,
  onInspirationChange,
  onExtractDNA,
  onBatchRender,
  isAnalyzing,
  isRendering,
  sectionRef,
  onOpenModal,
  currentRenderSig,
  lastRenderSig,
}) => {
  const localImportRef = useRef<HTMLInputElement>(null);
  const inspirationInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [hoveredCompareId, setHoveredCompareId] = useState<string | null>(null);

  // V5.XVII.G：灵感图改走上传换短链；后端 decode_image_to_inline 同样能解析短链字节，
  // 但请求体（DNA 提取 / chat / inspire 都会带它）从几百 KB base64 → 几十字节短链。
  const handleInspirationFile = async (file: File) => {
    try {
      const [shortUrl] = await uploadFilesToGcs([file], 'phase3');
      if (!shortUrl) {
        alert('灵感图上传失败：返回了空 URL');
        return;
      }
      onInspirationChange(shortUrl);
    } catch (err) {
      console.error('[Phase3] inspiration upload failed:', err);
      alert('灵感图上传失败，请检查网络或稍后重试');
    }
  };

  const dnaTags = p3Settings.styleDNA
    ? p3Settings.styleDNA.split(',').map(t => t.trim()).filter(Boolean)
    : [];

  return (
    <section ref={sectionRef} className="w-full space-y-12">
      {/* 头部：参照 Phase2 结构，大徽章 + h1 标题 + slate-500 副标题 */}
      <div className="flex items-center gap-4">
        <span className="flex items-center justify-center w-12 h-12 rounded-2xl bg-rose-600 text-white font-bold text-2xl shadow-lg shadow-rose-100">3</span>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">影调大师</h1>
          <p className="text-slate-500">上传参考图生成影调笔记</p>
        </div>
      </div>

      {/* 4 大部分：① 待处理底片  ② 视觉DNA提取  ③ 控制面板  ④ 影调成品库 */}
      <div className="flex flex-col gap-8">

        {/* ① 待处理底片 */}
        <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm flex flex-col">
          <div className="flex items-center justify-between mb-4 shrink-0">
            <h3 className="font-bold text-slate-700 text-lg">待处理底片</h3>
            <div className="flex items-center gap-2">
              {p3Queue.length > 0 && (
                <span className="bg-rose-600 text-white text-xs font-black rounded-full px-2 py-0.5">{p3Queue.length}</span>
              )}
              <button
                onClick={() => localImportRef.current?.click()}
                className="text-xs font-black text-rose-600 hover:text-rose-700 border border-rose-200 hover:border-rose-400 px-2 py-1 rounded-lg transition-colors"
              >+ 导入底片</button>
            </div>
          </div>
          <input
            ref={localImportRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={e => {
              const files = Array.from(e.target.files ?? []);
              files.forEach(f => onLocalImport(f));
              e.target.value = '';
            }}
          />
          <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
            {p3Queue.map(img => (
              <div key={img.id} className="relative group aspect-[3/4]">
                <img src={toProxiedSrc(img.url)} onError={makeImgErrorFallback()} alt="" className="w-full h-full object-cover rounded-lg border border-slate-200" />
                <button
                  onClick={() => removeFromP3Queue(img.id)}
                  className="absolute top-1 right-1 w-5 h-5 bg-black/60 text-white rounded-full text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >×</button>
              </div>
            ))}
            {/* Phase2 风格的点击上传卡片（始终末尾） */}
            <button
              type="button"
              onClick={() => localImportRef.current?.click()}
              className="group/box relative rounded-xl border-2 border-dashed transition-all flex flex-col items-center justify-center outline-none ring-offset-2 focus-within:ring-2 focus-within:ring-rose-500 aspect-[3/4] border-slate-200 bg-slate-50/30 hover:border-rose-300 hover:bg-rose-50/30 cursor-pointer"
            >
              <span className="text-2xl text-slate-300 group-hover/box:text-rose-400 transition-colors">+</span>
              <span className="text-[10px] font-black text-slate-400 group-hover/box:text-rose-500 mt-1 transition-colors">点击上传</span>
              <span className="text-[9px] text-slate-300 mt-0.5">支持多选</span>
            </button>
          </div>
          {p3Queue.length === 0 && (
            <p className="text-[11px] text-slate-400 text-center mt-3">从阶段 2 点击「送往影调精修」，或点击上方「+」上传本地底片</p>
          )}
        </div>

        {/* ② 视觉DNA提取（左 1 : 右 2 比例） */}
        <div
          className={`bg-white p-6 rounded-[2rem] border shadow-sm flex flex-col transition-colors ${isDragOver ? 'border-rose-400' : 'border-slate-200'}`}
          onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={e => {
            e.preventDefault();
            setIsDragOver(false);
            const file = e.dataTransfer.files[0];
            if (file?.type.startsWith('image/')) handleInspirationFile(file);
          }}
          onPaste={e => {
            const items = Array.from(e.clipboardData.items) as DataTransferItem[];
            const item = items.find(i => i.kind === 'file' && i.type.startsWith('image/'));
            if (item) { const f = item.getAsFile(); if (f) handleInspirationFile(f); }
          }}
          tabIndex={0}
        >
          <div className="flex items-center justify-between mb-4 shrink-0">
            <h3 className="font-bold text-slate-700 text-lg">视觉DNA提取</h3>
            <span className="bg-rose-500/10 text-rose-500 text-xs font-black px-3 py-1 rounded-full">PRO级影调引擎</span>
          </div>
          <input
            ref={inspirationInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={e => { if (e.target.files?.[0]) { handleInspirationFile(e.target.files[0]); e.target.value = ''; } }}
          />

          {/* 左 1 : 右 2 比例（md 以上）；移动端单列 */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">

            {/* 左：上传灵感参考图（占 1 列） */}
            <div className="md:col-span-1 flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-black text-rose-600 bg-rose-50 px-2 py-0.5 rounded">01</span>
                <span className="text-sm font-black text-slate-700">灵感参考图</span>
              </div>
              {/* 固定 270×365 — 与 Phase1/Phase2 单张出图卡同尺寸 */}
              {p3Settings.inspirationImage ? (
                <div className="group/insp relative w-[270px] h-[365px] max-w-full rounded-2xl border border-slate-200 bg-slate-50 overflow-hidden">
                  <img src={p3Settings.inspirationImage} alt="灵感参考" className="w-full h-full object-cover" />
                  {/* 叉叉：移除当前参考图后即可重新上传 */}
                  <button
                    onClick={() => { onInspirationChange(''); setP3Settings(prev => ({ ...prev, inspirationImage: undefined, styleDNA: '', dnaTranslation: undefined })); }}
                    title="移除参考图，重新上传"
                    className="absolute top-2 right-2 p-1.5 bg-black/50 hover:bg-rose-500 text-white rounded-full shadow-lg backdrop-blur-sm opacity-0 group-hover/insp:opacity-100 transition-all"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
              ) : (
                <div
                  className="w-[270px] h-[365px] max-w-full flex flex-col items-center justify-center text-slate-400 text-sm gap-2 cursor-pointer border border-dashed border-slate-300 rounded-2xl hover:border-rose-300 hover:bg-rose-50/30 transition-colors"
                  onClick={() => inspirationInputRef.current?.click()}
                >
                  <span className="text-3xl">🎨</span>
                  <span>点击上传 / 拖拽 / 粘贴</span>
                  <span className="text-xs">上传后点「提取 DNA」</span>
                </div>
              )}
              <button
                disabled={!p3Settings.inspirationImage || isAnalyzing}
                onClick={() => onExtractDNA(false)}
                className="w-[270px] max-w-full py-2.5 rounded-xl bg-rose-600 text-white text-sm font-black disabled:opacity-40 disabled:cursor-not-allowed hover:bg-rose-700 transition-colors"
              >
                {isAnalyzing ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="inline-block w-3 h-3 border-2 border-rose-200 border-t-rose-100 rounded-full animate-spin" />
                    AI 正在解析中...
                  </span>
                ) : '提取 DNA'}
              </button>
            </div>

            {/* 右：视觉DNA解析（占 2 列） */}
            <div className="md:col-span-2 flex flex-col gap-3 min-h-full">
              <div className="flex items-center gap-2">
                <span className="text-xs font-black text-rose-600 bg-rose-50 px-2 py-0.5 rounded">02</span>
                <span className="text-sm font-black text-slate-700">视觉DNA解析</span>
                {dnaTags.length > 0 && (
                  <>
                    <span className="ml-auto text-[10px] text-slate-400">共 {dnaTags.length} 个核心词条</span>
                    {/* V5.XVII.K.2：旁路 Redis DNA 缓存，强制重新跑一次 Gemini */}
                    <button
                      type="button"
                      disabled={!p3Settings.inspirationImage || isAnalyzing}
                      onClick={() => onExtractDNA(true)}
                      title="不命中缓存，强制让 AI 重新分析灵感图"
                      className="text-[10px] text-rose-600 hover:text-rose-700 underline disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      重新提取
                    </button>
                  </>
                )}
              </div>
              {(p3Settings.styleDNA || p3Settings.dnaTranslation) ? (
                <div className="flex flex-col gap-4">
                  {/* Tag cloud — 间距拉开 */}
                  {dnaTags.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {dnaTags.map((tag, i) => (
                        <span
                          key={i}
                          className="bg-white border border-rose-200 text-rose-600 text-[11px] font-black rounded-lg shadow-sm uppercase tracking-tight px-3 py-1.5 whitespace-nowrap"
                        >{tag}</span>
                      ))}
                    </div>
                  )}
                  {/* 4-dimension card — 排布整齐 */}
                  {p3Settings.dnaTranslation && (
                    <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 flex flex-col gap-3">
                      <div className="text-[11px] font-black text-slate-500 mb-1 tracking-wider uppercase">品牌影调笔记</div>
                      {(['color', 'lighting', 'texture', 'mood'] as const).map(dim => {
                        const label = dim === 'color' ? '色彩' : dim === 'lighting' ? '光影' : dim === 'texture' ? '质感' : '影调';
                        const value = p3Settings.dnaTranslation![dim] || '—';
                        return (
                          <div key={dim} className="flex gap-3 items-start">
                            <span className="font-black text-rose-600 w-12 shrink-0 text-sm">{label}</span>
                            <span className="text-slate-700 font-medium leading-relaxed text-sm flex-1">{value}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex-1 min-h-[200px] flex items-center justify-center text-xs text-slate-400 italic border border-dashed border-slate-200 rounded-2xl">
                  {p3Settings.inspirationImage ? '点击左侧「提取 DNA」开始解析' : '先上传灵感参考图'}
                </div>
              )}
            </div>

          </div>
        </div>

        {/* ③ 控制面板（独立部分，介于 DNA 与 成品库 之间） */}
        <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm flex flex-col">
          <div className="flex items-center justify-between mb-4 shrink-0">
            <h3 className="font-bold text-slate-700 text-lg">控制面板</h3>
            <span className="text-[11px] text-slate-400">渲染参数 · 影响整批底片</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {/* 画质 */}
            <div>
              <div className="text-xs font-black text-slate-500 mb-2">画质</div>
              <div className="flex gap-3">
                {(['1K', '2K', '4K'] as const).map(q => (
                  <label key={q} className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="p3Quality"
                      checked={p3Settings.imageSize === q}
                      onChange={() => setP3Settings(prev => ({ ...prev, imageSize: q as any }))}
                      className="accent-rose-600"
                    />
                    <span className="text-xs font-black text-slate-600">{q}</span>
                  </label>
                ))}
              </div>
              {p3Settings.imageSize === '4K' && (
                <p className="text-[10px] text-slate-400 mt-1">4K 出图较慢，约 30-60 秒</p>
              )}
            </div>

            {/* V5.XVII.F：影调浓度改为 5 档（20% / 40% / 60% / 80% / 100%）
                每档对应后端 build_phase3_prompt 的 T1..T5 tier 描述；档与档之间是
                "色调逐档加深"的递进，服装本色（surface albedo）始终锁定不变。 */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-black text-slate-500">影调浓度</span>
                <span className="text-xs font-black text-rose-600">{Math.round(p3Settings.intensity * 100)}%</span>
              </div>
              <div className="grid grid-cols-5 gap-1.5">
                {([
                  { label: '20%', val: 0.2, desc: 'T1 微染：仅高光阴影边缘轻染调，保留 ~80% 原貌' },
                  { label: '40%', val: 0.4, desc: 'T2 轻调：胶片色温淡入，整体仍接近原貌' },
                  { label: '60%', val: 0.6, desc: 'T3 平衡：电影感 LUT 风味明确，色调统一' },
                  { label: '80%', val: 0.8, desc: 'T4 加深：显著电影质感，色调浓郁' },
                  { label: '100%', val: 1.0, desc: 'T5 极深：全量胶片质感，整体色调最浓郁' },
                ] as const).map(opt => {
                  const active = Math.abs(p3Settings.intensity - opt.val) < 0.05;
                  return (
                    <button
                      key={opt.label}
                      type="button"
                      onClick={() => setP3Settings(prev => ({ ...prev, intensity: opt.val }))}
                      className={`px-1.5 py-2 rounded-xl text-[11px] font-black border transition-all ${
                        active
                          ? 'bg-rose-600 text-white border-rose-600 shadow-md shadow-rose-100'
                          : 'bg-white text-slate-600 border-slate-200 hover:border-rose-300 hover:text-rose-600'
                      }`}
                      title={opt.desc}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] text-slate-400 mt-1">5 档递进色调加深；服装本色（红仍红 / 白仍白）始终锁定</p>
            </div>

            {/* 颗粒感 + 对比度 */}
            <div>
              <div className="text-xs font-black text-slate-500 mb-2">效果</div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={p3Settings.grain}
                    onChange={e => setP3Settings(prev => ({ ...prev, grain: e.target.checked }))}
                    className="accent-rose-600"
                  />
                  <span className="text-xs font-black text-slate-600">颗粒感</span>
                </label>
                <select
                  value={p3Settings.contrast}
                  onChange={e => setP3Settings(prev => ({ ...prev, contrast: e.target.value as 'Low' | 'Standard' | 'High' }))}
                  className="text-xs border border-slate-200 rounded-lg px-2 py-1 bg-white text-slate-600"
                >
                  <option value="Low">对比度: 低</option>
                  <option value="Standard">对比度: 标准</option>
                  <option value="High">对比度: 高</option>
                </select>
              </div>
            </div>
          </div>

          {/* 补充描述（高优先级 P0，覆盖默认调色倾向；类比达芬奇调色板的导演说明） */}
          <div className="mt-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-black text-slate-500">补充描述 <span className="text-rose-600 ml-1">P0 高优先级</span></span>
              <span className="text-[10px] text-slate-400">{(p3Settings.remark || '').length}/200</span>
            </div>
            <textarea
              value={p3Settings.remark || ''}
              maxLength={200}
              onChange={e => setP3Settings(prev => ({ ...prev, remark: e.target.value }))}
              placeholder="例：偏冷青调、降低高光、夕阳暖光氛围、保留服装本色不要染色"
              className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2 bg-slate-50/50 focus:bg-white focus:border-rose-400 focus:ring-2 focus:ring-rose-100 outline-none transition-all resize-none"
              rows={2}
            />
            <p className="text-[10px] text-slate-400 mt-1">类似达芬奇调色板的导演说明，仅作用于整体色调/光影/氛围；服装、模特、构图保持完全锁定。</p>
          </div>

          {/* V5.XVI.16：主产品服装属性槽（继承自 Phase1/2，可继续编辑） */}
          <div className="mt-5">
            <GarmentAttrsForm
              value={p3Settings.garmentAttrs?.[0]}
              onChange={(v: GarmentAttrs) => setP3Settings(prev => {
                const arr = [...(prev.garmentAttrs ?? [])];
                arr[0] = v;
                return { ...prev, garmentAttrs: arr };
              })}
              compact
            />
          </div>

          {/* 一键复刻渲染按钮：① 队列非空 → 渲染队列；② 队列空但控制面板与上次渲染签名不同 → 用结果库 originalUrl 重渲染 */}
          {(() => {
            const reRenderCount = resultsPhase3.filter(i => i.status === 'done' && i.originalUrl).length;
            const settingsChanged =
              !!currentRenderSig && !!lastRenderSig && currentRenderSig !== lastRenderSig;
            const canReRender = p3Queue.length === 0 && reRenderCount > 0 && settingsChanged;
            const canRender = !!p3Settings.styleDNA && !isRendering && (p3Queue.length > 0 || canReRender);
            const isReRenderMode = p3Queue.length === 0 && canReRender;
            const renderCount = p3Queue.length > 0 ? p3Queue.length : reRenderCount;
            const labelBase = isReRenderMode ? '重新复刻渲染' : '一键复刻渲染';
            return (
              <>
                <button
                  disabled={!canRender}
                  onClick={onBatchRender}
                  className={`mt-5 w-full py-3 rounded-xl text-white text-sm font-black disabled:opacity-40 disabled:cursor-not-allowed transition-colors ${isReRenderMode ? 'bg-rose-600 hover:bg-rose-700' : 'bg-slate-700 hover:bg-slate-800'}`}
                >
                  {isRendering ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="inline-block w-3 h-3 border-2 border-slate-300 border-t-white rounded-full animate-spin" />
                      渲染中...
                    </span>
                  ) : `${labelBase}${renderCount > 0 ? ` (${renderCount})` : ''}`}
                </button>
                {!p3Settings.styleDNA && (
                  <p className="text-[11px] text-slate-400 text-center mt-2">需先在「视觉DNA提取」上传参考图并点击「提取 DNA」</p>
                )}
                {isReRenderMode && (
                  <p className="text-[11px] text-rose-500 text-center mt-2">检测到影调参数已变更，可对成品库 {reRenderCount} 张图重新渲染</p>
                )}
              </>
            );
          })()}
        </div>

        {/* ④ 影调成品库 */}
        <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm flex flex-col">
          <div className="flex items-center justify-between mb-4 shrink-0">
            <h3 className="font-bold text-slate-700 text-lg">影调成品库</h3>
            {resultsPhase3.length > 0 && (
              <span className="bg-rose-600 text-white text-xs font-black rounded-full px-2 py-0.5">{resultsPhase3.length}</span>
            )}
          </div>
          {resultsPhase3.length === 0 ? (
            <div className="h-40 flex items-center justify-center text-slate-400 text-sm border border-dashed border-slate-200 rounded-2xl">
              <span>影调精修结果将展示在此</span>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
                {resultsPhase3.map(img => {
                  const doneImgs = resultsPhase3.filter(i => i.status === 'done');
                  return (
                    <div
                      key={img.id}
                      className={`relative group aspect-[3/4] ${img.status === 'done' ? 'cursor-zoom-in' : ''}`}
                      onMouseEnter={() => img.originalUrl && img.status === 'done' && setHoveredCompareId(img.id)}
                      onMouseLeave={() => setHoveredCompareId(null)}
                      onClick={() => {
                        if (img.status === 'done') {
                          const idx = doneImgs.findIndex(i => i.id === img.id);
                          onOpenModal?.(doneImgs, idx);
                        }
                      }}
                    >
                      {img.status === 'pending' ? (
                        <div className="w-full h-full rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center">
                          <span className="inline-block w-5 h-5 border-2 border-rose-200 border-t-rose-600 rounded-full animate-spin" />
                        </div>
                      ) : img.status === 'error' ? (
                        <div className="w-full h-full rounded-xl bg-red-50 border border-red-100 flex items-center justify-center text-[9px] text-red-500 p-1 text-center">{img.errorMessage || '失败'}</div>
                      ) : (
                        <div className="relative w-full h-full">
                          <img src={toProxiedSrc(img.url)} onError={makeImgErrorFallback()} alt="" className="absolute inset-0 w-full h-full object-cover rounded-xl border border-slate-200" />
                          {img.originalUrl && (
                            <img
                              src={toProxiedSrc(img.originalUrl)}
                              onError={makeImgErrorFallback()}
                              alt="原图对比"
                              className={`absolute inset-0 w-full h-full object-cover rounded-xl border border-slate-200 transition-opacity duration-300 ${hoveredCompareId === img.id ? 'opacity-100' : 'opacity-0'}`}
                            />
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {resultsPhase3.some(i => i.originalUrl) && (
                <p className="text-[10px] text-slate-400 mt-3 text-center">悬停查看渲染前对比 · 点击放大可长按看对比原图</p>
              )}
            </>
          )}
        </div>

      </div>
    </section>
  );
};
