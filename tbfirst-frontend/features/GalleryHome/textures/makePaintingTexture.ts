import * as THREE from 'three';
import type { PaintingDef } from '../state/galleryConfig';

// Deterministic per-id RNG so a painting's texture is stable across renders.
function seededRand(seed: number): () => number {
  let s = seed | 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) | 0; return (s >>> 0) / 4294967296; };
}
function hashStr(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
function rgba(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

const W = 512;
const H = 660;

/**
 * Procedural "painting" — abstract gradient art + a faint emoji glyph + a baked
 * Chinese title card. Baking the label into the 2D canvas means we never have to
 * ship a CJK font for a 3D text helper (the canvas uses the browser's font stack).
 * Same procedural-canvas philosophy as components/EmbossRevealCanvas.tsx.
 */
export function makePaintingTexture(def: PaintingDef): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const rand = seededRand(hashStr(def.id));

  // base gradient
  const g = ctx.createLinearGradient(0, 0, W * 0.5, H);
  g.addColorStop(0, def.deep);
  g.addColorStop(1, '#0e0c0a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // soft tinted bloom
  const bx = W * (0.3 + rand() * 0.4), by = H * (0.22 + rand() * 0.28);
  const rg = ctx.createRadialGradient(bx, by, 0, bx, by, W * 0.75);
  rg.addColorStop(0, rgba(def.tint, 0.55));
  rg.addColorStop(1, rgba(def.tint, 0));
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, W, H);

  // additive translucent shapes
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 7; i++) {
    const x = rand() * W, y = rand() * H * 0.82, r = W * (0.06 + rand() * 0.2);
    const sg = ctx.createRadialGradient(x, y, 0, x, y, r);
    sg.addColorStop(0, rgba(def.tint, 0.16));
    sg.addColorStop(1, rgba(def.tint, 0));
    ctx.fillStyle = sg;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }

  // thin gilt brush strokes
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = rgba('#caa75a', 0.22);
  for (let i = 0; i < 4; i++) {
    ctx.lineWidth = 1 + rand() * 2;
    ctx.beginPath();
    ctx.moveTo(rand() * W, rand() * H * 0.8);
    ctx.bezierCurveTo(rand() * W, rand() * H, rand() * W, rand() * H, rand() * W, rand() * H * 0.8);
    ctx.stroke();
  }

  // faint emoji glyph
  ctx.globalAlpha = 0.15;
  ctx.font = `${Math.round(W * 0.5)}px serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(def.emoji, W / 2, H * 0.38);
  ctx.globalAlpha = 1;

  // title card band
  const cardY = H - 134;
  ctx.fillStyle = 'rgba(12,10,8,0.64)';
  ctx.fillRect(0, cardY, W, H - cardY);
  ctx.fillStyle = '#caa75a';
  ctx.fillRect(36, cardY + 28, 42, 3);
  ctx.fillStyle = '#f4efe6';
  ctx.font = `600 ${Math.round(W * 0.092)}px 'Noto Sans SC', sans-serif`;
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillText(def.titleZh, 36, cardY + 82);
  ctx.fillStyle = 'rgba(244,239,230,0.62)';
  ctx.font = `400 ${Math.round(W * 0.04)}px 'Noto Sans SC', sans-serif`;
  ctx.fillText(def.subtitleEn.toUpperCase(), 38, cardY + 110);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}
