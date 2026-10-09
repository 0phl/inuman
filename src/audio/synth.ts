// Tiny synthesized stand-ins for the UI sounds (and the drink clink the app always had), used when
// a sound's file is missing or the manifest didn't load. Each recipe renders a short mono sample
// buffer in plain JS once, so it plays through the same voice path as a decoded file (variants,
// humanising, buses). Everything else stays silent without its file.
import type { SoundId } from './catalog';

type Render = (sr: number, variant: number) => Float32Array;

/** Seeded noise so a variant always sounds the same. */
function noise(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) / 4294967296) * 2 - 1;
  };
}

const buf = (sr: number, seconds: number) =>
  new Float32Array(Math.max(1, Math.round(sr * seconds)));

/** Decaying sine partials: [freq, gain, decay seconds][]; `attack` seconds of fade-in. */
function partials(
  sr: number,
  seconds: number,
  parts: readonly (readonly [number, number, number])[],
  attack = 0.003,
  glide = 0,
): Float32Array {
  const out = buf(sr, seconds);
  for (const [f, g, decay] of parts) {
    let phase = 0;
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      const freq = f * (1 + glide * Math.min(1, t / seconds));
      phase += (2 * Math.PI * freq) / sr;
      const env = Math.min(1, t / attack) * Math.exp(-t / decay);
      out[i] = (out[i] ?? 0) + Math.sin(phase) * g * env;
    }
  }
  return out;
}

/** Band-limited noise burst (one-pole high/low pass) with an exponential decay. */
function swish(
  sr: number,
  seconds: number,
  seed: number,
  { lp, hp, gain, rise }: { lp: number; hp: number; gain: number; rise: number },
): Float32Array {
  const out = buf(sr, seconds);
  const rnd = noise(seed);
  let low = 0;
  let prev = 0;
  let high = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    const k = t / seconds;
    // Envelope: rises for `rise` of the length, then falls away.
    const env =
      k < rise
        ? Math.sin((k / rise) * (Math.PI / 2))
        : Math.cos(((k - rise) / (1 - rise)) * (Math.PI / 2));
    const cutoff = lp * (0.6 + 0.8 * (rise > 0.5 ? k : 1 - k));
    const a = 1 - Math.exp((-2 * Math.PI * cutoff) / sr);
    low += (rnd() - low) * a;
    const b = Math.exp((-2 * Math.PI * hp) / sr);
    high = b * (high + low - prev);
    prev = low;
    out[i] = high * gain * Math.max(0, env);
  }
  return out;
}

function mix(...layers: Float32Array[]): Float32Array {
  const len = layers.reduce((m, l) => Math.max(m, l.length), 0);
  const out = new Float32Array(len);
  for (const l of layers) for (let i = 0; i < l.length; i++) out[i] = (out[i] ?? 0) + (l[i] ?? 0);
  return out;
}

/** Notes one after another: [freq, at seconds, gain, decay]. */
function chime(
  sr: number,
  seconds: number,
  notes: readonly (readonly [number, number, number, number])[],
) {
  const out = buf(sr, seconds);
  for (const [f, at, g, decay] of notes) {
    const start = Math.round(at * sr);
    let phase = 0;
    for (let i = start; i < out.length; i++) {
      const t = (i - start) / sr;
      phase += (2 * Math.PI * f) / sr;
      const env = Math.min(1, t / 0.004) * Math.exp(-t / decay);
      out[i] = (out[i] ?? 0) + (Math.sin(phase) + 0.25 * Math.sin(phase * 2.01)) * g * env;
    }
  }
  return out;
}

/** The original glass clink: a few inharmonic partials. */
const clink = (sr: number, v: number) => {
  const d = 1 + (v - 1) * 0.04;
  return partials(sr, 0.55, [
    [2093 * d, 0.32, 0.18],
    [3136 * d, 0.16, 0.12],
    [4699 * d, 0.08, 0.07],
    [5920 * d, 0.04, 0.05],
  ]);
};

const RECIPES: Partial<Record<SoundId, { variants: number; render: Render }>> = {
  'ui.tap': {
    variants: 3,
    render: (sr, v) =>
      mix(
        partials(sr, 0.05, [[1650 + v * 120, 0.28, 0.012]], 0.0008),
        swish(sr, 0.03, 11 + v, { lp: 5200, hp: 900, gain: 0.5, rise: 0.05 }),
      ),
  },
  'ui.tapPrimary': {
    variants: 2,
    render: (sr, v) =>
      mix(
        partials(
          sr,
          0.12,
          [
            [190 + v * 12, 0.5, 0.045],
            [1150 + v * 60, 0.18, 0.02],
          ],
          0.001,
        ),
        swish(sr, 0.04, 21 + v, { lp: 4200, hp: 600, gain: 0.45, rise: 0.05 }),
      ),
  },
  'ui.select': {
    variants: 2,
    render: (sr, v) => partials(sr, 0.04, [[2500 + v * 180, 0.24, 0.009]], 0.0006),
  },
  'ui.toggleOn': {
    variants: 1,
    render: (sr) =>
      chime(sr, 0.16, [
        [880, 0, 0.16, 0.03],
        [1320, 0.045, 0.18, 0.05],
      ]),
  },
  'ui.toggleOff': {
    variants: 1,
    render: (sr) =>
      chime(sr, 0.16, [
        [1100, 0, 0.16, 0.03],
        [740, 0.045, 0.16, 0.05],
      ]),
  },
  'ui.back': {
    variants: 1,
    render: (sr) => swish(sr, 0.14, 31, { lp: 2600, hp: 300, gain: 0.55, rise: 0.25 }),
  },
  'ui.sheetOpen': {
    variants: 1,
    render: (sr) => swish(sr, 0.2, 41, { lp: 3000, hp: 250, gain: 0.5, rise: 0.7 }),
  },
  'ui.sheetClose': {
    variants: 1,
    render: (sr) => swish(sr, 0.18, 43, { lp: 2400, hp: 250, gain: 0.45, rise: 0.2 }),
  },
  'ui.error': {
    variants: 1,
    render: (sr) =>
      partials(
        sr,
        0.22,
        [
          [150, 0.42, 0.07],
          [225, 0.18, 0.05],
          [97, 0.25, 0.09],
        ],
        0.002,
        -0.15,
      ),
  },
  'ui.success': {
    variants: 1,
    render: (sr) =>
      chime(sr, 0.5, [
        [1046.5, 0, 0.2, 0.14],
        [1568, 0.08, 0.22, 0.22],
      ]),
  },
  'ui.notice': {
    variants: 2,
    render: (sr, v) => {
      const f = v === 0 ? 1318.5 : 1174.7;
      return partials(sr, 0.6, [
        [f, 0.22, 0.25],
        [f * 2.76, 0.07, 0.12],
        [f * 5.4, 0.03, 0.06],
      ]);
    },
  },
  'ui.pass': {
    variants: 2,
    render: (sr, v) =>
      swish(sr, 0.24, 51 + v, { lp: 3600 - v * 400, hp: 350, gain: 0.55, rise: 0.45 }),
  },
  'ui.reveal': {
    variants: 1,
    render: (sr) =>
      chime(sr, 0.6, [
        [2093, 0, 0.08, 0.2],
        [2637, 0.05, 0.08, 0.2],
        [3136, 0.1, 0.08, 0.22],
        [4186, 0.15, 0.06, 0.25],
      ]),
  },
  'ui.water': {
    variants: 1,
    render: (sr) =>
      mix(
        partials(sr, 0.12, [[700, 0.3, 0.03]], 0.001, 1.2),
        new Float32Array(Math.round(sr * 0.13)).fill(0),
      ).map((x, i, a) => x + (a[i - Math.round(sr * 0.13)] ?? 0) * 0.6),
  },
  'drink.cheers': { variants: 3, render: clink },
  'drink.social': {
    variants: 2,
    render: (sr, v) => {
      const a = clink(sr, v);
      const b = clink(sr, v + 2);
      const lag = Math.round(sr * (0.045 + v * 0.02));
      const out = new Float32Array(a.length + lag);
      for (let i = 0; i < a.length; i++) out[i] = (a[i] ?? 0) * 0.8;
      for (let i = 0; i < b.length; i++) out[i + lag] = (out[i + lag] ?? 0) + (b[i] ?? 0) * 0.7;
      return out;
    },
  },
};

export const hasSynth = (id: SoundId): boolean => id in RECIPES;

/** Renders every variant of a synthesized fallback as mono samples (null when there's none). */
export function renderSynth(id: SoundId, sampleRate: number): Float32Array[] | null {
  const r = RECIPES[id];
  if (!r) return null;
  return Array.from({ length: r.variants }, (_, v) => r.render(sampleRate, v));
}
