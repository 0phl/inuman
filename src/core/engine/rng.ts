// Seeded PRNG (mulberry32). The whole RNG state is one uint32, so it serializes
// into session state and makes every game replayable from (seed, actions).

export type RngState = number;

export interface Rng {
  /** Float in [0, 1). */
  random(): number;
  /** Integer in [min, max], inclusive. */
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  /** Fisher–Yates; returns a new array. */
  shuffle<T>(items: readonly T[]): T[];
  /** Current state, to be stored back into session state after a reduce. */
  readonly state: RngState;
}

export function createRng(seed: RngState): Rng {
  let s = seed >>> 0;
  const random = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
  return {
    random,
    int,
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new Error('rng.pick: empty array');
      return items[int(0, items.length - 1)] as T;
    },
    shuffle<T>(items: readonly T[]): T[] {
      const out = items.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = int(0, i);
        [out[i], out[j]] = [out[j] as T, out[i] as T];
      }
      return out;
    },
    get state() {
      return s;
    },
  };
}
