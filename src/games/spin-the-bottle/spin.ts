// Analytic spins for the bottle (Spin the Bottle) and the prize wheel (Truth or Dare). The reducer
// decides where a spin lands; these only animate it. No physics, so a spin always lands exactly.

export const TAU = Math.PI * 2;

/** Angle in [0, 2π). */
export const wrap = (a: number): number => ((a % TAU) + TAU) % TAU;

/** Smallest unsigned angle between two directions, in [0, π]. */
export const angleBetween = (a: number, b: number): number => {
  const d = wrap(a - b);
  return d > Math.PI ? TAU - d : d;
};

export interface SpinPlan {
  from: number;
  /** Total angle turned (≥ 0); the spin ends at `from + delta`. */
  delta: number;
  /** Seconds. */
  duration: number;
}

/**
 * A spin that starts at `from`, turns forward (increasing angle) through `turns` full turns and
 * stops pointing at `to`. Constant deceleration: θ(t) = θ0 + ω0·t − ½·α·t², with ω0 = 2Δθ/T and
 * α = ω0/T, so the angular velocity reaches exactly 0 at the target.
 */
export function planSpin(from: number, to: number, turns: number, duration: number): SpinPlan {
  const delta = wrap(to - from) + TAU * Math.max(0, Math.round(turns));
  return { from, delta, duration: Math.max(duration, 0.05) };
}

/** Angle at `t` seconds into the spin (clamped to the start and the end). */
export function angleAt(p: SpinPlan, t: number): number {
  const T = p.duration;
  const s = Math.min(Math.max(t, 0), T);
  const w0 = (2 * p.delta) / T;
  const alpha = w0 / T;
  return p.from + w0 * s - 0.5 * alpha * s * s;
}

/** Angular velocity at `t` (rad/s); 0 from the end of the spin on. */
export function velocityAt(p: SpinPlan, t: number): number {
  const T = p.duration;
  if (t >= T) return 0;
  const w0 = (2 * p.delta) / T;
  return w0 - (w0 / T) * Math.max(t, 0);
}

/** Flick strength 0..1 → seconds: a soft flick turns for ~2.5 s, a hard one for ~5 s. */
export const durationFor = (power: number): number =>
  2.5 + 2.5 * Math.min(Math.max(Number.isFinite(power) ? power : 0.5, 0), 1);

/** Deterministic 0…1 noise, so a reload lands a settled spin in exactly the same spot. */
export function hash01(n: number): number {
  const a = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return a - Math.floor(a);
}

/**
 * Where inside a seat's wedge the bottle stops: up to ±55% of the half-gap to the nearest
 * neighbour (capped so two players still read as a clear pick), varied per spin.
 */
export function wedgeOffset(yaws: readonly number[], i: number, seed: number): number {
  const n = yaws.length;
  const me = yaws[i];
  if (me === undefined || n < 2) return 0;
  let gap = Math.PI;
  for (let j = 0; j < n; j++) {
    if (j === i) continue;
    gap = Math.min(gap, angleBetween(me, yaws[j] as number));
  }
  const half = Math.min(gap / 2, 0.5);
  return (hash01(seed) * 2 - 1) * 0.55 * half;
}

/** Turns a flick (px/ms, from the gesture's release velocity) into SPIN power, 0..1. */
export const powerFromFlick = (speed: number): number =>
  Math.min(1, Math.max(0.08, (speed - 0.15) / 2.6));
