// Shared bootstrap for the headless Rapier pre-simulations (dice: presim.ts, throws: throwSim.ts).
// Both run in the same lazily loaded chunk family, so the WASM is instantiated once per page.
//
// Imports use relative `.ts` paths so the Node scripts (dice:check, throw:check) run unbundled.
import RAPIER from '@dimforge/rapier3d-compat';

export { RAPIER };

let ready: Promise<void> | null = null;

/** Loads and instantiates the Rapier WASM once; later calls reuse the same promise. */
export function initRapier(): Promise<void> {
  ready ??= RAPIER.init();
  return ready;
}

/** Small seeded PRNG (outside src/core, so it may live here). Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mixes a small integer (an attempt number, a salt) into a seed: a genuinely different stream. */
export function mixSeed(seed: number, n: number): number {
  let h = (seed ^ Math.imul(n + 1, 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
