import { describe, expect, it } from 'vitest';
import { HAPTIC_PATTERNS, hapticAllowed } from './haptics';

describe('haptics', () => {
  it('keeps the tap short and the patterns sane', () => {
    expect(HAPTIC_PATTERNS.tap).toBeLessThanOrEqual(10);
    for (const p of Object.values(HAPTIC_PATTERNS)) {
      const parts = typeof p === 'number' ? [p] : p;
      expect(parts.every((n) => n > 0 && n < 200)).toBe(true);
    }
  });

  it('rate-limits bursts but lets a heavier pattern cut in', () => {
    const last = { at: 1000, end: 1008, weight: 0 };
    expect(hapticAllowed(1020, 0, last)).toBe(false);
    expect(hapticAllowed(1020, 2, last)).toBe(true);
    expect(hapticAllowed(1050, 0, last)).toBe(true);
  });

  it("doesn't let a light tick cut a long pattern short", () => {
    const drink = { at: 1000, end: 1140, weight: 3 };
    expect(hapticAllowed(1100, 0, drink)).toBe(false);
    expect(hapticAllowed(1200, 0, drink)).toBe(true);
  });
});
