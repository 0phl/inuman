import { MeshStandardMaterial, Quaternion, Vector3 } from 'three';
import { remap, type Face } from '@/core/primitives/dice';
import { woodTextures } from '@/stage/proceduralTextures';

// Small math shared by the dice games' scenes (Mexico, Ship Captain & Crew, Liar's Dice).

export const reducedMotion = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Deterministic 0…1 noise from a number (stable "dropped by hand" offsets). */
export function hash01(n: number): number {
  const a = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return a - Math.floor(a);
}

export const easeInOut = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
export const easeOut = (t: number): number => 1 - Math.pow(1 - t, 3);
export const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));

const Y_AXIS = new Vector3(0, 1, 0);

/** World orientation that shows `face` on top, turned `yaw` radians about the vertical. */
export function faceUpQuaternion(face: Face, yaw = 0): Quaternion {
  const r = remap(1, face); // R·n(face) = n(1) = +Y
  const q = new Quaternion(r[0], r[1], r[2], r[3]);
  return q.premultiply(new Quaternion().setFromAxisAngle(Y_AXIS, yaw));
}

let narra: MeshStandardMaterial | null = null;
let brass: MeshStandardMaterial | null = null;

/**
 * Narra wood for trays and the dock. It carries a little of its own grain as emissive so faces
 * turned away from the bar's lights never go flat black.
 */
export function narraMaterial(): MeshStandardMaterial {
  if (narra) return narra;
  const { map, roughnessMap } = woodTextures(128);
  narra = new MeshStandardMaterial({
    color: '#b07a52',
    map,
    roughnessMap,
    roughness: 0.6,
    emissive: '#ffffff',
    emissiveMap: map,
    emissiveIntensity: 0.2,
    envMapIntensity: 0.8,
  });
  return narra;
}

/** Polished brass trim (tray caps, the dock's edge). */
export function brassMaterial(): MeshStandardMaterial {
  brass ??= new MeshStandardMaterial({ color: '#c9913a', metalness: 0.85, roughness: 0.34 });
  return brass;
}
