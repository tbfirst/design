
import React, { useRef, useEffect, useState, useImperativeHandle, forwardRef, useCallback } from 'react';

/**
 * Canvas 涂抹画布组件：InpaintCanvas
 *
 * V5.XV.7: 首次即走同源代理 + fetch blob URL 加载
 * - GCS 直链 99% 会 CORS 失败，V5.XIV.6 的"先试直链 onerror 再 retry"白白浪费一次
 *   请求；V5.XV.7 首次就用 rewriteToProxy 改写为 /img/<key> 同源路径
 * - 加载方式从 `new Image().src = url` 改为 `fetch().then(blob)` → blob URL，
 *   优点：拿到 HTTP 状态码、credentials:'include' 自动带 token、blob URL 同源
 *   不污染 canvas（toDataURL 仍可用）
 * - 失败按 HTTP 状态分类：502/503 → 服务暂时不可用；401/403 → 图片已过期；
 *   其他 → 通用「加载失败 (HTTP xxx)」
 * - 加载中 spinner + 错误时重试按钮保留
 */
interface InpaintCanvasProps {
  imageUrl: string;
  brushSize: number;
  className?: string;
}

export interface InpaintCanvasRef {
  getMaskedImage: () => Promise<string>; // 旧：返回带红色涂抹的图（V5.XVII Sprint A 路径，保留向后兼容）
  // V5.XVII.B.7：双图模式 — 干净原图 + 二值 mask。InpaintModal 走 composeMaskedResult 合成
  getWorkspaceImage: () => Promise<string>; // 干净原图（无红色叠加）
  getMaskImage: () => Promise<string>;      // 二值 mask（黑=保留 / 白=重绘）
  clearMask: () => void;
  hasMask: () => boolean;
}

/**
 * 把 GCS 直链改写为同源 `/img/<key>` 代理路径；其他形态（已是 /img/* /
 * data: / blob: / /static/）原样返回。匹配规则与 downloadHref.toDownloadHref
 * 保持一致，但不附加 `?download=` 参数（Canvas 加载只需字节）。
 */
function rewriteToProxy(url: string): string {
  if (!url) return url;
  if (url.startsWith('/img/') || url.includes('/img/')) return url;
  // GCS 直链：https://storage.googleapis.com/<bucket>/<key>[?...]
  const m = url.match(/storage\.googleapis\.com\/[^/]+\/(.+?)(\?|$)/);
  if (m) return `/img/${m[1]}`;
  return url;
}

export const InpaintCanvas = forwardRef<InpaintCanvasRef, InpaintCanvasProps>(({ imageUrl, brushSize, className }, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // V5.XVII.B.6：off-screen 二值 mask canvas（黑=保留 / 白=重绘）。
  // 与显示 canvasRef 解耦——红色半透明涂抹仍在显示 canvas，但同步写入此 mask canvas，
  // 提交时由 InpaintCanvasRef.getMaskImage()（B.7 暴露）输出真二值 PNG。
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [loadErrorMsg, setLoadErrorMsg] = useState<string>('图片加载失败');
  const [retryNonce, setRetryNonce] = useState(0); // 用户点重试 → 递增触发 useEffect 重跑
  const [hasDrawn, setHasDrawn] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);

  // === V5.XVIII: 缩放 / 平移（zoom & pan）— 便于在小区域精细涂抹 ===
  // 通过 CSS transform 对 canvas 整体缩放/平移；getBoundingClientRect 已反映变换后的
  // AABB，故 getCoordinates 的 (clientX-rect.left)/rect.width*canvas.width 映射在任意
  // scale+translate 下仍然正确，无需改动涂抹逻辑。
  const MIN_ZOOM = 1;
  const MAX_ZOOM = 8;
  const ZOOM_STEP = 1.3;
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  const viewRef = useRef(view);
  const [isPanning, setIsPanning] = useState(false);
  const [panMode, setPanMode] = useState(false);
  const panStateRef = useRef<{ startX: number; startY: number; startView: { zoom: number; x: number; y: number } } | null>(null);
  useEffect(() => { viewRef.current = view; }, [view]);

  const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
  const clampZoom = (z: number) => clamp(z, MIN_ZOOM, MAX_ZOOM);
  // 把平移限制在「图片边缘不脱离容器中心线」范围内，避免把图拖到看不见
  const clampView = (next: { zoom: number; x: number; y: number }) => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return next;
    const crect = container.getBoundingClientRect();
    const rect = canvas.getBoundingClientRect();
    const renderedZoom = viewRef.current.zoom || 1;
    const baseW = rect.width / renderedZoom;
    const baseH = rect.height / renderedZoom;
    const scaledW = baseW * next.zoom;
    const scaledH = baseH * next.zoom;
    const maxX = Math.max(0, (scaledW - crect.width) / 2);
    const maxY = Math.max(0, (scaledH - crect.height) / 2);
    return { zoom: next.zoom, x: clamp(next.x, -maxX, maxX), y: clamp(next.y, -maxY, maxY) };
  };
  // 以屏幕某点为锚点缩放（滚轮跟随光标；按钮跟随容器中心）
  const zoomAtPoint = (v: { zoom: number; x: number; y: number }, factor: number, clientX: number, clientY: number) => {
    const z1 = clampZoom(v.zoom * factor);
    if (z1 === v.zoom) return v;
    const canvas = canvasRef.current;
    if (!canvas) return clampView({ ...v, zoom: z1 });
    const rect = canvas.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const k = z1 / v.zoom;
    return clampView({ zoom: z1, x: v.x + (clientX - cx) * (1 - k), y: v.y + (clientY - cy) * (1 - k) });
  };
  const zoomBy = (factor: number) => setView(v => {
    const container = containerRef.current;
    if (!container) return clampView({ ...v, zoom: clampZoom(v.zoom * factor) });
    const crect = container.getBoundingClientRect();
    return zoomAtPoint(v, factor, crect.left + crect.width / 2, crect.top + crect.height / 2);
  });
  const resetView = () => setView({ zoom: 1, x: 0, y: 0 });

  // 非 passive wheel 监听：滚轮以光标为锚点缩放（React onWheel 默认 passive 无法 preventDefault）
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!imageLoaded) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      setView(v => zoomAtPoint(v, factor, e.clientX, e.clientY));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [imageLoaded]);

  const beginPan = (clientX: number, clientY: number) => {
    setIsPanning(true);
    panStateRef.current = { startX: clientX, startY: clientY, startView: viewRef.current };
  };
  const movePan = (clientX: number, clientY: number) => {
    const ps = panStateRef.current;
    if (!ps) return;
    const dx = clientX - ps.startX;
    const dy = clientY - ps.startY;
    setView(clampView({ zoom: ps.startView.zoom, x: ps.startView.x + dx, y: ps.startView.y + dy }));
  };
  const endPan = () => {
    setIsPanning(false);
    panStateRef.current = null;
  };

  // V5.XV.7: 初始化 Canvas 并加载图片（fetch + blob URL 路径）
  useEffect(() => {
    if (!imageUrl) return;
    let cancelled = false;
    let blobUrl: string | null = null;
    setImageLoaded(false);
    setLoadError(false);
    setLoadErrorMsg('图片加载失败');

    const proxied = rewriteToProxy(imageUrl);
    const headers: Record<string, string> = { Accept: 'image/*' };
    try {
      const token = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('token') : null;
      if (token) headers['Authorization'] = `Bearer ${token}`;
    } catch { /* sessionStorage 不可访问 */ }

    fetch(proxied, { credentials: 'include', headers, cache: 'no-store' })
      .then(async r => {
        if (!r.ok) {
          const msg = r.status === 502 || r.status === 503
            ? '服务暂时不可用，请重试'
            : r.status === 401 || r.status === 403
              ? '图片已过期，请刷新页面重新加载'
              : `加载失败 (HTTP ${r.status})`;
          throw new Error(msg);
        }
        return r.blob();
      })
      .then(blob => {
        if (cancelled) return;
        blobUrl = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          if (cancelled) {
            if (blobUrl) URL.revokeObjectURL(blobUrl);
            return;
          }
          imgRef.current = img;
          if (canvasRef.current && containerRef.current) {
            const canvas = canvasRef.current;
            const ctx = canvas.getContext('2d');
            if (!ctx) return;
            canvas.width = img.width;
            canvas.height = img.height;
            ctx.drawImage(img, 0, 0);
            // V5.XVII.B.6：同步初始化 off-screen mask canvas（同尺寸 + 全黑 = 全保留）
            const mc = document.createElement('canvas');
            mc.width = img.width;
            mc.height = img.height;
            const mctx = mc.getContext('2d');
            if (mctx) {
              mctx.fillStyle = '#000000';
              mctx.fillRect(0, 0, mc.width, mc.height);
            }
            maskCanvasRef.current = mc;
            // V5.XVIII：新底片载入后复位缩放/平移状态
            setView({ zoom: 1, x: 0, y: 0 });
            setPanMode(false);
            setImageLoaded(true);
          }
        };
        img.onerror = () => {
          if (cancelled) return;
          console.error('[InpaintCanvas] blob decode failed');
          setLoadError(true);
          setLoadErrorMsg('图片解码失败');
          setImageLoaded(false);
        };
        img.src = blobUrl;
      })
      .catch(e => {
        if (cancelled) return;
        console.error('[InpaintCanvas] load failed:', e);
        setLoadError(true);
        setLoadErrorMsg(e instanceof Error ? e.message : '图片加载失败');
        setImageLoaded(false);
      });

    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [imageUrl, retryNonce]);

  const handleRetry = useCallback(() => {
    setLoadError(false);
    setImageLoaded(false);
    setRetryNonce(n => n + 1);
  }, []);

  // 暴露方法给父组件
  useImperativeHandle(ref, () => ({
    getMaskedImage: async () => {
      if (!canvasRef.current) return "";
      return canvasRef.current.toDataURL("image/png");
    },
    // V5.XVII.B.7：干净原图（避免红色叠加污染 Gemini 输入与前端合成）
    getWorkspaceImage: async () => {
      if (!imgRef.current) return "";
      const tmp = document.createElement('canvas');
      tmp.width = imgRef.current.width;
      tmp.height = imgRef.current.height;
      const tctx = tmp.getContext('2d');
      if (!tctx) return "";
      tctx.drawImage(imgRef.current, 0, 0);
      return tmp.toDataURL("image/png");
    },
    // V5.XVII.B.7：二值 mask PNG（黑=保留 / 白=重绘）
    getMaskImage: async () => {
      if (!maskCanvasRef.current) return "";
      return maskCanvasRef.current.toDataURL("image/png");
    },
    clearMask: () => {
      if (!canvasRef.current || !imgRef.current) return;
      const ctx = canvasRef.current.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      ctx.drawImage(imgRef.current, 0, 0);
      // V5.XVII.B.7：同步把 off-screen mask 重置为全黑
      const mctx = maskCanvasRef.current?.getContext('2d');
      if (mctx && maskCanvasRef.current) {
        mctx.fillStyle = '#000000';
        mctx.fillRect(0, 0, maskCanvasRef.current.width, maskCanvasRef.current.height);
      }
      setHasDrawn(false);
    },
    hasMask: () => hasDrawn
  }));

  const getCoordinates = (e: React.MouseEvent | React.TouchEvent) => {
    if (!canvasRef.current) return { x: 0, y: 0 };
    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = canvasRef.current.width / rect.width;
    const scaleY = canvasRef.current.height / rect.height;

    let clientX, clientY;
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = (e as React.MouseEvent).clientX;
      clientY = (e as React.MouseEvent).clientY;
    }

    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY
    };
  };

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    if (!imageLoaded) return;
    setIsDrawing(true);
    setHasDrawn(true);
    const { x, y } = getCoordinates(e);

    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(255, 50, 50, 0.6)'; // 半透明红色
      ctx.lineWidth = brushSize * (canvasRef.current!.width / 1000) * 5; // 动态画笔大小
    }
    // V5.XVII.B.7：同步把笔触写入 off-screen mask canvas（纯白 = 重绘区）
    const mctx = maskCanvasRef.current?.getContext('2d');
    if (mctx && canvasRef.current) {
      mctx.beginPath();
      mctx.moveTo(x, y);
      mctx.lineCap = 'round';
      mctx.lineJoin = 'round';
      mctx.strokeStyle = '#FFFFFF';
      mctx.lineWidth = brushSize * (canvasRef.current.width / 1000) * 5;
    }
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing || !canvasRef.current) return;
    e.preventDefault(); // 防止触摸滚动
    const { x, y } = getCoordinates(e);
    const ctx = canvasRef.current.getContext('2d');
    if (ctx) {
      ctx.lineTo(x, y);
      ctx.stroke();
    }
    // V5.XVII.B.7：mask 同步描线
    const mctx = maskCanvasRef.current?.getContext('2d');
    if (mctx) {
      mctx.lineTo(x, y);
      mctx.stroke();
    }
  };

  const stopDrawing = () => {
    setIsDrawing(false);
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) ctx.closePath();
    // V5.XVII.B.7：mask 同步收尾
    const mctx = maskCanvasRef.current?.getContext('2d');
    if (mctx) mctx.closePath();
  };

  // V5.XVIII：统一指针入口 — 平移模式 / 中键拖动 → 平移；否则 → 涂抹
  const handlePointerDown = (e: React.MouseEvent) => {
    if (!imageLoaded) return;
    if (panMode || e.button === 1) {
      e.preventDefault();
      beginPan(e.clientX, e.clientY);
      return;
    }
    if (e.button !== 0) return;
    startDrawing(e);
  };
  const handlePointerMove = (e: React.MouseEvent) => {
    if (panStateRef.current) { movePan(e.clientX, e.clientY); return; }
    draw(e);
  };
  const handlePointerUp = () => {
    if (panStateRef.current) endPan();
    else stopDrawing();
  };
  const handleTouchStart = (e: React.TouchEvent) => {
    if (!imageLoaded) return;
    if (panMode) {
      beginPan(e.touches[0].clientX, e.touches[0].clientY);
      return;
    }
    startDrawing(e);
  };
  const handleTouchMove = (e: React.TouchEvent) => {
    if (panStateRef.current) {
      e.preventDefault();
      movePan(e.touches[0].clientX, e.touches[0].clientY);
      return;
    }
    draw(e);
  };
  const handleTouchEnd = () => {
    if (panStateRef.current) endPan();
    else stopDrawing();
  };

  return (
    <div ref={containerRef} className={`relative w-full h-full flex items-center justify-center bg-slate-900/50 rounded-xl overflow-hidden ${className}`}>
      {/* 加载中 spinner — 在 loadError 与 imageLoaded 都未发生时显示 */}
      {!imageLoaded && !loadError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/80">
          <div className="w-10 h-10 border-4 border-white/20 border-t-indigo-400 rounded-full animate-spin" />
          <span className="text-xs font-medium tracking-wide">加载底片中...</span>
        </div>
      )}
      {/* 加载失败兜底 — 含重试按钮 */}
      {loadError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-white/90 bg-slate-900/80 backdrop-blur-sm">
          <svg className="w-12 h-12 text-rose-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
          </svg>
          <div className="text-sm font-bold">{loadErrorMsg}</div>
          <div className="text-xs text-white/60 max-w-xs text-center">
            底片可能因签名过期、后端不可用或网络问题无法加载。
          </div>
          <button
            onClick={handleRetry}
            className="px-5 py-2 rounded-full bg-indigo-500 hover:bg-indigo-400 text-white text-sm font-bold transition-colors active:scale-95"
          >
            重试加载
          </button>
        </div>
      )}
      <canvas
        ref={canvasRef}
        style={{
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
          transformOrigin: 'center center',
          transition: isPanning ? 'none' : 'transform 90ms ease-out',
          willChange: 'transform',
        }}
        className={`max-w-full max-h-full object-contain touch-none shadow-2xl ${loadError ? 'opacity-0 pointer-events-none' : ''} ${panMode ? (isPanning ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-crosshair'}`}
        onMouseDown={handlePointerDown}
        onMouseMove={handlePointerMove}
        onMouseUp={handlePointerUp}
        onMouseLeave={handlePointerUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      />

      {/* V5.XVIII：缩放 / 平移工具条 — 滚轮缩放、按钮 ± 缩放、✋ 平移、复位 */}
      {imageLoaded && !loadError && (
        <div className="absolute top-3 right-3 z-10 flex items-center gap-0.5 bg-slate-800/90 backdrop-blur border border-slate-700 rounded-full px-1.5 py-1 shadow-xl select-none">
          <button
            type="button"
            title="缩小"
            onClick={() => zoomBy(1 / ZOOM_STEP)}
            disabled={view.zoom <= MIN_ZOOM + 1e-3}
            className="w-7 h-7 flex items-center justify-center rounded-full text-slate-200 hover:bg-slate-700 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 12H4" /></svg>
          </button>
          <span className="text-[11px] text-slate-300 font-mono w-11 text-center tabular-nums">{Math.round(view.zoom * 100)}%</span>
          <button
            type="button"
            title="放大"
            onClick={() => zoomBy(ZOOM_STEP)}
            disabled={view.zoom >= MAX_ZOOM - 1e-3}
            className="w-7 h-7 flex items-center justify-center rounded-full text-slate-200 hover:bg-slate-700 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>
          </button>
          <div className="w-px h-5 bg-slate-600 mx-0.5" />
          <button
            type="button"
            title={panMode ? '平移模式开启中（点击切回涂抹）' : '平移模式（拖动查看局部，再点回涂抹）'}
            onClick={() => setPanMode(p => !p)}
            className={`w-7 h-7 flex items-center justify-center rounded-full transition-colors ${panMode ? 'bg-indigo-500 text-white' : 'text-slate-200 hover:bg-slate-700'}`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 11V7a2 2 0 012-2 2 2 0 012 2m0 0V5a2 2 0 114 0v6m-6 0V5a2 2 0 10-4 0v9.5a5.5 5.5 0 0011 0V9a2 2 0 10-4 0" /></svg>
          </button>
          <button
            type="button"
            title="复位 (100%)"
            onClick={resetView}
            disabled={view.zoom === 1 && view.x === 0 && view.y === 0}
            className="w-7 h-7 flex items-center justify-center rounded-full text-slate-200 hover:bg-slate-700 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
          </button>
        </div>
      )}
    </div>
  );
});

InpaintCanvas.displayName = "InpaintCanvas";
