import type { Mesh, MeshBasicMaterial, Object3D } from 'three';
import type { GameId } from '@/core/engine/types';
import { detectGpu } from '@/stage/detectTier';
import { nextFrame, stageHandles, subscribeFrames, type FrameSample } from '@/stage/perf/probe';
import { round1, summarizeFrames } from '@/stage/perf/stats';
import { TIER_ORDER, TIER_SPEC, useStage } from '@/stage/stageStore';
import { warmGame } from '@/stage/warm/gameWarmup';
import { useSettings, type Tier } from '@/store/settings';
import { useTheme } from '@/store/theme';
import { collectDevice } from './device';
import { BENCH_VERSION, type BenchRun, type SceneResult } from './results';
import { SCENARIOS, type Scenario, type ScenarioCtx } from './scenarios';
import { createBenchHost, type BenchHost } from './session';

/** The measured window per scene. */
export const WINDOW_MS = 6000;
/** After the window: let the last animation land, then count frames that still render. */
const IDLE_GRACE_MS = 1000;
const IDLE_CHECK_MS = 1200;

export interface BenchProgress {
  index: number;
  total: number;
  game: GameId | null;
  tier: Tier;
  phase: 'loading' | 'mounting' | 'measuring' | 'idle-check' | 'done';
}

export interface RunnerIO {
  /** Mounts `host`'s scene (null unmounts it); resolves once it has committed inside the Canvas. */
  show(host: BenchHost | null): Promise<void>;
  progress(p: BenchProgress): void;
  signal: AbortSignal;
}

export interface RunOptions {
  mode: 'current' | 'all';
  /** Subset of games (default: all 13). */
  games?: readonly GameId[];
  /** Measured window per scene (default WINDOW_MS). */
  windowMs?: number;
}

const now = () => performance.now();

function sleep(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve(false);
    const t = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve(true);
    }, ms);
    const onAbort = () => {
      window.clearTimeout(t);
      resolve(false);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function heapMB(): number | null {
  const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  return mem ? round1(mem.usedJSHeapSize / 1048576) : null;
}

/** Long tasks (Chrome/Android only; null elsewhere). */
function recordLongTasks(): () => number[] | null {
  if (!PerformanceObserver.supportedEntryTypes?.includes('longtask')) return () => null;
  const tasks: number[] = [];
  const obs = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) tasks.push(e.duration);
  });
  obs.observe({ type: 'longtask' });
  return () => {
    for (const e of obs.takeRecords()) tasks.push(e.duration);
    obs.disconnect();
    return tasks;
  };
}

/** The tier the app would use on this device right now (without writing settings). */
export async function appTier(): Promise<Tier> {
  const s = useSettings.getState();
  if (s.quality !== 'auto') return s.quality;
  return s.detectedTier ?? (await detectGpu()).tier;
}

/** The object and all its ancestors are visible (the stage's warm gates hide things until compiled). */
function shown(o: Object3D | undefined): boolean {
  for (let p: Object3D | null = o ?? null; p; p = p.parent) if (!p.visible) return false;
  return !!o;
}

function hasBakedBar(scene: Object3D, tier: Tier): boolean {
  const bg = scene.getObjectByName('Background') as Mesh | undefined;
  if (!shown(bg)) return false;
  const map = (bg?.material as MeshBasicMaterial | undefined)?.map;
  const w = (map?.image as { width?: number } | undefined)?.width ?? 0;
  // dive-bar-low.glb carries a 1024² atlas, dive-bar.glb a 2048² one.
  return tier === 'low' ? w > 0 && w <= 1024 : w > 1024;
}

/**
 * Waits until the stage renders at `tier` with its final environment (the baked bar for that tier,
 * and the HDRI on high), so a download landing mid-window can't skew a scene's numbers.
 */
async function waitStageReady(tier: Tier, signal: AbortSignal): Promise<boolean> {
  const spec = TIER_SPEC[tier];
  const procedural = useTheme.getState().theme.environmentId === 'procedural-bar';
  const deadline = now() + 30_000;
  while (now() < deadline && !signal.aborted) {
    const h = stageHandles();
    if (h) {
      const msaa = h.gl.getContextAttributes()?.antialias ?? false;
      const dprOk =
        Math.abs(h.gl.getPixelRatio() - Math.min(Math.max(window.devicePixelRatio, 1), spec.dpr)) <
        0.01;
      const env = h.scene.environment as { isDataTexture?: boolean } | null;
      const envOk =
        tier === 'low' || procedural || (tier === 'high' ? !!env?.isDataTexture : !!env);
      if (msaa === spec.msaa && dprOk && envOk && (procedural || hasBakedBar(h.scene, tier))) {
        await nextFrame(1000);
        return sleep(400, signal);
      }
    }
    if (!(await sleep(100, signal))) return false;
  }
  return false;
}

function gpuCounts() {
  const gl = stageHandles()?.gl;
  return {
    textures: gl?.info.memory.textures ?? 0,
    geometries: gl?.info.memory.geometries ?? 0,
    programs: gl?.info.programs?.length ?? 0,
  };
}

function blank(id: GameId, tier: Tier): SceneResult {
  return {
    id,
    tier,
    prepMs: null,
    firstRenderMs: null,
    firstFrameMs: null,
    frames: 0,
    fps: null,
    p50: null,
    p95: null,
    max: null,
    long: 0,
    cpuP50: null,
    cpuP95: null,
    calls: 0,
    tris: 0,
    textures: 0,
    geometries: 0,
    programs: 0,
    heapMB: null,
    longTasks: null,
    longTaskMaxMs: null,
    idleFrames: 0,
    actions: 0,
  };
}

async function measureScene(
  sc: Scenario,
  tier: Tier,
  seed: number,
  windowMs: number,
  io: RunnerIO,
): Promise<SceneResult> {
  const res = blank(sc.id, tier);
  const { signal } = io;
  const setBench = useStage.getState().setBench;
  let stopLongTasks: (() => number[] | null) | null = null;
  try {
    // What the Lobby does before Start: the game's code, its physics, its shared props' shaders.
    const tPrep = now();
    await warmGame(sc.id);
    res.prepMs = round1(now() - tPrep);
    const host = createBenchHost({
      gameId: sc.id,
      seed,
      rules: sc.rules,
      content: sc.content?.(),
    });

    // First render: mount → the stage's scene gate has compiled and shown it → the end of the
    // first frame that draws it.
    stopLongTasks = recordLongTasks();
    const revealedBefore = useStage.getState().revealed;
    const t0 = now();
    const firstFrame = new Promise<FrameSample | null>((resolve) => {
      let committed = false;
      void io.show(host).then(() => {
        committed = true;
      });
      const off = subscribeFrames((s) => {
        if (!committed || useStage.getState().revealed === revealedBefore) return;
        off();
        resolve(s);
      });
      void sleep(20_000, signal).then(() => {
        off();
        resolve(null);
      });
    });
    const first = await firstFrame;
    if (first) {
      res.firstRenderMs = round1(first.end - t0);
      res.firstFrameMs = round1(first.cpu);
    }
    if (signal.aborted) return res;

    // The measured window: every frame rendered while the script plays the game.
    io.progress({ index: -1, total: 0, game: sc.id, tier, phase: 'measuring' });
    const samples: FrameSample[] = [];
    setBench({ tier, keepRendering: true });
    const off = subscribeFrames((s) => samples.push(s));
    const start = now();
    let ended = false;
    const ctx: ScenarioCtx = {
      host,
      view: <V>() => host.getView() as V,
      elapsed: () => now() - start,
      done: () => ended || signal.aborted,
      lastAction: Math.max(500, windowMs - 1700),
      sleep: async (ms) => {
        const left = windowMs - (now() - start);
        if (ended || left <= 0) return false;
        const ok = await sleep(Math.min(ms, left), signal);
        return ok && !ended && ms <= left;
      },
    };
    const script = sc.run(ctx).catch((err: unknown) => {
      res.error = err instanceof Error ? err.message : String(err);
    });
    await sleep(windowMs, signal);
    ended = true;
    off();
    setBench({ tier, keepRendering: false });
    const counts = gpuCounts();

    const sum = summarizeFrames(samples.map((s) => s.interval));
    const cpu = summarizeFrames(samples.map((s) => s.cpu));
    res.frames = sum.frames;
    res.fps = round1(sum.fps);
    res.p50 = round1(sum.p50);
    res.p95 = round1(sum.p95);
    res.max = round1(sum.max);
    res.long = sum.long;
    res.cpuP50 = round1(cpu.p50);
    res.cpuP95 = round1(cpu.p95);
    res.calls = samples.reduce((m, s) => Math.max(m, s.calls), 0);
    res.tris = samples.reduce((m, s) => Math.max(m, s.triangles), 0);
    res.textures = counts.textures;
    res.geometries = counts.geometries;
    res.programs = counts.programs;
    res.heapMB = heapMB();
    const tasks = stopLongTasks();
    stopLongTasks = null;
    res.longTasks = tasks ? tasks.length : null;
    res.longTaskMaxMs = tasks && tasks.length ? round1(Math.max(...tasks)) : tasks ? 0 : null;

    // Idle: once the last animation has landed nothing should render (frameloop="demand").
    io.progress({ index: -1, total: 0, game: sc.id, tier, phase: 'idle-check' });
    await Promise.race([script, sleep(IDLE_GRACE_MS, signal)]);
    await sleep(IDLE_GRACE_MS, signal);
    let idle = 0;
    const offIdle = subscribeFrames(() => idle++);
    await sleep(IDLE_CHECK_MS, signal);
    offIdle();
    res.idleFrames = idle;
    res.actions = host.stats.accepted;
  } catch (err) {
    res.error = err instanceof Error ? err.message : String(err);
  } finally {
    stopLongTasks?.();
    setBench({ tier, keepRendering: false });
    await io.show(null);
  }
  return res;
}

export async function runBench(opts: RunOptions, io: RunnerIO): Promise<BenchRun> {
  const t0 = now();
  const { signal } = io;
  const base = await appTier();
  const tiers: Tier[] = opts.mode === 'all' ? [...TIER_ORDER] : [base];
  const scenarios = SCENARIOS.filter((s) => !opts.games || opts.games.includes(s.id));
  const total = tiers.length * scenarios.length;
  const setBench = useStage.getState().setBench;

  setBench({ tier: tiers[0] as Tier, keepRendering: false });
  io.progress({ index: 0, total, game: null, tier: tiers[0] as Tier, phase: 'loading' });
  await waitStageReady(tiers[0] as Tier, signal);
  const device = await collectDevice();
  device.appTier = base;
  const heapStartMB = heapMB();
  const start = gpuCounts();

  const scenes: SceneResult[] = [];
  let index = 0;
  outer: for (const tier of tiers) {
    setBench({ tier, keepRendering: false });
    io.progress({ index, total, game: null, tier, phase: 'loading' });
    await waitStageReady(tier, signal);
    for (const [i, sc] of scenarios.entries()) {
      if (signal.aborted) break outer;
      io.progress({ index, total, game: sc.id, tier, phase: 'mounting' });
      scenes.push(await measureScene(sc, tier, 0x5eed + i, opts.windowMs ?? WINDOW_MS, io));
      index++;
    }
  }

  await io.show(null);
  setBench({ tier: base, keepRendering: false });
  await nextFrame(1000);
  const end = gpuCounts();
  io.progress({ index, total, game: null, tier: base, phase: 'done' });
  return {
    v: BENCH_VERSION,
    at: new Date().toISOString(),
    build: buildId(),
    device,
    mode: opts.mode,
    scenes,
    seconds: Math.round((now() - t0) / 100) / 10,
    leak: {
      heapStartMB,
      heapEndMB: heapMB(),
      texturesStart: start.textures,
      texturesEnd: end.textures,
      geometriesStart: start.geometries,
      geometriesEnd: end.geometries,
    },
    ...(signal.aborted ? { aborted: true } : {}),
  };
}

/** The hashed entry chunk identifies the deployed build ("dev" under the dev server). */
function buildId(): string {
  const src = document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.src ?? '';
  const m = /\/assets\/(index-[\w-]+)\.js/.exec(src);
  return m?.[1] ?? (import.meta.env.DEV ? 'dev' : 'unknown');
}
