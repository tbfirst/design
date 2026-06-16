import React from 'react';
import { toProxiedSrc, makeImgErrorFallback } from '@/services/shared/imageSrc';

/** 全屏放大查看完整图（点击遮罩/× 关闭）。复用于上传预览、模特库、审片台。 */
export default function Lightbox({ src, onClose }: { src: string | null; onClose: () => void }) {
  if (!src) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(28,24,20,0.82)',
        backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 28, cursor: 'zoom-out',
      }}
    >
      <img
        src={toProxiedSrc(src)}
        onError={makeImgErrorFallback()}
        alt="full"
        onClick={e => e.stopPropagation()}
        style={{
          maxWidth: '94vw', maxHeight: '92vh', objectFit: 'contain',
          borderRadius: 10, boxShadow: '0 24px 80px rgba(0,0,0,0.45)', cursor: 'default',
        }}
      />
      <button
        onClick={onClose}
        title="关闭"
        style={{
          position: 'fixed', top: 18, right: 24, fontSize: 30, lineHeight: 1, color: '#FBF8F2',
          background: 'none', border: 'none', cursor: 'pointer',
        }}
      >
        ×
      </button>
    </div>
  );
}
