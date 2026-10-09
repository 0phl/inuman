#!/usr/bin/env node
// Build every shipped audio file from the recipes in assets-src/audio/recipes.json and write
// public/assets/audio/manifest.json. Fails (exit 1) when a budget or contract check is violated.
//
//   pnpm audio               build everything (fetches missing downloads first)
//   pnpm audio --only=dice   rebuild only ids containing "dice" (manifest still covers all ids)
//   pnpm audio --check       only check budgets/contract of the files already in public/
//
// Pipeline per SFX take: decode source segment(s) (ffmpeg, mono f32 44.1 kHz) -> per-layer filters,
// rate, gain, offset -> mix -> take filters -> trim leading silence (<= 2 ms pre-roll) and trailing
// silence -> optional gate / max length -> fades -> peak-normalize to -3 dBFS -> loudness balance
// (K-weighted max 200 ms loudness vs. category target, never above -3 dBFS peak) -> MP3 96 kbps CBR.
// Loops get a crossfaded loop point instead of trims/fades and are verified by a 3x-concatenation
// seam check. Music: trim, fades, two-pass loudnorm (linear) to -18 LUFS, stereo MP3 128 kbps.
//
// ffmpeg: $FFMPEG, else assets-src/audio/tools/ffmpeg (static build, gitignored), else PATH.

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = path.join(ROOT, 'assets-src/audio');
const DL_DIR = path.join(SRC_DIR, 'downloads');
const OUT_DIR = path.join(ROOT, 'public/assets/audio');
const SR = 44100;
const KB = 1000;
const MB = 1000 * KB; // budgets in decimal megabytes (stricter than MiB)

const BUDGET = {
  sfxTotal: 1.6 * MB, // every file in sfx/, ambience included
  ambience: 0.8 * MB,
  musicEach: 4 * MB,
};
const PEAK_DB = -3; // SFX peak level after normalisation
const SFX_KBPS = 96;
const MUSIC_KBPS = 128;
const MUSIC_LUFS = -18;

const args = process.argv.slice(2);
const CHECK_ONLY = args.includes('--check');
const ONLY = (args.find((a) => a.startsWith('--only=')) ?? '').slice(7);
const VERBOSE = args.includes('--verbose');

// ── ffmpeg ────────────────────────────────────────────────────────────────────────────────

function findFfmpeg() {
  const candidates = [process.env.FFMPEG, path.join(SRC_DIR, 'tools', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'), 'ffmpeg'];
  for (const c of candidates) {
    if (!c) continue;
    const r = spawnSync(c, ['-hide_banner', '-version'], { encoding: 'utf8' });
    if (r.status === 0) return c;
  }
  return null;
}

let FF = null;
const ff = (argv, input) => execFileSync(FF, ['-hide_banner', '-nostdin', '-v', 'error', ...argv], { input, maxBuffer: 1 << 30 });

const toF32 = (b) => new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
const fromF32 = (x) => Buffer.from(x.buffer, x.byteOffset, x.byteLength);

/** Decode [inSec, outSec) of a file to mono f32 at 44.1 kHz, with an optional ffmpeg filter chain. */
function decode(file, { inSec = 0, outSec = null, filter = '', rate = 1 } = {}) {
  const chain = [];
  if (rate !== 1) chain.push(`asetrate=${Math.round(SR * rate)}`, `aresample=${SR}`);
  if (filter) chain.push(filter);
  const argv = [];
  if (inSec > 0) argv.push('-ss', String(inSec));
  if (outSec !== null) argv.push('-t', String(Math.max(0.001, outSec - inSec)));
  argv.push('-i', file, '-ac', '1', '-ar', String(SR));
  // rate change happens after the cut so in/out stay in source time
  if (chain.length) argv.push('-af', chain.join(','));
  argv.push('-f', 'f32le', '-');
  return toF32(ff(argv));
}

/** Run a mono f32 buffer through an ffmpeg filter chain. */
function filterBuf(x, filter) {
  if (!filter) return x;
  return toF32(ff(['-f', 'f32le', '-ar', String(SR), '-ac', '1', '-i', '-', '-af', filter, '-f', 'f32le', '-'], fromF32(x)));
}

// ── analysis helpers ──────────────────────────────────────────────────────────────────────

const dbToLin = (d) => 10 ** (d / 20);
const linToDb = (v) => (v > 0 ? 20 * Math.log10(v) : -Infinity);

function peakOf(x) {
  let p = 0;
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]);
    if (a > p) p = a;
  }
  return p;
}

/** BS.1770 K-weighting (coefficients derived for any rate, as in libebur128). */
function kWeight(x) {
  const biquad = (b, a) => {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    return (v) => {
      const y = b[0] * v + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2;
      x2 = x1; x1 = v; y2 = y1; y1 = y;
      return y;
    };
  };
  let f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / SR);
  const Vh = 10 ** (G / 20), Vb = Vh ** 0.4996667741545416;
  let a0 = 1 + K / Q + K * K;
  const pre = biquad([(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0], [1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0]);
  f0 = 38.13547087602444; Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / SR);
  a0 = 1 + K / Q + K * K;
  const rlb = biquad([1, -2, 1], [1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0]);
  const y = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) y[i] = rlb(pre(x[i]));
  return y;
}

/** Max K-weighted loudness over sliding 200 ms windows (short sounds are padded with silence). */
function loudnessMax200(x) {
  const k = kWeight(x);
  const W = Math.round(0.2 * SR), hop = Math.round(0.01 * SR);
  const sq = new Float64Array(k.length + 1);
  for (let i = 0; i < k.length; i++) sq[i + 1] = sq[i] + k[i] * k[i];
  let best = 0;
  for (let s = 0; s < Math.max(1, k.length - W + hop); s += hop) {
    const e = Math.min(k.length, s + W);
    const ms = (sq[e] - sq[s]) / W;
    if (ms > best) best = ms;
  }
  return best > 0 ? -0.691 + 10 * Math.log10(best) : -Infinity;
}

/** Integrated-style loudness (ungated mean over the whole buffer). */
function loudnessMean(x) {
  const k = kWeight(x);
  let s = 0;
  for (let i = 0; i < k.length; i++) s += k[i] * k[i];
  return -0.691 + 10 * Math.log10(s / k.length + 1e-20);
}

/** Robust noise floor: 10th percentile of 10 ms RMS frames. */
function noiseFloor(x) {
  const hop = Math.round(0.01 * SR);
  const fr = [];
  for (let i = 0; i + hop <= x.length; i += hop) {
    let s = 0;
    for (let j = 0; j < hop; j++) s += x[i + j] ** 2;
    fr.push(Math.sqrt(s / hop));
  }
  fr.sort((a, b) => a - b);
  return fr[Math.floor(fr.length * 0.1)] ?? 0;
}

// ── SFX processing ────────────────────────────────────────────────────────────────────────

/** Cosine fade shapes (ends at exactly 0 / starts at exactly 0). */
function fadeIn(x, n) {
  n = Math.min(n, x.length);
  for (let i = 0; i < n; i++) x[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / n);
}
function fadeOut(x, n, curve = 2) {
  n = Math.min(n, x.length);
  const s = x.length - n;
  for (let i = 0; i < n; i++) x[s + i] *= (0.5 + 0.5 * Math.cos((Math.PI * (i + 1)) / n)) ** (curve / 2);
}

/** Downward expander below `thrDb` (relative to peak) to clean noisy tails/gaps. */
function gate(x, thrDb, ratio = 3) {
  const thr = peakOf(x) * dbToLin(thrDb);
  const att = Math.exp(-1 / (0.001 * SR)), rel = Math.exp(-1 / (0.04 * SR));
  let env = 0;
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]);
    env = a > env ? att * env + (1 - att) * a : rel * env + (1 - rel) * a;
    if (env < thr) x[i] *= (env / thr) ** (ratio - 1);
  }
}

function trimSilence(x, { onsetDb = -36, tailDb = -50, preroll = 0.002 }) {
  const pk = peakOf(x);
  if (pk === 0) throw new Error('silent take');
  const floor = noiseFloor(x);
  const thrOn = Math.max(pk * dbToLin(onsetDb), floor * 2.5);
  let a = 0;
  while (a < x.length && Math.abs(x[a]) < thrOn) a++;
  const thrTail = Math.max(pk * dbToLin(tailDb), floor * 1.5);
  let b = x.length - 1;
  while (b > a && Math.abs(x[b]) < thrTail) b--;
  const pre = Math.round(preroll * SR);
  const start = Math.max(0, a - pre);
  const end = Math.min(x.length, b + Math.round(0.004 * SR));
  const y = x.slice(start, end);
  fadeIn(y, a - start); // the pre-roll ramps up from silence: no click, onset stays sharp
  return y;
}

function mixLayers(layers, resolveFile) {
  const parts = layers.map((L) => {
    let buf;
    if (L.synth) buf = renderSynthLayer(L.synth);
    else buf = decode(resolveFile(L), { inSec: L.in ?? 0, outSec: L.out ?? null, filter: L.filter ?? '', rate: L.rate ?? 1 });
    if (L.synth && L.filter) buf = filterBuf(buf, L.filter);
    if (L.ir) buf = convolveWith(buf, decode(resolveFile(L.ir), { inSec: L.ir.in ?? 0, outSec: L.ir.out ?? null, filter: L.ir.filter ?? '' }), L.ir.mix ?? 1);
    if (L.reverse) buf.reverse();
    if (L.fadeIn) fadeIn(buf, Math.round(L.fadeIn * SR));
    if (L.fadeOut) fadeOut(buf, Math.round(L.fadeOut * SR));
    const g = dbToLin(L.gain ?? 0);
    const at = Math.round((L.at ?? 0) * SR);
    return { buf, g, at };
  });
  const len = Math.max(...parts.map((p) => p.at + p.buf.length));
  const out = new Float32Array(len);
  for (const p of parts) for (let i = 0; i < p.buf.length; i++) out[p.at + i] += p.buf[i] * p.g;
  return out;
}

/**
 * Circular convolution with a recorded impulse response (e.g. a real bottle's ring), wet/dry by
 * `mix`. Circular so a periodic (loop) signal stays periodic; levels matched by peak.
 */
function convolveWith(x, ir, mix) {
  const N = x.length, M = ir.length;
  const wet = new Float32Array(N);
  for (let j = 0; j < M; j++) {
    const h = ir[j];
    if (h === 0) continue;
    for (let i = 0; i < N; i++) wet[(i + j) % N] += x[i] * h;
  }
  const g = peakOf(x) / (peakOf(wet) || 1);
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) out[i] = x[i] * (1 - mix) + wet[i] * g * mix;
  return out;
}

let synthMod = null;
function renderSynthLayer(spec) {
  return Float32Array.from(synthMod.renderSynth(spec));
}

/** Seamless loop: take L + X samples, crossfade the last X (equal power) into the first X. */
function makeLoop(x, xfadeSec) {
  const X = Math.round(xfadeSec * SR);
  const L = x.length - X;
  if (L <= X) throw new Error('loop source too short for its crossfade');
  const y = new Float32Array(L);
  for (let i = 0; i < L; i++) y[i] = x[i];
  for (let i = 0; i < X; i++) {
    const t = (i + 0.5) / X;
    y[i] = x[i] * Math.sin((Math.PI / 2) * t) + x[i + L] * Math.cos((Math.PI / 2) * t);
  }
  return y;
}

/**
 * Seam check on 3 concatenated copies. At the seam (start of the middle copy) we measure the
 * sample step, the 10 ms level change and the 10 ms high-frequency (first-difference) energy
 * change, and compare each with the same measure at every other 5 ms position of the loop: the
 * seam must not be more abrupt than what the material itself does (<= 99th percentile).
 */
function checkLoopSeam(y) {
  const L = y.length;
  const z = new Float32Array(L * 3);
  z.set(y, 0); z.set(y, L); z.set(y, 2 * L);
  const w = Math.round(0.01 * SR);
  const rms = (s) => { let e = 0; for (let i = s; i < s + w; i++) e += z[i] * z[i]; return Math.sqrt(e / w) + 1e-9; };
  const hf = (s) => { let e = 0; for (let i = s + 1; i < s + w; i++) e += (z[i] - z[i - 1]) ** 2; return e + 1e-12; };
  const measure = (p) => ({
    step: Math.abs(z[p] - z[p - 1]),
    level: Math.abs(linToDb(rms(p) / rms(p - w))),
    flux: Math.abs(10 * Math.log10(hf(p) / hf(p - w))),
  });
  const seam = measure(L);
  const others = [];
  for (let p = L + w * 2; p < 2 * L - w * 2; p += Math.round(0.005 * SR)) others.push(measure(p));
  const p99 = (k) => { const v = others.map((o) => o[k]).sort((a, b) => a - b); return v[Math.floor(v.length * 0.99)]; };
  const lim = { step: p99('step'), level: p99('level'), flux: p99('flux') };
  const ok = seam.step <= lim.step * 1.05 && seam.level <= lim.level + 0.5 && seam.flux <= lim.flux + 0.5;
  return { ok, seam, lim };
}

function processTake(take, spec, resolveFile) {
  const layers = take.layers ?? [take];
  let x = mixLayers(layers, resolveFile);
  if (take.layers && take.filter) x = filterBuf(x, take.filter);
  const gateDb = take.gate ?? (spec.loop ? undefined : spec.gate);
  if (gateDb !== undefined && gateDb !== null) gate(x, gateDb, take.gateRatio ?? 3);

  if (spec.loop) {
    x = makeLoop(x, take.xfade ?? 0.05);
  } else {
    if (take.trim !== false) x = trimSilence(x, { onsetDb: take.onsetDb ?? spec.onsetDb ?? -36, tailDb: take.tailDb ?? spec.tailDb ?? -50, preroll: take.preroll ?? 0.002 });
    if (take.maxDur && x.length > take.maxDur * SR) x = x.slice(0, Math.round(take.maxDur * SR));
    const fo = take.fadeOutSec ?? spec.fadeOutSec ?? Math.min(0.08, (x.length / SR) * 0.3);
    fadeOut(x, Math.round(fo * SR), take.fadeCurve ?? 2);
  }
  // peak-normalise; the loudness trim is decided per id (see balanceTakes)
  const pk = peakOf(x);
  const g = dbToLin(PEAK_DB) / pk;
  for (let i = 0; i < x.length; i++) x[i] *= g;
  const measured = spec.loop && spec.measure === 'mean' ? loudnessMean(x) : loudnessMax200(x);
  return { x, measured };
}

/**
 * Loudness balance (gain only ever goes down from the -3 dBFS peak):
 *  - each id has a target (category default or per-id `loudness`);
 *  - its takes are matched so none is more than VARIANT_SPREAD_DB louder than the quietest one,
 *    so rotating variants never jumps in level (the engine adds its own small random gain).
 */
const VARIANT_SPREAD_DB = 1.5;
function balanceTakes(results, takes, spec) {
  const quietest = Math.min(...results.map((r) => r.measured));
  return results.map((r, n) => {
    const target = Math.min(takes[n].loudness ?? spec.loudness, quietest + VARIANT_SPREAD_DB);
    const trimDb = Math.min(0, target - r.measured) + (takes[n].trimDb ?? 0);
    const g = dbToLin(trimDb);
    for (let i = 0; i < r.x.length; i++) r.x[i] *= g;
    return { x: r.x, trimDb, loudness: r.measured + trimDb, peakDb: linToDb(peakOf(r.x)) };
  });
}

function encodeMp3(x, outFile, { kbps, channels = 1 }) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  // CBR; LAME/Info header kept so decoders that honour it trim encoder delay + padding exactly.
  ff(['-y', '-f', 'f32le', '-ar', String(SR), '-ac', String(channels), '-i', '-', '-c:a', 'libmp3lame', '-b:a', `${kbps}k`, '-map_metadata', '-1', '-id3v2_version', '0', '-write_id3v1', '0', outFile], fromF32(x));
}

// ── main ──────────────────────────────────────────────────────────────────────────────────

async function main() {
  const recipes = JSON.parse(fs.readFileSync(path.join(SRC_DIR, 'recipes.json'), 'utf8'));
  const { SOUNDS, MUSIC } = await import(pathToFileURL(path.join(ROOT, 'src/audio/catalog.ts')).href);
  const errors = [];

  // contract: recipes cover the catalog exactly, with the right variant counts
  for (const [id, spec] of Object.entries(SOUNDS)) {
    const r = recipes.sfx[id];
    if (!r) { errors.push(`missing recipe for ${id}`); continue; }
    if (r.takes.length !== spec.variants) errors.push(`${id}: ${r.takes.length} takes, catalog wants ${spec.variants}`);
    if (!!r.loop !== !!spec.loop && !['dice.shake'].includes(id)) errors.push(`${id}: loop flag differs from catalog`);
  }
  for (const id of Object.keys(recipes.sfx)) if (!SOUNDS[id]) errors.push(`recipe ${id} is not in the catalog`);
  for (const m of MUSIC) if (!recipes.music[m.id]) errors.push(`missing music recipe for ${m.id}`);
  if (errors.length) return fail(errors);

  const sources = recipes.sources;
  const resolveFile = (L) => {
    const s = sources[L.src];
    if (!s) throw new Error(`unknown source "${L.src}"`);
    const f = path.join(DL_DIR, s.file ?? s.dir, L.file ?? '');
    if (!fs.existsSync(f)) throw new Error(`missing download ${path.relative(ROOT, f)} — run: node assets-src/audio/fetch.mjs`);
    return f;
  };

  if (!CHECK_ONLY) {
    FF = findFfmpeg();
    if (!FF) return fail(['ffmpeg not found: set FFMPEG or put a static build at assets-src/audio/tools/ffmpeg']);
    // make sure every download exists (fetch.mjs is idempotent)
    const missing = Object.values(sources).some((s) => s.file !== undefined || s.dir !== undefined ? !fs.existsSync(path.join(DL_DIR, s.file ?? s.dir)) : false);
    if (missing) execFileSync(process.execPath, [path.join(SRC_DIR, 'fetch.mjs')], { stdio: 'inherit' });
    synthMod = await import(pathToFileURL(path.join(SRC_DIR, 'synth.mjs')).href);
  }

  const cats = recipes.categories;
  const manifest = { version: 1, sfx: {}, music: {}, credits: [] };
  const report = [];
  const seamReports = [];

  // SFX
  for (const [id, r] of Object.entries(recipes.sfx)) {
    const spec = { ...cats[r.category], loop: !!SOUNDS[id].loop || !!r.loop, loudness: r.loudness ?? cats[r.category]?.loudness };
    if (spec.loudness === undefined) return fail([`${id}: no loudness target (category "${r.category}")`]);
    const files = r.takes.map((_, n) => `sfx/${id}_${n + 1}.mp3`);
    const durations = [];
    if (!CHECK_ONLY && (!ONLY || id.includes(ONLY))) {
      const balanced = balanceTakes(r.takes.map((take) => processTake(take, spec, resolveFile)), r.takes, spec);
      r.takes.forEach((take, n) => {
        const res = balanced[n];
        encodeMp3(res.x, path.join(OUT_DIR, files[n]), { kbps: SFX_KBPS });
        durations.push(+(res.x.length / SR).toFixed(4));
        report.push({ id: `${id}_${n + 1}`, dur: res.x.length / SR, loud: res.loudness, trim: res.trimDb, peak: res.peakDb });
        if (spec.loop) {
          const seam = checkLoopSeam(res.x);
          seamReports.push({ id: `${id}_${n + 1}`, ...seam });
          if (!seam.ok) errors.push(`${id}_${n + 1}: loop seam check failed (${JSON.stringify(seam)})`);
        }
      });
    }
    manifest.sfx[id] = { files, gainDb: r.gainDb ?? 0, loop: !!(SOUNDS[id].loop || r.loop), origin: originOf(r, sources) };
    if (durations.length) manifest.sfx[id].durationsSec = durations;
  }

  // Music
  for (const m of MUSIC) {
    const r = recipes.music[m.id];
    const s = sources[r.src];
    const file = `music/${m.id}.mp3`;
    const out = path.join(OUT_DIR, file);
    let durationSec;
    if (!CHECK_ONLY && (!ONLY || m.id.includes(ONLY))) durationSec = buildMusic(r, resolveFile({ src: r.src }), out);
    else durationSec = probeDuration(out);
    manifest.music[m.id] = { file, title: s.title, artist: s.author, license: s.license, url: s.url, loopStart: r.loopStart ?? null, loopEnd: r.loopEnd ?? null, durationSec: +durationSec.toFixed(3) };
  }

  // keep durations from a previous full build when rebuilding a subset
  const manifestPath = path.join(OUT_DIR, 'manifest.json');
  if ((ONLY || CHECK_ONLY) && fs.existsSync(manifestPath)) {
    const prev = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    for (const [id, e] of Object.entries(manifest.sfx)) if (!e.durationsSec && prev.sfx?.[id]?.durationsSec) e.durationsSec = prev.sfx[id].durationsSec;
    if (CHECK_ONLY) for (const [id, e] of Object.entries(manifest.music)) if (prev.music?.[id]) e.durationSec = prev.music[id].durationSec;
  }

  manifest.credits = buildCredits(recipes, manifest);
  if (!CHECK_ONLY) fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  // ── budgets & contract checks on the files on disk ───────────────────────────────────────
  const size = (rel) => (fs.existsSync(path.join(OUT_DIR, rel)) ? fs.statSync(path.join(OUT_DIR, rel)).size : -1);
  let sfxTotal = 0;
  for (const [id, e] of Object.entries(manifest.sfx)) {
    for (const f of e.files) {
      const sz = size(f);
      if (sz < 0) errors.push(`missing ${f}`);
      else sfxTotal += sz;
    }
  }
  const sfxDir = path.join(OUT_DIR, 'sfx');
  const strays = (fs.existsSync(sfxDir) ? fs.readdirSync(sfxDir) : []).filter((f) => !Object.values(manifest.sfx).some((e) => e.files.includes(`sfx/${f}`)));
  if (strays.length) errors.push(`stray files in sfx/: ${strays.join(', ')} (delete them)`);
  const amb = manifest.sfx['ambience.bar'].files.reduce((s, f) => s + Math.max(0, size(f)), 0);
  if (sfxTotal > BUDGET.sfxTotal) errors.push(`SFX total ${(sfxTotal / MB).toFixed(3)} MB > ${BUDGET.sfxTotal / MB} MB`);
  if (amb > BUDGET.ambience) errors.push(`ambience.bar ${(amb / MB).toFixed(3)} MB > ${BUDGET.ambience / MB} MB`);
  for (const [id, e] of Object.entries(manifest.music)) {
    const sz = size(e.file);
    if (sz < 0) errors.push(`missing ${e.file}`);
    else if (sz > BUDGET.musicEach) errors.push(`music ${id} ${(sz / MB).toFixed(2)} MB > ${BUDGET.musicEach / MB} MB`);
    if (e.durationSec < 120 || e.durationSec > 240) errors.push(`music ${id} is ${e.durationSec}s (want 2–4 min)`);
  }

  if (report.length && VERBOSE) {
    for (const r of report) console.log(`${r.id.padEnd(22)} ${r.dur.toFixed(2)}s  L200=${r.loud.toFixed(1)}  trim=${r.trim.toFixed(1)}dB  pk=${r.peak.toFixed(1)}`);
  }
  for (const s of seamReports) console.log(`loop ${s.id}: seam step ${s.seam.step.toFixed(4)} (p99 ${s.lim.step.toFixed(4)}), level jump ${s.seam.level.toFixed(1)} dB (p99 ${s.lim.level.toFixed(1)}), HF flux ${s.seam.flux.toFixed(1)} dB (p99 ${s.lim.flux.toFixed(1)}) -> ${s.ok ? 'OK' : 'FAIL'}`);
  const musicSizes = Object.entries(manifest.music).map(([id, e]) => `${id} ${(size(e.file) / MB).toFixed(2)} MB`).join(', ');
  console.log(`SFX: ${Object.values(manifest.sfx).reduce((n, e) => n + e.files.length, 0)} files, ${(sfxTotal / MB).toFixed(3)} MB (budget ${BUDGET.sfxTotal / MB}), ambience ${(amb / MB).toFixed(3)} MB (budget ${BUDGET.ambience / MB})`);
  console.log(`Music: ${musicSizes}`);
  if (errors.length) return fail(errors);
  console.log('audio OK');
}

function originOf(r, sources) {
  const kinds = new Set();
  for (const t of r.takes) {
    for (const L of t.layers ?? [t]) {
      kinds.add(L.synth ? 'synth' : sources[L.src]?.kind ?? '?');
      if (L.ir) kinds.add(sources[L.ir.src]?.kind ?? '?'); // a recorded impulse response counts as recorded material
    }
  }
  if (kinds.size === 1 && kinds.has('synth')) return 'synth';
  if (kinds.has('synth')) return 'mixed';
  return 'recorded';
}

function buildCredits(recipes, manifest) {
  const used = new Map(); // src -> Set(ids)
  for (const [id, r] of Object.entries(recipes.sfx)) {
    for (const t of r.takes) {
      for (const L of t.layers ?? [t]) {
        for (const src of [L.synth ? null : L.src, L.ir?.src]) {
          if (!src) continue;
          if (!used.has(src)) used.set(src, new Set());
          used.get(src).add(id);
        }
      }
    }
  }
  for (const [id, r] of Object.entries(recipes.music)) {
    if (!used.has(r.src)) used.set(r.src, new Set());
    used.get(r.src).add(`music:${id}`);
  }
  const credits = [];
  for (const [src, ids] of used) {
    const s = recipes.sources[src];
    credits.push({ what: s.title, author: s.author, license: s.license, url: s.url, ids: [...ids].sort() });
  }
  const synthIds = Object.entries(manifest.sfx).filter(([, e]) => e.origin !== 'recorded').map(([id]) => id);
  if (synthIds.length) credits.push({ what: 'Synthesized sounds (original, made for Inuman)', author: 'Inuman', license: 'CC0 1.0', url: '', ids: synthIds.sort() });
  return credits;
}

/**
 * Trim, fade, then one fixed gain to -18 LUFS integrated (measured with ffmpeg's loudnorm scanner;
 * a plain gain keeps dynamics and loop points level-matched), stereo MP3 128 kbps. Returns duration.
 */
function buildMusic(r, src, out) {
  const dur = r.out - r.in;
  const target = r.lufs ?? MUSIC_LUFS;
  const fades = [];
  if (r.fadeIn) fades.push(`afade=t=in:st=0:d=${r.fadeIn}:curve=qsin`);
  if (r.fadeOut) fades.push(`afade=t=out:st=${(dur - r.fadeOut).toFixed(3)}:d=${r.fadeOut}:curve=qsin`);
  const pre = [`atrim=start=${r.in}:end=${r.out}`, 'asetpts=PTS-STARTPTS', `aresample=${SR}`, ...fades].join(',');
  // pass 1: measure integrated loudness and true peak of the trimmed, faded track
  const meas = spawnSync(FF, ['-hide_banner', '-nostdin', '-i', src, '-vn', '-af', `${pre},loudnorm=I=${target}:TP=-1.5:print_format=json`, '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 26 });
  const json = JSON.parse(meas.stderr.slice(meas.stderr.lastIndexOf('{'), meas.stderr.lastIndexOf('}') + 1));
  let gain = target - Number(json.input_i);
  const tpAfter = Number(json.input_tp) + gain;
  if (tpAfter > -1) {
    console.warn(`  note: ${path.basename(out)} gain capped by true peak (${tpAfter.toFixed(1)} dBTP)`);
    gain = -1 - Number(json.input_tp);
  }
  // pass 2: fixed gain, encode
  fs.mkdirSync(path.dirname(out), { recursive: true });
  ff(['-y', '-i', src, '-vn', '-af', `${pre},volume=${gain.toFixed(2)}dB`, '-ac', '2', '-ar', String(SR), '-c:a', 'libmp3lame', '-b:a', `${MUSIC_KBPS}k`, '-map_metadata', '-1', '-id3v2_version', '0', '-write_id3v1', '0', out]);
  const check = spawnSync(FF, ['-hide_banner', '-nostdin', '-i', out, '-af', 'ebur128=framelog=quiet:peak=true', '-f', 'null', '-'], { encoding: 'utf8' });
  const summary = check.stderr.slice(check.stderr.lastIndexOf('Summary'));
  const I = (/I:\s+(-?[\d.]+) LUFS/.exec(summary) ?? [])[1];
  const TP = (/Peak:\s+(-?[\d.]+) dBFS/.exec(summary) ?? [])[1];
  console.log(`music ${path.basename(out)}: ${dur.toFixed(1)} s, ${I} LUFS integrated, true peak ${TP} dBFS (input ${json.input_i} LUFS, gain ${gain.toFixed(2)} dB)`);
  return dur;
}

function probeDuration(file) {
  if (!fs.existsSync(file)) return 0;
  const FP = FF ?? findFfmpeg();
  if (!FP) return 0;
  const r = spawnSync(FP, ['-hide_banner', '-i', file, '-f', 'null', '-'], { encoding: 'utf8' });
  const m = /time=(\d+):(\d+):([\d.]+)/g;
  let last = null, t;
  while ((t = m.exec(r.stderr))) last = t;
  return last ? Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]) : 0;
}

function fail(errors) {
  for (const e of errors) console.error(`✗ ${e}`);
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
