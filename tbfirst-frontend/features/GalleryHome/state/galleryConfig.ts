// ── Gallery layout, camera waypoints, palette and math helpers ──────────────
// Coordinate convention: the hall runs along -Z (into the screen); the camera
// dollies along Z; +Y is up. The lens axis is the Z axis, so "fly through the
// lens" == translate toward -Z.

export type PaintingId = 'image' | 'cinestitch' | 'agent' | 'memory';

export interface PaintingDef {
  id: PaintingId;
  route: string;
  titleZh: string;
  subtitleEn: string;
  emoji: string;
  tint: string;   // light accent hue
  deep: string;   // rich base hue
  position: [number, number, number];
  rotationY: number;
}

// Hall geometry (units ≈ metres).
export const HALL = {
  halfWidth: 6,    // side walls at x = ±6
  height: 6,       // floor y = 0, ceiling y = 6
  entranceZ: 6,    // gallery mouth (where the camera body sits)
  backZ: -22,      // back wall
};

// The camera body group sits in the gallery mouth, lens facing the viewer (+Z).
export const BODY_Z = 7;

// Camera dolly waypoints. progress 0 → 1 maps OUTSIDE → INSIDE.
export const CAM = {
  zOutside: 11,
  zInside: 0,
  yOutside: 1.5,
  yInside: 1.7,
  fovOutside: 55,
  fovInside: 62,
};

// Look clamps + sensitivities while INSIDE (radians; rad per px of drag).
export const LOOK = {
  yawMin: -1.05,
  yawMax: 1.05,
  pitchMin: -0.12,
  pitchMax: 0.12,
  yawSens: 0.0045,
  pitchSens: 0.0026,
};

const PY = 2.3; // painting centre height

// Two paintings per wall so a left↔right yaw sweep reveals all four.
export const PAINTINGS: PaintingDef[] = [
  {
    id: 'image', route: '/workspace',
    titleZh: '图像生成', subtitleEn: 'Image Studio',
    emoji: '🎨', tint: '#E7EEF7', deep: '#2f5d96',
    position: [-HALL.halfWidth + 0.12, PY, -5], rotationY: Math.PI / 2,
  },
  {
    id: 'cinestitch', route: '/cinestitch',
    titleZh: '分镜生成', subtitleEn: 'Storyboard',
    emoji: '🎬', tint: '#F3E7E1', deep: '#a85b3c',
    position: [-HALL.halfWidth + 0.12, PY, -12], rotationY: Math.PI / 2,
  },
  {
    id: 'agent', route: '/agent',
    titleZh: 'AI 协作', subtitleEn: 'Agent',
    emoji: '🤖', tint: '#E8F0E8', deep: '#3f7d5a',
    position: [HALL.halfWidth - 0.12, PY, -5], rotationY: -Math.PI / 2,
  },
  {
    id: 'memory', route: '/profile/memory',
    titleZh: '个人记忆库', subtitleEn: 'Profile Memory',
    emoji: '🧠', tint: '#EDE7F7', deep: '#6d4bbd',
    position: [HALL.halfWidth - 0.12, PY, -12], rotationY: -Math.PI / 2,
  },
];

// Museum / Louvre palette.
export const PALETTE = {
  bg: '#0c0a07',
  wallLeft: '#6e1f23',   // salon rouge
  wallRight: '#7d6a4a',  // warm sandstone
  backWall: '#3a2f24',
  floor: '#2a2620',
  ceiling: '#15120e',
  gilt: '#caa75a',
  bodyCharcoal: '#1c1a17',
  lensMetal: '#3a3a40',
};

// ── Math helpers ────────────────────────────────────────────────────────────
export const clamp = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, v));

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
