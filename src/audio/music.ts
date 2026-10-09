// Background music: two <audio> decks streamed through MediaElementAudioSourceNodes into the music
// bus, so tracks crossfade (≈2 s) when the choice changes or one track runs into the next in
// shuffle ("Halo-halo"), and a single track repeats seamlessly (its loop points when it has them,
// else a crossfade near the end). Starts only after the first tap, keeps playing across routes,
// ducks under reveals and big stings, and pauses while the page is hidden.
// Files are runtime-cached by the service worker on first play (see vite.config.ts).
import { MUSIC } from './catalog';
import { audioGraph, onAudioContext, onGestureHook, onVisibility } from './engine';
import { audioUrl, loadManifest, manifestNow, type MusicEntry } from './manifest';
import { dbToGain } from './mix';
import { SHUFFLE, useSettings } from '@/store/settings';

const XFADE_S = 2;
/** With loop points, the jump back is nearly a cut. */
const LOOP_XFADE_S = 0.08;
const WATCH_MS = 200;

interface Deck {
  el: HTMLAudioElement;
  fader: GainNode;
  track: string | null;
  /** Playback was requested and not paused by us. */
  live: boolean;
}

let decks: [Deck, Deck] | null = null;
let duckNode: GainNode | null = null;
let active: 0 | 1 = 0;
const flip = (i: 0 | 1): 0 | 1 => (i === 0 ? 1 : 0);
/** Track ids whose file failed to load (skipped in shuffle, silent otherwise). */
const failed = new Set<string>();
let watcher: number | null = null;
/** The scheduled hand-over to the next deck (timer id). */
let handover: number | null = null;
let blessed = false;
let lastShuffle: string | null = null;

const entryOf = (id: string): MusicEntry | null => manifestNow()?.music[id] ?? null;

function wanted(): string | null {
  const s = useSettings.getState();
  if (!s.sound || !s.music || s.musicVolume <= 0 || document.hidden) return null;
  return s.musicTrack;
}

/** Track ids that can play (in the manifest, not failed). */
function playable(): string[] {
  return MUSIC.map((m) => m.id).filter((id) => entryOf(id) && !failed.has(id));
}

function pickShuffle(not: string | null): string | null {
  const list = playable();
  if (!list.length) return null;
  const pool = list.length > 1 ? list.filter((id) => id !== not) : list;
  return pool[Math.floor(Math.random() * pool.length)] ?? null;
}

function makeDecks(c: AudioContext, musicBus: GainNode): void {
  if (decks) return;
  duckNode = c.createGain();
  duckNode.connect(musicBus);
  const make = (): Deck => {
    const el = new Audio();
    el.preload = 'auto';
    el.crossOrigin = 'anonymous';
    // Keeps iOS from showing the track in the lock screen as "the" media session.
    el.setAttribute('playsinline', '');
    const fader = c.createGain();
    fader.gain.value = 0;
    try {
      c.createMediaElementSource(el).connect(fader);
    } catch {
      // Already connected (hot reload).
    }
    fader.connect(duckNode as GainNode);
    const deck: Deck = { el, fader, track: null, live: false };
    el.addEventListener('error', () => {
      if (deck.track) failed.add(deck.track);
      deck.live = false;
      // Shuffle moves on; a single broken track just stays silent.
      if (useSettings.getState().musicTrack === SHUFFLE) window.setTimeout(sync, 0);
    });
    el.addEventListener('ended', () => {
      deck.live = false;
      if (deck === decks?.[active]) window.setTimeout(() => advance(true), 0);
    });
    return deck;
  };
  decks = [make(), make()];
}

function fade(deck: Deck, to: number, seconds: number): void {
  const g = audioGraph();
  if (!g) return;
  const p = deck.fader.gain;
  const t = g.ctx.currentTime;
  p.cancelScheduledValues(t);
  p.setValueAtTime(p.value, t);
  p.linearRampToValueAtTime(to, t + Math.max(0.01, seconds));
}

/** Tracks already fetched whole for the service worker's music cache this session. */
const warmed = new Set<string>();

/**
 * The player streams with range requests (206s), which the service worker can't store. Once a
 * track has been playing a while, one plain GET (often served from the HTTP cache) lets the music
 * cache keep it for offline nights.
 */
function warmCache(url: string): void {
  if (warmed.has(url) || !navigator.serviceWorker?.controller) return;
  warmed.add(url);
  window.setTimeout(() => {
    fetch(url)
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .catch(() => null);
  }, 15_000);
}

function startDeck(deck: Deck, track: string, at: number, fadeIn: number): void {
  const e = entryOf(track);
  if (!e) return;
  const url = audioUrl(e.file);
  if (deck.track !== track || !deck.el.src.endsWith(url)) {
    deck.el.src = url;
    deck.track = track;
  }
  try {
    // An armed deck is already parked there (and buffered): don't seek again.
    if (Math.abs(deck.el.currentTime - at) > 0.05) deck.el.currentTime = at;
  } catch {
    // Not seekable yet: starts from the top.
  }
  deck.live = true;
  fade(deck, 0, 0);
  const p = deck.el.play();
  p?.then(
    () => {
      fade(deck, 1, fadeIn);
      warmCache(url);
    },
    () => {
      // Autoplay refused (iOS, no gesture on this element yet): retried on the next tap.
      deck.live = false;
    },
  );
}

function stopDeck(deck: Deck, fadeOut: number): void {
  fade(deck, 0, fadeOut);
  deck.live = false;
  const el = deck.el;
  window.setTimeout(
    () => {
      if (!deck.live) el.pause();
    },
    fadeOut * 1000 + 60,
  );
}

/** The loop's end and where the repeat picks up, for a track. */
function loopPoints(
  track: string,
  el: HTMLAudioElement,
): { end: number; start: number; xfade: number } {
  const e = entryOf(track);
  const dur = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : (e?.durationSec ?? 0);
  if (e?.loopStart != null && e.loopEnd != null && e.loopEnd <= dur + 0.05)
    return { end: e.loopEnd, start: e.loopStart, xfade: LOOP_XFADE_S };
  return { end: dur, start: 0, xfade: XFADE_S };
}

/** What plays after the current take, decided (and the other deck parked on it) ahead of time. */
let queued: { track: string; start: number } | null = null;

/** The next take: the same track again from its loop start (repeat), or another one (shuffle). */
function nextTake(): { track: string; start: number } | null {
  const cur = decks?.[active];
  const choice = wanted();
  if (!cur || !choice || !cur.track) return null;
  if (choice !== SHUFFLE) return { track: choice, start: loopPoints(cur.track, cur.el).start };
  const track = pickShuffle(cur.track);
  return track ? { track, start: 0 } : null;
}

/** A few seconds before the hand-over: load and seek the idle deck so the switch is instant. */
function arm(): void {
  if (!decks || queued) return;
  queued = nextTake();
  const other = decks[flip(active)];
  const e = queued ? entryOf(queued.track) : null;
  if (!queued || !e || other.live) return;
  const url = audioUrl(e.file);
  if (other.track !== queued.track || !other.el.src.endsWith(url)) {
    other.el.src = url;
    other.track = queued.track;
  }
  try {
    other.el.currentTime = queued.start;
  } catch {
    // Seeks once it can.
  }
}

/** Crossfades into the next take (the same track again, or the next one in shuffle). */
function advance(ended = false): void {
  if (!decks) return;
  handover = null;
  const cur = decks[active];
  const take = queued ?? nextTake();
  queued = null;
  if (!take || !cur.track) return;
  const shuffle = wanted() === SHUFFLE;
  const xfade = shuffle ? XFADE_S : loopPoints(cur.track, cur.el).xfade;
  if (shuffle) lastShuffle = take.track;
  startDeck(decks[flip(active)], take.track, take.start, ended ? 0.3 : xfade);
  stopDeck(cur, ended ? 0.05 : xfade);
  active = flip(active);
}

function watch(): void {
  if (!decks || handover !== null) return;
  const deck = decks[active];
  if (!deck.live || !deck.track || deck.el.paused) return;
  const { end, xfade } = loopPoints(deck.track, deck.el);
  if (!(end > 0)) return;
  const left = end - deck.el.currentTime;
  if (left <= xfade + 3) arm();
  // Close to the hand-over: schedule it precisely.
  if (left <= xfade + 0.6) {
    handover = window.setTimeout(() => advance(), Math.max(0, (left - xfade) * 1000));
  }
}

/** Brings the decks in line with the settings: start, switch track, or fade out. */
export function sync(): void {
  try {
    if (!decks) return;
    const choice = wanted();
    const cur = decks[active];
    // Whatever was lined up next may no longer be what's wanted.
    queued = null;
    if (!choice) {
      if (handover !== null) window.clearTimeout(handover);
      handover = null;
      for (const d of decks) if (d.live) stopDeck(d, 1);
      return;
    }
    const target =
      choice === SHUFFLE
        ? cur.live && cur.track && !failed.has(cur.track)
          ? cur.track
          : lastShuffle && !failed.has(lastShuffle)
            ? lastShuffle
            : pickShuffle(null)
        : choice;
    if (!target || !entryOf(target) || failed.has(target)) {
      for (const d of decks) if (d.live) stopDeck(d, 1);
      return;
    }
    if (choice === SHUFFLE) lastShuffle = target;
    if (cur.live && cur.track === target && !cur.el.paused) return;
    if (cur.track === target && cur.el.paused && cur.el.currentTime > 0 && !cur.el.ended) {
      // Paused by us (hidden page): pick up where it was.
      cur.live = true;
      const p = cur.el.play();
      p?.then(
        () => fade(cur, 1, 0.6),
        () => {
          cur.live = false;
        },
      );
      return;
    }
    if (handover !== null) window.clearTimeout(handover);
    handover = null;
    const fresh = !cur.live;
    const other = decks[flip(active)];
    if (cur.live) stopDeck(cur, XFADE_S);
    startDeck(other, target, 0, fresh ? 1.2 : XFADE_S);
    active = flip(active);
  } catch {
    // Music is never worth an exception.
  }
}

/**
 * iOS lets an <audio> element start later only if it was played once inside a tap: on the first
 * gesture with music wanted, both decks get a muted play/pause.
 */
function bless(): void {
  if (blessed || !decks || !wanted()) return;
  const first = playable()[0];
  const e = first ? entryOf(first) : null;
  if (!e) return;
  blessed = true;
  for (const d of decks) {
    if (d.live) continue;
    d.el.src = audioUrl(e.file);
    d.track = first ?? null;
    d.el.muted = true;
    const p = d.el.play();
    p?.then(
      () => {
        d.el.muted = false;
        // sync() may have started this deck for real in the meantime.
        if (!d.live) {
          d.el.pause();
          d.el.currentTime = 0;
        }
      },
      () => {
        d.el.muted = false;
      },
    );
  }
}

/** Dips the music by `db` for `ms` (reveals, big stings), then brings it back. */
export function duck(db = -6, ms = 1500): void {
  const g = audioGraph();
  if (!g || !duckNode) return;
  const p = duckNode.gain;
  const t = g.ctx.currentTime;
  p.cancelScheduledValues(t);
  p.setTargetAtTime(dbToGain(db), t, 0.06);
  p.setTargetAtTime(1, t + ms / 1000, 0.35);
}

let installed = false;

/** Hooks the player up to the engine and the settings. Idempotent. */
export function installMusic(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  onAudioContext((c, buses) => {
    makeDecks(c, buses.music);
    const go = () => {
      bless();
      sync();
    };
    // Inside the unlocking tap when we can (iOS wants play() in the gesture's call stack).
    if (manifestNow() !== undefined) go();
    else void loadManifest().then(go);
  });
  // Every tap: start what an earlier refusal left waiting.
  onGestureHook(() => {
    if (!decks) return;
    bless();
    const d = decks[active];
    if (wanted() && (!d.live || d.el.paused)) sync();
  });
  onVisibility((hidden) => {
    if (!decks) return;
    if (hidden) {
      if (handover !== null) window.clearTimeout(handover);
      handover = null;
      for (const d of decks) if (!d.el.paused) d.el.pause();
    } else sync();
  });
  useSettings.subscribe((s, prev) => {
    if (
      s.sound !== prev.sound ||
      s.music !== prev.music ||
      s.musicTrack !== prev.musicTrack ||
      s.musicVolume > 0 !== prev.musicVolume > 0
    )
      sync();
  });
  watcher ??= window.setInterval(watch, WATCH_MS);
}

/** The track playing now (for the picker's "now playing" mark), or null. */
export function nowPlaying(): string | null {
  const d = decks?.[active];
  return d && d.live && d.track ? d.track : null;
}

/** Diagnostics for tests: what the decks are doing. */
export function musicState(): { music: string | null; musicTime: number; musicPaused: boolean } {
  const d = decks?.[active];
  return {
    music: nowPlaying(),
    musicTime: d ? d.el.currentTime : 0,
    musicPaused: d ? d.el.paused : true,
  };
}
