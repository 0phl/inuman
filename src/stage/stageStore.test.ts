import { describe, expect, it } from 'vitest';
import { latchMsaa, lowerTier } from './stageStore';

describe('latchMsaa', () => {
  it('takes the tier’s MSAA when the Canvas is first made', () => {
    expect(latchMsaa(null, true, false)).toBe(true);
    expect(latchMsaa(null, false, false)).toBe(false);
  });

  it('keeps the Canvas’s MSAA while a game is on screen (no remount mid-game)', () => {
    // high → mid step-down during play: MSAA stays on until the stage is off screen
    expect(latchMsaa(true, false, false)).toBe(true);
    expect(latchMsaa(false, true, false)).toBe(false);
  });

  it('follows the tier once no game is on screen (or on /bench)', () => {
    expect(latchMsaa(true, false, true)).toBe(false);
    expect(latchMsaa(false, true, true)).toBe(true);
  });
});

describe('lowerTier', () => {
  it('steps down and stops at low', () => {
    expect(lowerTier('high')).toBe('mid');
    expect(lowerTier('mid')).toBe('low');
    expect(lowerTier('low')).toBe('low');
  });
});
