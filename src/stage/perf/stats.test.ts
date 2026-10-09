import { describe, expect, it } from 'vitest';
import { calibrationVerdict, LONG_FRAME_MS, percentile, round1, summarizeFrames } from './stats';

describe('frame stats', () => {
  it('nearest-rank percentiles', () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(sorted, 50)).toBe(5);
    expect(percentile(sorted, 95)).toBe(10);
    expect(percentile(sorted, 0)).toBe(1);
    expect(percentile([], 50)).toBeNaN();
  });

  it('summarises intervals, skipping the first frame after idle', () => {
    const s = summarizeFrames([NaN, 16, 17, 16, 80, 16]);
    expect(s.frames).toBe(5);
    expect(s.p50).toBe(16);
    expect(s.max).toBe(80);
    expect(s.long).toBe(1);
    expect(s.fps).toBeCloseTo(1000 / 29, 5);
    expect(LONG_FRAME_MS).toBe(50);
  });

  it('empty input', () => {
    const s = summarizeFrames([]);
    expect(s.frames).toBe(0);
    expect(s.fps).toBeNaN();
  });

  it('rounds for display', () => {
    expect(round1(16.6666)).toBe(16.7);
    expect(round1(1234.4)).toBe(1234);
    expect(round1(NaN)).toBeNull();
  });
});

describe('calibrationVerdict', () => {
  const frames = (ms: number, n: number) => Array.from({ length: n }, () => ms);

  it('waits for 12 frames over 2 s', () => {
    expect(calibrationVerdict(frames(16.7, 11), 2500)).toBe('wait');
    expect(calibrationVerdict(frames(16.7, 60), 1000)).toBe('wait');
  });

  it('steps down when the median frame is under 40 fps', () => {
    expect(calibrationVerdict(frames(33, 70), 2300)).toBe('slow');
    expect(calibrationVerdict(frames(18, 120), 2200)).toBe('ok');
  });

  it('judges a very slow device after 6 s even with few frames (drei never could)', () => {
    // ~4 fps: 230 ms frames, only 9 of them before the deadline
    expect(calibrationVerdict(frames(230, 9), 2100)).toBe('wait');
    expect(calibrationVerdict(frames(230, 9), 6000)).toBe('slow');
  });

  it('ignores a single hitch, and never judges a paused (hidden) tab', () => {
    expect(calibrationVerdict([...frames(16.7, 40), 900], 2500)).toBe('ok');
    expect(calibrationVerdict([NaN], 7000)).toBe('ok');
  });
});
