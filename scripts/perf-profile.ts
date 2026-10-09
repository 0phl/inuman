// Emulated performance profile of the app (pnpm build && pnpm preview first, then
//   node scripts/perf-profile.ts --url http://localhost:4173 --out perf-out --label before
// ). Headless Chromium renders with SwiftShader, so GPU-bound numbers (fps, frame p95) don't
// transfer to phones; main-thread numbers (CPU per frame, long tasks, first-render cost, React
// commits) and resource counts do. Passes (--passes, comma separated; default all):
//   bench   /bench at Pixel 7 size: mid tier at 4× CPU throttle, low tier at 6×; adds CDP main-thread
//           busy time per scene window
//   commits React commits per second, per renderer (DOM vs R3F) and per component, during each
//           scene's animation (installs a stand-in React DevTools hook; use an unminified build
//           for readable component names)
//   leak    all 13 scenes twice in one page: JS heap after GC, DOM nodes, GPU textures/geometries
//   load    cold first-game load (Home → Lobby → Start) with 4× CPU and a 4G-ish network: time to
//           the first frame, to a smooth table, long tasks, and the GLB/HDR/Rapier/font downloads
//   idle    real /play: frames rendered while idle for 5 s after the scene settles
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, devices, type Browser, type CDPSession, type Page } from '@playwright/test';

type Tier = 'low' | 'mid' | 'high';

const argv = process.argv.slice(2);
const arg = (name: string, fallback: string): string => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? (argv[i + 1] as string) : fallback;
};
const BASE = arg('url', 'http://localhost:4173');
const OUT = arg('out', 'perf-out');
const LABEL = arg('label', 'run');
const PASSES = new Set(arg('passes', 'bench,commits,leak,load,idle').split(','));
const GAMES = arg('games', '');
/**
 * --gpu wsl: render on the host GPU through WSL's D3D12 Mesa driver (full Chromium, ANGLE on GL)
 * instead of SwiftShader. Frame times are then GPU-accelerated (a desktop GPU, so still not a
 * phone's), which makes CPU-side differences visible.
 */
const GPU = arg('gpu', '');
const WINDOW = arg('window', '');
mkdirSync(OUT, { recursive: true });

const PLAYERS = ['Migs', 'Bea', 'Jun', 'Kat'].map((name, i) => ({
  id: `p${i + 1}`,
  name,
  nonAlcoholic: false,
  sittingOut: false,
}));

/** localStorage for a fresh profile: 18+ confirmed, a fixed quality tier, four players. */
const seed = (tier: Tier, perf: boolean) => `
  try {
    localStorage.setItem('inuman.settings', JSON.stringify({ state: { ageConfirmed: true, quality: '${tier}', locale: 'en' }, version: 1 }));
    if (!localStorage.getItem('inuman.players')) localStorage.setItem('inuman.players', JSON.stringify({ state: { players: ${JSON.stringify(PLAYERS)} }, version: 1 }));
    ${perf ? "localStorage.setItem('inuman.perf', '1');" : ''}
  } catch (e) {}
`;

/** A stand-in React DevTools hook that counts commits per renderer and renders per component. */
const COMMIT_HOOK = `
(() => {
  const c = { on: false, byRenderer: {}, comps: {} };
  const seenProps = new WeakSet();
  const seenState = new WeakSet();
  const COMPONENT = new Set([0, 1, 11, 14, 15]);
  const nameOf = (f) => {
    const t = f.type;
    if (typeof t === 'function') return t.displayName || t.name || 'anonymous';
    if (t && typeof t === 'object') {
      const inner = t.render || t.type;
      const n = inner && (inner.displayName || inner.name);
      return n ? n : null;
    }
    return null;
  };
  const walk = (root) => {
    const stack = root.current ? [root.current] : [];
    while (stack.length) {
      const f = stack.pop();
      if (COMPONENT.has(f.tag)) {
        const p = f.memoizedProps;
        const s = f.memoizedState;
        const freshP = p && typeof p === 'object' && !seenProps.has(p);
        const freshS = s && typeof s === 'object' && !seenState.has(s);
        if (freshP) seenProps.add(p);
        if (freshS) seenState.add(s);
        if (c.on && (freshP || freshS)) {
          const n = nameOf(f);
          if (n) c.comps[n] = (c.comps[n] || 0) + 1;
        }
      }
      if (f.sibling) stack.push(f.sibling);
      if (f.child) stack.push(f.child);
    }
  };
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    renderers: new Map(),
    supportsFiber: true,
    isDisabled: false,
    inject(r) { const id = this.renderers.size + 1; this.renderers.set(id, r); return id; },
    onCommitFiberRoot(id, root) {
      if (c.on) c.byRenderer[id] = (c.byRenderer[id] || 0) + 1;
      walk(root);
    },
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    onScheduleFiberRoot() {},
    checkDCE() {},
  };
  window.__rc = {
    start() { c.on = true; c.byRenderer = {}; c.comps = {}; },
    stop() { c.on = false; return JSON.parse(JSON.stringify({ byRenderer: c.byRenderer, comps: c.comps })); },
    renderers() { return [...window.__REACT_DEVTOOLS_GLOBAL_HOOK__.renderers.values()].map((r) => r.rendererPackageName || '?'); },
  };
})();
`;

/** Long tasks with timestamps, from page start. */
const LONGTASK_LOG = `
(() => {
  window.__lt = [];
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push([Math.round(e.startTime), Math.round(e.duration)]); })
      .observe({ type: 'longtask', buffered: true });
  } catch (e) {}
})();
`;

interface Opened {
  page: Page;
  cdp: CDPSession;
  close(): Promise<void>;
}

async function open(
  browser: Browser,
  opts: { tier: Tier; throttle: number; perf?: boolean; hook?: boolean; network?: boolean },
): Promise<Opened> {
  const ctx = await browser.newContext({ ...devices['Pixel 7'], serviceWorkers: 'block' });
  await ctx.addInitScript({ content: seed(opts.tier, opts.perf ?? false) + LONGTASK_LOG });
  if (opts.hook) await ctx.addInitScript({ content: COMMIT_HOOK });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.warn('  [pageerror]', e.message));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: opts.throttle });
  if (opts.network) {
    await cdp.send('Network.enable');
    // ~4G: 12 Mbps down, 3 Mbps up, 70 ms RTT. Cache disabled: a first visit.
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 70,
      downloadThroughput: (12 * 1024 * 1024) / 8,
      uploadThroughput: (3 * 1024 * 1024) / 8,
    });
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  }
  return { page, cdp, close: () => ctx.close() };
}

async function metrics(cdp: CDPSession): Promise<Record<string, number>> {
  const { metrics: list } = (await cdp.send('Performance.getMetrics')) as {
    metrics: { name: string; value: number }[];
  };
  return Object.fromEntries(list.map((m) => [m.name, m.value]));
}

const r1 = (v: number) => Math.round(v * 10) / 10;

interface Progress {
  i: number;
  n: number;
  tier: string;
  game: string;
  phase: string;
}

const parseProgress = (text: string): Progress | null => {
  const m = /^(\d+)\/(\d+) · (\w+) · ([\w -]+?) · ([\w-]+)$/.exec(text.trim());
  return m ? { i: Number(m[1]), n: Number(m[2]), tier: m[3]!, game: m[4]!, phase: m[5]! } : null;
};

interface WindowStats {
  game: string;
  tier: string;
  /** Main thread busy (CDP TaskDuration) per second of the window, ms/s. */
  busyMsPerS: number;
  scriptMsPerS: number;
  layoutStyleMsPerS: number;
  commits?: Record<string, number>;
  topComponents?: [string, number][];
}

/**
 * Runs /bench in `page` and samples CDP metrics (and the commit hook, if installed) at the start
 * and end of every scene's measured window. Returns the bench's JSON and the per-window stats.
 */
async function runBench(
  o: Opened,
  query: string,
  hook: boolean,
): Promise<{ bench: unknown; windows: WindowStats[] }> {
  const { page, cdp } = o;
  await page.goto(`${BASE}/bench?${query}`);
  await page.waitForSelector('[data-testid=bench-start]:not([disabled])', { timeout: 60_000 });
  await page.click('[data-testid=bench-start]');
  const windows: WindowStats[] = [];
  let last: Progress | null = null;
  let start: Record<string, number> | null = null;
  const deadline = Date.now() + 30 * 60_000;
  while (Date.now() < deadline) {
    const state = await page.getAttribute('[data-testid=bench]', 'data-state').catch(() => null);
    if (state === 'idle') break;
    const text = await page.textContent('[data-testid=bench-progress]').catch(() => null);
    const p = text ? parseProgress(text) : null;
    if (p && (p.phase !== last?.phase || p.game !== last?.game)) {
      if (p.phase === 'measuring') {
        start = await metrics(cdp);
        if (hook) await page.evaluate('window.__rc.start()');
      } else if (last?.phase === 'measuring' && start) {
        const end = await metrics(cdp);
        const dt = (end.Timestamp! - start.Timestamp!) * 1000;
        const per = (k: string) => r1(((end[k]! - start![k]!) * 1e6) / dt);
        const w: WindowStats = {
          game: last.game,
          tier: last.tier,
          busyMsPerS: per('TaskDuration'),
          scriptMsPerS: per('ScriptDuration'),
          layoutStyleMsPerS: r1(per('LayoutDuration') + per('RecalcStyleDuration')),
        };
        if (hook) {
          const snap = (await page.evaluate('window.__rc.stop()')) as {
            byRenderer: Record<string, number>;
            comps: Record<string, number>;
          };
          const secs = dt / 1000;
          const names = (await page.evaluate('window.__rc.renderers()')) as string[];
          w.commits = Object.fromEntries(
            Object.entries(snap.byRenderer).map(([id, n]) => [
              names[Number(id) - 1] ?? id,
              r1(n / secs),
            ]),
          );
          w.topComponents = Object.entries(snap.comps)
            .map(([name, n]) => [name, r1(n / secs)] as [string, number])
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8);
        }
        windows.push(w);
        start = null;
      }
      last = p;
    }
    await page.waitForTimeout(40);
  }
  const json = await page.inputValue('[data-testid=bench-json]');
  return { bench: JSON.parse(json), windows };
}

const benchQuery = (extra = '') =>
  [GAMES && `games=${GAMES}`, WINDOW && `window=${WINDOW}`, extra].filter(Boolean).join('&');

function save(name: string, data: unknown) {
  const file = join(OUT, `${LABEL}-${name}.json`);
  writeFileSync(file, JSON.stringify(data, null, 1));
  console.log(`  → ${file}`);
}

async function passBench(browser: Browser) {
  for (const [tier, throttle] of [
    ['mid', 4],
    ['low', 6],
  ] as [Tier, number][]) {
    console.log(`bench: ${tier} @ ${throttle}× CPU`);
    const o = await open(browser, { tier, throttle });
    const res = await runBench(o, benchQuery(), false);
    save(`bench-${tier}-x${throttle}`, res);
    await o.close();
  }
}

async function passCommits(browser: Browser) {
  console.log('commits: mid @ 4× CPU');
  const o = await open(browser, { tier: 'mid', throttle: 4, hook: true });
  const res = await runBench(o, benchQuery(), true);
  save('commits', res.windows);
  await o.close();
}

async function passLeak(browser: Browser) {
  console.log('leak: all scenes twice in one page (mid, no throttle)');
  const o = await open(browser, { tier: 'mid', throttle: 1 });
  const { page, cdp } = o;
  const snapshots: unknown[] = [];
  const snapshot = async (label: string) => {
    await cdp.send('HeapProfiler.collectGarbage');
    await page.waitForTimeout(300);
    await cdp.send('HeapProfiler.collectGarbage');
    const heap = (await cdp.send('Runtime.getHeapUsage')) as { usedSize: number };
    const dom = (await cdp.send('Memory.getDOMCounters')) as Record<string, number>;
    const json = await page.inputValue('[data-testid=bench-json]').catch(() => '');
    const leak = json ? (JSON.parse(json) as { leak: unknown }).leak : null;
    snapshots.push({ label, heapMB: r1(heap.usedSize / 1048576), dom, gpu: leak });
    console.log(`  ${label}: heap ${r1(heap.usedSize / 1048576)} MB, nodes ${dom.nodes}`, leak);
  };
  await runBench(o, benchQuery('window=2500'), false);
  await snapshot('after cycle 1');
  await page.click('[data-testid=bench-start]');
  await page.waitForSelector('[data-testid=bench][data-state=running]');
  await page.waitForSelector('[data-testid=bench][data-state=idle]', { timeout: 20 * 60_000 });
  await snapshot('after cycle 2');
  save('leak', snapshots);
  await o.close();
}

interface FrameLog {
  t: number;
  interval: number;
  cpu: number;
  end: number;
  calls: number;
  triangles: number;
}

/** Cold first-game load: Home → Lobby (its preload) → Start → a smooth table. */
async function passLoad(browser: Browser) {
  const runs: unknown[] = [];
  for (const [game, tier] of [
    ['higher-lower', 'mid'],
    ['mexico', 'mid'],
    ['beer-pong', 'mid'],
    ['kings-cup', 'high'],
    ['higher-lower', 'low'],
  ] as [string, Tier][]) {
    console.log(`load: ${game} (${tier}) cold, 4× CPU, 4G`);
    const o = await open(browser, { tier, throttle: 4, perf: true, network: true });
    const { page } = o;
    await page.goto(`${BASE}/`);
    await page.getByTestId('home').waitFor({ timeout: 60_000 });
    const homeLong = (await page.evaluate('window.__lt.slice()')) as [number, number][];
    const tLobby = (await page.evaluate('performance.now()')) as number;
    await page.goto(`${BASE}/games/${game}`);
    await page.getByTestId('start-game').waitFor({ timeout: 60_000 });
    // Players read the rules for a few seconds: the Lobby's preload/warm-up gets that long.
    await page.waitForTimeout(6000);
    const lobbyLong = (await page.evaluate('window.__lt.slice()')) as [number, number][];
    const t0 = (await page.evaluate('performance.now()')) as number;
    await page.getByTestId('start-game').click();
    await page.getByTestId('play').waitFor({ timeout: 60_000 });
    // A table that has drawn and then stayed smooth (no frame over 100 ms) for 1.5 s.
    let settled: number | null = null;
    let first: number | null = null;
    const until = Date.now() + 45_000;
    while (Date.now() < until) {
      const frames = (await page.evaluate(
        'window.__inumanPerf ? window.__inumanPerf.frames.slice() : []',
      )) as FrameLog[];
      const after = frames.filter((f) => f.end > t0);
      if (after.length && first === null) first = after[0]!.end - t0;
      const slow = after.filter((f) => f.interval > 100 || f.cpu > 50);
      const lastSlow = slow.length ? slow[slow.length - 1]!.end : after[0]?.end;
      const now = (await page.evaluate('performance.now()')) as number;
      if (after.length && lastSlow !== undefined && now - lastSlow > 1500 && now - t0 > 2500) {
        settled = lastSlow - t0;
        break;
      }
      await page.waitForTimeout(250);
    }
    const lt = (await page.evaluate('window.__lt.slice()')) as [number, number][];
    const res = (await page.evaluate(`performance.getEntriesByType('resource').map((e) => ({
      name: e.name.split('/').pop(), start: Math.round(e.startTime), end: Math.round(e.responseEnd),
      kb: Math.round((e.transferSize || e.encodedBodySize) / 1024) }))`)) as {
      name: string;
      start: number;
      end: number;
      kb: number;
    }[];
    // Everything fetched after Start, plus what the Lobby preloaded (GLB/HDR/fonts).
    const interesting = res
      .filter((r) => r.start >= t0 || /\.(glb|hdr|woff2?)$/.test(r.name))
      .map((r) => ({ ...r, start: r.start - Math.round(t0), end: r.end - Math.round(t0) }));
    const sum = (list: [number, number][], from: number, to: number) =>
      list.filter(([s]) => s >= from && s < to).reduce((a, [, d]) => a + d, 0);
    // The page can freeze after the first frame (texture uploads, shader compiles, WASM compile)
    // with no frame to show it under frameloop="demand": "quiet" is when the last long task ends.
    const startTasks = lt.filter(([s]) => s >= t0 && s < t0 + 15_000);
    const lastTask = startTasks[startTasks.length - 1];
    const run = {
      game,
      tier,
      firstFrameMs: first === null ? null : Math.round(first),
      smoothTableMs: settled === null ? null : Math.round(settled),
      quietMs: Math.round(Math.max(settled ?? 0, lastTask ? lastTask[0] + lastTask[1] - t0 : 0)),
      homeLongTaskMs: sum(homeLong, 0, tLobby),
      lobbyLongTaskMs: sum(lobbyLong, tLobby, t0),
      startLongTaskMs: sum(lt, t0, t0 + 15_000),
      startLongTasks: lt.filter(([s]) => s >= t0).map(([s, d]) => [Math.round(s - t0), d]),
      resources: interesting,
    };
    // Mexico: the first roll (Rapier is loaded on demand unless the Lobby warmed it).
    if (game === 'mexico') {
      const tRoll = (await page.evaluate('performance.now()')) as number;
      await page.getByTestId('mx-roll').click();
      await page.waitForTimeout(4000);
      const after = (await page.evaluate('window.__lt.slice()')) as [number, number][];
      Object.assign(run, {
        firstRollLongTaskMs: sum(after, tRoll, tRoll + 4000),
        firstRollLongTasks: after
          .filter(([s]) => s >= tRoll)
          .map(([s, d]) => [Math.round(s - tRoll), d]),
      });
    }
    console.log(
      `  first frame ${run.firstFrameMs} ms · smooth table ${run.smoothTableMs} ms · quiet ${run.quietMs} ms · long tasks home ${run.homeLongTaskMs} / lobby ${run.lobbyLongTaskMs} / start ${run.startLongTaskMs} ms`,
    );
    runs.push(run);
    await o.close();
  }
  save('load', runs);
}

/** Real play: does anything keep rendering once the table is still? */
async function passIdle(browser: Browser) {
  const out: unknown[] = [];
  for (const game of [
    'higher-lower',
    'kings-cup',
    'mexico',
    'liars-dice',
    'beer-pong',
    'flip-cup',
  ]) {
    const o = await open(browser, { tier: 'mid', throttle: 1, perf: true });
    const { page } = o;
    await page.goto(`${BASE}/games/${game}`);
    await page.getByTestId('start-game').click();
    await page.getByTestId('play').waitFor();
    await page.waitForTimeout(6000); // first-scene calibration (3.5 s) and env loads finish
    const before = (await page.evaluate('window.__inumanPerf.frames.length')) as number;
    await page.waitForTimeout(5000);
    const after = (await page.evaluate('window.__inumanPerf.frames.length')) as number;
    // Back Home (client-side): the hidden Canvas must stay idle too.
    await page.getByTestId('open-menu').click();
    await page.getByTestId('menu-home').click();
    await page.getByTestId('home').waitFor();
    await page.waitForTimeout(1000);
    const home0 = (await page.evaluate('window.__inumanPerf.frames.length')) as number;
    await page.waitForTimeout(5000);
    const home1 = (await page.evaluate('window.__inumanPerf.frames.length')) as number;
    out.push({ game, idleFrames5s: after - before, homeFrames5s: home1 - home0 });
    console.log(
      `idle: ${game}: ${after - before} frames in 5 s on /play, ${home1 - home0} at Home`,
    );
    await o.close();
  }
  save('idle', out);
}

const browser =
  GPU === 'wsl'
    ? await chromium.launch({
        channel: 'chromium',
        args: [
          '--enable-precise-memory-info',
          '--use-gl=angle',
          '--use-angle=gl',
          '--ignore-gpu-blocklist',
          '--enable-gpu',
        ],
        env: {
          ...process.env,
          GALLIUM_DRIVER: 'd3d12',
          LD_LIBRARY_PATH: [process.env.LD_LIBRARY_PATH, '/usr/lib/wsl/lib']
            .filter(Boolean)
            .join(':'),
        },
      })
    : await chromium.launch({ args: ['--enable-precise-memory-info'] });
try {
  if (PASSES.has('bench')) await passBench(browser);
  if (PASSES.has('commits')) await passCommits(browser);
  if (PASSES.has('leak')) await passLeak(browser);
  if (PASSES.has('load')) await passLoad(browser);
  if (PASSES.has('idle')) await passIdle(browser);
} finally {
  await browser.close();
}
