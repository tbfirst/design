/**
 * Phase2Color.tsx — Phase 2 色彩实验室组件
 */
import React, { useRef, useState, useEffect } from 'react';
import { Phase2Settings, Phase2ColorSettings, GeneratedImage, ImageSize } from '../types';
import { ASPECT_RATIOS, IMAGE_SIZES } from '../constants';
import { generateColorVariantImage } from '../services/colorService';
import { fileToDataUri } from '../services/shared/imagePartUtils';
import { uploadFilesToGcs } from '../services/uploadService';

interface Phase2ColorProps {
  baseSettings: Phase2Settings; setBaseSettings: React.Dispatch<React.SetStateAction<Phase2Settings>>;
  colorSettings: Phase2ColorSettings; setColorSettings: React.Dispatch<React.SetStateAction<Phase2ColorSettings>>;
  results: GeneratedImage[]; setResults: React.Dispatch<React.SetStateAction<GeneratedImage[]>>;
  setAssetPreviewUrl: (url: string) => void;
  setKeyReady: (ready: boolean) => void;
  getFriendlyError: (error: any) => string;
  renderImageItem: (img: GeneratedImage, index: number, phase: 0 | 1 | 2) => React.ReactNode;
  resultsRef: React.RefObject<HTMLDivElement | null>;
}

export const Phase2Color: React.FC<Phase2ColorProps> = ({
  baseSettings, setBaseSettings, colorSettings, setColorSettings, results, setResults,
  setAssetPreviewUrl, setKeyReady, getFriendlyError, renderImageItem, resultsRef
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hasSelectedImages = baseSettings.selectedBaseImages.length > 0;
  // V5.XVII.E：File → 上传换 GCS 短链 → 进 selectedBaseImages（避免 base64 撑大 phase2 generate body）
  const processFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const blobUrls = files.map(f => URL.createObjectURL(f));
    setBaseSettings(prev => ({ ...prev, selectedBaseImages: [...prev.selectedBaseImages, ...blobUrls] }));
    try {
      const shortUrls = await uploadFilesToGcs(files, 'upload');
      setBaseSettings(prev => {
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
      setBaseSettings(prev => ({ ...prev, selectedBaseImages: prev.selectedBaseImages.filter(u => !blobUrls.includes(u)) }));
      blobUrls.forEach(u => URL.revokeObjectURL(u));
      alert("参考图上传失败，请检查网络或稍后重试");
    }
  };
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => { if (e.target.files && e.target.files.length > 0) { await processFiles(Array.from(e.target.files)); e.target.value = ''; } };
  const handlePaste = async (e: React.ClipboardEvent) => { const items = e.clipboardData.items; const files: File[] = []; for (let i = 0; i < items.length; i++) { if (items[i].type.indexOf('image') !== -1) { const file = items[i].getAsFile(); if (file) files.push(file); } } if (files.length > 0) { e.preventDefault(); await processFiles(files); } };

  const [isGenerating, setIsGenerating] = useState(false);
  const [generatingIds] = useState(new Set<string>());

  const compressImage = (dataUri: string, maxWidth = 800): Promise<string> => { return new Promise((resolve) => { const img = new Image(); img.onload = () => { const canvas = document.createElement('canvas'); let width = img.width; let height = img.height; if (width > maxWidth) { height *= maxWidth / width; width = maxWidth; } canvas.width = width; canvas.height = height; const ctx = canvas.getContext('2d'); ctx?.drawImage(img, 0, 0, width, height); resolve(canvas.toDataURL('image/jpeg', 0.7)); }; img.src = dataUri; }); };

  const handleReferenceImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => { if (e.target.files && e.target.files[0]) { try { const uri = await fileToDataUri(e.target.files[0]); const compressed = await compressImage(uri); setColorSettings(s => ({ ...s, referenceImageUrl: compressed, targetColor: '' })); } catch (err) { console.error("Upload failed", err); alert("图片处理失败，请重试"); } } };

  React.useEffect(() => { const pending = results.filter(img => img.status === 'pending' && !generatingIds.has(img.id)); if (pending.length > 0) { pending.forEach(img => { generatingIds.add(img.id); generateImage(img); }); } }, [results]);

  const generateImage = async (placeholder: GeneratedImage) => {
    setIsGenerating(true);
    try {
      const baseImg = (placeholder as any).baseImgUrl;
      const result = await generateColorVariantImage(baseImg, colorSettings);
      setResults(prev => prev.map(img => img.id === placeholder.id ? { ...img, url: result.url, actionLabel: result.label, status: 'done' } : img));
    } catch (error: any) {
      console.error("Phase 2 Color Generation Error:", error);
      const friendlyError = getFriendlyError(error);
      if (friendlyError.includes("纹理") || friendlyError.includes("解析")) { alert("AI 无法解析该纹理/风格，请尝试更换参考图或调整描述。"); } else { alert(`生成失败: ${friendlyError}`); }
      setResults(prev => prev.map(img => img.id === placeholder.id ? { ...img, status: 'error', errorMessage: friendlyError } : img));
      if (error.message.includes("API_KEY_INVALID")) setKeyReady(false);
    } finally { generatingIds.delete(placeholder.id); setIsGenerating(false); }
  };

  const handleGenerateColor = async () => {
    if (baseSettings.selectedBaseImages.length === 0) { alert("请先在左侧选择参考图"); return; }
    if (!colorSettings.targetColor && !colorSettings.referenceImageUrl) { alert("请选择目标颜色或上传参考图"); return; }
    const taskId = `task-p2-color-${Date.now()}`;
    const currentMaxTaskNumber = results.reduce((max, img) => Math.max(max, img.taskNumber || 0), 0);
    const nextTaskNumber = currentMaxTaskNumber + 1;
    const jobs = baseSettings.selectedBaseImages.flatMap((baseImg, baseIdx) => Array.from({ length: colorSettings.count }).map((_, i) => ({ baseImg, id: `${taskId}-${baseIdx}-${i}`, index: i })));
    const placeholders: GeneratedImage[] = jobs.map(job => ({ id: job.id, taskId, taskNumber: nextTaskNumber, url: '', actionLabel: '改色计算中', promptUsed: colorSettings.referenceImageUrl ? '多模态风格迁移' : `Color: ${colorSettings.targetColor} on ${colorSettings.targetArea}`, aspectRatio: colorSettings.aspectRatio, phase: 2, status: 'pending', baseImgUrl: job.baseImg } as any));
    setResults(prev => [...placeholders, ...prev]);
    setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  };

  const TARGET_AREAS = [
    { value: 'Whole Outfit', label: '全身穿搭 (Whole Outfit)' }, { value: 'Dress', label: '连衣裙 (Dress)' },
    { value: 'Top/Shirt', label: '上装 (Top)' }, { value: 'Pants/Skirt', label: '下装 (Bottom)' },
    { value: 'Outerwear/Coat', label: '外套 (Coat)' }, { value: 'Bag', label: '包袋 (Bag)' },
    { value: 'Shoes', label: '鞋履 (Shoes)' }, { value: 'Background', label: '背景 (Background)' },
  ];
  const COMMON_COLORS = ['#000000', '#FFFFFF', '#808080', '#C0392B', '#E74C3C', '#9B59B6', '#2980B9', '#3498DB', '#1ABC9C', '#27AE60', '#F1C40F', '#E67E22', '#D35400', '#7F8C8D', '#2C3E50'];

  return (
    <section className="mt-24 space-y-12 animate-in fade-in slide-in-from-right-4 duration-500">
      <div className="flex items-center gap-4">
        <span className="flex items-center justify-center w-12 h-12 rounded-2xl bg-purple-600 text-white font-bold text-2xl shadow-lg shadow-purple-100">2</span>
        <div><h1 className="text-3xl font-bold tracking-tight">生活化延展与精修</h1><p className="text-slate-500">基于多图参考进行动作与光影微调，产出商业成品</p></div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
        <div className="lg:col-span-4 flex flex-col">
          <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm sticky top-24 h-fit max-h-[80vh] overflow-hidden flex flex-col">
            <div className="flex justify-between items-center mb-4 shrink-0"><h3 className="font-bold text-slate-700 text-lg">参考资产</h3><span className="px-2 py-0.5 bg-pink-50 text-pink-600 text-[10px] font-bold rounded border border-pink-100">共享数据源</span></div>
            <div className="flex-grow overflow-y-auto custom-scrollbar pr-2 pl-1 pt-1 pb-4 outline-none rounded-2xl" onPaste={handlePaste}>
              <input type="file" ref={fileInputRef} className="hidden" accept="image/*" multiple onChange={handleFileChange} />
              <div className="grid grid-cols-2 gap-2">
                {baseSettings.selectedBaseImages.map((url, idx) => (
                  <div key={idx} className="relative rounded-xl overflow-hidden aspect-[3/4] bg-slate-50 border border-slate-100 group cursor-pointer" onClick={() => setAssetPreviewUrl(url)}>
                    <img src={url} className="w-full h-full object-contain" alt="Base" />
                    <button onClick={(e) => { e.stopPropagation(); setBaseSettings(prev => ({...prev, selectedBaseImages: prev.selectedBaseImages.filter(u => u !== url)})); }} className="absolute top-1 right-1 p-1 bg-black/50 text-white rounded-full hover:bg-red-500 transition-colors"><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg></button>
                  </div>
                ))}
                <div tabIndex={0} className={`group/box relative rounded-xl border-2 border-dashed transition-all flex flex-col items-center justify-center outline-none ring-offset-2 focus-within:ring-2 focus-within:ring-purple-500 ${!hasSelectedImages ? 'col-span-2 h-28 border-slate-200 bg-slate-50/50 hover:border-purple-300' : 'aspect-[3/4] border-slate-200 bg-slate-50/30 hover:border-purple-200'}`}>
                  <button onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }} className="flex flex-col items-center group/btn transition-all active:scale-95 px-2">
                    <div className="w-8 h-8 bg-white rounded-xl shadow-sm border border-slate-100 flex items-center justify-center mb-1.5 group-hover/btn:border-purple-300 group-hover/btn:text-purple-600 text-slate-400 transition-all"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4"></path></svg></div>
                    <p className="text-[10px] font-bold text-slate-500 group-hover/btn:text-purple-600 transition-colors">点击上传</p><p className="text-[8px] text-slate-400 font-medium leading-none mt-0.5">聚焦后粘贴</p>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="lg:col-span-8">
          <div className="bg-white rounded-[2rem] border border-pink-100 shadow-xl shadow-pink-50/50 flex flex-col h-full relative overflow-hidden">
            <div className="p-8 pb-4 border-b border-pink-50 flex justify-between items-center bg-gradient-to-r from-white to-pink-50/30">
              <div><h3 className="font-bold text-lg text-slate-800 flex items-center gap-2"><span className="text-2xl">🎨</span> 色彩实验室配置</h3><p className="text-[10px] text-pink-500 font-medium mt-1">独立引擎：仅改变颜色，严格保留面料纹理与光影</p></div>
              {!hasSelectedImages && (<span className="px-3 py-1 bg-red-50 text-red-600 text-[10px] font-bold rounded-full border border-red-200 animate-pulse">请先在左侧选择图片</span>)}
            </div>
            <div className="flex-grow overflow-y-auto p-8 pt-6 space-y-8 custom-scrollbar">
              <div className="space-y-4"><label className="text-sm font-bold text-slate-700 flex items-center gap-2"><span className="w-5 h-5 rounded-md bg-pink-100 text-pink-600 flex items-center justify-center text-[10px]">01</span>目标改色区域</label><div className="grid grid-cols-2 sm:grid-cols-4 gap-3">{TARGET_AREAS.map(area => (<button key={area.value} onClick={() => setColorSettings(s => ({...s, targetArea: area.value}))} className={`px-3 py-3 rounded-2xl text-xs font-bold border transition-all ${colorSettings.targetArea === area.value ? 'bg-pink-600 border-pink-600 text-white shadow-lg shadow-pink-200' : 'bg-slate-50 border-transparent text-slate-600 hover:border-pink-200'}`}>{area.label.split(' (')[0]}</button>))}</div></div>
              <div className="space-y-4"><label className="text-sm font-bold text-slate-700 flex items-center gap-2"><span className="w-5 h-5 rounded-md bg-pink-100 text-pink-600 flex items-center justify-center text-[10px]">02</span>目标色值 (Color)</label>
                <div className="flex flex-col gap-4 p-5 bg-slate-50 rounded-3xl border border-slate-100">
                  <div className="flex items-center gap-4"><input type="color" value={colorSettings.targetColor} disabled={!!colorSettings.referenceImageUrl} onChange={(e) => setColorSettings(s => ({...s, targetColor: e.target.value, referenceImageUrl: null}))} className="w-16 h-16 rounded-2xl cursor-pointer border-4 border-white shadow-sm disabled:opacity-50" /><div className="flex-grow space-y-1"><p className="text-xs font-bold text-slate-500 uppercase">HEX Code</p><input type="text" value={colorSettings.targetColor} disabled={!!colorSettings.referenceImageUrl} onChange={(e) => setColorSettings(s => ({...s, targetColor: e.target.value, referenceImageUrl: null}))} className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2 font-mono text-lg font-black text-slate-700 focus:ring-2 focus:ring-pink-500 outline-none uppercase disabled:opacity-50" /></div></div>
                  <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-200/50">{COMMON_COLORS.map(c => (<button key={c} disabled={!!colorSettings.referenceImageUrl} onClick={() => setColorSettings(s => ({...s, targetColor: c, referenceImageUrl: null}))} className="w-8 h-8 rounded-full border-2 border-white shadow-sm hover:scale-110 transition-transform disabled:opacity-50" style={{ backgroundColor: c }} title={c} />))}</div>
                  <div className="pt-4 border-t border-slate-200"><p className="text-xs font-bold text-slate-500 uppercase mb-3">或上传材质/色彩参考图</p>{colorSettings.referenceImageUrl ? (<div className="relative w-24 h-24 rounded-2xl overflow-hidden border-2 border-pink-500"><img src={colorSettings.referenceImageUrl} className="w-full h-full object-cover" alt="Ref" /><button onClick={() => setColorSettings(s => ({...s, referenceImageUrl: null}))} className="absolute top-1 right-1 bg-black/50 text-white rounded-full p-1"><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg></button></div>) : (<label className="flex items-center justify-center w-full h-24 border-2 border-dashed border-slate-200 rounded-2xl cursor-pointer hover:border-pink-300 transition-colors"><input type="file" className="hidden" accept="image/*" onChange={handleReferenceImageUpload} /><span className="text-xs text-slate-400 font-bold">点击上传参考图</span></label>)}</div>
                </div>
              </div>
              <div className="space-y-4"><label className="text-sm font-bold text-slate-700 flex items-center gap-2"><span className="w-5 h-5 rounded-md bg-pink-100 text-pink-600 flex items-center justify-center text-[10px]">03</span>重绘强度控制 (Intensity)</label><div className="px-2"><div className="flex justify-between text-xs font-bold text-slate-400 mb-2"><span>温和微调 (20%)</span><span>标准重绘 (60%)</span><span>强力覆盖 (100%)</span></div><input type="range" min="10" max="100" step="10" value={colorSettings.intensity} onChange={(e) => setColorSettings(s => ({...s, intensity: parseInt(e.target.value)}))} className="w-full h-3 bg-slate-200 rounded-lg appearance-none accent-pink-600 cursor-pointer" /></div></div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6 border-t border-pink-50 pt-8">
                <div className="space-y-3"><label className="text-sm font-bold text-slate-700 flex items-center gap-2"><span className="w-5 h-5 rounded-md bg-pink-100 text-pink-600 flex items-center justify-center text-[10px]">04</span>输出比例</label><select value={colorSettings.aspectRatio} onChange={(e) => setColorSettings(s => ({...s, aspectRatio: e.target.value}))} className="w-full bg-slate-50 border-none rounded-2xl p-4 text-sm font-medium focus:ring-2 focus:ring-pink-500">{ASPECT_RATIOS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
                <div className="space-y-3"><label className="text-sm font-bold text-slate-700 flex items-center gap-2"><span className="w-5 h-5 rounded-md bg-pink-100 text-pink-600 flex items-center justify-center text-[10px]">05</span>资产画质</label><select value={colorSettings.imageSize} onChange={(e) => setColorSettings(s => ({...s, imageSize: e.target.value as ImageSize}))} className="w-full bg-slate-50 border-none rounded-2xl p-4 text-sm font-medium focus:ring-2 focus:ring-pink-500">{IMAGE_SIZES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
              </div>
              <div className="space-y-3 pb-4 pt-8 border-t border-pink-50"><label className="text-sm font-bold text-slate-700 flex items-center gap-2"><span className="w-5 h-5 rounded-md bg-pink-100 text-pink-600 flex items-center justify-center text-[10px]">06</span>色彩细节微调 (Prompt)</label><textarea value={colorSettings.remark} onChange={(e) => setColorSettings(s => ({...s, remark: e.target.value}))} placeholder="例如：稍微带一点金属光泽，或者需要哑光质感..." className="w-full bg-slate-50 border-none rounded-2xl p-5 h-24 focus:ring-2 focus:ring-pink-500 text-sm resize-none" /></div>
            </div>
            <div className="mt-auto p-8 border-t border-pink-50 bg-white sticky bottom-0">
               <div className="flex flex-col sm:flex-row items-center gap-8">
                  <div className="flex-grow w-full space-y-3"><div className="flex justify-between items-center text-sm"><label className="font-bold text-slate-600">生成版本数</label><span className="text-pink-600 font-black text-lg">{colorSettings.count}</span></div><input type="range" min="1" max="8" step="1" value={colorSettings.count} onChange={(e) => setColorSettings(s => ({...s, count: parseInt(e.target.value)}))} className="w-full h-2 bg-slate-100 rounded-lg appearance-none accent-pink-600 cursor-pointer" /><div className="flex justify-between px-1 mt-1 text-[10px] font-bold text-slate-400 select-none">{[1,2,3,4,5,6,7,8].map(n=><span key={n}>{n}</span>)}</div></div>
                  <button onClick={handleGenerateColor} disabled={!hasSelectedImages || (!colorSettings.targetColor && !colorSettings.referenceImageUrl) || isGenerating} className="w-full sm:w-auto px-12 py-5 bg-pink-600 text-white font-black rounded-[1.25rem] shadow-xl shadow-pink-200 hover:bg-pink-700 active:scale-95 transition-all flex items-center justify-center gap-3 whitespace-nowrap disabled:bg-slate-200 disabled:shadow-none">
                    {isGenerating ? '正在进行风格迁移...' : <><span className="text-lg">🧪</span> 开始色彩实验</>}
                  </button>
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
