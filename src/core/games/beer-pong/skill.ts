import { z } from 'zod';
import type { PlayerId } from '../../engine/types';

// Shared by the skill games (Beer Pong, Quarters, Flip Cup): team forming and the
// physics boundary. Throwing clients simulate; reducers only check what they report.

export const TEAM_MODES = ['alternate', 'halves'] as const;
export type TeamMode = (typeof TEAM_MODES)[number];
export type TeamIndex = 0 | 1;

export const otherTeam = (t: TeamIndex): TeamIndex => (t === 0 ? 1 : 0);

/**
 * Splits the seat order into two teams. alternate: seats 1, 3, 5… vs 2, 4, 6…;
 * halves: the first ceil(n/2) seats vs the rest. Two or more players give two non-empty teams.
 */
export function formTeams(order: readonly PlayerId[], mode: TeamMode): [PlayerId[], PlayerId[]] {
  if (mode === 'alternate') {
    return [order.filter((_, i) => i % 2 === 0), order.filter((_, i) => i % 2 === 1)];
  }
  const half = Math.ceil(order.length / 2);
  return [order.slice(0, half), order.slice(half)];
}

/**
 * Largest throw impulse a reducer accepts (|impulse|, mass × launch velocity, in the stage's
 * world units — ~4 per metre, see src/stage/tableSpace.ts — and kilograms). Rule-independent and
 * deliberately loose: it only rejects garbage today, and gives a future room host a fixed bound to
 * re-simulate against. Clients must clamp their gesture to it.
 */
export const MAX_IMPULSE = 50;

/** Largest distance (world units) of a throw's origin from the table centre. */
export const MAX_ORIGIN = 20;

/** A 3D vector [x, y, z]. Zod's number() already rejects NaN and ±Infinity. */
export const vec3Schema = z.tuple([z.number(), z.number(), z.number()]);
export type Vec3 = z.output<typeof vec3Schema>;

const finite3 = (v: readonly number[]): boolean => v.length === 3 && v.every(Number.isFinite);

/**
 * Plausibility check for a client-reported throw: three finite components each,
 * |impulse| ≤ MAX_IMPULSE, and |origin| ≤ MAX_ORIGIN.
 */
export function isSaneThrow(impulse: readonly number[], origin: readonly number[]): boolean {
  return (
    finite3(impulse) &&
    finite3(origin) &&
    Math.hypot(...impulse) <= MAX_IMPULSE &&
    Math.hypot(...origin) <= MAX_ORIGIN
  );
}
