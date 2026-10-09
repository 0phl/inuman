// The audio manifest written by the asset pipeline (public/assets/audio/manifest.json): which file(s)
// play for each sound id, the music tracks with their credits, and attribution for everything.
// Loaded once, lazily; a missing or malformed manifest is simply "no files" (the engine falls back
// to synthesized UI sounds and stays silent otherwise).

export interface SfxEntry {
  /** Paths relative to assets/audio/ (one per variant). */
  files: string[];
  /** Level trim applied on top of the catalog's bus. */
  gainDb: number;
  loop: boolean;
  /** Exact length of each file (aligned with `files`), when the pipeline recorded it. */
  durationsSec: (number | null)[];
}

export interface MusicEntry {
  file: string;
  title: string;
  artist: string;
  license: string;
  url: string;
  /** Seamless loop points (seconds), when the track has them. */
  loopStart: number | null;
  loopEnd: number | null;
  durationSec: number;
}

export interface Credit {
  what: string;
  author: string;
  license: string;
  url: string;
}

export interface AudioManifest {
  version: 1;
  sfx: Record<string, SfxEntry>;
  music: Record<string, MusicEntry>;
  credits: Credit[];
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
/** Relative, no scheme, no parent hops: a file the manifest may point at. */
const safePath = (p: string): boolean =>
  p.length > 0 && !p.startsWith('/') && !p.includes('..') && !/^[a-z]+:/i.test(p);

/** Accepts anything (parsed JSON) and returns a clean manifest, or null when it isn't one. */
export function parseManifest(raw: unknown): AudioManifest | null {
  const r = obj(raw);
  if (r.version !== 1) return null;
  const sfx: Record<string, SfxEntry> = {};
  for (const [id, v] of Object.entries(obj(r.sfx))) {
    const e = obj(v);
    const durations = Array.isArray(e.durationsSec) ? e.durationsSec : [];
    const takes = (Array.isArray(e.files) ? e.files : []).flatMap((f, i) =>
      typeof f === 'string' && safePath(f) ? [{ f, d: num(durations[i]) }] : [],
    );
    if (!takes.length) continue;
    sfx[id] = {
      files: takes.map((x) => x.f),
      gainDb: Math.max(-40, Math.min(12, num(e.gainDb) ?? 0)),
      loop: e.loop === true,
      durationsSec: takes.map((x) => (x.d !== null && x.d > 0 ? x.d : null)),
    };
  }
  const music: Record<string, MusicEntry> = {};
  for (const [id, v] of Object.entries(obj(r.music))) {
    const e = obj(v);
    const file = str(e.file);
    if (!safePath(file)) continue;
    const loopStart = num(e.loopStart);
    const loopEnd = num(e.loopEnd);
    const loops = loopStart !== null && loopEnd !== null && loopEnd > loopStart + 1;
    music[id] = {
      file,
      title: str(e.title) || id,
      artist: str(e.artist),
      license: str(e.license),
      url: str(e.url),
      loopStart: loops ? loopStart : null,
      loopEnd: loops ? loopEnd : null,
      durationSec: Math.max(0, num(e.durationSec) ?? 0),
    };
  }
  const credits = (Array.isArray(r.credits) ? r.credits : [])
    .map((c) => {
      const e = obj(c);
      return { what: str(e.what), author: str(e.author), license: str(e.license), url: str(e.url) };
    })
    .filter((c) => c.what || c.author);
  return { version: 1, sfx, music, credits };
}

/** Base URL of the audio assets (respects Vite's base). */
export const AUDIO_BASE = `${import.meta.env.BASE_URL}assets/audio/`;

export const audioUrl = (path: string): string => AUDIO_BASE + path;

let pending: Promise<AudioManifest | null> | null = null;
let loaded: AudioManifest | null | undefined;
const listeners = new Set<() => void>();

/** Fetches the manifest once. Resolves null (never rejects) when it's missing or invalid. */
export function loadManifest(): Promise<AudioManifest | null> {
  pending ??= (async () => {
    try {
      if (typeof fetch !== 'function') return null;
      const res = await fetch(audioUrl('manifest.json'), { cache: 'no-cache' });
      if (!res.ok) return null;
      return parseManifest(await res.json());
    } catch {
      return null;
    }
  })().then((m) => {
    loaded = m;
    listeners.forEach((l) => l());
    return m;
  });
  return pending;
}

/** The manifest if it has loaded (null = missing), undefined while still loading. */
export const manifestNow = (): AudioManifest | null | undefined => loaded;

/** For useSyncExternalStore: notified once the manifest has loaded. */
export function subscribeManifest(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
