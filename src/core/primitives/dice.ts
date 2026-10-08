// Dice math shared by the reducer side (face values) and the physics side (reading and
// remapping orientations). Quaternions are [x, y, z, w]; vectors are [x, y, z]; +Y is up.
//
// Outcome-first dice: the reducer rolls faces with the seeded RNG, the client pre-simulates
// a throw, reads which face physically landed up, then rotates the *visual* mesh inside the
// symmetric cube collider by remap(landed, target) so the RNG's face shows on top.

import type { Rng } from '../engine/rng';

export type Face = 1 | 2 | 3 | 4 | 5 | 6;
export type Vec3 = readonly [number, number, number];
export type Quat = readonly [number, number, number, number];

export const FACES: readonly Face[] = [1, 2, 3, 4, 5, 6];

/** Local outward normals; opposite faces sum to 7. Die meshes must be modelled to match. */
export const FACE_NORMALS: Readonly<Record<Face, Vec3>> = {
  1: [0, 1, 0],
  6: [0, -1, 0],
  2: [1, 0, 0],
  5: [-1, 0, 0],
  3: [0, 0, 1],
  4: [0, 0, -1],
};

/** Below this alignment with world-up the die is "cocked" (leaning) and the throw is redone. */
export const COCKED_THRESHOLD = 0.9;

export const IDENTITY: Quat = [0, 0, 0, 1];

export function rotate(q: Quat, v: Vec3): [number, number, number] {
  const [x, y, z, w] = q;
  const [vx, vy, vz] = v;
  // t = 2 * cross(q.xyz, v); v' = v + w * t + cross(q.xyz, t)
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  return [
    vx + w * tx + (y * tz - z * ty),
    vy + w * ty + (z * tx - x * tz),
    vz + w * tz + (x * ty - y * tx),
  ];
}

export function multiply(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export function fromAxisAngle(axis: Vec3, angle: number): Quat {
  const s = Math.sin(angle / 2);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
}

/** Which face points most nearly up for a die with world orientation q. */
export function topFace(q: Quat): { face: Face; alignment: number } {
  let best: Face = 1;
  let alignment = -Infinity;
  for (const face of FACES) {
    const up = rotate(q, FACE_NORMALS[face])[1];
    if (up > alignment) {
      alignment = up;
      best = face;
    }
  }
  return { face: best, alignment };
}

export const isCocked = (q: Quat): boolean => topFace(q).alignment < COCKED_THRESHOLD;

/**
 * Local rotation R with R·n(target) = n(landed). Rendering the visual mesh at
 * colliderRotation · R makes `target` the face that shows on top.
 */
export function remap(landed: Face, target: Face): Quat {
  if (landed === target) return IDENTITY;
  const a = FACE_NORMALS[target];
  const b = FACE_NORMALS[landed];
  if (landed + target === 7) {
    // Opposite faces: half-turn about any axis perpendicular to them.
    const axis: Vec3 = a[1] !== 0 ? [1, 0, 0] : [0, 1, 0];
    return fromAxisAngle(axis, Math.PI);
  }
  // Adjacent faces: quarter-turn about a × b (already unit length for axis-aligned normals).
  const axis: Vec3 = [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  return fromAxisAngle(axis, Math.PI / 2);
}

// ---- Reducer side: outcome-first rolls -------------------------------------------------

/**
 * A public roll as games store it. The reducer picks `faces` with the seeded RNG; the UI animates
 * physical dice that land on exactly those faces, then dispatches `SETTLED { rollId: id }`.
 * Games score a roll only once `settled` is true.
 */
export interface DiceRoll {
  /** Increments with every roll, so the UI can tell a new throw from a re-render. */
  id: number;
  faces: Face[];
  settled: boolean;
}

export const rollFace = (rng: Rng): Face => rng.int(1, 6) as Face;

export const rollFaces = (rng: Rng, count: number): Face[] =>
  Array.from({ length: Math.max(0, count) }, () => rollFace(rng));
