import React, { useState } from 'react';

// The heavy three/R3F/drei bundle is isolated here so it loads ONLY for capable
// clients on /home — never on the fallback path or the four service routes.
const GalleryExperience = React.lazy(() => import('./GalleryExperience'));
// Reuse the existing intro page as the accessible fallback (it already links all
// four routes and matches the app's visual language).
const ServiceIntroPage = React.lazy(() => import('../../pages/ServiceIntroPage'));

function canRender3D(): boolean {
  if (typeof window === 'undefined') return false;
  const mm = window.matchMedia;
  const reduce = mm?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const coarse = mm?.('(pointer: coarse)').matches ?? false;
  const narrow = mm?.('(max-width: 768px)').matches ?? false;
  let webgl = false;
  try {
    const c = document.createElement('canvas');
    webgl = !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { /* no WebGL */ }
  return webgl && !reduce && !coarse && !narrow;
}

/**
 * /home entry. Picks the immersive 3D gallery for capable desktops, or the
 * accessible card-grid fallback (ServiceIntroPage) for mobile / reduced-motion /
 * no-WebGL clients. The decision is taken once on mount.
 */
export default function GalleryHome() {
  const [use3D] = useState(canRender3D);
  return (
    <React.Suspense fallback={<div style={{ position: 'fixed', inset: 0, background: '#0c0a07' }} />}>
      {use3D ? <GalleryExperience /> : <ServiceIntroPage />}
    </React.Suspense>
  );
}
