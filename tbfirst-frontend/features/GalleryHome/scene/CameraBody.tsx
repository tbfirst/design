import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { RoundedBox } from '@react-three/drei';
import * as THREE from 'three';
import { BODY_Z, PALETTE, clamp } from '../state/galleryConfig';
import type { GalleryStateRef } from '../state/useGalleryMachine';

/**
 * Stylised camera exterior that sits in the gallery mouth. The lens barrel faces
 * the viewer; flying -Z carries you into it. The whole group fades out as you
 * cross into the interior so it never clips the camera once INSIDE.
 */
export default function CameraBody({ stateRef }: { stateRef: GalleryStateRef }) {
  const group = useRef<THREE.Group>(null);

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const op = 1 - clamp((stateRef.current.progress - 0.45) / 0.27, 0, 1);
    g.visible = op > 0.01;
    g.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m && 'opacity' in m) { m.transparent = true; m.opacity = op; }
    });
  });

  return (
    <group ref={group} position={[0, 1.5, BODY_Z]}>
      {/* body */}
      <RoundedBox args={[3.3, 2.2, 2.0]} radius={0.16} smoothness={4}>
        <meshStandardMaterial color={PALETTE.bodyCharcoal} roughness={0.55} metalness={0.25} />
      </RoundedBox>

      {/* viewfinder hump */}
      <mesh position={[0, 1.28, -0.1]}>
        <boxGeometry args={[1.0, 0.5, 1.0]} />
        <meshStandardMaterial color={PALETTE.bodyCharcoal} roughness={0.5} metalness={0.3} />
      </mesh>

      {/* lens barrel — open cylinder along Z, facing the viewer (+Z) */}
      <mesh position={[0, 0, 1.4]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.95, 1.18, 1.7, 48, 1, true]} />
        <meshStandardMaterial color={PALETTE.lensMetal} roughness={0.35} metalness={0.85} side={THREE.DoubleSide} />
      </mesh>

      {/* lens glass glint (faces the viewer) */}
      <mesh position={[0, 0, 2.2]}>
        <circleGeometry args={[0.9, 48]} />
        <meshStandardMaterial color={'#0f131c'} roughness={0.12} metalness={0.7} emissive={'#243450'} emissiveIntensity={0.6} />
      </mesh>

      {/* shutter button + dial for silhouette */}
      <mesh position={[1.05, 1.22, 0]}>
        <cylinderGeometry args={[0.16, 0.16, 0.18, 24]} />
        <meshStandardMaterial color={PALETTE.gilt} metalness={0.6} roughness={0.4} />
      </mesh>
      <mesh position={[-1.05, 1.16, 0]}>
        <cylinderGeometry args={[0.34, 0.34, 0.22, 32]} />
        <meshStandardMaterial color={'#2a2724'} metalness={0.4} roughness={0.5} />
      </mesh>
    </group>
  );
}
