import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { lerp, type PaintingDef } from '../state/galleryConfig';
import type { GalleryStateRef } from '../state/useGalleryMachine';

const PW = 2.4, PH = 3.1, FRAME = 0.16, DEPTH = 0.12;

interface Props {
  def: PaintingDef;
  texture: THREE.Texture;
  stateRef: GalleryStateRef;
  onActivate: (def: PaintingDef) => void;
  onHover: (hovered: boolean) => void;
}

/**
 * One framed painting on a wall. Hover lifts the gilt frame's glow + a slight
 * scale; a click (distinguished from a yaw-drag via the shared dragMoved flag)
 * activates the mapped service route. A front spotlight gives the museum
 * "picture light" pool.
 */
export default function Painting({ def, texture, stateRef, onActivate, onHover }: Props) {
  const group = useRef<THREE.Group>(null);
  const light = useRef<THREE.SpotLight>(null);
  const target = useRef<THREE.Group>(null);
  const scale = useRef(1);
  const [hovered, setHovered] = useState(false);

  const frameMat = useMemo(
    () => new THREE.MeshStandardMaterial({
      color: '#caa75a', metalness: 0.75, roughness: 0.35,
      emissive: new THREE.Color('#caa75a'), emissiveIntensity: 0.12,
    }),
    [],
  );
  useEffect(() => () => frameMat.dispose(), [frameMat]);

  useEffect(() => {
    if (light.current && target.current) light.current.target = target.current;
  }, []);

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    scale.current = lerp(scale.current, hovered ? 1.035 : 1, 0.15);
    g.scale.setScalar(scale.current);
    frameMat.emissiveIntensity = lerp(frameMat.emissiveIntensity, hovered ? 0.6 : 0.12, 0.15);
  });

  const setHover = (h: boolean) => { setHovered(h); onHover(h); };

  const onOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (stateRef.current.phase === 'INSIDE') setHover(true);
  };
  const onOut = () => setHover(false);
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const s = stateRef.current;
    if (s.phase !== 'INSIDE' || s.dragMoved || s.zooming) return;
    onActivate(def);
  };

  const bars = [
    { p: [0, PH / 2 + FRAME / 2, 0], s: [PW + FRAME * 2, FRAME, DEPTH] },
    { p: [0, -PH / 2 - FRAME / 2, 0], s: [PW + FRAME * 2, FRAME, DEPTH] },
    { p: [-PW / 2 - FRAME / 2, 0, 0], s: [FRAME, PH, DEPTH] },
    { p: [PW / 2 + FRAME / 2, 0, 0], s: [FRAME, PH, DEPTH] },
  ] as const;

  return (
    <group ref={group} position={def.position} rotation={[0, def.rotationY, 0]}>
      {/* front picture light aimed at the canvas (local +Z faces into the room) */}
      <spotLight
        ref={light}
        position={[0, 2.3, 1.7]}
        angle={0.6}
        penumbra={0.85}
        intensity={hovered ? 26 : 16}
        distance={9}
        color={'#fff2d8'}
      />
      <group ref={target} position={[0, 0, 0]} />

      {/* canvas */}
      <mesh onPointerOver={onOver} onPointerOut={onOut} onClick={onClick}>
        <planeGeometry args={[PW, PH]} />
        <meshStandardMaterial map={texture} roughness={0.5} metalness={0} />
      </mesh>

      {/* gilt frame */}
      {bars.map((b, i) => (
        <mesh key={i} position={b.p as unknown as [number, number, number]} material={frameMat}>
          <boxGeometry args={b.s as unknown as [number, number, number]} />
        </mesh>
      ))}
    </group>
  );
}
