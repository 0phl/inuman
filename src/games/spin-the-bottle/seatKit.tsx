import { useEffect, useMemo } from 'react';
import { BoxGeometry, PlaneGeometry } from 'three';
import { useThree, type ThreeElements } from '@react-three/fiber';
import { brassMaterial } from '../mexico/dice3d';
import { GlowDisc } from '../mexico/diceKit';
import { plateTexture, type PlateTone } from './seats';

// The name plaque for the games that sit everyone around the table (Spin the Bottle, Most Likely
// To, Ride the Bus), propped toward the camera. Layout and textures live in seats.ts. Three-only;
// the HUDs never import this.

/** Leans the plaque back from upright so it faces the fixed camera (~46° above the table). */
const LEAN = 0.72;
let plateGeo: PlaneGeometry | null = null;
let footGeo: BoxGeometry | null = null;

export interface NameplateProps extends Omit<ThreeElements['group'], 'ref'> {
  name: string;
  tone: PlateTone;
  /** Plaque width in world units; its height is a quarter of that. */
  width?: number;
  /** A soft halo on the felt under the plaque. */
  glow?: string | null;
}

/** A player's name plaque, standing on a thin brass foot and tilted toward the players. */
export function Nameplate({ name, tone, width = 0.52, glow = null, ...group }: NameplateProps) {
  const invalidate = useThree((s) => s.invalidate);
  const tex = useMemo(() => plateTexture(name, tone, invalidate), [name, tone, invalidate]);
  useEffect(() => () => tex.dispose(), [tex]);
  useEffect(() => invalidate(), [tex, invalidate]);
  plateGeo ??= new PlaneGeometry(1, 0.25);
  footGeo ??= new BoxGeometry(0.94, 0.014, 0.05);
  const h = width / 4;
  return (
    <group {...group}>
      {glow && <GlowDisc radius={width * 0.78} color={glow} opacity={0.75} position-y={0.003} />}
      <mesh
        geometry={footGeo}
        material={brassMaterial()}
        position={[0, 0.007, 0.004]}
        scale={[width, 1, 1]}
      />
      <mesh
        geometry={plateGeo}
        rotation-x={-Math.PI / 2 + LEAN}
        position={[0, 0.32 * h + 0.006, 0]}
        scale={width}
      >
        <meshBasicMaterial map={tex} transparent toneMapped={false} />
      </mesh>
    </group>
  );
}
