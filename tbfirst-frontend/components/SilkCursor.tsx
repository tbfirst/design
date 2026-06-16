import React, { useEffect, useRef } from 'react';

type Seg = {
  x1: number; y1: number;
  x2: number; y2: number;
  speed: number;
  birth: number;
};

const LIFE = 55;

const SilkCursor: React.FC = () => {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d')!;
    let raf: number;
    let frame = 0;
    let px = -9999, py = -9999;
    const segs: Seg[] = [];

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();

    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - px, dy = e.clientY - py;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 3) { px = e.clientX; py = e.clientY; return; }
      segs.push({ x1: px, y1: py, x2: e.clientX, y2: e.clientY, speed: Math.min(dist, 30), birth: frame });
      px = e.clientX; py = e.clientY;
    };

    window.addEventListener('resize', resize);
    window.addEventListener('mousemove', onMove);

    const tick = () => {
      frame++;
      while (segs.length && frame - segs[0].birth > LIFE) segs.shift();
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      for (const s of segs) {
        const t = (frame - s.birth) / LIFE;
        const fade = 1 - Math.pow(t, 1.2);

        // Faint halo
        ctx.beginPath();
        ctx.moveTo(s.x1, s.y1);
        ctx.lineTo(s.x2, s.y2);
        ctx.lineWidth = (1 + t * 1.8) * s.speed * 0.45 + 3;
        ctx.lineCap = 'round';
        ctx.strokeStyle = `rgba(35,35,45,${fade * 0.05})`;
        ctx.stroke();

        // Slim core
        const coreAlpha = Math.max(0, 1 - t * 2.8) * 0.08;
        if (coreAlpha > 0.005) {
          ctx.beginPath();
          ctx.moveTo(s.x1, s.y1);
          ctx.lineTo(s.x2, s.y2);
          ctx.lineWidth = 1.2;
          ctx.strokeStyle = `rgba(35,35,45,${coreAlpha})`;
          ctx.stroke();
        }
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMove);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      style={{
        position: 'fixed', top: 0, left: 0,
        width: '100vw', height: '100vh',
        pointerEvents: 'none', zIndex: 9999,
      }}
    />
  );
};

export default SilkCursor;
