import { describe, expect, it } from 'vitest';
import { DEFAULT_FLICK_TUNING, inThrowZone, measureFlick, type FlickSample } from './useFlick';

const W = 412;
const H = 915;

/** A swipe from (x0, y0) moving at (vx, vy) px/ms for `ms`, sampled every 8 ms. */
const swipe = (
  x0: number,
  y0: number,
  vx: number,
  vy: number,
  ms: number,
  t0 = 1000,
): FlickSample[] => {
  const out: FlickSample[] = [];
  for (let t = 0; t <= ms; t += 8) out.push({ x: x0 + vx * t, y: y0 + vy * t, t: t0 + t });
  return out;
};

describe('measureFlick', () => {
  it('a quick upward swipe is a flick pointing up, with power from its speed', () => {
    const f = measureFlick(swipe(206, 800, 0, -2.5, 160), W, H);
    expect(f).not.toBeNull();
    expect(f?.direction[1]).toBeCloseTo(-1, 6);
    expect(f?.speed).toBeCloseTo((2.5 * 1000) / H, 3);
    const expected =
      ((2.5 * 1000) / H - DEFAULT_FLICK_TUNING.minSpeed) /
      (DEFAULT_FLICK_TUNING.maxSpeed - DEFAULT_FLICK_TUNING.minSpeed);
    expect(f?.power).toBeCloseTo(expected, 3);
    expect(f?.start).toEqual([206 / W, 800 / H]);
    expect(f?.aspect).toBeCloseTo(W / H, 9);
  });

  it('uses only the last ~80 ms: a slow start then a fast finish counts as fast', () => {
    const slow = swipe(200, 850, 0, -0.3, 200);
    const lastS = slow[slow.length - 1] as FlickSample;
    const fast = swipe(lastS.x, lastS.y, 0.8, -3, 96, lastS.t + 8);
    const f = measureFlick([...slow, ...fast], W, H);
    expect(f?.power).toBeGreaterThan(0.6);
    expect(f?.direction[0]).toBeGreaterThan(0.2); // the late sideways component
  });

  it('a swipe that stops before release is not a throw', () => {
    const s = swipe(200, 850, 0, -2.5, 120);
    const end = s[s.length - 1] as FlickSample;
    expect(measureFlick([...s, { ...end, t: end.t + 150 }], W, H)).toBeNull();
  });

  it('rejects downward, tiny and too-slow swipes, and clamps very fast ones', () => {
    expect(measureFlick(swipe(200, 700, 0, 2.5, 120), W, H)).toBeNull();
    expect(measureFlick(swipe(200, 800, 0, -2.5, 8), W, H)).toBeNull();
    expect(measureFlick(swipe(200, 850, 0, -0.2, 400), W, H)).toBeNull();
    expect(measureFlick(swipe(200, 880, 0, -12, 40), W, H)?.power).toBe(1);
  });
});

describe('inThrowZone', () => {
  it('is the bottom 35% of the screen, clear of the side and bottom edges', () => {
    expect(inThrowZone(206, 800, W, H)).toBe(true);
    expect(inThrowZone(206, 400, W, H)).toBe(false); // above the zone
    expect(inThrowZone(10, 800, W, H)).toBe(false); // iOS back-swipe edge
    expect(inThrowZone(W - 10, 800, W, H)).toBe(false);
    expect(inThrowZone(206, H - 5, W, H)).toBe(false); // home indicator
  });
});
