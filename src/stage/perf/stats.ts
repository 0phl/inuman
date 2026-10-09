// Frame statistics shared by the perf overlay and the bench. Pure (no DOM, no three).

/** Frames longer than this count as "long" (a visible hitch). */
export const LONG_FRAME_MS = 50;

/** Nearest-rank percentile (p in 0..100) of an ascending-sorted list; NaN when empty. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const rank = Math.ceil((Math.min(Math.max(p, 0), 100) / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))] as number;
}

export interface FrameSummary {
  /** Frame intervals measured. */
  frames: number;
  p50: number;
  p95: number;
  max: number;
  /** 1000 / mean interval. */
  fps: number;
  /** Intervals over LONG_FRAME_MS. */
  long: number;
}

/** Summarises frame intervals (ms); non-finite entries (the first frame after idle) are skipped. */
export function summarizeFrames(intervals: readonly number[]): FrameSummary {
  const ok = intervals.filter((v) => Number.isFinite(v) && v >= 0);
  const sorted = [...ok].sort((a, b) => a - b);
  const total = ok.reduce((a, b) => a + b, 0);
  return {
    frames: ok.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted.length ? (sorted[sorted.length - 1] as number) : NaN,
    fps: total > 0 ? (1000 * ok.length) / total : NaN,
    long: ok.filter((v) => v > LONG_FRAME_MS).length,
  };
}

/** Rounds for display/JSON: 1 decimal under 100, whole numbers above; NaN → null. */
export function round1(v: number): number | null {
  if (!Number.isFinite(v)) return null;
  return Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10;
}

/** Auto-quality floor: a median frame slower than this (fps) steps the tier down. */
export const CALIBRATION_FPS = 40;

/**
 * The calibration's decision from the frame intervals forced so far: 'wait' until there are 12
 * frames over at least 2 s (or 6 s have passed), then 'slow' if the median frame is slower than
 * CALIBRATION_FPS, else 'ok'. The median ignores the odd hitch (a texture upload, GC).
 */
export function calibrationVerdict(
  intervals: readonly number[],
  elapsedMs: number,
): 'wait' | 'slow' | 'ok' {
  const s = summarizeFrames(intervals);
  const enough = s.frames >= 12 && elapsedMs >= 2000;
  if (!enough && elapsedMs < 6000) return 'wait';
  // Hardly any frames (a backgrounded tab pauses rAF): no evidence either way, so don't judge.
  if (s.frames < 3) return 'ok';
  return 1000 / s.p50 < CALIBRATION_FPS ? 'slow' : 'ok';
}
