// The audio engine: one shared AudioContext (created and unlocked on the first tap/key), a small
// mix graph, lazily decoded and cached clips, and `play(id)` for every sound in the catalog.
//
//   voices ─► bus.ui ──────┐
//   voices ─► bus.sfx ─────┼─► master ─► limiter ─► speakers
//   loop   ─► bus.ambience ┤
//   music decks ─► bus.music
//
// Nothing here may throw into the app or block a frame: every entry point is guarded, decoding is
// async, and a sound whose file is missing falls back to a synthesized stand-in (UI ids) or is
// silent.
import { useSettings, type AudioSettings } from '@/store/settings';
import { SOUNDS, type Bus, type SoundId } from './catalog';
import { audioUrl, loadManifest } from './manifest';
import {
  dbToGain,
  fitTake,
  humanize,
  leadingSilence,
  loopRegion,
  pickVariant,
  RetriggerGate,
  VoicePool,
  volumeToGain,
} from './mix';
import { renderSynth } from './synth';

export interface PlayOpts {
  /** Linear gain multiplier (1 = as mixed). */
  gain?: number;
  /** Playback-rate multiplier (pitch and speed together). */
  rate?: number;
  /** Stereo position, −1 (left) … 1 (right). */
  pan?: number;
  /** Seconds from now on the audio clock: schedule ahead for sample-accurate timing. */
  delay?: number;
  /** Skip the random pitch/gain humanising (e.g. for loops whose rate is driven). */
  exact?: boolean;
  /** Loop this take (the catalog's loop flag otherwise decides). */
  loop?: boolean;
  /** Stop (with a short fade) this many seconds after it starts: e.g. a shake loop. */
  duration?: number;
  /**
   * Seconds this one-shot should last: plays the take whose length fits best, sped up or slowed
   * down a little to land exactly (e.g. a bottle spin that stops when the bottle does).
   */
  fit?: number;
}

/** A playing (or scheduled) sound. Every method is safe to call at any time, even after it ended. */
export interface SoundHandle {
  readonly id: SoundId | null;
  /** Fades out over `fadeMs` and stops (a scheduled sound that hasn't started is cancelled). */
  stop(fadeMs?: number): void;
  /** Glides the playback rate to `rate` (loops: pitch follows speed). */
  setRate(rate: number, rampMs?: number): void;
  /** Glides the voice's level to `gain` × its mixed level. */
  setGain(gain: number, rampMs?: number): void;
}

export const SILENT: SoundHandle = {
  id: null,
  stop() {},
  setRate() {},
  setGain() {},
};

interface Clip {
  buffer: AudioBuffer;
  /** Seconds of leading silence / encoder delay to skip. */
  offset: number;
  /** The seamless repeat region, for looped takes. */
  loopStart: number;
  loopEnd: number;
  /** Linear trim from the manifest's gainDb. */
  gain: number;
}

// ---------------------------------------------------------------- tuning

/** Per-id minimum spacing of starts (seconds). */
const RETRIGGER: Partial<Record<SoundId, number>> = {
  'ui.tap': 0.04,
  'ui.select': 0.035,
  'dice.hitTable': 0.016,
  'dice.hitDie': 0.016,
  'dice.hitWall': 0.02,
  'ball.bounce': 0.03,
  'coin.bounce': 0.025,
  'wheel.tick': 0.028,
  'chips.stack': 0.035,
  'cup.lift': 0.05,
};
const DEFAULT_RETRIGGER = 0.025;

/** Per-id voice cap (the oldest is stolen). Loops default to 1. */
const POLYPHONY: Partial<Record<SoundId, number>> = {
  'dice.hitTable': 6,
  'dice.hitDie': 4,
  'dice.hitWall': 4,
  'ball.bounce': 3,
  'wheel.tick': 3,
  'chips.stack': 5,
  'cup.lift': 6,
  'card.place': 3,
  'card.slide': 3,
  'drink.cheers': 2,
};
const DEFAULT_POLYPHONY = 3;

/** A clip that finished decoding after its start time may still start this late (s). */
const LATE_OK = 0.12;

/** Bus trims under the user's volumes (UI clicks sit under the game). */
const BUS_TRIM: Record<Bus, number> = { ui: 0.75, sfx: 1, music: 1, ambience: 0.8 };

// ---------------------------------------------------------------- state

interface Graph {
  master: GainNode;
  limiter: DynamicsCompressorNode;
  buses: Record<Bus, GainNode>;
}

let ctx: AudioContext | null = null;
let graph: Graph | null = null;
const gate = new RetriggerGate();
const pool = new VoicePool<Voice>();
const lastVariant = new Map<SoundId, number>();
const idClips = new Map<SoundId, Promise<Clip[]>>();
const idReady = new Map<SoundId, Clip[]>();
const fileClips = new Map<string, Promise<Clip | null>>();
const fileBytes = new Map<string, Promise<ArrayBuffer | null>>();
/** Ids asked for before the context existed: decoded as soon as it does. */
const warmLater = new Set<SoundId>();
const contextHooks = new Set<(c: AudioContext, g: Graph) => void>();
const gestureHooks = new Set<() => void>();
let settings: AudioSettings = useSettings.getState();
let hidden = typeof document !== 'undefined' && document.hidden;

// ---------------------------------------------------------------- debug log

const DEBUG_KEY = 'inuman.audioDebug';
let debug = false;
function initDebug(): void {
  try {
    if (typeof window === 'undefined') return;
    const q = new URLSearchParams(window.location.search).get('audioDebug');
    if (q === '1') sessionStorage.setItem(DEBUG_KEY, '1');
    if (q === '0') sessionStorage.removeItem(DEBUG_KEY);
    debug = import.meta.env.DEV || sessionStorage.getItem(DEBUG_KEY) === '1';
    if (debug) (window as unknown as { __audioLog: string[] }).__audioLog ??= [];
  } catch {
    debug = import.meta.env.DEV;
  }
}

/** True with `?audioDebug=1` (kept for the tab) or in dev: the engine keeps window.__audioLog. */
export const audioDebug = (): boolean => debug;

/** Diagnostics for tests: context state and how many ids have decoded takes. */
export function engineState(): { context: string; ready: number } {
  return { context: ctx?.state ?? 'none', ready: idReady.size };
}

function logPlayed(id: string): void {
  if (!debug) return;
  const w = window as unknown as { __audioLog?: string[] };
  const log = (w.__audioLog ??= []);
  log.push(id);
  if (log.length > 600) log.splice(0, log.length - 600);
}

// ---------------------------------------------------------------- voices

class Voice implements SoundHandle {
  private src: AudioBufferSourceNode | null = null;
  private amp: GainNode | null = null;
  private base = 1;
  private level = 1;
  private cancelled = false;
  private done = false;

  readonly id: SoundId;
  private readonly bus: Bus;
  private readonly when: number;
  private rate: number;
  private readonly gain: number;
  private readonly pan: number;
  private readonly loop: boolean;
  /** Seconds after the start to stop at (loops held for a while). */
  hold: number | null = null;

  constructor(
    id: SoundId,
    bus: Bus,
    when: number,
    rate: number,
    gain: number,
    pan: number,
    loop: boolean,
  ) {
    this.id = id;
    this.bus = bus;
    this.when = when;
    this.rate = rate;
    this.gain = gain;
    this.pan = pan;
    this.loop = loop;
  }

  begin(c: AudioContext, g: Graph, clip: Clip): void {
    if (this.cancelled || this.done) return;
    const now = c.currentTime;
    let when = this.when;
    if (when < now) {
      if (!this.loop && now - when > LATE_OK) {
        this.done = true;
        return;
      }
      when = now;
    }
    const src = c.createBufferSource();
    src.buffer = clip.buffer;
    src.playbackRate.value = this.rate;
    const amp = c.createGain();
    this.base = this.gain * clip.gain;
    amp.gain.value = this.base * this.level;
    src.connect(amp);
    if (this.pan !== 0 && typeof c.createStereoPanner === 'function') {
      const p = c.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, this.pan));
      amp.connect(p).connect(g.buses[this.bus]);
    } else {
      amp.connect(g.buses[this.bus]);
    }
    const length = Math.max(0.01, clip.buffer.duration - clip.offset);
    if (this.loop) {
      src.loop = true;
      src.loopStart = clip.loopStart;
      src.loopEnd = clip.loopEnd;
    }
    src.onended = () => this.cleanup();
    src.start(when, this.loop ? clip.loopStart : clip.offset);
    this.src = src;
    this.amp = amp;
    if (this.hold !== null) this.stopAt(when + this.hold, 0.08);
    const natural = this.loop ? Infinity : when + length / Math.max(this.rate, 0.05);
    const end = this.hold !== null ? Math.min(natural, when + this.hold + 0.16) : natural;
    const cap = POLYPHONY[this.id] ?? (this.loop ? 1 : DEFAULT_POLYPHONY);
    for (const v of pool.add(this.id, this, when, end, cap, now)) v.stopAt(when, 0.015);
  }

  cancel(): void {
    this.cancelled = true;
  }

  /** Stops at audio time `t` with a short fade (voice stealing). */
  stopAt(t: number, fade: number): void {
    if (!this.src || !this.amp) {
      this.cancelled = true;
      return;
    }
    try {
      this.amp.gain.setTargetAtTime(0, t, Math.max(0.001, fade / 3));
      this.src.stop(t + fade * 2);
    } catch {
      // Already stopped.
    }
  }

  stop(fadeMs = 60): void {
    this.cancelled = true;
    // Never sounded: give its start back (React StrictMode re-runs effects that schedule sounds).
    if (!ctx || this.when >= ctx.currentTime) gate.forget(this.id, this.when);
    if (!ctx || !this.src) return;
    this.stopAt(ctx.currentTime, Math.max(0.005, fadeMs / 1000));
  }

  setRate(rate: number, rampMs = 60): void {
    if (!Number.isFinite(rate) || rate <= 0) return;
    this.rate = rate;
    if (!ctx || !this.src) return;
    const p = this.src.playbackRate;
    p.cancelScheduledValues(ctx.currentTime);
    p.setTargetAtTime(rate, ctx.currentTime, Math.max(0.001, rampMs / 3000));
  }

  setGain(gain: number, rampMs = 60): void {
    if (!Number.isFinite(gain)) return;
    this.level = Math.max(0, gain);
    if (!ctx || !this.amp) return;
    const p = this.amp.gain;
    p.cancelScheduledValues(ctx.currentTime);
    p.setTargetAtTime(this.base * this.level, ctx.currentTime, Math.max(0.001, rampMs / 3000));
  }

  private cleanup(): void {
    this.done = true;
    pool.remove(this.id, this);
    try {
      this.src?.disconnect();
      this.amp?.disconnect();
    } catch {
      // Fine.
    }
    this.src = null;
    this.amp = null;
  }
}

// ---------------------------------------------------------------- loading

function fetchBytes(path: string): Promise<ArrayBuffer | null> {
  let p = fileBytes.get(path);
  if (!p) {
    p = fetch(audioUrl(path))
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .catch(() => null);
    fileBytes.set(path, p);
  }
  return p;
}

function decodeFile(
  c: AudioContext,
  path: string,
  gainDb: number,
  exact: number | null,
): Promise<Clip | null> {
  let p = fileClips.get(path);
  if (!p) {
    p = fetchBytes(path)
      .then(async (bytes) => {
        if (!bytes) return null;
        // decodeAudioData detaches its input; keep the cached bytes intact.
        const buffer = await c.decodeAudioData(bytes.slice(0));
        const channels: Float32Array[] = [];
        for (let i = 0; i < buffer.numberOfChannels; i++) channels.push(buffer.getChannelData(i));
        const leading = leadingSilence(channels, buffer.sampleRate);
        const offset = Math.min(leading, buffer.duration * 0.5);
        const loop = loopRegion(buffer.duration, leading, exact);
        fileBytes.delete(path);
        return {
          buffer,
          offset,
          loopStart: loop.start,
          loopEnd: loop.end,
          gain: dbToGain(gainDb),
        };
      })
      .catch(() => null);
    fileClips.set(path, p);
  }
  return p;
}

function synthClips(c: AudioContext, id: SoundId): Clip[] {
  const takes = renderSynth(id, c.sampleRate);
  if (!takes) return [];
  return takes.map((samples) => {
    const buffer = c.createBuffer(1, samples.length, c.sampleRate);
    buffer.getChannelData(0).set(samples);
    return { buffer, offset: 0, loopStart: 0, loopEnd: buffer.duration, gain: 1 };
  });
}

/** Every playable take of `id` (decoded files, else the synth fallback, else none). */
function clipsFor(c: AudioContext, id: SoundId): Promise<Clip[]> {
  let p = idClips.get(id);
  if (!p) {
    p = loadManifest()
      .then(async (m) => {
        const entry = m?.sfx[id];
        const files = entry
          ? (
              await Promise.all(
                entry.files.map((f, i) =>
                  decodeFile(c, f, entry.gainDb, entry.durationsSec[i] ?? null),
                ),
              )
            ).filter((x): x is Clip => x !== null)
          : [];
        return files.length ? files : synthClips(c, id);
      })
      .catch(() => synthClips(c, id))
      .then((clips) => {
        idReady.set(id, clips);
        return clips;
      });
    idClips.set(id, p);
  }
  return p;
}

/**
 * Warms the cache for these ids: fetches their files now (cheap, cacheable) and decodes them as
 * soon as there is an AudioContext. Call when a game's lobby opens.
 */
export function preload(ids: readonly SoundId[]): void {
  try {
    const c = ctx;
    if (c) {
      for (const id of ids) void clipsFor(c, id);
      return;
    }
    for (const id of ids) warmLater.add(id);
    void loadManifest().then((m) => {
      for (const id of ids) for (const f of m?.sfx[id]?.files ?? []) void fetchBytes(f);
    });
  } catch {
    // Preloading is best effort.
  }
}

// ---------------------------------------------------------------- context & graph

function applyMix(): void {
  if (!ctx || !graph) return;
  const s = settings;
  const t = ctx.currentTime;
  const set = (node: GainNode, v: number) => node.gain.setTargetAtTime(v, t, 0.05);
  set(graph.master, s.sound ? volumeToGain(s.masterVolume) : 0);
  set(graph.buses.ui, volumeToGain(s.sfxVolume) * BUS_TRIM.ui);
  set(graph.buses.sfx, volumeToGain(s.sfxVolume) * BUS_TRIM.sfx);
  set(graph.buses.music, s.music ? volumeToGain(s.musicVolume) * BUS_TRIM.music : 0);
  set(graph.buses.ambience, volumeToGain(s.ambienceVolume) * BUS_TRIM.ambience);
}

function applyAudioSession(): void {
  try {
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    if (session) session.type = settings.mixWithOthers ? 'ambient' : 'playback';
  } catch {
    // Not supported.
  }
}

function createContext(): AudioContext | null {
  if (ctx) return ctx;
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    applyAudioSession();
    const c = new Ctor({ latencyHint: 'interactive' });
    const master = c.createGain();
    const limiter = c.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    master.connect(limiter).connect(c.destination);
    const bus = () => {
      const g = c.createGain();
      g.connect(master);
      return g;
    };
    graph = { master, limiter, buses: { ui: bus(), sfx: bus(), music: bus(), ambience: bus() } };
    ctx = c;
    applyMix();
    // iOS: a context interrupted by a call or Siri comes back on the next tap or when visible.
    c.onstatechange = () => {
      if (c.state === 'running') syncAmbience();
    };
    // Unlock iOS output with a one-sample silent buffer inside the gesture.
    const silent = c.createBufferSource();
    silent.buffer = c.createBuffer(1, 1, c.sampleRate);
    silent.connect(c.destination);
    silent.start();
    for (const id of warmLater) void clipsFor(c, id);
    warmLater.clear();
    for (const hook of contextHooks) hook(c, graph);
    return c;
  } catch {
    return null;
  }
}

function resume(): void {
  const c = ctx;
  if (!c || hidden) return;
  if (c.state !== 'running') c.resume().catch(() => {});
}

function onGesture(): void {
  try {
    createContext();
    resume();
    for (const hook of gestureHooks) hook();
  } catch {
    // Never break a tap.
  }
}

// ---------------------------------------------------------------- ambience

let ambienceVoice: SoundHandle | null = null;

function syncAmbience(): void {
  const want =
    !!ctx && !hidden && settings.sound && settings.ambience && settings.ambienceVolume > 0;
  if (want && !ambienceVoice) {
    const v = play('ambience.bar', { exact: true });
    if (v !== SILENT) {
      v.setGain(0, 0);
      v.setGain(1, 1500);
      ambienceVoice = v;
    }
  } else if (!want && ambienceVoice) {
    ambienceVoice.stop(800);
    ambienceVoice = null;
  }
}

// ---------------------------------------------------------------- public API

/** The performance bench replays real game scenes: keep their sound effects out of it. */
const onBench = (): boolean =>
  typeof location !== 'undefined' && location.pathname.replace(/\/+$/, '').endsWith('/bench');

/**
 * Plays a catalog sound: a random take (never the same twice in a row), humanised a little,
 * through its bus. Returns a handle (loops: setRate / setGain / stop). Never throws; returns a
 * silent handle when sound is off, before the first tap, or when retriggered too fast.
 */
export function play(id: SoundId, opts: PlayOpts = {}): SoundHandle {
  try {
    const spec = SOUNDS[id];
    if (!spec || !settings.sound || onBench()) return SILENT;
    const c = ctx;
    const g = graph;
    if (!c || !g || hidden) {
      // Before the first tap there is no context yet; the intent still shows in the debug log.
      if (!c) logPlayed(id);
      return SILENT;
    }
    const when = c.currentTime + Math.max(0, opts.delay ?? 0);
    if (!gate.allow(id, when, RETRIGGER[id] ?? DEFAULT_RETRIGGER)) return SILENT;
    logPlayed(id);
    const loop = opts.loop ?? ('loop' in spec && spec.loop === true);
    const h = opts.exact ? { rate: 1, gainDb: 0 } : humanize(Math.random);
    // A fitted take's rate is its timing: only its level is humanised.
    if (opts.fit !== undefined) h.rate = 1;
    const voice = new Voice(
      id,
      spec.bus,
      when,
      (opts.rate ?? 1) * h.rate,
      (opts.gain ?? 1) * dbToGain(h.gainDb),
      opts.pan ?? 0,
      loop,
    );
    if (opts.duration !== undefined) voice.hold = Math.max(0.02, opts.duration);
    const start = (clips: Clip[]) => {
      if (!clips.length) return voice.cancel();
      let k: number;
      if (opts.fit !== undefined) {
        const lengths = clips.map((cl) => cl.buffer.duration - cl.offset);
        const fit = fitTake(lengths, opts.fit, lastVariant.get(id), Math.random);
        k = fit.index;
        voice.setRate(fit.rate * (opts.rate ?? 1));
      } else k = pickVariant(clips.length, lastVariant.get(id), Math.random);
      lastVariant.set(id, k);
      voice.begin(c, g, clips[k] as Clip);
    };
    const ready = idReady.get(id);
    if (ready) start(ready);
    else clipsFor(c, id).then(start, () => voice.cancel());
    return voice;
  } catch {
    return SILENT;
  }
}

/** Plays a few sounds in sequence: [id, delaySeconds, opts?][]. */
export function playSequence(
  steps: readonly (readonly [SoundId, number, PlayOpts?])[],
): SoundHandle {
  const handles = steps.map(([id, delay, o]) => play(id, { ...o, delay: (o?.delay ?? 0) + delay }));
  return {
    id: steps[0]?.[0] ?? null,
    stop: (ms) => handles.forEach((h) => h.stop(ms)),
    setRate: (r, ms) => handles.forEach((h) => h.setRate(r, ms)),
    setGain: (v, ms) => handles.forEach((h) => h.setGain(v, ms)),
  };
}

/** The live context and mix graph (null before the first tap). For the music player. */
export function audioGraph(): { ctx: AudioContext; buses: Record<Bus, GainNode> } | null {
  return ctx && graph ? { ctx, buses: graph.buses } : null;
}

/** Runs `hook` once the context exists (now, if it already does). */
export function onAudioContext(
  hook: (c: AudioContext, buses: Record<Bus, GainNode>) => void,
): void {
  const wrapped = (c: AudioContext, g: Graph) => hook(c, g.buses);
  contextHooks.add(wrapped);
  if (ctx && graph) wrapped(ctx, graph);
}

/** Runs on every user gesture (after the context has been unlocked). */
export function onGestureHook(hook: () => void): void {
  gestureHooks.add(hook);
}

/** True while the page is hidden (sounds are dropped, the context is suspended). */
export const isHidden = (): boolean => hidden;

let installed = false;
const visibilityHooks = new Set<(hidden: boolean) => void>();

/** Runs when the page is hidden / shown again. */
export function onVisibility(hook: (hidden: boolean) => void): void {
  visibilityHooks.add(hook);
}

/** Wires the unlock gestures, visibility handling and settings. Idempotent. */
export function installEngine(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  initDebug();
  void loadManifest();
  const opts = { capture: true, passive: true } as const;
  window.addEventListener('pointerdown', onGesture, opts);
  window.addEventListener('touchend', onGesture, opts);
  window.addEventListener('keydown', onGesture, { capture: true });
  document.addEventListener('visibilitychange', () => {
    hidden = document.hidden;
    try {
      if (hidden) {
        ctx?.suspend().catch(() => {});
      } else resume();
      for (const hook of visibilityHooks) hook(hidden);
      syncAmbience();
    } catch {
      // Ignore.
    }
  });
  useSettings.subscribe((s) => {
    const prev = settings;
    settings = s;
    if (
      prev.sound === s.sound &&
      prev.masterVolume === s.masterVolume &&
      prev.sfxVolume === s.sfxVolume &&
      prev.music === s.music &&
      prev.musicVolume === s.musicVolume &&
      prev.ambience === s.ambience &&
      prev.ambienceVolume === s.ambienceVolume &&
      prev.mixWithOthers === s.mixWithOthers
    )
      return;
    applyMix();
    if (prev.mixWithOthers !== s.mixWithOthers) applyAudioSession();
    syncAmbience();
  });
  onGestureHook(syncAmbience);
}
