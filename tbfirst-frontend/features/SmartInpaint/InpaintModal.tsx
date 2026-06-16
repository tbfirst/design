
import React, { useState, useRef, useEffect } from 'react';
import { InpaintCanvas, InpaintCanvasRef } from './InpaintCanvas';
import { generateInpaintImage } from './InpaintService';
import { composeMaskedResult } from './composeMaskedResult';
import { fileToDataUri } from '../../services/shared/imagePartUtils';

/**
 * 局部重绘弹窗组件：InpaintModal
 */
interface InpaintModalProps {
  originalImageUrl: string;
  originalAspectRatio: string;
  onClose: () => void;
  onSave: (newImageUrl: string, prompt: string) => void;
  getFriendlyError: (e: any) => string;
}

// V5.XIV.6: GCS 直链 → /img/<key> 同源代理改写（与 InpaintCanvas / downloadHref 一致）
function rewriteToProxy(url: string): string {
  if (!url) return url;
  if (url.startsWith('/img/') || url.includes('/img/')) return url;
  const m = url.match(/storage\.googleapis\.com\/[^/]+\/(.+?)(\?|$)/);
  if (m) return `/img/${m[1]}`;
  return url;
}

/**
 * V5.XIV.6 / V5.XV.8: 容错图片组件。首次 src 就走 rewriteToProxy 改写为同源 /img/<key>，
 * 避免 GCS 直链 CORS 失败的第一次浪费请求。再失败显示错误占位。仅用于 InpaintModal 内部。
 */
const SafeImg: React.FC<{ src: string; alt: string; className?: string }> = ({ src, alt, className }) => {
  const [current, setCurrent] = useState(() => rewriteToProxy(src));
  const [failed, setFailed] = useState(false);
  const triedProxyRef = useRef(rewriteToProxy(src) !== src); // 首次已走 proxy 视为已尝试

  useEffect(() => {
    const proxied = rewriteToProxy(src);
    setCurrent(proxied);
    setFailed(false);
    triedProxyRef.current = proxied !== src;
  }, [src]);

  if (failed) {
    return (
      <div className={`flex flex-col items-center justify-center bg-slate-800 text-white/70 text-xs gap-2 ${className ?? ''}`}>
        <svg className="w-8 h-8 text-rose-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
        </svg>
        <span>图片加载失败</span>
      </div>
    );
  }

  return (
    <img
      src={current}
      alt={alt}
      className={className}
      onError={() => {
        if (!triedProxyRef.current) {
          const proxied = rewriteToProxy(src);
          if (proxied !== current) {
            triedProxyRef.current = true;
            // eslint-disable-next-line no-console
            console.warn('[InpaintModal] image load failed, retrying via proxy:', proxied);
            setCurrent(proxied);
            return;
          }
        }
        // eslint-disable-next-line no-console
        console.error('[InpaintModal] image load failed even after proxy retry:', src);
        setFailed(true);
      }}
    />
  );
};

export const InpaintModal: React.FC<InpaintModalProps> = ({
  originalImageUrl,
  originalAspectRatio,
  onClose,
  onSave,
  getFriendlyError
}) => {
  const [step, setStep] = useState<'edit' | 'comparing'>('edit');
  const [brushSize, setBrushSize] = useState(10);
  const [prompt, setPrompt] = useState("");
  // V5.XVII.7：绝对禁止段。多行字符串，每行一条；空 / 仅空白 → 不进 body
  const [negativePrompt, setNegativePrompt] = useState("");
  const [referenceImage, setReferenceImage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [resultImage, setResultImage] = useState<string | null>(null);

  const canvasRef = useRef<InpaintCanvasRef>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleReferenceUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const uri = await fileToDataUri(e.target.files[0]);
      setReferenceImage(uri);
    }
  };

  const handleGenerate = async () => {
    if (!canvasRef.current?.hasMask()) {
      alert("请先在左侧图片上涂抹需要修改的区域");
      return;
    }
    if (!prompt.trim() && !referenceImage) {
      alert("请填写修改描述或上传参考图");
      return;
    }

    setIsProcessing(true);
    try {
      // V5.XVII.B.10：双图模式 — workspaceImage (干净原图) + maskImage (二值 mask)
      const workspaceImage = await canvasRef.current.getWorkspaceImage();
      const maskImage = await canvasRef.current.getMaskImage();

      // 2. 调用独立服务（V5.XVII.B.9：透传 maskImage 走双图路径；
      //    V5.XVII.7：透传 negativePrompt 到后端 FORBIDDEN 段）
      const newUrl = await generateInpaintImage(
        workspaceImage,
        prompt,
        referenceImage,
        originalAspectRatio,
        maskImage,
        negativePrompt,
      );

      // V5.XVII.B.10：前端 mask-outside 像素硬锁合成（mask 外字节级=原图）
      try {
        const composed = await composeMaskedResult({
          originalSrc: workspaceImage,
          generatedSrc: newUrl,
          maskSrc: maskImage,
          feather: 2,
        });
        setResultImage(composed);
      } catch (composeErr) {
        // 合成失败（CORS / 加载失败等）→ 至少不阻断用户，回退到未合成的 generated
        console.warn('[InpaintModal] composeMaskedResult failed, fallback to raw generated:', composeErr);
        setResultImage(newUrl);
      }
      setStep('comparing');
    } catch (e: any) {
      alert(`重绘失败: ${getFriendlyError(e)}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSave = () => {
    if (resultImage) {
      onSave(resultImage, `[局部重绘] ${prompt}`);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-slate-950/95 backdrop-blur-xl flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-300">
      <div className="w-full max-w-7xl h-[90vh] bg-slate-900 rounded-[2.5rem] shadow-2xl border border-slate-700 overflow-hidden flex flex-col md:flex-row">

        {/* === Left Area: Canvas / Compare === */}
        <div className="flex-1 min-w-0 min-h-0 bg-black/50 overflow-hidden flex flex-col">
          {/* Canvas / Compare view */}
          {/* min-h-0：破除 flex 子项 min-height:auto，否则 canvas 内在像素高(如 1536)
              撑破 h-[90vh]，把 brush 工具条挤出视口、图片被裁切（需缩放整页才看得全） */}
          <div className="flex-1 min-h-0 relative flex items-center justify-center p-4">
            {step === 'edit' ? (
              <InpaintCanvas
                ref={canvasRef}
                imageUrl={originalImageUrl}
                brushSize={brushSize}
              />
            ) : (
              // Compare View
              <div className="relative w-full h-full flex items-center justify-center group select-none">
                <div className="relative max-w-full max-h-full aspect-[3/4]">
                  <SafeImg src={resultImage!} className="w-full h-full object-contain" alt="Result" />
                  {/* Hold to compare */}
                  <div className="absolute inset-0 opacity-0 active:opacity-100 transition-opacity cursor-help">
                     <SafeImg src={originalImageUrl} className="w-full h-full object-contain" alt="Original" />
                     <div className="absolute top-4 left-4 bg-black/70 text-white px-3 py-1 rounded text-xs">原始图片</div>
                  </div>
                  <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-white/10 backdrop-blur text-white px-4 py-2 rounded-full text-xs font-bold pointer-events-none group-active:opacity-0 transition-opacity">
                    按住图片对比原图
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Canvas Tools — 图片下方，不遮挡涂抹区域 */}
          {step === 'edit' && (
            <div className="flex items-center justify-center px-4 py-3 border-t border-slate-800 bg-slate-900/80 backdrop-blur">
              <div className="bg-slate-800/90 p-2 rounded-2xl flex items-center gap-4 border border-slate-700 shadow-xl">
                <div className="flex items-center gap-2 px-2">
                  <span className="text-[10px] text-slate-400 font-bold uppercase">Brush</span>
                  <input
                    type="range" min="1" max="50"
                    value={brushSize}
                    onChange={(e) => setBrushSize(Number(e.target.value))}
                    className="w-24 h-2 bg-slate-600 rounded-lg appearance-none accent-indigo-500"
                  />
                </div>
                <div className="w-px h-6 bg-slate-600"></div>
                <button onClick={() => canvasRef.current?.clearMask()} className="p-2 hover:bg-slate-700 rounded-xl text-slate-300 transition-colors" title="Clear Mask">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* === Right Area: Controls === */}
        <div className="w-full md:w-[400px] bg-slate-900 border-l border-slate-800 flex flex-col h-full">
          {/* Header */}
          <div className="p-6 border-b border-slate-800 flex justify-between items-center">
             <div className="flex items-center gap-3">
               <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-xl shadow-lg shadow-indigo-900/50">🩹</div>
               <div>
                 <h2 className="text-white font-bold text-lg">局部重绘工坊</h2>
                 <p className="text-slate-500 text-xs">Smart Inpainting Studio</p>
               </div>
             </div>
             <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
               <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
             </button>
          </div>

          <div className="flex-grow overflow-y-auto p-6 space-y-8 custom-scrollbar">
             {step === 'edit' ? (
               <>
                 {/* 1. Instruction */}
                 <div className="space-y-3">
                   <label className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                     <span className="w-2 h-2 bg-indigo-500 rounded-full"></span>
                     描述修改需求 (Prompt)
                   </label>
                   <textarea
                     value={prompt}
                     onChange={(e) => setPrompt(e.target.value)}
                     placeholder="例如：把扣子改成透明树脂扣；把裤脚改短露出脚踝..."
                     className="w-full bg-slate-800 border border-slate-700 rounded-2xl p-4 text-white text-sm focus:ring-2 focus:ring-indigo-500 outline-none resize-none h-32 placeholder-slate-500 transition-all"
                   />
                 </div>

                 {/* 1.5 Negative Prompt (V5.XVII.7) */}
                 <div className="space-y-3">
                   <label className="text-xs font-bold text-rose-400 uppercase tracking-widest flex items-center gap-2">
                     <span className="w-2 h-2 bg-rose-500 rounded-full"></span>
                     绝对禁止 (Negative — 每行一条)
                   </label>
                   <textarea
                     value={negativePrompt}
                     onChange={(e) => setNegativePrompt(e.target.value)}
                     placeholder="例如：&#10;不要露出牙齿&#10;不要张嘴&#10;不要笑出酒窝"
                     className="w-full bg-rose-950/20 border border-rose-900/40 rounded-2xl p-4 text-rose-100 text-sm focus:ring-2 focus:ring-rose-500 outline-none resize-none h-24 placeholder-rose-700/60 transition-all"
                   />
                   <p className="text-[10px] text-rose-500/60 leading-relaxed">
                     生图模型对"不要 X"不敏感。在这里写下绝对不允许出现的视觉元素，会被翻译成
                     <code className="bg-rose-950/40 px-1 rounded mx-1">FORBIDDEN VISUAL ELEMENTS</code>
                     硬约束段单独喂给后端。
                   </p>
                 </div>

                 {/* 2. Reference Image */}
                 <div className="space-y-3">
                   <label className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                     <span className="w-2 h-2 bg-pink-500 rounded-full"></span>
                     细节参考图 (Reference)
                   </label>
                   <div
                    onClick={() => fileInputRef.current?.click()}
                    className={`relative w-full h-40 rounded-2xl border-2 border-dashed flex flex-col items-center justify-center cursor-pointer transition-all overflow-hidden ${referenceImage ? 'border-pink-500/50 bg-pink-900/10' : 'border-slate-700 bg-slate-800 hover:border-slate-500 hover:bg-slate-700'}`}
                   >
                     <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleReferenceUpload} />
                     {referenceImage ? (
                       <>
                         <img src={referenceImage} className="w-full h-full object-cover opacity-60" alt="ref" />
                         <div className="absolute inset-0 flex items-center justify-center">
                            <span className="bg-black/50 text-white px-3 py-1 rounded-full text-xs font-bold backdrop-blur">点击更换</span>
                         </div>
                       </>
                     ) : (
                       <div className="text-center p-4">
                         <div className="w-10 h-10 bg-slate-700 rounded-full flex items-center justify-center mx-auto mb-2 text-slate-400">
                           <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                         </div>
                         <p className="text-xs text-slate-400 font-bold">上传正确的细节图</p>
                         <p className="text-[10px] text-slate-500 mt-1">如：正确的扣子特写、背面结构图</p>
                       </div>
                     )}
                   </div>
                 </div>
               </>
             ) : (
               // Compare Mode Info
               <div className="text-center py-10 space-y-4">
                 <div className="w-16 h-16 bg-green-500/10 text-green-500 rounded-full flex items-center justify-center mx-auto text-3xl border border-green-500/20">
                   ✨
                 </div>
                 <h3 className="text-white font-bold text-xl">重绘完成</h3>
                 <p className="text-slate-400 text-sm">请在左侧仔细对比细节。</p>
                 <button
                  onClick={() => { setStep('edit'); setResultImage(null); }}
                  className="text-indigo-400 text-sm font-bold hover:text-indigo-300 underline"
                 >
                   不满意？重新调整
                 </button>
               </div>
             )}
          </div>

          {/* Footer Actions */}
          <div className="p-6 border-t border-slate-800 bg-slate-900">
            {step === 'edit' ? (
              <button
                onClick={handleGenerate}
                disabled={isProcessing}
                className={`w-full py-4 rounded-xl font-black text-white shadow-lg transition-all flex items-center justify-center gap-2 ${isProcessing ? 'bg-slate-700 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-500 active:scale-95 shadow-indigo-900/20'}`}
              >
                {isProcessing ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    <span>AI 正在修补...</span>
                  </>
                ) : (
                  <>
                    <span>执行修补 (Generate)</span>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                  </>
                )}
              </button>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                 <button
                   onClick={onClose}
                   className="py-4 rounded-xl font-bold text-slate-300 bg-slate-800 hover:bg-slate-700 transition-colors"
                 >
                   放弃
                 </button>
                 <button
                   onClick={handleSave}
                   className="py-4 rounded-xl font-black text-white bg-green-600 hover:bg-green-500 shadow-lg shadow-green-900/20 transition-all active:scale-95"
                 >
                   保存并应用
                 </button>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
};
