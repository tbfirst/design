import { useEffect, useRef, useState } from 'react';
import { Engine, World, Bodies, Body, Sleeping } from 'matter-js';

const DEBUG_PHYSICS = false;
const FIXED_STEP_MS = 1000 / 60;
const MAX_STEPS_PER_FRAME = 3;
const MAX_FRAME_DELTA_MS = 250;
const MAX_DPR = 2;
const WALL_THICKNESS = 80;
const GRAVITY_Y = 1;
const BODY_DEFAULTS = {
  friction: 0.8,
  frictionAir: 0.015,
  restitution: 0.08,
  density: 0.001,
};

type BodyKind = 'triangle' | 'square' | 'pentagon' | 'hexagon';

const SHAPE_SIDES: Record<BodyKind, number> = {
  triangle: 3,
  square: 4,
  pentagon: 5,
  hexagon: 6,
};

const BODY_KINDS: readonly BodyKind[] = ['triangle', 'square', 'pentagon', 'hexagon'];

interface ColorEntry {
  hex: string;
  weight: number;
}

const PALETTE_HEX: readonly ColorEntry[] = [
  { hex: '#FFB5C5', weight: 0.19 },
  { hex: '#FFE5A8', weight: 0.19 },
  { hex: '#A8D8FF', weight: 0.19 },
  { hex: '#B5E8C8', weight: 0.19 },
  { hex: '#D8B5FF', weight: 0.19 },
  { hex: '#FFFAF0', weight: 0.05 },
];

function pickPaletteColor(): string {
  const r = Math.random();
  let acc = 0;
  for (const entry of PALETTE_HEX) {
    acc += entry.weight;
    if (r <= acc) return entry.hex;
  }
  return PALETTE_HEX[0].hex;
}

interface BodyMeta {
  kind: BodyKind;
  color: string;
  size: number;
}

const RADIUS_MIN = 16;
const RADIUS_MAX = 32;
const MOUSE_REPULSOR_RADIUS = 76;
const MOUSE_INFLUENCE_RADIUS = MOUSE_REPULSOR_RADIUS * 1.5;
const MOUSE_VEL_EMA = 0.3;
const MOUSE_FAST_SPEED = 12;
const MOUSE_IMPULSE_GAIN = 0.5;
const BODY_MAX_VELOCITY = 18;
const BODY_MAX_ANGULAR_VELOCITY = 0.3;
const FPS_DEGRADE_THRESHOLD = 45;
const FPS_RECOVERY_THRESHOLD = 55;
const FPS_STREAK_FRAMES = 60;
const BODY_CULL_RATIO = 0.3;
const CAT_DEFAULT = 0x0001;
const CAT_WALL = 0x0002;
const CAT_MOUSE = 0x0004;

function createPolygonBody(kind: BodyKind, x: number, y: number, r: number) {
  const sides = SHAPE_SIDES[kind];
  const angle = Math.random() * Math.PI * 2;
  const meta: BodyMeta = { kind, color: pickPaletteColor(), size: r };
  const body = Bodies.polygon(x, y, sides, r, {
    ...BODY_DEFAULTS,
    angle,
    label: `body-${kind}`,
  });
  body.plugin = meta;
  return body;
}

function pickBodyKind(): BodyKind {
  return BODY_KINDS[Math.floor(Math.random() * BODY_KINDS.length)];
}

function detectDesktopBodyCount(): number {
  if (typeof navigator === 'undefined') return 192;
  const hw = navigator.hardwareConcurrency ?? 0;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 0;
  return hw >= 8 && mem >= 8 ? 260 : 192;
}

function pickSpawnX(W: number, padding: number): number {
  const usable = W - 2 * padding;
  if (usable <= 0) return W / 2;
  if (Math.random() < 0.8) {
    const sideThird = usable / 3;
    return Math.random() < 0.5
      ? padding + Math.random() * sideThird
      : W - padding - Math.random() * sideThird;
  }
  return padding + Math.random() * usable;
}

type QualityTier = 'desktop' | 'mobile';

function detectQualityTier(): QualityTier {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return 'desktop';
  const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const multiTouch = (navigator.maxTouchPoints ?? 0) > 1;
  return coarsePointer || multiTouch ? 'mobile' : 'desktop';
}

export default function PhysicsBottleBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [qualityTier] = useState<QualityTier>(detectQualityTier);

  useEffect(() => {
    if (qualityTier === 'mobile') return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const engine = Engine.create();
    engine.gravity.y = GRAVITY_Y;
    engine.enableSleeping = true;
    const world = engine.world;

    const buildWalls = () => {
      const W = canvas.clientWidth;
      const H = canvas.clientHeight;
      const T = WALL_THICKNESS;
      const wallOpts = {
        isStatic: true as const,
        collisionFilter: { category: CAT_WALL, mask: CAT_DEFAULT },
      };
      return [
        Bodies.rectangle(W / 2, H + T / 2, W + 2 * T, T, { ...wallOpts, label: 'wall-bottom' }),
        Bodies.rectangle(W / 2, -T / 2, W + 2 * T, T, { ...wallOpts, label: 'wall-top' }),
        Bodies.rectangle(-T / 2, H / 2, T, H + 2 * T, { ...wallOpts, label: 'wall-left' }),
        Bodies.rectangle(W + T / 2, H / 2, T, H + 2 * T, { ...wallOpts, label: 'wall-right' }),
      ];
    };
    let walls = buildWalls();
    World.add(world, walls);

    const mouseBody = Bodies.circle(-1e4, -1e4, MOUSE_REPULSOR_RADIUS, {
      isStatic: true,
      label: 'mouseRepulsor',
      collisionFilter: { category: CAT_MOUSE, mask: CAT_DEFAULT },
    });
    World.add(world, mouseBody);

    const latestMouse = { x: -1e4, y: -1e4 };
    const prevMouse = { x: -1e4, y: -1e4 };
    const mouseVel = { x: 0, y: 0 };
    const onPointerMove = (e: PointerEvent) => {
      latestMouse.x = e.clientX;
      latestMouse.y = e.clientY;
    };
    const parkMouse = () => {
      latestMouse.x = -1e4;
      latestMouse.y = -1e4;
    };
    window.addEventListener('pointermove', onPointerMove);
    document.addEventListener('mouseleave', parkMouse);
    window.addEventListener('blur', parkMouse);

    const totalCount = detectDesktopBodyCount();
    let spawned = 0;
    let spawnIntervalId: ReturnType<typeof setInterval> | null = null;
    const spawnBatch = () => {
      const W = canvas.clientWidth;
      const H = canvas.clientHeight;
      const remaining = totalCount - spawned;
      const batchSize = Math.min(4 + Math.floor(Math.random() * 5), remaining);
      const batch = [];
      for (let i = 0; i < batchSize; i++) {
        const x = pickSpawnX(W, RADIUS_MAX);
        const y = H * 0.10 + Math.random() * H * 0.25;
        const r = RADIUS_MIN + Math.random() * (RADIUS_MAX - RADIUS_MIN);
        const body = createPolygonBody(pickBodyKind(), x, y, r);
        Body.setAngularVelocity(body, (Math.random() - 0.5) * 0.1);
        batch.push(body);
      }
      if (batch.length > 0) World.add(world, batch);
      spawned += batch.length;
      if (spawned >= totalCount && spawnIntervalId !== null) {
        clearInterval(spawnIntervalId);
        spawnIntervalId = null;
      }
    };
    spawnIntervalId = setInterval(spawnBatch, 80);

    const resetStack = () => {
      const dynamicBodies = world.bodies.filter((b) => !b.isStatic);
      if (dynamicBodies.length > 0) World.remove(world, dynamicBodies);
      spawned = 0;
      if (spawnIntervalId === null) {
        spawnIntervalId = setInterval(spawnBatch, 80);
      }
    };
    const onDblClick = () => {
      resetStack();
    };
    window.addEventListener('dblclick', onDblClick);

    const recycleIntervalId = setInterval(() => {
      const W = canvas.clientWidth;
      const H = canvas.clientHeight;
      const margin = 300;
      for (const body of world.bodies) {
        if (body.isStatic) continue;
        const { x, y } = body.position;
        if (x < -margin || x > W + margin || y < -margin || y > H + margin) {
          Body.setPosition(body, {
            x: pickSpawnX(W, RADIUS_MAX),
            y: H * 0.10 + Math.random() * H * 0.25,
          });
          Body.setVelocity(body, { x: 0, y: 0 });
          Body.setAngularVelocity(body, 0);
        }
      }
    }, 2000);

    const rebuildWalls = () => {
      World.remove(world, walls);
      walls = buildWalls();
      World.add(world, walls);
    };

    const clampBodiesToViewport = () => {
      const W = canvas.clientWidth;
      const H = canvas.clientHeight;
      const margin = 20;
      for (const body of world.bodies) {
        if (body.isStatic) continue;
        const { x, y } = body.position;
        const nx = Math.min(Math.max(x, margin), W - margin);
        const ny = Math.min(Math.max(y, margin), H - margin);
        if (nx !== x || ny !== y) {
          Body.setPosition(body, { x: nx, y: ny });
          Body.setVelocity(body, { x: 0, y: 0 });
          Body.setAngularVelocity(body, 0);
        }
      }
    };

    let renderDegraded = false;
    let bodyCullDone = false;
    let lowFpsStreak = 0;
    let highFpsStreak = 0;
    let avgFrameDelta = FIXED_STEP_MS;

    const syncSize = () => {
      const cap = renderDegraded ? 1 : MAX_DPR;
      const dpr = Math.min(window.devicePixelRatio || 1, cap);
      const cssW = canvas.clientWidth;
      const cssH = canvas.clientHeight;
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    syncSize();

    const onResize = () => {
      syncSize();
      rebuildWalls();
      clampBodiesToViewport();
    };
    window.addEventListener('resize', onResize);

    let rafId = 0;
    let lastTimeMs = performance.now();
    let accumulator = 0;

    const tick = (now: number) => {
      const frameDelta = now - lastTimeMs;
      lastTimeMs = now;
      if (frameDelta > MAX_FRAME_DELTA_MS) {
        accumulator = 0;
      } else {
        accumulator += frameDelta;
        avgFrameDelta = avgFrameDelta * 0.9 + frameDelta * 0.1;
        const fps = 1000 / avgFrameDelta;
        if (fps < FPS_DEGRADE_THRESHOLD) {
          lowFpsStreak++;
          highFpsStreak = 0;
        } else if (fps >= FPS_RECOVERY_THRESHOLD) {
          highFpsStreak++;
          lowFpsStreak = 0;
        }
        if (lowFpsStreak >= FPS_STREAK_FRAMES && !bodyCullDone) {
          bodyCullDone = true;
          renderDegraded = true;
          const dyn = world.bodies.filter((b) => !b.isStatic);
          const cullCount = Math.floor(dyn.length * BODY_CULL_RATIO);
          if (cullCount > 0) World.remove(world, dyn.slice(0, cullCount));
          syncSize();
          // eslint-disable-next-line no-console
          console.debug('[PhysicsBottleBackground] entering degraded mode');
        }
        if (highFpsStreak >= FPS_STREAK_FRAMES && renderDegraded) {
          renderDegraded = false;
          syncSize();
          // eslint-disable-next-line no-console
          console.debug('[PhysicsBottleBackground] visual quality recovered');
        }
      }
      Body.setPosition(mouseBody, latestMouse);

      if (latestMouse.x < -9000) {
        prevMouse.x = latestMouse.x;
        prevMouse.y = latestMouse.y;
        mouseVel.x = 0;
        mouseVel.y = 0;
      } else if (prevMouse.x < -9000) {
        prevMouse.x = latestMouse.x;
        prevMouse.y = latestMouse.y;
      } else {
        const dx = latestMouse.x - prevMouse.x;
        const dy = latestMouse.y - prevMouse.y;
        prevMouse.x = latestMouse.x;
        prevMouse.y = latestMouse.y;
        mouseVel.x = MOUSE_VEL_EMA * dx + (1 - MOUSE_VEL_EMA) * mouseVel.x;
        mouseVel.y = MOUSE_VEL_EMA * dy + (1 - MOUSE_VEL_EMA) * mouseVel.y;
      }

      const mouseSpeed = Math.hypot(mouseVel.x, mouseVel.y);
      const inViewport = latestMouse.x > -9000;
      const isFast = inViewport && mouseSpeed > MOUSE_FAST_SPEED;
      if (inViewport) {
        const dirX = isFast ? mouseVel.x / mouseSpeed : 0;
        const dirY = isFast ? mouseVel.y / mouseSpeed : 0;
        const excess = isFast ? mouseSpeed - MOUSE_FAST_SPEED : 0;
        for (const body of world.bodies) {
          if (body.isStatic) continue;
          const bdx = body.position.x - latestMouse.x;
          const bdy = body.position.y - latestMouse.y;
          const dist = Math.hypot(bdx, bdy);
          if (dist > MOUSE_INFLUENCE_RADIUS) continue;
          if (body.isSleeping) Sleeping.set(body, false);
          if (!isFast) continue;
          const att = 1 - dist / MOUSE_INFLUENCE_RADIUS;
          const ix = dirX * excess * MOUSE_IMPULSE_GAIN * att;
          const iy = dirY * excess * MOUSE_IMPULSE_GAIN * att;
          let vx = body.velocity.x + ix;
          let vy = body.velocity.y + iy;
          const mag = Math.hypot(vx, vy);
          if (mag > BODY_MAX_VELOCITY) {
            vx = (vx / mag) * BODY_MAX_VELOCITY;
            vy = (vy / mag) * BODY_MAX_VELOCITY;
          }
          Body.setVelocity(body, { x: vx, y: vy });
        }
      }

      let steps = 0;
      while (accumulator >= FIXED_STEP_MS && steps < MAX_STEPS_PER_FRAME) {
        Engine.update(engine, FIXED_STEP_MS);
        accumulator -= FIXED_STEP_MS;
        steps++;
      }
      if (accumulator > FIXED_STEP_MS) accumulator = 0;

      for (const body of world.bodies) {
        if (body.isStatic) continue;
        const vx = body.velocity.x;
        const vy = body.velocity.y;
        const mag = Math.hypot(vx, vy);
        if (mag > BODY_MAX_VELOCITY) {
          Body.setVelocity(body, {
            x: (vx / mag) * BODY_MAX_VELOCITY,
            y: (vy / mag) * BODY_MAX_VELOCITY,
          });
        }
        const av = body.angularVelocity;
        if (av > BODY_MAX_ANGULAR_VELOCITY) {
          Body.setAngularVelocity(body, BODY_MAX_ANGULAR_VELOCITY);
        } else if (av < -BODY_MAX_ANGULAR_VELOCITY) {
          Body.setAngularVelocity(body, -BODY_MAX_ANGULAR_VELOCITY);
        }
      }

      const cssW = canvas.clientWidth;
      const cssH = canvas.clientHeight;
      ctx.fillStyle = '#fafafa';
      ctx.fillRect(0, 0, cssW, cssH);

      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      const useShadow = !renderDegraded;
      if (useShadow) {
        ctx.shadowBlur = 6;
        ctx.shadowOffsetY = 2;
      }
      for (const body of world.bodies) {
        if (body.isStatic) continue;
        const meta = body.plugin as BodyMeta | undefined;
        if (!meta) continue;
        const verts = body.vertices;
        ctx.beginPath();
        ctx.moveTo(verts[0].x, verts[0].y);
        for (let i = 1; i < verts.length; i++) ctx.lineTo(verts[i].x, verts[i].y);
        ctx.closePath();
        ctx.fillStyle = meta.color;
        if (useShadow) ctx.shadowColor = 'rgba(0,0,0,0.12)';
        ctx.fill();
        if (useShadow) ctx.shadowColor = 'transparent';
        ctx.stroke();
      }
      if (useShadow) {
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;
      }

      if (DEBUG_PHYSICS) {
        ctx.strokeStyle = 'rgba(6,182,212,0.5)';
        ctx.lineWidth = 2;
        ctx.strokeRect(1, 1, cssW - 2, cssH - 2);

        ctx.lineWidth = 1.5;
        for (const body of world.bodies) {
          const label = typeof body.label === 'string' ? body.label : '';
          if (body.isStatic && label.startsWith('wall-')) {
            ctx.strokeStyle = 'rgba(6,182,212,0.6)';
            const verts = body.vertices;
            ctx.beginPath();
            ctx.moveTo(verts[0].x, verts[0].y);
            for (let i = 1; i < verts.length; i++) ctx.lineTo(verts[i].x, verts[i].y);
            ctx.closePath();
            ctx.stroke();
          } else if (label === 'mouseRepulsor') {
            const r = body.circleRadius ?? 0;
            ctx.strokeStyle = 'rgba(245,158,11,0.7)';
            ctx.beginPath();
            ctx.arc(body.position.x, body.position.y, r, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = 'rgba(245,158,11,0.85)';
            ctx.fillText(`r=${r}`, body.position.x + r + 4, body.position.y);
          } else if (!body.isStatic) {
            ctx.strokeStyle = 'rgba(239,68,68,0.5)';
            const { min, max } = body.bounds;
            ctx.strokeRect(min.x, min.y, max.x - min.x, max.y - min.y);
          }
        }

        ctx.fillStyle = 'rgba(15,23,42,0.55)';
        ctx.font = '12px ui-monospace, SFMono-Regular, Menlo, monospace';
        const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
        ctx.fillText('PhysicsBottleBackground · M2.4 debug', 12, 22);
        ctx.fillText(`viewport ${cssW}×${cssH} · dpr ${dpr} · bodies ${world.bodies.length}`, 12, 40);
      }

      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      if (spawnIntervalId !== null) {
        clearInterval(spawnIntervalId);
        spawnIntervalId = null;
      }
      clearInterval(recycleIntervalId);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('mouseleave', parkMouse);
      window.removeEventListener('blur', parkMouse);
      window.removeEventListener('dblclick', onDblClick);
      World.clear(world, false);
      Engine.clear(engine);
    };
  }, [qualityTier]);

  if (qualityTier === 'mobile') return null;

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 0,
        display: 'block',
      }}
    />
  );
}
