/**
 * ImageModal.tsx — 全屏图片预览弹窗组件
 */
import React, { useState, useEffect, useCallback } from 'react';
import { GeneratedImage } from '../types';
import { toDownloadHref } from '../services/shared/downloadHref';
import { downloadAndFavorite } from '../services/shared/saveBlobAs';
import { toProxiedSrc, makeImgErrorFallback } from '../services/shared/imageSrc';
import { authService } from '../features/Auth/authService';

interface ImageModalProps {
  images: GeneratedImage[];
  currentIndex: number;
  onNavigate: (index: number) => void;
  onClose: () => void;
  onRefine?: (img: GeneratedImage) => void;
  selectedBaseImages?: string[];
  onSendToTone?: (img: GeneratedImage) => void;
  p3Queue?: GeneratedImage[];
  // V5.XIV.7: Phase2/Phase3 成品的局部重绘入口（独立 prop，避免与 onRefine 耦合）
  onInpaint?: (img: GeneratedImage) => void;
}

export const ImageModal: React.FC<ImageModalProps> = ({
  images, currentIndex, onNavigate, onClose, onRefine, selectedBaseImages = [], onSendToTone, p3Queue = [], onInpaint
}) => {
  const currentImage = images[currentIndex];
  const isSelected = currentImage ? selectedBaseImages.includes(currentImage.url) : false;
  const isInToneQueue = currentImage ? p3Queue.some(i => i.id === currentImage.id) : false;
  const [showingOriginal, setShowingOriginal] = useState(false);
  // V5.XIV.8: 下载按钮点击立即显示 spinner，避免用户因 fetch + picker 延迟以为没响应
  const [isDownloading, setIsDownloading] = useState(false);

  const handlePrev = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (currentIndex > 0) onNavigate(currentIndex - 1);
    else onNavigate(images.length - 1);
  }, [currentIndex, images.length, onNavigate]);

  const handleNext = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (currentIndex < images.length - 1) onNavigate(currentIndex + 1);
    else onNavigate(0);
  }, [currentIndex, images.length, onNavigate]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') handlePrev();
      if (e.key === 'ArrowRight') handleNext();
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handlePrev, handleNext, onClose]);

  useEffect(() => { setShowingOriginal(false); }, [currentIndex]);

  // V5.XI-2.4：大图下载走 saveBlobAs.downloadAndFavorite 'auto' 模式，
  // 复用 HistoryModal 已设的账号级默认下载目录；未设则弹原生另存为。
  // V5.XV.5: 显式区分 failed / cancelled / saved-fallback：
  //   - 'failed'   → 必须 alert，按钮恢复可点
  //   - 'cancelled'→ 静默（用户主动取消另存为对话框）
  //   - 'saved'/'fallback' → 浏览器原生下载栏即反馈，不弹"已成功"toast；
  //     仅当 needsAlert 非空（fallback 场景的"已用浏览器默认目录"提示）才 alert
  const handleDownload = useCallback(async () => {
    if (!currentImage || isDownloading) return;
    setIsDownloading(true);
    try {
      const filename = `brandgenius-${currentImage.id}.png`;
      const url = toDownloadHref(currentImage.url, filename);
      const userId = authService.getCurrentUser()?.userId ?? null;
      const r = await downloadAndFavorite({ url, filename, userId, mode: 'auto' });
      if (r.result === 'failed') {
        alert(r.needsAlert || '下载失败，请重试');
      } else if ((r.result === 'saved' || r.result === 'fallback') && r.needsAlert) {
        alert(r.needsAlert);
      }
      // 'cancelled' 静默
    } finally {
      setIsDownloading(false);
    }
  }, [currentImage, isDownloading]);

  if (!currentImage) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-md p-4 animate-in fade-in duration-200" onClick={onClose}>
      <button onClick={onClose} className="absolute top-6 right-6 text-white/50 hover:text-white bg-white/10 hover:bg-white/20 rounded-full p-2 transition-colors z-50 shadow-xl">
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M6 18L18 6M6 6l12 12"></path></svg>
      </button>
      {images.length > 1 && (
        <>
          <button onClick={handlePrev} className="absolute left-4 sm:left-10 top-1/2 -translate-y-1/2 p-4 bg-white/5 hover:bg-white/20 text-white rounded-full transition-all z-40 border border-white/10 backdrop-blur-sm group">
            <svg className="w-8 h-8 group-hover:-translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7"></path></svg>
          </button>
          <button onClick={handleNext} className="absolute right-4 sm:right-10 top-1/2 -translate-y-1/2 p-4 bg-white/5 hover:bg-white/20 text-white rounded-full transition-all z-40 border border-white/10 backdrop-blur-sm group">
            <svg className="w-8 h-8 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"></path></svg>
          </button>
        </>
      )}
      <div className="relative w-full h-full flex flex-col items-center justify-center" onClick={e => e.stopPropagation()}>
        <div className="relative group max-h-[80vh] flex items-center justify-center">
          <img key={currentImage.id} src={toProxiedSrc(showingOriginal && currentImage.originalUrl ? currentImage.originalUrl : currentImage.url)} onError={makeImgErrorFallback()} alt="Full view" className="max-h-[80vh] max-w-full object-contain rounded-lg shadow-2xl animate-in zoom-in-95 duration-300" />
          <div className="absolute -top-12 left-1/2 -translate-x-1/2 bg-black/50 backdrop-blur-md text-white/80 px-4 py-1.5 rounded-full text-xs font-bold border border-white/10">
            {currentIndex + 1} / {images.length}
          </div>
          {currentImage.actionLabel && (
             <div className="absolute top-4 left-4 bg-purple-600/90 backdrop-blur-md text-white px-3 py-1 rounded-full text-xs font-bold shadow-lg border border-white/20">
               {currentImage.actionLabel}
             </div>
          )}
        </div>
        <div className="mt-6 flex flex-col items-center gap-4 w-full max-w-4xl animate-in slide-in-from-bottom-4 duration-300">
           <div className="bg-gray-900/80 backdrop-blur-xl px-6 py-3 rounded-2xl border border-white/10 flex flex-wrap justify-center items-center gap-4 shadow-2xl">
              {(currentImage.phase === 1 || currentImage.phase === 3) && onRefine && (
                 <button onClick={() => { onRefine(currentImage); }} className={`px-6 py-2.5 rounded-xl font-bold shadow-lg transition-all flex items-center gap-2 active:scale-95 ${isSelected ? 'bg-indigo-600 text-white' : 'bg-white text-indigo-600 hover:bg-indigo-50'}`}>
                   {/* V5.XIV.7: Phase3 时文案从「局部重绘 / 精修参考」改为「设为精修参考」
                       避免与下方 onInpaint 按钮的「局部重绘」语义混淆 */}
                   <span>{isSelected ? '已选为精修参考' : '设为精修参考'}</span>
                   <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d={isSelected ? "M5 13l4 4L19 7" : "M12 4v16m8-8H4"}></path>
                   </svg>
                 </button>
              )}
              {/* V5.XIV.7: Phase2/Phase3 成品可走局部重绘 — 涂抹 mask 区域后只重绘
                  涂抹处，识别为 inpaint 任务；与 onRefine（选作参考图）语义独立。 */}
              {(currentImage.phase === 2 || currentImage.phase === 3) && onInpaint && (
                 <button onClick={() => { onInpaint(currentImage); }} className="px-6 py-2.5 rounded-xl font-bold shadow-lg transition-all flex items-center gap-2 active:scale-95 bg-white text-purple-600 hover:bg-purple-50 border border-purple-200">
                   <span>局部重绘</span>
                   <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/>
                   </svg>
                 </button>
              )}
              {currentImage.phase === 2 && onSendToTone && (
                 <button onClick={() => { onSendToTone(currentImage); }} className={`px-6 py-2.5 rounded-xl font-bold shadow-lg transition-all flex items-center gap-2 active:scale-95 ${isInToneQueue ? 'bg-rose-600 text-white' : 'bg-white text-rose-600 hover:bg-rose-50 border border-rose-200'}`}>
                   <span>{isInToneQueue ? '已送往影调精修' : '送往影调精修'}</span>
                   <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d={isInToneQueue ? "M5 13l4 4L19 7" : "M12 4v16m8-8H4"}></path>
                   </svg>
                 </button>
              )}
              {currentImage.phase === 3 && currentImage.originalUrl && (
                <button
                  onMouseDown={() => setShowingOriginal(true)}
                  onMouseUp={() => setShowingOriginal(false)}
                  onMouseLeave={() => setShowingOriginal(false)}
                  onTouchStart={e => { e.preventDefault(); setShowingOriginal(true); }}
                  onTouchEnd={() => setShowingOriginal(false)}
                  className={`px-6 py-2.5 rounded-xl font-bold transition-all flex items-center gap-2 select-none ${showingOriginal ? 'bg-rose-600 text-white' : 'bg-white/10 hover:bg-white/20 text-white border border-white/20'}`}
                >
                  <span>{showingOriginal ? '原图对比中...' : '长按看对比原图'}</span>
                </button>
              )}
              <button type="button" disabled={isDownloading} onClick={(e) => { e.stopPropagation(); handleDownload(); }} className={`bg-white/10 hover:bg-white/20 text-white px-6 py-2.5 rounded-xl font-bold transition-all flex items-center gap-2 ${isDownloading ? 'opacity-60 cursor-wait' : ''}`} title="走账号默认下载目录；未设默认时弹原生另存为对话框">
                {isDownloading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>准备下载...</span>
                  </>
                ) : (
                  <>
                    <span>下载原图</span>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                  </>
                )}
              </button>
           </div>
           {currentImage.promptUsed && (
             <p className="text-white/40 text-[10px] text-center max-w-2xl px-4 uppercase tracking-widest font-mono">
               AI 配置参数: {currentImage.promptUsed.slice(0, 100)}...
             </p>
           )}
        </div>
      </div>
    </div>
  );
};
