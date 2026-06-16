/**
 * Phase0.tsx — Phase 0 标准资产工厂组件
 */
import React, { useRef, useState } from 'react';
import { AssetStudioSettings, GeneratedImage, InputFiles, InputLabels, ImageSize } from '../types';
import { ASPECT_RATIOS, IMAGE_SIZES } from '../constants';
import { analyzeGarmentStructure, generatePhase0Asset } from '../services/phase0';
import { uploadFilesToGcs } from '../services/uploadService';
import { auditService } from '../services/auditService';
import { ImageTagger } from './ImageTagger';

interface Phase0Props {
  inputs: InputFiles; setInputs: React.Dispatch<React.SetStateAction<InputFiles>>;
  previews: {[key: string]: string | string[]}; setPreviews: React.Dispatch<React.SetStateAction<{[key: string]: string | string[]}>>;
  // Phase0 目前的管线只把 front/side/back 三个语义槽下发给 Gemini（服务 phase0/index.ts），
  // mannequinDetail[] 虽然能上传但并不进入请求；所以这里接收 inputLabels 仅为接口对齐，暂不渲染 tagger。
  // 未来 phase0 扩展到可用自定义参考图时，直接在对应槽下挂 <ImageTagger /> 即可。
  // 见 errorConclude #41 的"后续扩展"。
  inputLabels: InputLabels; setInputLabels: React.Dispatch<React.SetStateAction<InputLabels>>;
  settings: AssetStudioSettings; setSettings: React.Dispatch<React.SetStateAction<AssetStudioSettings>>;
  results: GeneratedImage[]; setResults: React.Dispatch<React.SetStateAction<GeneratedImage[]>>;
  setKeyReady: (ready: boolean) => void;
  getFriendlyError: (error: any) => string;
  renderImageItem: (img: GeneratedImage, index: number, phase: 0 | 1 | 2) => React.ReactNode;
  sectionRef: React.RefObject<HTMLDivElement | null>;
  resultsRef: React.RefObject<HTMLDivElement | null>;
}

const VIEW_OPTIONS = [
  { value: '3D_FRONT', label: '正面 3D 视图' },
  { value: '3D_SIDE', label: '侧面 45° 视图' },
  { value: '3D_BACK', label: '背面视图' }
];

export const Phase0: React.FC<Phase0Props> = ({
  inputs, setInputs, previews, setPreviews,
  inputLabels, setInputLabels,
  settings, setSettings, results, setResults,
  setKeyReady, getFriendlyError, renderImageItem, sectionRef, resultsRef
}) => {
  // === 参考图标签辅助 === (与 Phase1 同构，复用 InputLabels 字段子集)
  // Phase0 目前只给 mannequinDetail[] 渲染 tagger（front/side/back 槽名自带语义，不打标）。
  const getLabelAt = (field: keyof InputLabels, index?: number): string => {
    const v = inputLabels[field] as any;
    if (Array.isArray(v)) return (index != null ? v[index] : '') || '';
    return (v as string) || '';
  };
  const setLabelAt = (field: keyof InputLabels, value: string, index?: number) => {
    setInputLabels(prev => {
      if (index == null) {
        return { ...prev, [field]: value || undefined };
      }
      const arr = [...((prev[field] as string[]) || [])];
      while (arr.length <= index) arr.push('');
      arr[index] = value;
      return { ...prev, [field]: arr };
    });
  };
  const removeLabelAt = (field: keyof InputLabels, index?: number) => {
    setInputLabels(prev => {
      if (index == null) {
        const { [field]: _, ...rest } = prev as any;
        return rest;
      }
      const arr = [...((prev[field] as string[]) || [])];
      if (index < arr.length) arr.splice(index, 1);
      return { ...prev, [field]: arr };
    });
  };
  const pendingResults = results.filter(img => img.status === 'pending');
  const btnState = pendingResults.length === 0 ? 'idle' : pendingResults.some(img => img.actionLabel === '正在解析版型...') ? 'step1' : 'step2';

  const frontRef = useRef<HTMLInputElement>(null);
  const sideRef = useRef<HTMLInputElement>(null);
  const backRef = useRef<HTMLInputElement>(null);
  const detailRef = useRef<HTMLInputElement>(null);
  const inputRefs: Record<string, React.RefObject<HTMLInputElement | null>> = { mannequinFront: frontRef, mannequinSide: sideRef, mannequinBack: backRef, mannequinDetail: detailRef };

  /**
   * Phase0 默认标签（#41.5 起全部中文，与后端 role-based prompt 兼容）。
   * 单图槽也预填，用户可直接在输入框里改。
   */
  const getDefaultLabel = (field: string, index?: number): string => {
    if (field === 'mannequinFront') return '正面';
    if (field === 'mannequinSide') return '侧面';
    if (field === 'mannequinBack') return '背面';
    if (field === 'mannequinDetail') return `细节 #${(index ?? 0) + 1}`;
    return '';
  };

  // V5.XVII.G：File → 上传换 GCS 短链 → 同时写入 inputs[field] 与 previews[field]。
  // 旧实现是 inputs 存 File、previews 存 base64 dataUri；生图时 fileToDataUri(File) 现场
  // 转 base64 当 referenceImages，phase0/generate 请求体可达几 MB → 浏览器 / vite-proxy
  // 容易在 socket idle 时 RST。改完后生图请求体只含短链，几 KB。
  const processFiles = async (field: string, files: File[], multiple: boolean) => {
    if (files.length === 0) return;
    const fieldKey = field as keyof InputFiles;
    // 立即显示 blob 占位预览，inputs 等上传成功后再填
    const blobUrls = files.map(f => URL.createObjectURL(f));
    if (multiple) {
      setPreviews(prev => {
        const existing = (prev[fieldKey] as string[] | undefined) || [];
        return { ...prev, [fieldKey]: [...existing, ...blobUrls] };
      });
      setInputLabels(prev => {
        const existingLabels = ((prev[field as keyof InputLabels] as string[]) || []).slice();
        const startIdx = existingLabels.length;
        for (let i = 0; i < files.length; i++) existingLabels.push(getDefaultLabel(field, startIdx + i));
        return { ...prev, [field as keyof InputLabels]: existingLabels };
      });
    } else {
      setPreviews(prev => ({ ...prev, [fieldKey]: blobUrls[0] }));
      const def = getDefaultLabel(field);
      if (def) setInputLabels(prev => ({ ...prev, [field as keyof InputLabels]: def }));
    }
    // 后台上传，完成后更新 inputs + 把 previews 中的 blob URL 替换为真实短链
    let shortUrls: string[];
    try {
      shortUrls = await uploadFilesToGcs(files, 'phase0');
    } catch (err) {
      console.error('[Phase0] upload failed:', err);
      if (multiple) {
        setPreviews(prev => {
          const existing = (prev[fieldKey] as string[] | undefined) || [];
          return { ...prev, [fieldKey]: existing.filter(u => !blobUrls.includes(u)) };
        });
      } else {
        setPreviews(prev => ({ ...prev, [fieldKey]: undefined }));
      }
      blobUrls.forEach(u => URL.revokeObjectURL(u));
      alert('参考图上传失败，请检查网络或稍后重试');
      return;
    }
    blobUrls.forEach(u => URL.revokeObjectURL(u));
    if (multiple) {
      setInputs(prev => {
        const existing = (prev[fieldKey] as (File | string)[] | undefined) || [];
        return { ...prev, [fieldKey]: [...existing, ...shortUrls] };
      });
      setPreviews(prev => {
        const existing = [...((prev[fieldKey] as string[] | undefined) || [])];
        blobUrls.forEach((blob, i) => {
          const idx = existing.indexOf(blob);
          if (idx !== -1) existing[idx] = shortUrls[i];
        });
        return { ...prev, [fieldKey]: existing };
      });
    } else {
      setInputs(prev => ({ ...prev, [fieldKey]: shortUrls[0] }));
      setPreviews(prev => ({ ...prev, [fieldKey]: shortUrls[0] }));
    }
  };

  const handleFileChange = async (field: string, e: React.ChangeEvent<HTMLInputElement>, multiple: boolean) => {
    if (e.target.files && e.target.files.length > 0) { await processFiles(field, Array.from(e.target.files), multiple); e.target.value = ''; }
  };

  const handlePaste = async (field: string, e: React.ClipboardEvent, multiple: boolean) => {
    const items = e.clipboardData.items; const files: File[] = [];
    for (let i = 0; i < items.length; i++) { if (items[i].type.indexOf('image') !== -1) { const file = items[i].getAsFile(); if (file) files.push(file); } }
    if (files.length > 0) { e.preventDefault(); await processFiles(field, files, multiple); }
  };

  const handleRemoveFile = (field: keyof InputFiles, index?: number) => {
    setInputs(prev => { const val = prev[field]; if (Array.isArray(val)) { const updated = [...val]; if (index !== undefined) updated.splice(index, 1); return { ...prev, [field]: updated }; } return { ...prev, [field]: undefined }; });
    setPreviews(prev => { const val = prev[field]; if (Array.isArray(val)) { const updated = [...val]; if (index !== undefined) updated.splice(index, 1); return { ...prev, [field]: updated }; } return { ...prev, [field]: undefined }; });
    // 标签同步清理，保持 inputs[i] ↔ labels[i] 对齐
    removeLabelAt(field as keyof InputLabels, index);
  };

  const [generatingIds] = useState(new Set<string>());

  React.useEffect(() => {
    const pending = results.filter(img => img.status === 'pending' && !generatingIds.has(img.id));
    if (pending.length > 0) { pending.forEach(img => { generatingIds.add(img.id); generateImage(img); }); }
  }, [results]);

  const generateImage = async (placeholder: GeneratedImage) => {
    try {
      let structureremark = placeholder.dnaUsed;
      if (!structureremark) {
        setResults(prev => prev.map(img => img.id === placeholder.id ? { ...img, actionLabel: '正在解析版型...' } : img));
        // 细节图（mannequinDetail[]）和各槽的用户标签一并下发；
        // 让后端 _phase0_dna 给每张图前注入 [Reference Image: <label>] 帮 Gemini 显式区分。
        structureremark = await analyzeGarmentStructure(
          inputs.mannequinFront!,
          inputs.mannequinSide,
          inputs.mannequinBack,
          settings.remark,
          inputs.mannequinDetail,
          {
            front: inputLabels.mannequinFront,
            side: inputLabels.mannequinSide,
            back: inputLabels.mannequinBack,
            details: inputLabels.mannequinDetail,
          },
        );
      }
      setResults(prev => prev.map(img => img.id === placeholder.id ? { ...img, dnaUsed: structureremark, actionLabel: '正在重构资产...' } : img));
      const url = await generatePhase0Asset({ front: inputs.mannequinFront!, side: inputs.mannequinSide, back: inputs.mannequinBack }, structureremark, placeholder.promptUsed, settings);
      setResults(prev => prev.map(img => img.id === placeholder.id ? { ...img, url, actionLabel: '资产重构完成', status: 'done' } : img));
      if (url) { auditService.logGeneration('Phase0', `Generated asset with remark: ${structureremark}`); }
    } catch (error: any) {
      console.error("Phase 0 Generation Error:", error);
      setResults(prev => prev.map(img => img.id === placeholder.id ? { ...img, status: 'error', errorMessage: getFriendlyError(error) } : img));
      if (error.message.includes("API_KEY_INVALID")) setKeyReady(false);
    } finally { generatingIds.delete(placeholder.id); }
  };

  const handleGenerate = async () => {
    if (settings.tasks.length === 0) { alert("请选择至少一个生成视角"); return; }
    if (!inputs.mannequinFront) { alert("请上传正面人台图"); return; }
    const taskId = `task-p0-${Date.now()}`;
    const tasksSnapshot = [...settings.tasks];
    const currentMaxTaskNumber = results.reduce((max, img) => Math.max(max, img.taskNumber || 0), 0);
    const nextTaskNumber = currentMaxTaskNumber + 1;
    const placeholders: GeneratedImage[] = tasksSnapshot.map((taskVal, i) => ({ id: `${taskId}-${i}`, taskId, taskNumber: nextTaskNumber, url: '', promptUsed: taskVal, aspectRatio: settings.aspectRatio, phase: 0, status: 'pending', actionLabel: '正在解析版型...' }));
    setResults(prev => [...placeholders, ...prev]);
    setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  };

  const toggleTask = (val: string) => { setSettings(prev => ({ ...prev, tasks: prev.tasks.includes(val) ? prev.tasks.filter(t => t !== val) : [...prev.tasks, val] })); };

  const renderUploadSlot = (label: string, field: string, multiple: boolean = false) => {
    const preview = previews[field];
    const hasContent = multiple ? Array.isArray(preview) && preview.length > 0 : !!preview;
    return (
      <div className="space-y-2">
        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{label}</label>
        <div tabIndex={0} onPaste={(e) => handlePaste(field, e, multiple)} className={`group relative rounded-2xl border-2 border-dashed transition-all overflow-hidden flex flex-col items-center justify-center outline-none ring-offset-2 focus-within:ring-2 focus-within:ring-emerald-500 ${hasContent ? 'border-emerald-100 bg-emerald-50/10' : 'border-slate-200 bg-slate-50 hover:border-emerald-300 h-32'}`}>
          <input type="file" ref={inputRefs[field]} accept="image/*" multiple={multiple} className="hidden" onChange={(e) => handleFileChange(field, e, multiple)} />
          {hasContent ? (
            <div className="relative w-full h-full group/item">
              {multiple ? (
                <div className="grid grid-cols-2 gap-2 w-full p-2 overflow-y-auto no-scrollbar max-h-72">
                  {(preview as string[]).map((src, i) => (
                    <div key={i} className="flex flex-col gap-1">
                      <div className="relative rounded-lg overflow-hidden border border-white shadow-sm aspect-[3/4]">
                        <img src={src} className="w-full h-full object-cover" alt="prev" />
                        <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleRemoveFile(field as keyof InputFiles, i); }} className="absolute top-1 right-1 p-1 bg-red-500 text-white rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity"><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12"></path></svg></button>
                      </div>
                      <ImageTagger
                        value={getLabelAt(field as keyof InputLabels, i)}
                        onChange={(v) => setLabelAt(field as keyof InputLabels, v, i)}
                        presets={['面料纹理', '领口细节', '下摆', '45°斜视', '内部结构', '五金']}
                        placeholder="细节标签"
                      />
                    </div>
                  ))}
                  <button onClick={() => inputRefs[field].current?.click()} className="aspect-[3/4] bg-white/50 border-2 border-dashed border-emerald-100 rounded-lg flex items-center justify-center text-emerald-400 hover:text-emerald-600 transition-colors">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M12 4v16m8-8H4"></path></svg>
                  </button>
                </div>
              ) : (
                // 单图槽（mannequinFront / Side / Back）：#41.5 起在图片下方也挂 ImageTagger，
                // processFiles 已预填中文默认（"正面" / "侧面" / "背面"），用户可改。
                <div className="w-full p-2 flex flex-col">
                  <div className="relative rounded-xl overflow-hidden">
                    <img src={preview as string} className="w-full h-auto block" alt="prev" />
                    <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleRemoveFile(field as keyof InputFiles); }} className="absolute top-2 right-2 p-1.5 bg-red-500 text-white rounded-xl shadow-lg opacity-0 group-hover/item:opacity-100 transition-opacity"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12"></path></svg></button>
                  </div>
                  <ImageTagger
                    value={getLabelAt(field as keyof InputLabels)}
                    onChange={(v) => setLabelAt(field as keyof InputLabels, v)}
                    presets={
                      field === 'mannequinFront' ? ['正面', '正面·平铺', '正面·穿着']
                      : field === 'mannequinSide' ? ['侧面', '45°斜视', '侧面·剖面']
                      : field === 'mannequinBack' ? ['背面', '背面·开合', '背面·细节']
                      : undefined
                    }
                  />
                </div>
              )}
            </div>
          ) : (
            <button onClick={() => inputRefs[field].current?.click()} className="flex flex-col items-center group/btn text-center px-4">
              <div className="w-8 h-8 bg-white rounded-xl shadow-sm border border-slate-100 flex items-center justify-center mb-1.5 text-slate-400 group-hover/btn:text-emerald-600 transition-all">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4"></path></svg>
              </div>
              <p className="text-[10px] font-bold text-slate-500">点击上传</p>
              <p className="text-[8px] text-slate-400 mt-0.5 uppercase">或聚焦后粘贴</p>
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <section ref={sectionRef} className="space-y-12 mb-24 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="flex items-center gap-4">
        <div className="flex items-center justify-center w-12 h-12 rounded-2xl bg-emerald-600 text-white font-bold text-2xl shadow-lg shadow-emerald-100">0</div>
        <div><h1 className="text-3xl font-bold tracking-tight text-slate-900">标准资产工厂</h1><h2 className="text-slate-500 text-base">采用"结构锁定+数字熨烫"逻辑，产出无瑕疵 3D 电商资产</h2></div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
        <div className="lg:col-span-5 flex flex-col">
          <div className="bg-white p-6 rounded-[2.5rem] border border-slate-200 shadow-sm flex flex-col gap-6 h-full">
            <h3 className="font-bold text-lg text-slate-800">结构化多模态输入</h3>
            <div className="grid grid-cols-2 gap-4">
              {renderUploadSlot('正面人台图 (必填)', 'mannequinFront')}
              {renderUploadSlot('侧面角度图', 'mannequinSide')}
              {renderUploadSlot('背面角度图', 'mannequinBack')}
              {renderUploadSlot('面料细节图', 'mannequinDetail', true)}
            </div>
          </div>
        </div>
        <div className="lg:col-span-7">
          <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm flex flex-col h-full relative overflow-hidden">
            <div className="p-8 pb-4 border-b border-slate-50 flex justify-between items-center">
              <h3 className="font-bold text-lg text-slate-800">资产重构配置</h3>
              {btnState !== 'idle' && (<div className="flex items-center gap-2 text-emerald-600"><span className="w-2 h-2 bg-emerald-600 rounded-full animate-ping"></span><span className="text-[10px] font-black uppercase tracking-widest">{btnState === 'step1' ? 'Step 1: 正在解析版型...' : 'Step 2: 正在重构资产...'}</span></div>)}
            </div>
            <div className="flex-grow overflow-y-auto p-8 pt-6 space-y-8 custom-scrollbar">
              <div className="space-y-4">
                <label className="text-sm font-bold text-slate-700 flex items-center gap-2"><span className="w-5 h-5 rounded-md bg-emerald-50 text-emerald-600 flex items-center justify-center text-[10px]">01</span>重构视角任务</label>
                <div className="flex flex-wrap gap-3">
                  {VIEW_OPTIONS.map(opt => (<button key={opt.value} onClick={() => toggleTask(opt.value)} className={`px-6 py-3 rounded-2xl text-xs font-bold border transition-all ${settings.tasks.includes(opt.value) ? 'bg-emerald-600 border-emerald-600 text-white shadow-lg' : 'bg-slate-50 border-transparent text-slate-600 hover:border-emerald-200'}`}>{opt.label}</button>))}
                </div>
              </div>
              <div className="space-y-4">
                <label className="text-sm font-bold text-slate-700 flex items-center gap-2"><span className="w-5 h-5 rounded-md bg-emerald-50 text-emerald-600 flex items-center justify-center text-[10px]">02</span>数字美化增强</label>
                <button onClick={() => setSettings({...settings, smartRetouch: !settings.smartRetouch})} className={`w-full flex items-center justify-between p-5 rounded-2xl border transition-all ${settings.smartRetouch ? 'bg-emerald-50 border-emerald-600 shadow-sm' : 'bg-slate-50 border-transparent hover:border-emerald-100'}`}>
                  <div className="text-left"><p className={`text-sm font-bold ${settings.smartRetouch ? 'text-emerald-900' : 'text-slate-700'}`}>数字熨烫与 3D 渲染美化</p><p className="text-[10px] text-slate-400 font-medium mt-0.5 italic">执行 30% 美化自由度，消除褶皱与噪点</p></div>
                  <div className={`w-12 h-6 rounded-full p-1 transition-colors relative ${settings.smartRetouch ? 'bg-emerald-600' : 'bg-slate-300'}`}><div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-all absolute top-1 ${settings.smartRetouch ? 'right-1' : 'left-1'}`}></div></div>
                </button>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-3"><label className="text-sm font-bold text-slate-700 flex items-center gap-2"><span className="w-5 h-5 rounded-md bg-emerald-50 text-emerald-600 flex items-center justify-center text-[10px]">03</span>输出比例</label><select value={settings.aspectRatio} onChange={(e) => setSettings({...settings, aspectRatio: e.target.value})} className="w-full bg-slate-50 border-none rounded-2xl p-4 text-sm font-bold focus:ring-2 focus:ring-emerald-500 transition-all">{ASPECT_RATIOS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
                <div className="space-y-3"><label className="text-sm font-bold text-slate-700 flex items-center gap-2"><span className="w-5 h-5 rounded-md bg-emerald-50 text-emerald-600 flex items-center justify-center text-[10px]">04</span>资产画质</label><select value={settings.imageSize} onChange={(e) => setSettings({...settings, imageSize: e.target.value as ImageSize})} className="w-full bg-slate-50 border-none rounded-2xl p-4 text-sm font-bold focus:ring-2 focus:ring-emerald-500 transition-all">{IMAGE_SIZES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
              </div>
              <div className="space-y-4 pb-4">
                <label className="text-sm font-bold text-slate-700 flex items-center gap-2"><span className="w-5 h-5 rounded-md bg-emerald-50 text-emerald-600 flex items-center justify-center text-[10px]">05</span>重构补充描述</label>
                <textarea value={settings.remark} onChange={(e) => setSettings({...settings, remark: e.target.value})} placeholder="提供额外的设计指引..." className="w-full bg-slate-50 border-none rounded-2xl p-5 h-32 focus:ring-2 focus:ring-emerald-500 transition-all text-sm resize-none" />
              </div>
            </div>
            <div className="p-8 border-t border-slate-100 bg-white sticky bottom-0">
              <button onClick={handleGenerate} disabled={btnState !== 'idle' || settings.tasks.length === 0} className={`w-full py-5 text-white font-black rounded-[1.25rem] shadow-xl transition-all flex items-center justify-center gap-3 active:scale-95 disabled:bg-slate-200 disabled:shadow-none ${btnState !== 'idle' ? 'bg-emerald-400' : 'bg-emerald-600 shadow-emerald-100 hover:bg-emerald-700'}`}>
                {btnState === 'idle' ? "开始 3D 资产计算" : btnState === 'step1' ? "Step 1: 正在解析版型..." : "Step 2: 正在重构资产..."}
              </button>
            </div>
          </div>
        </div>
      </div>
      <div ref={resultsRef}>
        {results.length > 0 && (
          <div className="bg-white rounded-[2.5rem] p-10 shadow-xl border border-slate-100 mt-10">
            <h2 className="text-2xl font-bold mb-8 flex items-center gap-3">资产重构结果库 <span className="text-sm font-normal text-slate-400">| 全部按 Phase 0 任务顺序排列</span></h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">{results.map((img, index) => renderImageItem(img, index, 0))}</div>
          </div>
        )}
      </div>
    </section>
  );
};
