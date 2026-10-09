// Offline synthesis voices for sounds with no suitable CC0 recording, or where a clean synthetic
// tone beats a noisy recording (UI chimes, swooshes, the jeepney horn). Everything renders mono
// float32 at 44.1 kHz and is deterministic (seeded noise), so `pnpm audio` is reproducible.
// These are original works made for this project: CC0.

export const SR = 44100;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const noteHz = (n) => {
  // "C6", "F#5", "Bb4" -> Hz (A4 = 440)
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(n);
  if (!m) throw new Error(`bad note ${n}`);
  const pc = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  const midi = (Number(m[3]) + 1) * 12 + pc;
  return 440 * 2 ** ((midi - 69) / 12);
};
const hz = (f) => (typeof f === 'string' ? noteHz(f) : f);

/** Topology-preserving state-variable filter (Zavalishin); stable under fast cutoff sweeps. */
function makeSvf() {
  let ic1 = 0, ic2 = 0;
  return (x, fc, q) => {
    const g = Math.tan((Math.PI * Math.min(fc, SR * 0.45)) / SR);
    const k = 1 / q;
    const a1 = 1 / (1 + g * (g + k));
    const a2 = g * a1;
    const a3 = g * a2;
    const v3 = x - ic2;
    const v1 = a1 * ic1 + a2 * v3;
    const v2 = ic2 + a2 * ic1 + a3 * v3;
    ic1 = 2 * v1 - ic1;
    ic2 = 2 * v2 - ic2;
    return { lp: v2, bp: v1, hp: x - k * v1 - v2 };
  };
}

function onePoleLp(fc) {
  const a = Math.exp((-2 * Math.PI * fc) / SR);
  let y = 0;
  return (x) => (y = (1 - a) * x + a * y);
}

const buf = (sec) => new Float32Array(Math.max(1, Math.round(sec * SR)));

/** Smooth swell: rises with (t/peak)^p, falls as a raised cosine to zero at the end. */
function swellEnv(t, dur, peakAt, p = 2) {
  if (t < 0 || t > dur) return 0;
  const pk = dur * peakAt;
  if (t < pk) return (t / pk) ** p;
  const u = (t - pk) / (dur - pk);
  return 0.5 * (1 + Math.cos(Math.PI * u));
}

// ── Voices ────────────────────────────────────────────────────────────────────────────────

/** Band-passed noise swoosh with an exponential centre-frequency sweep. */
function swoosh({ dur = 0.25, f0 = 700, f1 = 3000, q = 1.4, peakAt = 0.55, attackPow = 2, seed = 1, air = 0.25, bodyHz = 0 }) {
  const out = buf(dur);
  const rnd = mulberry32(seed);
  const f1a = makeSvf(), f1b = makeSvf(), fAir = makeSvf();
  const smooth = onePoleLp(6000);
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    const u = t / dur;
    const fc = f0 * (f1 / f0) ** u;
    const n = rnd() * 2 - 1;
    const a = f1a(n, fc, q).bp;
    const b = f1b(a, fc, q).bp; // 4-pole band-pass: smoother, less hissy
    const airy = fAir(n, Math.min(fc * 2.5, 12000), 0.7).bp * air;
    let s = b + airy;
    if (bodyHz) s += Math.sin(2 * Math.PI * bodyHz * t * (1 + 0.3 * u)) * 0.15;
    out[i] = smooth(s) * swellEnv(t, dur, peakAt, attackPow);
  }
  return out;
}

/** Struck bar / bell: inharmonic partials with per-partial exponential decay plus a soft mallet tick. */
function strike(out, t0, f, { amp = 1, decay = 0.6, partials, mallet = 0.15, seed = 7, detune = 0 }) {
  const parts = partials ?? [
    [1, 1, 1],
    [2.76, 0.28, 0.45],
    [5.4, 0.09, 0.25],
    [8.93, 0.035, 0.14],
  ];
  const start = Math.round(t0 * SR);
  const rnd = mulberry32(seed);
  const len = Math.min(out.length - start, Math.round(decay * 6 * SR));
  for (const [ratio, a, dk] of parts) {
    const fr = f * ratio * (1 + detune * (rnd() - 0.5));
    if (fr > SR * 0.45) continue;
    const tau = decay * dk;
    const ph = rnd() * 0.2;
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      const att = Math.min(1, t / 0.0015); // 1.5 ms attack: crisp but click-free
      out[start + i] += amp * a * att * Math.exp(-t / tau) * Math.sin(2 * Math.PI * fr * t + ph);
    }
  }
  if (mallet > 0) {
    const hp = makeSvf();
    for (let i = 0; i < Math.round(0.006 * SR) && start + i < out.length; i++) {
      const t = i / SR;
      out[start + i] += amp * mallet * hp(rnd() * 2 - 1, Math.min(f * 3, 9000), 0.8).bp * Math.exp(-t / 0.0015);
    }
  }
}

function notes({ dur, seq, decay = 0.5, partials, mallet = 0.12, detune = 0.002 }) {
  const out = buf(dur);
  seq.forEach(([t, n, amp = 1, dk = decay], i) => strike(out, t, hz(n), { amp, decay: dk, partials, mallet, seed: 11 + i, detune }));
  return out;
}

const MARIMBA = [
  [1, 1, 1],
  [3.93, 0.12, 0.3],
  [9.2, 0.03, 0.12],
];
const GLOCK = [
  [1, 1, 1],
  [2.76, 0.25, 0.4],
  [5.4, 0.08, 0.22],
  [8.93, 0.03, 0.12],
];
const SOFT_BELL = [
  [1, 1, 1],
  [2.0, 0.22, 0.6],
  [3.01, 0.08, 0.4],
  [4.17, 0.05, 0.25],
  [5.43, 0.02, 0.18],
];

/** Band-limited-ish buzzy tone (sum of harmonics with 1/n rolloff) with a pitch glide. */
function buzzTone(out, t0, dur, fStart, fEnd, { amp = 1, harmonics = 12, rolloff = 1.2, attack = 0.008, release = 0.06, vibHz = 0, vibDepth = 0 }) {
  const start = Math.round(t0 * SR);
  const len = Math.min(out.length - start, Math.round(dur * SR));
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const u = t / dur;
    let f = fStart * (fEnd / fStart) ** u;
    if (vibHz) f *= 1 + vibDepth * Math.sin(2 * Math.PI * vibHz * t);
    ph += (2 * Math.PI * f) / SR;
    let s = 0;
    for (let h = 1; h <= harmonics; h++) {
      if (f * h > 9000) break;
      s += Math.sin(ph * h) / h ** rolloff;
    }
    const env = Math.min(1, t / attack) * Math.min(1, (dur - t) / release);
    out[start + i] += amp * s * Math.max(0, env);
  }
}

/** Two short honks of a dual-tone electric horn (jeepney / car style), through a horn-body resonance. */
function horn({ honks = [[0, 0.16], [0.24, 0.3]], f1 = 415, f2 = 523, seed = 3 }) {
  const dur = honks.at(-1)[0] + honks.at(-1)[1] + 0.08;
  const raw = buf(dur);
  const rnd = mulberry32(seed);
  for (const [t0, d] of honks) {
    for (const [f, a] of [[f1, 1], [f2, 0.85]]) {
      const start = Math.round(t0 * SR);
      const len = Math.round(d * SR);
      let ph = rnd() * 6.28;
      for (let i = 0; i < len && start + i < raw.length; i++) {
        const t = i / SR;
        // the diaphragm takes ~15 ms to settle: a slight pitch scoop on attack
        const ff = f * (1 - 0.04 * Math.exp(-t / 0.012));
        ph += (2 * Math.PI * ff) / SR;
        // asymmetric clipped wave = rich, brassy spectrum
        const s = Math.tanh(2.6 * (Math.sin(ph) + 0.35 * Math.sin(2 * ph + 0.4)));
        const env = Math.min(1, t / 0.01) * Math.min(1, (d - t) / 0.03);
        raw[start + i] += a * s * env;
      }
    }
  }
  // horn flare resonances + rolloff so it isn't a raw square wave
  const r1 = makeSvf(), r2 = makeSvf(), lp = makeSvf();
  const out = buf(dur);
  for (let i = 0; i < raw.length; i++) {
    const x = raw[i];
    const body = r1(x, 1200, 1.6).bp * 0.9 + r2(x, 2600, 2.2).bp * 0.5 + x * 0.25;
    out[i] = lp(body, 4200, 0.7).lp;
  }
  return out;
}

/** Sparkly cluster of high glock partials over an airy noise swell. */
function shimmer({ dur = 0.55, count = 9, fLow = 2200, fHigh = 5200, spread = 0.28, seed = 5 }) {
  const out = buf(dur);
  const rnd = mulberry32(seed);
  for (let k = 0; k < count; k++) {
    const u = k / (count - 1);
    const t = spread * u + rnd() * 0.02;
    const f = fLow * (fHigh / fLow) ** (u * 0.85 + rnd() * 0.15);
    strike(out, t, f, { amp: 0.35 + 0.25 * (1 - u), decay: 0.22, partials: [[1, 1, 1], [2.76, 0.12, 0.4]], mallet: 0.02, seed: 50 + k });
  }
  const air = swoosh({ dur: dur * 0.8, f0: 3500, f1: 8000, q: 0.9, peakAt: 0.35, seed: seed + 9, air: 0.4 });
  for (let i = 0; i < air.length; i++) out[i] += air[i] * 0.12;
  return out;
}

/**
 * Soft dull thud with a short buzzy body: invalid action. The thump sits low, but the buzz's
 * harmonics (up to ~1.4 kHz) keep it audible on phone speakers that roll off below 300 Hz.
 */
function errorThud({ seed = 4 }) {
  const out = buf(0.26);
  const rnd = mulberry32(seed);
  let ph = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    const f = 120 + 90 * Math.exp(-t / 0.025);
    ph += (2 * Math.PI * f) / SR;
    out[i] += 0.8 * Math.sin(ph) * Math.exp(-t / 0.06) * Math.min(1, t / 0.002);
  }
  const tmp = buf(0.26);
  buzzTone(tmp, 0.0, 0.17, 185, 165, { amp: 0.32, harmonics: 12, rolloff: 1.25, attack: 0.004, release: 0.06 });
  const lp = makeSvf();
  for (let i = 0; i < out.length; i++) out[i] += lp(tmp[i] + (rnd() - 0.5) * 0.002, 1400, 0.7).lp;
  return out;
}

/** Playful two-note "uh-oh" buzzer (wrong answer). */
function sablay({ seq = [[0, 0.12, 'E4', 'E4'], [0.15, 0.26, 'C4', 'Bb3']], harmonics = 9 }) {
  const dur = seq.at(-1)[0] + seq.at(-1)[1] + 0.05;
  const raw = buf(dur);
  for (const [t0, d, a, b] of seq) buzzTone(raw, t0, d, hz(a), hz(b), { amp: 0.5, harmonics, rolloff: 1.1, attack: 0.006, release: 0.05, vibHz: 7, vibDepth: 0.006 });
  const lp = makeSvf();
  const out = buf(dur);
  for (let i = 0; i < raw.length; i++) out[i] = lp(raw[i], 1800, 0.9).lp;
  return out;
}

/** Tiny resonant tick: a filtered impulse ringing a small plastic body. */
function tick({ f = 3200, q = 6, decay = 0.012, seed = 2, body = 900 }) {
  const out = buf(0.05);
  const rnd = mulberry32(seed);
  const r = makeSvf(), b = makeSvf();
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    const exc = i < 40 ? (rnd() * 2 - 1) * Math.exp(-i / 8) : 0;
    out[i] = (r(exc, f, q).bp + 0.6 * b(exc, body, 3).bp) * Math.exp(-t / decay);
  }
  return out;
}

/** Coin-like two-note blip (soft "ka-ching" without the 8-bit square). */
function coinBlip({ a = 'B6', b = 'E7' }) {
  const out = buf(0.42);
  const parts = [[1, 1, 1], [2, 0.18, 0.5], [3, 0.1, 0.35], [4.01, 0.04, 0.2]];
  strike(out, 0, hz(a), { amp: 0.7, decay: 0.05, partials: parts, mallet: 0.05, seed: 21 });
  strike(out, 0.065, hz(b), { amp: 1, decay: 0.16, partials: parts, mallet: 0.05, seed: 22 });
  return out;
}

/**
 * Glass bottle spinning on its side on a wooden table: a low wood rumble and a brighter glass
 * grind, both modulated by the rotation (the bottle's bulge lifts and drops once per turn), plus
 * sparse grit ticks. The modulation is exactly periodic over `loopSec`, so the build's crossfade
 * loop lands on a whole number of turns. The build convolves it with a real bottle's ring.
 */
function bottleSpin({ loopSec = 1.0, turns = 4, xfade = 0.06, seed = 8, rumbleHz = 260, grindHz = 1900 }) {
  const dur = loopSec + xfade;
  const out = buf(dur);
  const rnd = mulberry32(seed);
  const fr = turns / loopSec;
  const r1 = makeSvf(), r2 = makeSvf(), r3 = makeSvf(), hp = makeSvf();
  let tickEnv = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    const ph = 2 * Math.PI * fr * t;
    const lift = (0.5 + 0.5 * Math.cos(ph)) ** 3; // contact pressure peaks once per turn
    const wob = 0.5 + 0.5 * Math.cos(2 * ph + 0.7); // the neck scuffs twice per turn
    const n = rnd() * 2 - 1;
    const rumble = r1(n, rumbleHz, 1.2).bp * (0.55 + 0.45 * lift);
    const grind = r2(r3(n, grindHz, 2.5).bp, grindHz * 1.6, 1.5).bp * (0.25 + 0.75 * lift * wob);
    if (rnd() < 35 / SR) tickEnv = 0.6 + 0.4 * rnd();
    tickEnv *= Math.exp(-1 / (0.0015 * SR));
    const grit = hp(n, 3500, 0.8).hp * tickEnv;
    out[i] = rumble * 1.0 + grind * 0.55 + grit * 0.35;
  }
  return out;
}

const VOICES = { swoosh, notes, horn, shimmer, errorThud, sablay, tick, coinBlip, bottleSpin };
const PARTIAL_SETS = { MARIMBA, GLOCK, SOFT_BELL };

/** Render a synth recipe: { voice, ...params }; `partials` may name a preset. */
export function renderSynth(spec) {
  const { voice, ...p } = spec;
  const fn = VOICES[voice];
  if (!fn) throw new Error(`unknown synth voice "${voice}"`);
  if (typeof p.partials === 'string') p.partials = PARTIAL_SETS[p.partials];
  return fn(p);
}
