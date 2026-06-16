import { useEffect, useRef, useState } from 'react';
import { LOOK, clamp } from './galleryConfig';

export type Phase = 'OUTSIDE' | 'ENTERING' | 'INSIDE' | 'EXITING';

export interface GalleryState {
  progress: number;        // actual, lerped each frame
  progressTarget: number;  // wheel/touch-driven target
  yaw: number;
  yawTarget: number;
  pitch: number;
  pitchTarget: number;
  dragging: boolean;
  dragMoved: boolean;      // pointer moved past the click/drag threshold
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  exitAccum: number;       // accumulated upward wheel while INSIDE → triggers exit
  phase: Phase;            // mirror of React phase for frame/handler logic (no stale closure)
  zooming: boolean;        // a painting zoom-to-navigate transition is in progress
}

export type GalleryStateRef = React.MutableRefObject<GalleryState>;

const SCROLL_SENS = 0.0016;   // progress per px of wheel deltaY
const TOUCH_SENS = 0.0024;    // progress per px of vertical touch-drag
const EXIT_THRESHOLD = 220;   // accumulated upward wheel to leave INSIDE
const DRAG_THRESHOLD = 4;     // px before a press counts as a drag (not a click)

/**
 * OUTSIDE → ENTERING → INSIDE → EXITING state machine.
 * State lives in a ref (mutated by native wheel/pointer listeners and by the
 * per-frame CameraRig) so the React tree never re-renders during interaction.
 * `phase` is surfaced as React state only on the ~4 transitions (cursor/overlay).
 */
export function useGalleryMachine(containerRef: React.RefObject<HTMLDivElement | null>) {
  const stateRef = useRef<GalleryState>({
    progress: 0, progressTarget: 0,
    yaw: 0, yawTarget: 0, pitch: 0, pitchTarget: 0,
    dragging: false, dragMoved: false,
    startX: 0, startY: 0, lastX: 0, lastY: 0,
    exitAccum: 0, phase: 'OUTSIDE', zooming: false,
  });
  const [phase, setPhase] = useState<Phase>('OUTSIDE');

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const s = stateRef.current;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();              // page is fixed; the wheel drives the dolly
      if (s.zooming) return;
      if (s.phase === 'INSIDE') {
        // scroll-up (sustained) reverses out of the camera; scroll-down is consumed
        if (e.deltaY < 0) {
          s.exitAccum += -e.deltaY;
          if (s.exitAccum > EXIT_THRESHOLD) {
            s.progressTarget = 0;
            s.exitAccum = 0;
            s.yawTarget = 0; s.pitchTarget = 0;
          }
        } else {
          s.exitAccum = 0;
        }
      } else {
        s.progressTarget = clamp(s.progressTarget + e.deltaY * SCROLL_SENS, 0, 1);
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      s.dragging = true;
      s.dragMoved = false;
      s.startX = s.lastX = e.clientX;
      s.startY = s.lastY = e.clientY;
      s.exitAccum = 0;
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!s.dragging) return;
      const dx = e.clientX - s.lastX;
      const dy = e.clientY - s.lastY;
      s.lastX = e.clientX; s.lastY = e.clientY;
      if (!s.dragMoved && Math.hypot(e.clientX - s.startX, e.clientY - s.startY) > DRAG_THRESHOLD) {
        s.dragMoved = true;
      }
      if (s.phase === 'INSIDE') {
        // drag-right → look right, drag-down → look down (FPS-style, clamped to the walls)
        s.yawTarget = clamp(s.yawTarget - dx * LOOK.yawSens, LOOK.yawMin, LOOK.yawMax);
        s.pitchTarget = clamp(s.pitchTarget - dy * LOOK.pitchSens, LOOK.pitchMin, LOOK.pitchMax);
      } else if (e.pointerType === 'touch') {
        // touch devices that still pass the 3D gate: vertical swipe drives the dolly
        s.progressTarget = clamp(s.progressTarget - dy * TOUCH_SENS, 0, 1);
      }
    };

    const onPointerUp = () => { s.dragging = false; };

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);

    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }, [containerRef]);

  return { stateRef, phase, setPhase };
}
