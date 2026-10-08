import type { Ref } from 'react';
import type { Mesh } from 'three';
import type { ThreeElements } from '@react-three/fiber';
import { DIE_SIZE } from '@/physics/diceConfig';
import { useTier } from '@/stage/stageStore';
import { dieGeometry, dieMaterial } from './diceTextures';

type Die3DProps = Omit<ThreeElements['mesh'], 'geometry' | 'material'> & {
  /** 'ivory' | 'red-casino' | 'wood' (theme.diceMaterialId); unknown ids fall back to ivory. */
  materialId?: string;
  /** Edge length in world units (default DIE_SIZE, the size the physics uses). */
  size?: number;
  ref?: Ref<Mesh>;
};

/**
 * One die, centred on its origin, unrotated = 1 up (+Y), 2 on +X, 3 on +Z (FACE_NORMALS).
 * Geometry and material are shared across every die of the same tier/material: 1 draw call each.
 */
export function Die3D({ materialId, size = DIE_SIZE, ref, ...mesh }: Die3DProps) {
  const tier = useTier() ?? 'mid';
  return (
    <mesh
      ref={ref}
      geometry={dieGeometry(tier)}
      material={dieMaterial(materialId, tier)}
      scale={size / DIE_SIZE}
      {...mesh}
    />
  );
}
