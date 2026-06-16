/**
 * Phase2.tsx — Phase 2 生活化延展与精修组件
 */
import React, { useRef, useState, useEffect, useMemo } from 'react';
import { Phase2Settings, GeneratedImage, ImageSize, ResolvedCompositionIntent, CompositionScope } from '../types';
import type { GarmentAttrs } from '../types';
import GarmentAttrsForm from './GarmentAttrsForm';
import { ACTIONS, EXPRESSIONS, FOCUS_OPTIONS, FLAT_LAY_OPTIONS, LIGHTING_OPTIONS, ASPECT_RATIOS, IMAGE_SIZES, FABRIC_DETAILS, LIFESTYLE_DETAILS, COMPOSITION_SCOPES, getCompositionTargets } from '../constants';
import { toProxiedSrc, makeImgErrorFallback } from '../services/shared/imageSrc';
import { inferCompositionFromText, mergeInferredComposition, resolveCompositionIntent } from '../services/shared/compositionIntent';
import { generateSinglePhase2Image, VARIATION_HINTS, DETAIL_VARIATION_HINTS } from '../services/geminiService';
import { uploadFilesToGcs } from '../services/uploadService';
import { auditService } from '../services/auditService';
import { ImageTagger } from './ImageTagger';

interface Phase2Props {
  settings: Phase2Settings; setSettings: React.Dispatch<React.SetStateAction<Phase2Settings>>;
  results: GeneratedImage[]; setResults: React.Dispatch<React.SetStateAction<GeneratedImage[]>>;
  toggleAction: (val: string) => void;
  handleFabricDetailChange: (val: string) => void;
  handleDetailFocusChange: (val: string) => void;
  setAssetPreviewUrl: (url: string) => void;
  setKeyReady: (ready: boolean) => void;
  getFriendlyError: (error: any) => string;
  renderImageItem: (img: GeneratedImage, index: number, phase: 0 | 1 | 2) => React.ReactNode;
  renderScaleMarks: () => React.ReactNode;
  sectionRef: React.RefObject<HTMLDivElement | null>;
  resultsRef: React.RefObject<HTMLDivElement | null>;
  lastCompositionIntent?: ResolvedCompositionIntent | null;
  setLastCompositionIntent?: React.Dispatch<React.SetStateAction<ResolvedCompositionIntent | null>>;
}

export const Phase2: React.FC<Phase2Props> = ({
  settings, setSettings, results, setResults, toggleAction, handleFabricDetailChange, handleDetailFocusChange, setAssetPreviewUrl,
  setKeyReady, getFriendlyError, renderImageItem, renderScaleMarks, sectionRef, resultsRef,
  lastCompositionIntent: _lastCompositionIntent, setLastCompositionIntent: _setLastCompositionIntent,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const poseRefInputRef = useRef<HTMLInputElement>(null);
  const [poseRefUrl, setPoseRefUrl] = useState<string | null>(null);
  const [poseRefUploading, setPoseRefUploading] = useState(false);
  const [baseUploadsInProgress, setBaseUploadsInProgress] = useState(0);
  const isFabricActive = !!settings.fabricDetail;
  const isLifestyleActive = !!settings.detailFocus;
  const isFlatLayActive = !!settings.flatLayDetail;
  // 任一特写/模式激活 → 生成姿态（01）与之互斥；用户只能选择一种模式
  const isDetailModeActive = isFabricActive || isLifestyleActive || isFlatLayActive;
  // V5.XI-3.2：撤销 V5.XI-2.6 的"构图 ↔ ACTIONS 互斥"。两者允许同时选；
  // 用 isCompositionActive 仅用于"构图优先"非阻塞提示，不再禁用任何控件。
  const isCompositionActive =
    (settings.compositionScope !== 'inherit' && settings.compositionScope !== '') ||
    settings.compositionTarget.trim() !== '';
  const showCompositionOverrideHint = isCompositionActive && settings.actions.length > 0;
  // V5.XI-3.4：批量组数 = 每姿态生成张数（用户拖动 count slider 控制）；
  // 总图数 = actions.length > 0 ? actions.length × count : count；
  // count slider 始终启用，特写模式下也走 count 张（每模式 N 张）。
  const p2BatchCount = settings.count;
  const p2TotalImages = isDetailModeActive
    ? p2BatchCount
    : settings.actions.length > 0
      ? settings.actions.length * p2BatchCount
      : p2BatchCount;
  const isP2HighVolume = p2TotalImages > 16;
  const hasSelectedImages = settings.selectedBaseImages.length > 0;

  const handleExclusiveMode = (mode: 'fabric' | 'lifestyle' | 'flatLay', value: string) => {
    setSettings(prev => {
      const next = { ...prev };
      if (mode === 'fabric') {
        next.fabricDetail = value;
        if (value) {
          next.detailFocus = ""; next.flatLayDetail = ""; next.actions = []; next.focus = FOCUS_OPTIONS[1].value;
          next.compositionScope = 'macro';
        } else {
          if (prev.compositionScope === 'macro') next.compositionScope = 'inherit';
        }
      } else if (mode === 'lifestyle') {
        next.detailFocus = value;
        if (value) {
          next.fabricDetail = ""; next.flatLayDetail = ""; next.actions = [];
          const isUpper = LIFESTYLE_DETAILS[0].options.some(o => o.value === value);
          const isAccessory = LIFESTYLE_DETAILS[1].options.some(o => o.value === value);
          const isLower = LIFESTYLE_DETAILS[2].options.some(o => o.value === value);
          if (isUpper || isAccessory) next.focus = FOCUS_OPTIONS[1].value;
          else if (isLower) next.focus = FOCUS_OPTIONS[2].value;
          next.compositionScope = 'detail';
        } else {
          if (prev.compositionScope === 'detail') next.compositionScope = 'inherit';
        }
      } else if (mode === 'flatLay') {
        next.flatLayDetail = value;
        if (value) {
          next.fabricDetail = ""; next.detailFocus = ""; next.actions = []; next.focus = "Industrial Top-Down";
          next.compositionScope = 'detail';
        } else {
          if (prev.compositionScope === 'detail') next.compositionScope = 'inherit';
        }
      }
      return next;
    });
  };

  // 参考图标签：与 selectedBaseImages 一一对应，空串 = 走后端默认 label。
  // 不持久化到 settings（避免 Phase2Settings 污染），保留在 Phase2 局部 state。
  const [baseLabels, setBaseLabels] = useState<string[]>([]);
  // 保证 baseLabels.length === selectedBaseImages.length。
  // processFiles 会主动填默认；这个 effect 负责兜底（例如从 Workspace 选历史图加入 selectedBaseImages 时，
  // 没走 processFiles，本地 baseLabels 需要补齐默认标签）。
  useEffect(() => {
    setBaseLabels(prev => {
      const n = settings.selectedBaseImages.length;
      if (prev.length === n) return prev;
      const next = [...prev];
      while (next.length < n) next.push(`参考图 #${next.length + 1}`);
      next.length = n;
      return next;
    });
  }, [settings.selectedBaseImages.length]);

  /**
   * Phase2 默认标签（#41.5 起中文）。selectedBaseImages 是"过去生成的图 / 自定义参考图"，
   * 没有固定语义槽位，用"参考图 #N"序号帮模型区分不同参考；用户可改为"姿态参考"/"光影参考"之类。
   */
  const getDefaultLabel = (index: number): string => `参考图 #${index + 1}`;

  // V5.XVII.E：把"File → base64 → 塞 selectedBaseImages"换成"File → 上传换短链 → 塞短链"。
  // 避免 selectedBaseImages 里出现多 MB base64，导致后续 phase2/generate body 爆炸断连。
  const processFiles = async (files: File[]) => {
    if (files.length === 0) return;
    // 立即生成 blob URL 作为占位预览，用户粘贴后无感知延迟
    const blobUrls = files.map(f => URL.createObjectURL(f));
    setSettings(prev => ({ ...prev, selectedBaseImages: [...prev.selectedBaseImages, ...blobUrls] }));
    setBaseLabels(prev => {
      const next = [...prev];
      const startIdx = next.length;
      for (let i = 0; i < files.length; i++) next.push(getDefaultLabel(startIdx + i));
      return next;
    });
    setBaseUploadsInProgress(prev => prev + files.length);
    // 后台上传 GCS，完成后把 blob URL 替换为真实短链
    try {
      const shortUrls = await uploadFilesToGcs(files, 'upload');
      setSettings(prev => {
        const imgs = [...prev.selectedBaseImages];
        blobUrls.forEach((blob, i) => {
          const idx = imgs.indexOf(blob);
          if (idx !== -1) imgs[idx] = shortUrls[i];
          URL.revokeObjectURL(blob);
        });
        return { ...prev, selectedBaseImages: imgs };
      });
    } catch (err) {
      console.error("Failed to upload reference images:", err);
      setSettings(prev => ({ ...prev, selectedBaseImages: prev.selectedBaseImages.filter(u => !blobUrls.includes(u)) }));
      setBaseLabels(prev => prev.slice(0, prev.length - blobUrls.length));
      blobUrls.forEach(u => URL.revokeObjectURL(u));
      alert("参考图上传失败，请检查网络或稍后重试");
    } finally {
      setBaseUploadsInProgress(prev => prev - files.length);
    }
  };
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => { if (e.target.files && e.target.files.length > 0) { await processFiles(Array.from(e.target.files)); e.target.value = ''; } };
  const handlePaste = async (e: React.ClipboardEvent) => { const items = e.clipboardData.items; const files: File[] = []; for (let i = 0; i < items.length; i++) { if (items[i].type.indexOf('image') !== -1) { const file = items[i].getAsFile(); if (file) files.push(file); } } if (files.length > 0) { e.preventDefault(); await processFiles(files); } };

  const handlePoseRefUpload = async (files: File[]) => {
    if (files.length === 0) return;
    const file = files[0];
    const blobUrl = URL.createObjectURL(file);
    setPoseRefUrl(blobUrl);
    setPoseRefUploading(true);
    try {
      const shortUrls = await uploadFilesToGcs([file], 'upload');
      URL.revokeObjectURL(blobUrl);
      setPoseRefUrl(shortUrls[0]);
    } catch (err) {
      console.error('[Phase2] pose ref upload failed:', err);
      URL.revokeObjectURL(blobUrl);
      setPoseRefUrl(null);
      alert('参考图上传失败，请检查网络或稍后重试');
    } finally {
      setPoseRefUploading(false);
    }
  };

  useEffect(() => {
    if (poseRefUrl && !settings.actions.includes('__pose_ref__') && !isDetailModeActive) {
      setSettings(prev => ({ ...prev, actions: [...prev.actions, '__pose_ref__'] }));
    } else if (!poseRefUrl && settings.actions.includes('__pose_ref__')) {
      setSettings(prev => ({ ...prev, actions: prev.actions.filter(a => a !== '__pose_ref__') }));
    }
  }, [poseRefUrl]);

  const [generatingIds] = useState(new Set<string>());
  React.useEffect(() => { const pending = results.filter(img => img.status === 'pending' && !generatingIds.has(img.id)); if (pending.length > 0) { pending.forEach(img => { generatingIds.add(img.id); generateImage(img); }); } }, [results]);

  const generateImage = async (placeholder: GeneratedImage) => {
    try {
      const isPoseRef = placeholder.promptUsed === 'POSE_REF';
      // poseRef 上传未完成时（blob URL 或 poseRefUploading），降级为 Refined，
      // 避免 POSE_REF_IMAGE 指令下没有对应参考图导致后端 prompt 语义混乱。
      const poseRefReady = isPoseRef && !!poseRefUrl && !poseRefUploading && !poseRefUrl.startsWith('blob:');
      const action = poseRefReady ? 'POSE_REF_IMAGE' : isPoseRef ? 'Refined' : placeholder.promptUsed;
      // 安全过滤：blob URL 是上传中的占位，不能传给后端
      const baseParts: string[] = [];
      const labels: string[] = [];
      settings.selectedBaseImages.forEach((url, i) => {
        if (!url.startsWith('blob:')) {
          baseParts.push(url);
          labels.push(baseLabels[i] || '');
        }
      });
      if (poseRefReady) {
        baseParts.push(poseRefUrl!);
        labels.push('动作参考');
      }
      // Resolve inherit → real scope before sending to backend
      const resolved = resolveCompositionIntent(
        { scope: settings.compositionScope, target: settings.compositionTarget },
        _lastCompositionIntent ?? null,
      );
      const resolvedSettings = { ...settings, compositionScope: resolved.scope, compositionTarget: resolved.target };
      // Compute variation meta
      const batchPeers = results.filter(img => img.taskId === placeholder.taskId);
      const variationIndex = batchPeers.findIndex(img => img.id === placeholder.id);
      // V5.XI-2.5：实际批量数（actions 多选时 = actions.length；其它情况 = count），
      // 直接读 batchPeers.length 避免和 p2TotalImages 计算重复。
      const variationTotal = batchPeers.length || settings.count;
      const isDetailMode = !!(settings.fabricDetail || settings.detailFocus || settings.flatLayDetail);
      const hints = isDetailMode ? DETAIL_VARIATION_HINTS : VARIATION_HINTS;
      const variationHint = variationTotal > 1 ? hints[variationIndex % hints.length] : '';
      const result = await generateSinglePhase2Image(baseParts, action, resolvedSettings, labels, { variationIndex, variationTotal, variationHint });
      const compositionSummary = resolved.target ? `${resolved.scope} · ${resolved.target}` : resolved.scope;
      setResults(prev => prev.map(img => img.id === placeholder.id ? { ...img, url: result.url, actionLabel: result.actionLabel, compositionSummary, status: 'done' } : img));
      if (result.url) {
        _setLastCompositionIntent?.(resolved);
        auditService.logGeneration('Phase2', `Generated image with action: ${result.actionLabel}`);
      }
    } catch (error: any) {
      console.error("Phase 2 Generation Error:", error);
      setResults(prev => prev.map(img => img.id === placeholder.id ? { ...img, status: 'error', errorMessage: getFriendlyError(error) } : img));
      if (error.message.includes("API_KEY_INVALID")) setKeyReady(false);
    } finally { generatingIds.delete(placeholder.id); }
  };

  const handleGenerate = async () => {
    if (settings.selectedBaseImages.length === 0) { alert("请先选择或上传参考图"); return; }
    if (baseUploadsInProgress > 0) { alert("参考图正在上传中，请稍候再试"); return; }
    if (poseRefUploading) { alert("动作参考图正在上传中，请稍候再试"); return; }
    const taskId = `task-p2-${Date.now()}`;
    const jobs: { action: string, index: number, id: string }[] = [];
    if (isDetailModeActive) {
      const detailAction = isFabricActive ? 'DETAIL_FABRIC' : isLifestyleActive ? 'DETAIL_LIFESTYLE' : 'DETAIL_FLATLAY';
      for (let i = 0; i < settings.count; i++) {
        jobs.push({ action: detailAction, index: i, id: `${taskId}-${detailAction}-${i}` });
      }
    } else {
      // V5.XI-3.4：actions × count 嵌套乘法。外层遍历每个选中的姿态，
      // 内层 count 次循环每个姿态各生成 count 张（用户拖 slider 控制）。
      // 未选 action 时回落到 count 张 'Maintain original pose'。
      if (settings.actions.length > 0) {
        let flatIdx = 0;
        settings.actions.forEach((action) => {
          const jobAction = action === '__pose_ref__' ? 'POSE_REF' : action;
          for (let i = 0; i < settings.count; i++) {
            jobs.push({ action: jobAction, index: flatIdx, id: `${taskId}-pose-${flatIdx}` });
            flatIdx += 1;
          }
        });
      } else {
        for (let i = 0; i < settings.count; i++) {
          jobs.push({ action: 'Maintain original pose', index: i, id: `${taskId}-pose-${i}` });
        }
      }
    }
    const currentMaxTaskNumber = results.reduce((max, img) => Math.max(max, img.taskNumber || 0), 0);
    const nextTaskNumber = currentMaxTaskNumber + 1;
    const placeholders: GeneratedImage[] = jobs.map((job) => ({ id: job.id, taskId, taskNumber: nextTaskNumber, url: '', actionLabel: '渲染中', promptUsed: job.action, aspectRatio: settings.aspectRatio, phase: 2, status: 'pending' }));
    setResults(prev => [...placeholders, ...prev]);
    setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  };

  const renderBlinkingMode = (active: boolean, text: string) => { if (!active) return null; return (<span className="ml-2 inline-flex items-center gap-1.5 text-[10px] font-black text-purple-600 animate-[pulse_2s_infinite]"><span className="w-1.5 h-1.5 rounded-full bg-purple-600"></span>{text}</span>); };

  const compositionTargets = useMemo(
    () => getCompositionTargets(settings.compositionScope),
    [settings.compositionScope]
  );
  const isCustomTarget = settings.compositionTarget !== '' && !compositionTargets.some(t => t.value === settings.compositionTarget);

  return (
    <section ref={sectionRef} className="mt-24 space-y-12">
      <div className="flex items-center gap-4">
        <span className="flex items-center justify-center w-12 h-12 rounded-2xl bg-purple-600 text-white font-bold text-2xl shadow-lg shadow-purple-100">2</span>
        <div><h1 className="text-3xl font-bold tracking-tight">生活化延展与精修</h1><p className="text-slate-500">基于多图参考进行动作与光影微调，产出商业成品</p></div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
        <div className="lg:col-span-4 flex flex-col">
          <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm sticky top-24 h-fit max-h-[80vh] overflow-hidden flex flex-col">
            <h3 className="font-bold mb-4 text-slate-700 text-lg shrink-0">参考资产</h3>
            <div className="flex-grow overflow-y-auto custom-scrollbar pr-2 pl-1 pt-1 pb-4 outline-none rounded-2xl" onPaste={handlePaste}>
              {/* V5.XVI.16：主产品服装属性槽（继承自 Phase1，可继续编辑） */}
              <GarmentAttrsForm
                value={settings.garmentAttrs?.[0]}
                onChange={(v: GarmentAttrs) => setSettings(prev => {
                  const arr = [...(prev.garmentAttrs ?? [])];
                  arr[0] = v;
                  return { ...prev, garmentAttrs: arr };
                })}
                compact
              />
              <input type="file" ref={fileInputRef} className="hidden" accept="image/*" multiple onChange={handleFileChange} />
              <div className="grid grid-cols-2 gap-2">
                {settings.selectedBaseImages.map((url, idx) => (
                  <div key={idx} className="flex flex-col gap-1">
                    <div
                      className="relative rounded-xl overflow-hidden aspect-[3/4] bg-slate-50 border border-slate-100 group cursor-pointer"
                      onClick={() => setAssetPreviewUrl(url)}
                    >
                      <img src={toProxiedSrc(url)} onError={makeImgErrorFallback()} className="w-full h-full object-contain" alt="Base" />
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSettings({ ...settings, selectedBaseImages: settings.selectedBaseImages.filter((_, i) => i !== idx) });
                          setBaseLabels(prev => prev.filter((_, i) => i !== idx));
                        }}
                        className="absolute top-1 right-1 p-1 bg-black/50 text-white rounded-full hover:bg-red-500 transition-colors"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                      </button>
                    </div>
                    <ImageTagger
                      value={baseLabels[idx] || ''}
                      onChange={(v) => setBaseLabels(prev => {
                        const next = [...prev];
                        while (next.length <= idx) next.push('');
                        next[idx] = v;
                        return next;
                      })}
                    />
                  </div>
                ))}
                <div tabIndex={0} className={`group/box relative rounded-xl border-2 border-dashed transition-all flex flex-col items-center justify-center outline-none ring-offset-2 focus-within:ring-2 focus-within:ring-purple-500 ${!hasSelectedImages ? 'col-span-2 h-28 border-slate-200 bg-slate-50/50 hover:border-purple-300' : 'aspect-[3/4] border-slate-200 bg-slate-50/30 hover:border-purple-200'}`}>
                  <button onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }} className="flex flex-col items-center group/btn transition-all active:scale-95 px-2">
                    <div className="w-8 h-8 bg-white rounded-xl shadow-sm border border-slate-100 flex items-center justify-center mb-1.5 group-hover/btn:border-purple-300 group-hover/btn:text-purple-600 text-slate-400 transition-all"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4"></path></svg></div>
                    <p className="text-[10px] font-bold text-slate-500 group-hover/btn:text-purple-600 transition-colors">点击上传</p><p className="text-[8px] text-slate-400 font-medium leading-none mt-0.5">聚焦后粘贴</p>
                  </button>
                </div>
              </div>
              <div className="mt-3 space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">动作参考 (可选)</label>
                <input type="file" ref={poseRefInputRef} accept="image/*" className="hidden" onChange={(e) => { if (e.target.files?.[0]) handlePoseRefUpload(Array.from(e.target.files)); e.target.value = ''; }} />
                {poseRefUrl ? (
                  <div className="relative rounded-xl overflow-hidden border border-slate-100">
                    <img src={toProxiedSrc(poseRefUrl)} onError={makeImgErrorFallback()} className={`w-full h-auto block ${poseRefUploading ? 'opacity-50' : ''}`} alt="动作参考" />
                    {poseRefUploading && (
                      <div className="absolute inset-0 flex items-center justify-center bg-white/60">
                        <svg className="w-4 h-4 animate-spin text-purple-500" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
                        <span className="ml-1.5 text-[10px] font-bold text-purple-600">上传中…</span>
                      </div>
                    )}
                    {!poseRefUploading && (
                      <button onClick={() => setPoseRefUrl(null)} className="absolute top-1.5 right-1.5 p-1.5 bg-red-500 text-white rounded-lg shadow-xl hover:bg-red-600 transition-all">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12"></path></svg>
                      </button>
                    )}
                  </div>
                ) : (
                  <button onClick={() => poseRefInputRef.current?.click()} className="w-full h-20 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/50 hover:border-purple-300 flex flex-col items-center justify-center text-slate-400 hover:text-purple-600 transition-all">
                    <svg className="w-5 h-5 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>
                    <span className="text-[10px] font-bold">上传动作参考图</span>
                    <span className="text-[9px] mt-0.5">AI 将参考此图的姿态/动作</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="lg:col-span-8">
          <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm flex flex-col h-full relative overflow-hidden">
            <div className="p-8 pb-4 border-b border-slate-50 flex justify-between items-center"><h3 className="font-bold text-lg text-slate-800">精修配置</h3>{!hasSelectedImages && (<span className="px-3 py-1 bg-amber-50 text-amber-600 text-[10px] font-bold rounded-full border border-amber-200 animate-pulse">未选择/上传参考图</span>)}</div>
            <div className="flex-grow overflow-y-auto p-8 pt-6 space-y-8 custom-scrollbar">
              <div className="space-y-4">
                <label className="text-sm font-bold text-slate-700 flex items-center gap-2">
                  <span className="w-5 h-5 rounded-md bg-purple-50 text-purple-600 flex items-center justify-center text-[10px]">01</span>
                  <span className={isDetailModeActive ? 'text-slate-400' : ''}>生成姿态</span>
                  {isDetailModeActive && (
                    <span className="ml-2 inline-flex items-center gap-1.5 text-[10px] font-black text-amber-600 animate-[pulse_2s_infinite]">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                      已启用特写模式，姿态不可选（只可选一个模式）
                    </span>
                  )}
                </label>
                <div
                  className="grid grid-cols-2 sm:grid-cols-3 gap-3"
                  title={isDetailModeActive ? '当前已启用特写/模式，只可选一个模式；请先清除 02/03/04 选项再选姿态' : ''}
                >
                  {ACTIONS.map(action => {
                    const selected = settings.actions.includes(action.value);
                    const disabled = isDetailModeActive;
                    return (
                      <button
                        key={action.value}
                        onClick={() => toggleAction(action.value)}
                        disabled={disabled}
                        aria-disabled={disabled}
                        className={`px-4 py-3 rounded-2xl text-xs font-medium border transition-all ${
                          disabled
                            ? 'bg-slate-100 border-slate-100 text-slate-300 cursor-not-allowed opacity-60'
                            : selected
                              ? 'bg-purple-600 border-purple-600 text-white shadow-lg'
                              : 'bg-slate-50 border-transparent text-slate-600 hover:border-purple-200'
                        }`}
                      >
                        {action.label.split(' - ')[0]}
                      </button>
                    );
                  })}
                  {poseRefUrl && (
                    <button
                      onClick={() => toggleAction('__pose_ref__')}
                      disabled={isDetailModeActive}
                      aria-disabled={isDetailModeActive}
                      className={`px-4 py-3 rounded-2xl text-xs font-medium border transition-all flex items-center justify-center gap-1.5 ${
                        isDetailModeActive
                          ? 'bg-slate-100 border-slate-100 text-slate-300 cursor-not-allowed opacity-60'
                          : settings.actions.includes('__pose_ref__')
                            ? 'bg-purple-600 border-purple-600 text-white shadow-lg'
                            : 'bg-slate-50 border-purple-200 text-purple-700 hover:border-purple-400'
                      }`}
                    >
                      <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                      参考图姿态
                    </button>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6 border-t border-slate-50 pt-8">
                <div className="space-y-3"><label className="text-sm font-bold text-slate-700 flex items-center gap-2"><span className="w-5 h-5 rounded-md bg-purple-50 text-purple-600 flex items-center justify-center text-[10px]">02</span>面料与材质特写{renderBlinkingMode(isFabricActive, "● 纯面料模式已开启")}</label><select value={settings.fabricDetail} onChange={(e) => handleExclusiveMode('fabric', e.target.value)} className={`w-full bg-slate-50 border-none rounded-2xl p-4 focus:ring-2 focus:ring-purple-500 text-sm font-bold transition-all ${isFabricActive ? 'ring-2 ring-purple-100 text-purple-700' : 'text-slate-600'}`}><option value="">无特写</option>{FABRIC_DETAILS.map(o => (<option key={o.value} value={o.value}>{o.label}</option>))}</select></div>
                <div className="space-y-3"><label className="text-sm font-bold text-slate-700 flex items-center gap-2"><span className="w-5 h-5 rounded-md bg-purple-50 text-purple-600 flex items-center justify-center text-[10px]">03</span>生活化场景与交互{renderBlinkingMode(isLifestyleActive, "● 手部交互模式已开启")}</label><select value={settings.detailFocus} onChange={(e) => handleExclusiveMode('lifestyle', e.target.value)} className={`w-full bg-slate-50 border-none rounded-2xl p-4 focus:ring-2 focus:ring-purple-500 text-sm font-bold transition-all ${isLifestyleActive ? 'ring-2 ring-purple-100 text-purple-700' : 'text-slate-600'}`}><option value="">全景/无交互</option>{LIFESTYLE_DETAILS.map((group) => (<optgroup key={group.group} label={group.group}>{group.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</optgroup>))}</select></div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6 border-t border-slate-50 pt-8">
                <div className="space-y-3"><label className="text-sm font-bold text-slate-700 flex items-center gap-2"><span className="w-5 h-5 rounded-md bg-purple-50 text-purple-600 flex items-center justify-center text-[10px]">04</span>平铺细节特写{renderBlinkingMode(isFlatLayActive, "● 纯静物模式已开启")}</label><select value={settings.flatLayDetail || ""} onChange={(e) => handleExclusiveMode('flatLay', e.target.value)} className={`w-full bg-slate-50 border-none rounded-2xl p-4 focus:ring-2 focus:ring-purple-500 text-sm font-bold transition-all ${isFlatLayActive ? 'ring-2 ring-purple-100 text-purple-700' : 'text-slate-600'}`}><option value="">无特写 (标准人像模式)</option>{FLAT_LAY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
                <div className="space-y-3">
                  <label className="text-sm font-bold text-slate-700 flex items-center gap-2">
                    <span className="w-5 h-5 rounded-md bg-purple-50 text-purple-600 flex items-center justify-center text-[10px]">05</span>
                    构图层级与镜头聚焦
                  </label>
                  {showCompositionOverrideHint && (
                    <p className="text-[11px] text-purple-600 font-bold leading-snug px-1 -mt-1 flex items-start gap-1.5">
                      <span className="inline-block w-1.5 h-1.5 mt-1.5 rounded-full bg-purple-600 shrink-0"></span>
                      构图层级 + 镜头聚焦优先级高于生成姿态；如有冲突按构图为准
                    </p>
                  )}
                  <select
                    value={settings.compositionScope}
                    onChange={(e) => {
                      const newScope = e.target.value as CompositionScope;
                      const newTargets = getCompositionTargets(newScope);
                      const stillValid = settings.compositionTarget === '' || newTargets.some(t => t.value === settings.compositionTarget);
                      const clearExclusive = newScope !== 'detail' && newScope !== 'macro';
                      setSettings({
                        ...settings,
                        compositionScope: newScope,
                        compositionTarget: stillValid ? settings.compositionTarget : '',
                        ...(clearExclusive ? { fabricDetail: '', flatLayDetail: '', detailFocus: '' } : {}),
                      });
                    }}
                    className="w-full bg-slate-50 border-none rounded-2xl p-4 focus:ring-2 focus:ring-purple-500 text-sm font-medium"
                  >
                    {COMPOSITION_SCOPES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  {settings.compositionScope !== 'inherit' && (
                    <div className="space-y-2">
                      <select
                        value={isCustomTarget ? '__custom__' : settings.compositionTarget}
                        onChange={(e) => {
                          const v = e.target.value;
                          setSettings({ ...settings, compositionTarget: v === '__custom__' ? ' ' : v });
                        }}
                        className="w-full bg-slate-50 border-none rounded-2xl p-4 focus:ring-2 focus:ring-purple-500 text-sm"
                      >
                        <option value="">请选择聚焦对象</option>
                        {compositionTargets.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        <option value="__custom__">自定义…</option>
                      </select>
                      {isCustomTarget && (
                        <input
                          type="text"
                          placeholder="自定义聚焦对象（如：腰带、扣子）"
                          value={settings.compositionTarget}
                          onChange={(e) => setSettings({ ...settings, compositionTarget: e.target.value })}
                          className="w-full bg-slate-50 border-none rounded-2xl px-4 py-3 focus:ring-2 focus:ring-purple-500 text-sm"
                        />
                      )}
                    </div>
                  )}
                  {settings.compositionScope === 'inherit' && _lastCompositionIntent && (
                    <p className="text-[11px] text-purple-500 font-medium px-1">
                      将沿用上一轮：{_lastCompositionIntent.scope} · {_lastCompositionIntent.target || '整体人物'}
                    </p>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6 border-t border-slate-50 pt-8">
                <div className="space-y-3"><label className="text-sm font-bold text-slate-700 flex items-center gap-2"><span className="w-5 h-5 rounded-md bg-purple-50 text-purple-600 flex items-center justify-center text-[10px]">06</span>专业光影控制</label><select value={settings.lighting} onChange={(e) => setSettings({...settings, lighting: e.target.value})} className="w-full bg-slate-50 border-none rounded-2xl p-4 focus:ring-2 focus:ring-purple-500 text-sm font-medium">{LIGHTING_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
                <div className="space-y-3"><label className="text-sm font-bold text-slate-700 flex items-center gap-2"><span className="w-5 h-5 rounded-md bg-purple-50 text-purple-600 flex items-center justify-center text-[10px]">07</span>人物表情表达</label><select value={settings.expression} onChange={(e) => setSettings({...settings, expression: e.target.value})} className="w-full bg-slate-50 border-none rounded-2xl p-4 focus:ring-2 focus:ring-purple-500 text-sm font-medium">{EXPRESSIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
              </div>
              <div className="space-y-3 border-t border-slate-50 pt-8"><label className="text-sm font-bold text-slate-700 flex items-center gap-2"><span className="w-5 h-5 rounded-md bg-purple-50 text-purple-600 flex items-center justify-center text-[10px]">08</span>比例与画质</label><div className="flex gap-4"><select value={settings.aspectRatio} onChange={(e) => setSettings({...settings, aspectRatio: e.target.value})} className="flex-1 bg-slate-50 border-none rounded-2xl p-4 text-sm font-medium">{ASPECT_RATIOS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select><select value={settings.imageSize} onChange={(e) => setSettings({...settings, imageSize: e.target.value as ImageSize})} className="flex-1 bg-slate-50 border-none rounded-2xl p-4 text-sm font-medium">{IMAGE_SIZES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div></div>
              <div className="space-y-3 pb-4 border-t border-slate-50 pt-8"><label className="text-sm font-bold text-slate-700 flex items-center gap-2"><span className="w-5 h-5 rounded-md bg-purple-50 text-purple-600 flex items-center justify-center text-[10px]">09</span>补充描述 (Prompt)</label><textarea value={settings.remark} onChange={(e) => {
                const text = e.target.value;
                const merged = mergeInferredComposition(settings, text);
                setSettings({ ...settings, remark: text, compositionScope: merged.compositionScope, compositionTarget: merged.compositionTarget });
              }} placeholder="输入额外的精修指令..." className="w-full bg-slate-50 border-none rounded-2xl p-5 h-32 focus:ring-2 focus:ring-purple-500 text-sm resize-none" /></div>
            </div>
            <div className="mt-auto p-8 border-t border-slate-100 bg-white sticky bottom-0 shadow-[0_-4px_20px_-10px_rgba(0,0,0,0.05)]">
              <div className="flex flex-col sm:flex-row items-center gap-8">
                <div className="flex-grow w-full space-y-3">
                  <div className="flex justify-between items-center text-sm">
                    <label className="font-bold text-slate-600">{settings.actions.length > 0 && !isDetailModeActive ? '每种姿态张数' : '批量组数'}</label>
                    <div className={`flex items-center gap-2 text-xs font-bold transition-colors ${isP2HighVolume ? 'text-amber-500' : 'text-slate-400'}`}>
                      <span>
                        {isDetailModeActive
                          ? `特写模式 × ${p2BatchCount} 张 = `
                          : settings.actions.length > 0
                            ? `已选 ${settings.actions.length} 种姿态 × ${p2BatchCount} 张/姿态 = `
                            : `保持原姿态 × ${p2BatchCount} 张 = `}
                      </span>
                      <span className={`text-sm font-black underline underline-offset-4 ${isP2HighVolume ? 'text-amber-600' : 'text-purple-600'}`}>共 {p2TotalImages} 张</span>
                    </div>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="8"
                    step="1"
                    value={settings.count}
                    onChange={(e) => setSettings({...settings, count: parseInt(e.target.value)})}
                    className={`w-full h-2 rounded-lg appearance-none transition-colors cursor-pointer ${
                      isP2HighVolume ? 'bg-amber-100 accent-amber-500' : 'bg-slate-100 accent-purple-600'
                    }`}
                  />
                  {renderScaleMarks()}
                </div>
                <div className="flex flex-col w-full sm:w-auto gap-2">
                  <button onClick={handleGenerate} disabled={!hasSelectedImages} className={`w-full px-12 py-5 text-white font-black rounded-[1.25rem] shadow-xl active:scale-95 transition-all flex items-center justify-center gap-3 whitespace-nowrap disabled:bg-slate-200 disabled:shadow-none ${isP2HighVolume ? 'bg-amber-500 shadow-amber-100 hover:bg-amber-600' : 'bg-purple-600 shadow-purple-100 hover:bg-purple-700'}`}>
                    {`批量生成 ${p2TotalImages} 张成品`}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div ref={resultsRef}>
        {results.length > 0 && (
          <div className="bg-white rounded-[2.5rem] p-8 sm:p-10 shadow-xl border border-slate-100 mt-10">
             <h2 className="text-2xl font-bold mb-8 flex items-center gap-3">精修成品库 <span className="text-sm font-normal text-slate-400">| 全部按 Phase 2 任务顺序排列</span></h2>
             <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">{results.map((img, index) => renderImageItem(img, index, 2))}</div>
          </div>
        )}
      </div>
    </section>
  );
};
