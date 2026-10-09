// Pure helpers for the audio engine: gain maths, variant choice, humanisation, the per-id
// retrigger gate, the polyphony pool and the leading-silence trim. No Web Audio, DOM or React here,
// so every piece is unit-tested in Node.

export const clamp01 = (x: number): number =>
  x <= 0 ? 0 : x >= 1 ? 1 : Number.isFinite(x) ? x : 0;

export const dbToGain = (db: number): number => Math.pow(10, db / 20);

export const gainToDb = (gain: number): number => (gain <= 0 ? -Infinity : 20 * Math.log10(gain));

/**
 * A 0..1 volume slider to a linear gain on a perceptual curve (squared: ½ ≈ −12 dB). 0 is
 * silence; 1 is unity.
 */
export const volumeToGain = (v: number): number => {
  const x = clamp01(v);
  return x * x;
};

/**
 * A random take out of `count`, never the same one twice in a row (when there is a choice).
 * `last` is the index played last time (or undefined); `rand` returns [0, 1).
 */
export function pickVariant(count: number, last: number | undefined, rand: () => number): number {
  if (count <= 1) return 0;
  const avoid = last !== undefined && last >= 0 && last < count;
  // Draw from the count − 1 others and step over the last one.
  const n = avoid ? count - 1 : count;
  const k = Math.min(n - 1, Math.floor(clamp01(rand()) * n));
  return avoid && k >= last ? k + 1 : k;
}

/** Small random pitch (±`pitch`, as a fraction) and gain (±`db`) so repeats don't sound robotic. */
export function humanize(
  rand: () => number,
  pitch = 0.03,
  db = 1.5,
): { rate: number; gainDb: number } {
  return { rate: 1 + (rand() * 2 - 1) * pitch, gainDb: (rand() * 2 - 1) * db };
}

/**
 * Per-id minimum retrigger interval. Times are in the audio clock (seconds) at which a sound is
 * scheduled to start, so bursts scheduled ahead of time (dice impacts) are gated as well as live
 * ones. Remembers the last few start times per id.
 */
export class RetriggerGate {
  private readonly times = new Map<string, number[]>();
  private readonly memory: number;
  constructor(memory = 12) {
    this.memory = memory;
  }

  /** True (and remembers `when`) unless another start of `id` is closer than `minInterval`. */
  allow(id: string, when: number, minInterval: number): boolean {
    let list = this.times.get(id);
    if (!list) {
      list = [];
      this.times.set(id, list);
    }
    if (minInterval > 0) {
      for (const t of list) if (Math.abs(when - t) < minInterval) return false;
    }
    list.push(when);
    if (list.length > this.memory) list.shift();
    return true;
  }

  /** Gives back a start that was cancelled before it sounded (so a re-run can take its slot). */
  forget(id: string, when: number): void {
    const list = this.times.get(id);
    const i = list ? list.lastIndexOf(when) : -1;
    if (list && i >= 0) list.splice(i, 1);
  }

  clear(): void {
    this.times.clear();
  }
}

interface PoolEntry<V> {
  voice: V;
  start: number;
  end: number;
}

/**
 * Polyphony bookkeeping per id. Voices occupy [start, end) on the audio clock (end = Infinity for
 * loops). Adding a voice when `cap` others already sound at its start returns the oldest
 * overlapping ones to steal (stop at the new voice's start).
 */
export class VoicePool<V> {
  private readonly byId = new Map<string, PoolEntry<V>[]>();

  add(id: string, voice: V, start: number, end: number, cap: number, now: number): V[] {
    let list = this.byId.get(id);
    if (!list) {
      list = [];
      this.byId.set(id, list);
    }
    // Forget voices that have finished.
    for (let i = list.length - 1; i >= 0; i--)
      if ((list[i] as PoolEntry<V>).end <= now) list.splice(i, 1);
    const overlapping = list.filter((e) => e.start < end && e.end > start);
    const stolen: V[] = [];
    const excess = overlapping.length - Math.max(1, cap) + 1;
    if (excess > 0) {
      overlapping.sort((a, b) => a.start - b.start);
      for (let i = 0; i < excess; i++) {
        const e = overlapping[i] as PoolEntry<V>;
        stolen.push(e.voice);
        // A stolen voice stops at the new one's start.
        e.end = Math.max(e.start, start);
      }
    }
    list.push({ voice, start, end });
    return stolen;
  }

  remove(id: string, voice: V): void {
    const list = this.byId.get(id);
    if (!list) return;
    const i = list.findIndex((e) => e.voice === voice);
    if (i >= 0) list.splice(i, 1);
  }

  /** Voices of `id` sounding at `t` (for tests and diagnostics). */
  activeAt(id: string, t: number): number {
    return (this.byId.get(id) ?? []).filter((e) => e.start <= t && e.end > t).length;
  }
}

/**
 * Seconds of leading silence / encoder delay to skip: the time of the first sample (any channel)
 * louder than `thresholdDb` dBFS, minus a short pre-roll so the attack isn't clipped. 0 for a
 * buffer that starts loud; the whole length (minus pre-roll) for a silent one is clamped to 0.
 */
export function leadingSilence(
  channels: readonly ArrayLike<number>[],
  sampleRate: number,
  thresholdDb = -50,
  preRoll = 0.002,
): number {
  const threshold = dbToGain(thresholdDb);
  let first = -1;
  const len = channels.reduce((m, c) => Math.max(m, c.length), 0);
  for (let i = 0; i < len && first < 0; i++) {
    for (const c of channels) {
      const s = c[i] ?? 0;
      if (s > threshold || s < -threshold) {
        first = i;
        break;
      }
    }
  }
  if (first <= 0) return 0;
  return Math.max(0, first / sampleRate - preRoll);
}

/**
 * Where a looped take repeats, in buffer seconds. `exact` is the file's true length from the
 * manifest; browsers that don't honour the MP3 encoder-delay header decode up to ~50 ms of extra
 * silence around it, which would leave an audible gap at the seam. The start skips at most that
 * extra (never the loop's own quiet start), and the region is always exactly `exact` long.
 */
export function loopRegion(
  bufferDuration: number,
  leading: number,
  exact: number | null,
): { start: number; end: number } {
  if (exact === null || !(exact > 0) || exact > bufferDuration + 0.001)
    return { start: 0, end: bufferDuration };
  const start = Math.min(leading, bufferDuration - exact);
  return { start, end: Math.min(bufferDuration, start + exact) };
}
