import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { CAM, clamp, easeInOutCubic, lerp } from '../state/galleryConfig';
import type { GalleryStateRef, Phase } from '../state/useGalleryMachine';

interface Props {
  stateRef: GalleryStateRef;
  setPhase: (p: Phase) => void;
}

/**
 * Single source of camera motion: every frame it eases `progress`, `yaw` and
 * `pitch` toward their targets, applies them to the real Three camera, and
 * derives the phase (notifying React only on change).
 */
export default function CameraRig({ stateRef, setPhase }: Props) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;

  useFrame(() => {
    const s = stateRef.current;

    s.progress += (s.progressTarget - s.progress) * 0.08;
    s.yaw += (s.yawTarget - s.yaw) * 0.12;
    s.pitch += (s.pitchTarget - s.pitch) * 0.12;

    const eased = easeInOutCubic(clamp(s.progress, 0, 1));
    camera.position.set(0, lerp(CAM.yOutside, CAM.yInside, eased), lerp(CAM.zOutside, CAM.zInside, eased));

    // free-look only fades in over the last stretch of the dolly
    const insideF = clamp((s.progress - 0.82) / 0.18, 0, 1);
    camera.rotation.order = 'YXZ';
    camera.rotation.y = s.yaw * insideF;
    camera.rotation.x = s.pitch * insideF;
    camera.rotation.z = 0;

    const fov = lerp(CAM.fovOutside, CAM.fovInside, eased) - (s.zooming ? 7 : 0);
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }

    const next: Phase =
      s.progress < 0.02 ? 'OUTSIDE'
      : s.progress > 0.985 ? 'INSIDE'
      : s.progressTarget >= s.progress ? 'ENTERING'
      : 'EXITING';
    if (next !== s.phase) { s.phase = next; setPhase(next); }
  });

  return null;
}
