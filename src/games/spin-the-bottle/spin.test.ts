import { describe, expect, it } from 'vitest';
import {
  TAU,
  angleAt,
  angleBetween,
  durationFor,
  planSpin,
  powerFromFlick,
  velocityAt,
  wedgeOffset,
  wrap,
} from './spin';

describe('planSpin / angleAt', () => {
  it('lands exactly on the target after the extra turns', () => {
    const p = planSpin(1.2, 0.4, 3, 4);
    expect(p.delta).toBeCloseTo(wrap(0.4 - 1.2) + 3 * TAU);
    expect(wrap(angleAt(p, p.duration))).toBeCloseTo(0.4);
    expect(angleAt(p, p.duration + 3)).toBeCloseTo(angleAt(p, p.duration));
  });

  it('decelerates at a constant rate to exactly zero at the end', () => {
    const p = planSpin(0, 2, 2, 3);
    expect(velocityAt(p, p.duration)).toBe(0);
    expect(velocityAt(p, p.duration - 1e-9)).toBeCloseTo(0, 6);
    const a1 = velocityAt(p, 0.5) - velocityAt(p, 1);
    const a2 = velocityAt(p, 2) - velocityAt(p, 2.5);
    expect(a1).toBeCloseTo(a2);
    // Never turns backwards.
    let prev = angleAt(p, 0);
    for (let t = 0.05; t <= p.duration; t += 0.05) {
      const now = angleAt(p, t);
      expect(now).toBeGreaterThanOrEqual(prev);
      prev = now;
    }
  });

  it('starts where the bottle already points', () => {
    const p = planSpin(5, 1, 2, 2.5);
    expect(angleAt(p, 0)).toBe(5);
  });
});

describe('helpers', () => {
  it('maps flick power to 2.5–5 seconds', () => {
    expect(durationFor(0)).toBe(2.5);
    expect(durationFor(1)).toBe(5);
    expect(durationFor(9)).toBe(5);
    expect(durationFor(Number.NaN)).toBe(3.75);
  });

  it('keeps flick power in 0..1', () => {
    expect(powerFromFlick(0)).toBeGreaterThan(0);
    expect(powerFromFlick(100)).toBe(1);
  });

  it('stays inside the seat wedge', () => {
    const yaws = [0, 1, 2, 3, 4, 5];
    for (let seed = 0; seed < 50; seed++) {
      const off = wedgeOffset(yaws, 2, seed);
      expect(Math.abs(off)).toBeLessThan(0.5);
      // Still closer to its own seat than to either neighbour.
      expect(angleBetween(2 + off, 2)).toBeLessThan(angleBetween(2 + off, 1));
      expect(angleBetween(2 + off, 2)).toBeLessThan(angleBetween(2 + off, 3));
    }
    expect(wedgeOffset([1], 0, 3)).toBe(0);
  });
});
