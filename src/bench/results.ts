import type { Tier } from '@/store/settings';

// Bench results: per-scene numbers, the pass/warn/fail grading, and the compact JSON the user
// copies back to us. Pure apart from the localStorage helpers at the bottom.

export const BENCH_VERSION = 1;

export interface DeviceInfo {
  ua: string;
  /** Unmasked GPU renderer (WEBGL_debug_renderer_info), or the masked one, or null. */
  gpu: string | null;
  /** detect-gpu: its 0–3 tier, result type and matched GPU. */
  detect: { tier: number | null; type: string; gpu: string | null; fps: number | null } | null;
  dpr: number;
  /** CSS px. */
  viewport: [number, number];
  /** Drawing-buffer px of the stage canvas. */
  canvas: [number, number] | null;
  cores: number | null;
  /** GB (navigator.deviceMemory, Chrome only, capped at 8). */
  memory: number | null;
  /** The tier the app would pick here (quality setting / detected). */
  appTier: Tier | null;
  quality: string;
  maxTextureSize: number | null;
}

export interface SceneResult {
  id: string;
  tier: Tier;
  /** Ran into an error (the rest of the numbers may be partial). */
  error?: string;
  /** Rapier loaded/warmed before the window (ms), or null when the game has no physics. */
  prepMs: number | null;
  /** From mounting the scene to the end of its first rendered frame (lazy chunk, textures, shaders). */
  firstRenderMs: number | null;
  /** Main-thread ms of that first frame alone (texture uploads + shader compiles land here). */
  firstFrameMs: number | null;
  /** Frame intervals during the window. */
  frames: number;
  fps: number | null;
  p50: number | null;
  p95: number | null;
  max: number | null;
  /** Frames over 50 ms. */
  long: number;
  /** Main-thread ms per frame (useFrame work + render submission). */
  cpuP50: number | null;
  cpuP95: number | null;
  /** Main-pass draw calls and triangles (max seen during the window). */
  calls: number;
  tris: number;
  textures: number;
  geometries: number;
  programs: number;
  /** usedJSHeapSize in MB after the window (Chrome only). */
  heapMB: number | null;
  /** Long tasks (PerformanceObserver, Chrome only) during mount and window: count / max ms. */
  longTasks: number | null;
  longTaskMaxMs: number | null;
  /** Frames rendered in the idle check after the window (should be 0). */
  idleFrames: number;
  /** Actions the script got accepted (sanity check that it really played). */
  actions: number;
}

export interface BenchRun {
  v: number;
  at: string;
  build: string;
  device: DeviceInfo;
  /** 'current' = the app's tier only; 'all' = low, mid and high. */
  mode: 'current' | 'all';
  scenes: SceneResult[];
  /** Total wall time (s). */
  seconds: number;
  /** Heap (MB) and GPU resources at the end vs. the start. */
  leak: {
    heapStartMB: number | null;
    heapEndMB: number | null;
    texturesStart: number;
    texturesEnd: number;
    geometriesStart: number;
    geometriesEnd: number;
  } | null;
  aborted?: boolean;
}

// ---------------------------------------------------------------- grading

export type Grade = 'good' | 'warn' | 'bad' | 'none';

/** p95 frame-time targets: 50 fps (20 ms) on mid/high, 30 fps (33 ms) on low. */
export const P95_TARGET: Readonly<Record<Tier, number>> = { low: 33.4, mid: 20, high: 20 };
/** Amber up to here; red beyond. */
export const P95_LIMIT: Readonly<Record<Tier, number>> = { low: 50, mid: 33.4, high: 33.4 };

export function gradeP95(p95: number | null, tier: Tier): Grade {
  if (p95 === null || !Number.isFinite(p95)) return 'none';
  if (p95 <= P95_TARGET[tier]) return 'good';
  if (p95 <= P95_LIMIT[tier]) return 'warn';
  return 'bad';
}

export function gradeFirstRender(ms: number | null): Grade {
  if (ms === null) return 'none';
  return ms <= 700 ? 'good' : ms <= 2000 ? 'warn' : 'bad';
}

export function gradeLong(long: number, frames: number): Grade {
  if (frames === 0) return 'none';
  return long === 0 ? 'good' : long <= 2 ? 'warn' : 'bad';
}

export function gradeScene(s: SceneResult): Grade {
  if (s.error) return 'bad';
  const g = [gradeP95(s.p95, s.tier), gradeLong(s.long, s.frames)];
  return g.includes('bad')
    ? 'bad'
    : g.includes('warn')
      ? 'warn'
      : g.includes('none')
        ? 'none'
        : 'good';
}

// ---------------------------------------------------------------- compact JSON

/** Column order of each scene row in the compact JSON. */
export const COMPACT_COLUMNS = [
  'game',
  'tier',
  'firstRenderMs',
  'firstFrameMs',
  'fps',
  'p50',
  'p95',
  'max',
  'long',
  'cpuP50',
  'cpuP95',
  'calls',
  'tris',
  'textures',
  'geometries',
  'programs',
  'heapMB',
  'longTasks',
  'longTaskMaxMs',
  'idleFrames',
  'prepMs',
  'actions',
] as const;

/** A short, paste-friendly JSON of a run: device info plus one array row per scene. */
export function compactJson(run: BenchRun): string {
  const rows = run.scenes.map((s) => [
    s.id,
    s.tier,
    s.firstRenderMs,
    s.firstFrameMs,
    s.fps,
    s.p50,
    s.p95,
    s.max,
    s.long,
    s.cpuP50,
    s.cpuP95,
    s.calls,
    s.tris,
    s.textures,
    s.geometries,
    s.programs,
    s.heapMB,
    s.longTasks,
    s.longTaskMaxMs,
    s.idleFrames,
    s.prepMs,
    s.actions,
    ...(s.error ? [s.error] : []),
  ]);
  return JSON.stringify({
    inumanBench: run.v,
    at: run.at,
    build: run.build,
    mode: run.mode,
    seconds: run.seconds,
    ...(run.aborted ? { aborted: true } : {}),
    device: run.device,
    leak: run.leak,
    cols: COMPACT_COLUMNS,
    scenes: rows,
  });
}

// ---------------------------------------------------------------- storage

const KEY = 'inuman.bench.last';

export function saveLastRun(run: BenchRun): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(run));
  } catch {
    // Storage full or blocked: the result is still on screen.
  }
}

export function loadLastRun(): BenchRun | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const run = JSON.parse(raw) as BenchRun;
    return run && run.v === BENCH_VERSION && Array.isArray(run.scenes) ? run : null;
  } catch {
    return null;
  }
}
