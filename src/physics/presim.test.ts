import { beforeAll, describe, expect, it } from 'vitest';
import { FACES, multiply, remap, topFace, type Face, type Quat } from '@/core/primitives/dice';
import { DEFAULT_TRAY, DIE_SIZE, FRAME_STRIDE } from './diceConfig';
import { initRapier, presimulateThrow, type PresimResult } from './presim';

const pose = (r: PresimResult, count: number, frame: number, die: number) => {
  const o = (frame * count + die) * FRAME_STRIDE;
  const f = (j: number) => r.frames[o + j] ?? NaN;
  return { p: [f(0), f(1), f(2)] as const, q: [f(3), f(4), f(5), f(6)] as Quat };
};

describe('presimulateThrow', () => {
  beforeAll(async () => {
    await initRapier();
  });

  it('records steps × count × 7 floats and reads the landed face from the last frame', async () => {
    const r = await presimulateThrow({ count: 3, throwSeed: 7 });
    expect(r.frames.length).toBe(r.steps * 3 * FRAME_STRIDE);
    expect(r.steps).toBeGreaterThan(10);
    expect(r.steps).toBeLessThanOrEqual(361);
    for (let d = 0; d < 3; d++)
      expect(r.landed[d]).toBe(topFace(pose(r, 3, r.steps - 1, d).q).face);
  });

  it('is deterministic for a seed and varies across seeds', async () => {
    const a = await presimulateThrow({ count: 5, throwSeed: 1234 });
    const b = await presimulateThrow({ count: 5, throwSeed: 1234 });
    const c = await presimulateThrow({ count: 5, throwSeed: 1235 });
    expect(Array.from(b.frames)).toEqual(Array.from(a.frames));
    expect(Array.from(c.frames)).not.toEqual(Array.from(a.frames));
  });

  it('100 throws of 5: remap always shows the target, few stay cocked, all settle in the tray', async () => {
    let dice = 0;
    let stuck = 0;
    let mismatches = 0;
    for (let i = 0; i < 100; i++) {
      const r = await presimulateThrow({ count: 5, throwSeed: i * 7919 + 1 });
      for (let d = 0; d < 5; d++) {
        dice++;
        const { p, q } = pose(r, 5, r.steps - 1, d);
        const target = FACES[(i + d * 5) % 6] as Face;
        if (topFace(multiply(q, remap(r.landed[d] as Face, target))).face !== target) mismatches++;
        if (r.cocked[d]) stuck++;
        expect(Math.abs(p[0])).toBeLessThan(DEFAULT_TRAY.width / 2);
        expect(Math.abs(p[2])).toBeLessThan(DEFAULT_TRAY.depth / 2);
        expect(p[1]).toBeGreaterThan(0);
      }
    }
    expect(mismatches).toBe(0);
    expect(stuck / dice).toBeLessThan(0.01);
  });

  it('throws around dice that stay put (obstacles are never overlapped)', async () => {
    const first = await presimulateThrow({ count: 5, throwSeed: 99 });
    const kept = [0, 1].map((d) => pose(first, 5, first.steps - 1, d));
    const r = await presimulateThrow({ count: 3, throwSeed: 100, obstacles: kept });
    for (let d = 0; d < 3; d++) {
      const { p } = pose(r, 3, r.steps - 1, d);
      for (const k of kept) {
        const dist = Math.hypot(p[0] - k.p[0], p[1] - k.p[1], p[2] - k.p[2]);
        expect(dist).toBeGreaterThan(DIE_SIZE * 0.95);
      }
    }
  });

  it('handles zero dice', async () => {
    const r = await presimulateThrow({ count: 0, throwSeed: 1 });
    expect(r.landed).toEqual([]);
    expect(r.frames.length).toBe(0);
  });
});
