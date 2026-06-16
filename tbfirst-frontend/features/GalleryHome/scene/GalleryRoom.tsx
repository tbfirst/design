import React from 'react';
import { HALL, PALETTE } from '../state/galleryConfig';

/**
 * The Louvre-style hall: floor, two coloured side walls, back wall, dark coffered
 * ceiling, and gilt skirting/cornice running the length of each wall. Paintings
 * are passed in as children so they sit inside the room's coordinate space.
 */
export default function GalleryRoom({ children }: { children?: React.ReactNode }) {
  const { halfWidth, height, entranceZ, backZ } = HALL;
  const depth = entranceZ - backZ;
  const midZ = (entranceZ + backZ) / 2;

  return (
    <group>
      {/* floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, midZ]}>
        <planeGeometry args={[halfWidth * 2, depth]} />
        <meshStandardMaterial color={PALETTE.floor} roughness={0.32} metalness={0.12} />
      </mesh>

      {/* ceiling */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, height, midZ]}>
        <planeGeometry args={[halfWidth * 2, depth]} />
        <meshStandardMaterial color={PALETTE.ceiling} roughness={0.9} />
      </mesh>

      {/* left wall (salon rouge), normal faces +X */}
      <mesh rotation={[0, Math.PI / 2, 0]} position={[-halfWidth, height / 2, midZ]}>
        <planeGeometry args={[depth, height]} />
        <meshStandardMaterial color={PALETTE.wallLeft} roughness={0.92} />
      </mesh>

      {/* right wall (sandstone), normal faces -X */}
      <mesh rotation={[0, -Math.PI / 2, 0]} position={[halfWidth, height / 2, midZ]}>
        <planeGeometry args={[depth, height]} />
        <meshStandardMaterial color={PALETTE.wallRight} roughness={0.92} />
      </mesh>

      {/* back wall */}
      <mesh position={[0, height / 2, backZ]}>
        <planeGeometry args={[halfWidth * 2, height]} />
        <meshStandardMaterial color={PALETTE.backWall} roughness={0.9} />
      </mesh>

      {/* gilt skirting + cornice along both side walls */}
      {[0.16, height - 0.16].map((y, i) => (
        <group key={i}>
          <mesh position={[-halfWidth + 0.03, y, midZ]}>
            <boxGeometry args={[0.06, 0.16, depth]} />
            <meshStandardMaterial color={PALETTE.gilt} metalness={0.6} roughness={0.4} />
          </mesh>
          <mesh position={[halfWidth - 0.03, y, midZ]}>
            <boxGeometry args={[0.06, 0.16, depth]} />
            <meshStandardMaterial color={PALETTE.gilt} metalness={0.6} roughness={0.4} />
          </mesh>
        </group>
      ))}

      {children}
    </group>
  );
}
