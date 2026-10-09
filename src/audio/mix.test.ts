import { describe, expect, it } from 'vitest';
import {
  dbToGain,
  fitTake,
  FIT_RATE_MAX,
  FIT_RATE_MIN,
  humanize,
  leadingSilence,
  loopRegion,
  pickVariant,
  RetriggerGate,
  VoicePool,
  volumeToGain,
} from './mix';

/** A deterministic [0,1) source cycling through `values`. */
const seq = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length] as number;
};

describe('pickVariant', () => {
  it('never repeats the last take when there is a choice', () => {
    let last: number | undefined;
    const rand = seq(0, 0.1, 0.5, 0.99, 0.33, 0.66, 0.01);
    for (let i = 0; i < 200; i++) {
      const k = pickVariant(4, last, rand);
      expect(k).toBeGreaterThanOrEqual(0);
      expect(k).toBeLessThan(4);
      expect(k).not.toBe(last);
      last = k;
    }
  });

  it('reaches every other take', () => {
    const seen = new Set<number>();
    for (const r of [0, 0.34, 0.67, 0.999]) seen.add(pickVariant(4, 1, () => r));
    expect([...seen].sort()).toEqual([0, 2, 3]);
  });

  it('handles one take, no history and out-of-range history', () => {
    expect(pickVariant(1, 0, () => 0.7)).toBe(0);
    expect(pickVariant(0, undefined, () => 0.7)).toBe(0);
    expect(pickVariant(3, undefined, () => 0.999)).toBe(2);
    expect(pickVariant(3, 9, () => 0)).toBe(0);
    // Two takes alternate.
    expect(pickVariant(2, 0, () => 0.2)).toBe(1);
    expect(pickVariant(2, 1, () => 0.9)).toBe(0);
  });
});

describe('humanize', () => {
  it('stays within ±3 % pitch and ±1.5 dB', () => {
    for (const r of [0, 0.25, 0.5, 0.999]) {
      const h = humanize(() => r);
      expect(h.rate).toBeGreaterThanOrEqual(0.97);
      expect(h.rate).toBeLessThanOrEqual(1.03);
      expect(Math.abs(h.gainDb)).toBeLessThanOrEqual(1.5);
    }
  });
});

describe('gain maths', () => {
  it('converts dB and slider volumes', () => {
    expect(dbToGain(0)).toBe(1);
    expect(dbToGain(-6)).toBeCloseTo(0.501, 3);
    expect(volumeToGain(0)).toBe(0);
    expect(volumeToGain(1)).toBe(1);
    expect(volumeToGain(0.5)).toBeCloseTo(0.25);
    expect(volumeToGain(-3)).toBe(0);
    expect(volumeToGain(Number.NaN)).toBe(0);
  });
});

describe('RetriggerGate', () => {
  it('drops starts closer than the minimum interval, per id', () => {
    const g = new RetriggerGate();
    expect(g.allow('ui.tap', 1.0, 0.025)).toBe(true);
    expect(g.allow('ui.tap', 1.01, 0.025)).toBe(false);
    expect(g.allow('ui.select', 1.01, 0.025)).toBe(true);
    expect(g.allow('ui.tap', 1.03, 0.025)).toBe(true);
  });

  it('gates sounds scheduled ahead, in any order', () => {
    const g = new RetriggerGate();
    expect(g.allow('dice.hitTable', 2.0, 0.02)).toBe(true);
    expect(g.allow('dice.hitTable', 1.5, 0.02)).toBe(true);
    expect(g.allow('dice.hitTable', 1.99, 0.02)).toBe(false);
    expect(g.allow('dice.hitTable', 1.51, 0.02)).toBe(false);
    expect(g.allow('dice.hitTable', 1.75, 0.02)).toBe(true);
  });

  it('gives a cancelled start back', () => {
    const g = new RetriggerGate();
    expect(g.allow('card.flip', 3, 0.025)).toBe(true);
    g.forget('card.flip', 3);
    expect(g.allow('card.flip', 3, 0.025)).toBe(true);
  });
});

describe('VoicePool', () => {
  it('steals the oldest overlapping voice past the cap', () => {
    const p = new VoicePool<string>();
    expect(p.add('x', 'a', 0, 1, 2, 0)).toEqual([]);
    expect(p.add('x', 'b', 0.1, 1.1, 2, 0)).toEqual([]);
    expect(p.add('x', 'c', 0.2, 1.2, 2, 0)).toEqual(['a']);
    expect(p.activeAt('x', 0.5)).toBe(2);
  });

  it('only counts voices that overlap the new one, and forgets finished ones', () => {
    const p = new VoicePool<string>();
    p.add('x', 'a', 0, 0.2, 1, 0);
    // Scheduled later, after `a` ends: no steal.
    expect(p.add('x', 'b', 0.5, 0.7, 1, 0)).toEqual([]);
    expect(p.add('x', 'c', 0.6, 0.8, 1, 0.3)).toEqual(['b']);
    p.remove('x', 'c');
    expect(p.activeAt('x', 0.65)).toBe(0);
  });

  it('keeps one loop per id by default cap', () => {
    const p = new VoicePool<string>();
    p.add('loop', 'a', 0, Infinity, 1, 0);
    expect(p.add('loop', 'b', 5, Infinity, 1, 4)).toEqual(['a']);
  });
});

describe('leadingSilence', () => {
  const sr = 1000;
  const tone = (silent: number, len: number, level = 0.5) => {
    const a = new Float32Array(len);
    for (let i = silent; i < len; i++) a[i] = level * Math.sin(i);
    return a;
  };

  it('finds the first sample above -50 dBFS', () => {
    // 100 silent samples at 1 kHz = 0.1 s, minus the 2 ms pre-roll.
    expect(leadingSilence([tone(100, 400)], sr)).toBeCloseTo(0.098, 3);
  });

  it('treats encoder hiss below the threshold as silence', () => {
    const a = tone(50, 300);
    for (let i = 0; i < 50; i++) a[i] = (i % 2 ? 1 : -1) * 0.002; // ≈ −54 dBFS
    expect(leadingSilence([a], sr)).toBeCloseTo(0.048, 3);
  });

  it('uses the earliest channel', () => {
    expect(leadingSilence([tone(200, 400), tone(80, 400)], sr)).toBeCloseTo(0.078, 3);
  });

  it('returns 0 for a loud start or an all-silent buffer', () => {
    expect(leadingSilence([tone(0, 100)], sr)).toBe(0);
    expect(leadingSilence([new Float32Array(100)], sr)).toBe(0);
    expect(leadingSilence([], sr)).toBe(0);
  });

  it('never returns a negative offset for a start inside the pre-roll', () => {
    expect(leadingSilence([tone(1, 100)], sr)).toBe(0);
  });
});

describe('loopRegion', () => {
  it('uses the whole buffer when the decoder already trimmed the encoder delay', () => {
    expect(loopRegion(1.022, 0, 1.022)).toEqual({ start: 0, end: 1.022 });
    expect(loopRegion(1.022, 0.001, 1.022)).toEqual({ start: 0, end: 1.022 });
  });

  it('skips the decoder delay and padding, keeping the exact loop length', () => {
    // 25 ms of delay in front, 20 ms of padding behind.
    const r = loopRegion(1.045, 0.025, 1);
    expect(r.start).toBeCloseTo(0.025, 6);
    expect(r.end - r.start).toBeCloseTo(1, 6);
  });

  it("never skips into a loop's own quiet start beyond the extra length", () => {
    const r = loopRegion(1.045, 0.3, 1);
    expect(r.start).toBeCloseTo(0.045, 6);
    expect(r.end).toBeCloseTo(1.045, 6);
  });

  it('falls back to the whole buffer without a usable length', () => {
    expect(loopRegion(2, 0.01, null)).toEqual({ start: 0, end: 2 });
    expect(loopRegion(2, 0.01, 3)).toEqual({ start: 0, end: 2 });
  });
});

describe('fitTake', () => {
  const takes = [5.08, 3.21, 4.18, 2.67];

  it('picks the take closest in length and times it to the target', () => {
    const r = fitTake(takes, 4.4, undefined, () => 0);
    expect(r.index).toBe(2);
    expect(r.rate).toBeCloseTo(4.18 / 4.4, 6);
    expect(fitTake(takes, 2.85, undefined, () => 0).index).toBe(3);
  });

  it('clamps the rate so pitch never moves too far', () => {
    expect(fitTake(takes, 20, undefined, () => 0).rate).toBe(FIT_RATE_MIN);
    expect(fitTake(takes, 1, undefined, () => 0).rate).toBe(FIT_RATE_MAX);
  });

  it('draws among near-equal fits, avoiding the last one', () => {
    const twins = [3, 3.05, 6];
    expect(fitTake(twins, 3.02, 0, () => 0).index).toBe(1);
    expect(fitTake(twins, 3.02, 1, () => 0).index).toBe(0);
  });

  it('covers every spin length the game plans (2.85–5.35 s with the tail) within the clamp', () => {
    for (let t = 2.85; t <= 5.35; t += 0.05) {
      const { index, rate } = fitTake(takes, t, undefined, () => 0.5);
      const len = takes[index] ?? 0;
      expect(Math.abs(len / rate - t)).toBeLessThan(0.01);
    }
  });
});
