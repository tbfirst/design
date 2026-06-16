import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { CAM, PALETTE, PAINTINGS, type PaintingDef } from './state/galleryConfig';
import { useGalleryMachine } from './state/useGalleryMachine';
import { makePaintingTexture } from './textures/makePaintingTexture';
import CameraRig from './scene/CameraRig';
import CameraBody from './scene/CameraBody';
import GalleryRoom from './scene/GalleryRoom';
import Painting from './scene/Painting';

/**
 * The WebGL home experience. `useNavigate()` is called here, OUTSIDE <Canvas>,
 * and passed down as a callback so we never depend on router context crossing
 * the R3F reconciler boundary.
 */
export default function GalleryExperience() {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const { stateRef, phase, setPhase } = useGalleryMachine(containerRef);
  const [paintHover, setPaintHover] = useState(false);
  const [veil, setVeil] = useState(false);

  // procedural textures: built once, disposed on unmount
  const textures = useMemo(() => PAINTINGS.map((p) => makePaintingTexture(p)), []);
  useEffect(() => () => textures.forEach((t) => t.dispose()), [textures]);

  const activate = (def: PaintingDef) => {
    if (stateRef.current.zooming) return;
    stateRef.current.zooming = true;
    setVeil(true);
    window.setTimeout(() => navigate(def.route), 620);
  };

  const enterGallery = () => { stateRef.current.progressTarget = 1; };
  const exitGallery = () => {
    const s = stateRef.current;
    s.progressTarget = 0; s.yawTarget = 0; s.pitchTarget = 0; s.exitAccum = 0;
  };

  const inside = phase === 'INSIDE';
  const cursor = paintHover ? 'pointer' : inside ? 'grab' : 'default';

  return (
    <div
      ref={containerRef}
      style={{ position: 'fixed', inset: 0, overflow: 'hidden', background: PALETTE.bg, cursor, touchAction: 'none' }}
    >
      <Canvas
        dpr={[1, 1.75]}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        camera={{ position: [0, CAM.yOutside, CAM.zOutside], fov: CAM.fovOutside, near: 0.1, far: 80 }}
      >
        <color attach="background" args={[PALETTE.bg]} />
        <fog attach="fog" args={[PALETTE.bg, 16, 46]} />

        <ambientLight intensity={0.4} color={'#fff3e0'} />
        <pointLight position={[0, 5, 2]} intensity={22} distance={32} color={'#ffe9c7'} />
        <pointLight position={[0, 4.5, -14]} intensity={28} distance={36} color={'#ffe7c0'} />
        <pointLight position={[0, 2.4, 9]} intensity={12} distance={18} color={'#9fb6e0'} />

        <CameraRig stateRef={stateRef} setPhase={setPhase} />

        <React.Suspense fallback={null}>
          <CameraBody stateRef={stateRef} />
          <GalleryRoom>
            {PAINTINGS.map((p, i) => (
              <Painting
                key={p.id}
                def={p}
                texture={textures[i]}
                stateRef={stateRef}
                onActivate={activate}
                onHover={setPaintHover}
              />
            ))}
          </GalleryRoom>
        </React.Suspense>
      </Canvas>

      {/* ── DOM overlays ─────────────────────────────────────────────────── */}
      <div style={{ position: 'absolute', top: 22, left: 26, pointerEvents: 'none', userSelect: 'none' }}>
        <div style={{ fontSize: 12, letterSpacing: '0.32em', color: 'rgba(202,167,90,0.85)', fontWeight: 600 }}>
          BRANDGENIUS · GALLERY
        </div>
        <div style={{ fontSize: 12.5, color: 'rgba(244,239,230,0.55)', marginTop: 4 }}>
          {inside ? '拖动环顾 · 点击画作进入服务' : '向下滚动 · 步入相机内部'}
        </div>
      </div>

      {/* scroll-to-enter hint */}
      <AnimatePresence>
        {phase === 'OUTSIDE' && (
          <motion.div
            key="hint"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6 }}
            style={{
              position: 'absolute', bottom: 38, left: '50%', transform: 'translateX(-50%)',
              textAlign: 'center', color: 'rgba(244,239,230,0.72)', pointerEvents: 'none', userSelect: 'none',
            }}
          >
            <div style={{ fontSize: 13, letterSpacing: '0.18em' }}>向下滚动进入展厅</div>
            <motion.div
              animate={{ y: [0, 7, 0] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
              style={{ marginTop: 8, fontSize: 18, color: 'rgba(202,167,90,0.9)' }}
            >
              ↓
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* skip / exit control */}
      <button
        onClick={inside ? exitGallery : enterGallery}
        style={{
          position: 'absolute', top: 20, right: 24, zIndex: 5,
          padding: '8px 16px', borderRadius: 999, cursor: 'pointer',
          background: 'rgba(20,17,13,0.55)', color: 'rgba(244,239,230,0.85)',
          border: '1px solid rgba(202,167,90,0.45)', fontSize: 12.5, letterSpacing: '0.08em',
          backdropFilter: 'blur(6px)',
        }}
      >
        {inside ? '退出相机' : '直接进入 →'}
      </button>

      {/* navigate veil */}
      <AnimatePresence>
        {veil && (
          <motion.div
            key="veil"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.55 }}
            style={{ position: 'absolute', inset: 0, background: PALETTE.bg, pointerEvents: 'none' }}
          />
        )}
      </AnimatePresence>

      {/* a11y: visually-hidden direct links so keyboard/AT users can navigate */}
      <nav aria-label="服务导航" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
        {PAINTINGS.map((p) => (
          <a key={p.id} href={p.route} onClick={(e) => { e.preventDefault(); navigate(p.route); }}>
            {p.titleZh}
          </a>
        ))}
      </nav>
    </div>
  );
}
