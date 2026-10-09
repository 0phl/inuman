import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { BenchScene, type ShownScene } from '@/bench/BenchScene';
import { collectDevice } from '@/bench/device';
import {
  compactJson,
  gradeFirstRender,
  gradeLong,
  gradeP95,
  gradeScene,
  loadLastRun,
  P95_TARGET,
  saveLastRun,
  type BenchRun,
  type DeviceInfo,
  type Grade,
  type SceneResult,
} from '@/bench/results';
import { appTier, runBench, WINDOW_MS, type BenchProgress } from '@/bench/runner';
import { SCENARIOS } from '@/bench/scenarios';
import type { BenchHost } from '@/bench/session';
import type { GameId } from '@/core/engine/types';
import { stageHandles } from '@/stage/perf/probe';
import { useStage } from '@/stage/stageStore';
import type { Tier } from '@/store/settings';

// /bench: an on-device performance benchmark (production too). Plain English on purpose: it's a
// technical page, and its results are pasted back to the developers.

const GRADE_CLASS: Record<Grade, string> = {
  good: 'text-emerald-300',
  warn: 'text-amber-300',
  bad: 'text-red-400 font-bold',
  none: 'text-capiz-400',
};
const GRADE_DOT: Record<Grade, string> = {
  good: 'bg-emerald-400',
  warn: 'bg-amber-400',
  bad: 'bg-red-500',
  none: 'bg-capiz-400/40',
};

const n = (v: number | null | undefined, digits = 1) =>
  v === null || v === undefined || !Number.isFinite(v) ? '–' : v.toFixed(digits);
const k = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v));

function Cell({ grade = 'none', children }: { grade?: Grade; children: ReactNode }) {
  return (
    <td className={`px-1.5 py-1 text-right tabular-nums ${GRADE_CLASS[grade]}`}>{children}</td>
  );
}

function ResultsTable({ scenes }: { scenes: SceneResult[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-narra-600" data-testid="bench-table">
      <table className="w-full min-w-[640px] border-collapse text-[0.78rem]">
        <thead className="bg-black/30 text-capiz-300">
          <tr>
            {[
              'Game',
              'Tier',
              'First (ms)',
              'FPS',
              'p50',
              'p95',
              'Max',
              'Long',
              'CPU p95',
              'Calls',
              'Tris',
              'Tex',
              'Heap MB',
              'Idle',
            ].map((h, i) => (
              <th
                key={h}
                className={`px-1.5 py-1 font-semibold ${i < 2 ? 'text-left' : 'text-right'}`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {scenes.map((s) => (
            <tr
              key={`${s.tier}:${s.id}`}
              className="border-t border-white/6"
              data-testid="bench-row"
            >
              <td className="px-1.5 py-1 text-left whitespace-nowrap">
                <span
                  className={`mr-1.5 inline-block size-2 rounded-full ${GRADE_DOT[gradeScene(s)]}`}
                />
                {s.id}
                {s.error && <span className="ml-1 text-red-400">⚠ {s.error}</span>}
              </td>
              <td className="px-1.5 py-1 text-left">{s.tier}</td>
              <Cell grade={gradeFirstRender(s.firstRenderMs)}>{n(s.firstRenderMs, 0)}</Cell>
              <Cell>{n(s.fps, 0)}</Cell>
              <Cell>{n(s.p50)}</Cell>
              <Cell grade={gradeP95(s.p95, s.tier)}>{n(s.p95)}</Cell>
              <Cell>{n(s.max, 0)}</Cell>
              <Cell grade={gradeLong(s.long, s.frames)}>{s.long}</Cell>
              <Cell>{n(s.cpuP95)}</Cell>
              <Cell>{s.calls}</Cell>
              <Cell>{k(s.tris)}</Cell>
              <Cell>{s.textures}</Cell>
              <Cell>{n(s.heapMB, 0)}</Cell>
              <Cell grade={s.idleFrames === 0 ? 'good' : 'warn'}>{s.idleFrames}</Cell>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DeviceRows({ device }: { device: DeviceInfo }) {
  const rows: [string, string][] = [
    ['GPU', device.gpu ?? 'unknown'],
    [
      'detect-gpu',
      device.detect
        ? `tier ${device.detect.tier ?? '?'} · ${device.detect.type}${device.detect.gpu ? ` · ${device.detect.gpu}` : ''}`
        : '–',
    ],
    ['App tier', `${device.appTier ?? '?'} (quality: ${device.quality})`],
    ['Screen', `${device.viewport[0]}×${device.viewport[1]} css px · DPR ${device.dpr}`],
    ['Canvas', device.canvas ? `${device.canvas[0]}×${device.canvas[1]} px` : '–'],
    ['CPU / RAM', `${device.cores ?? '?'} cores · ${device.memory ?? '?'} GB`],
    ['Browser', device.ua],
  ];
  return (
    <dl
      className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[0.8rem]"
      data-testid="bench-device"
    >
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-capiz-400">{label}</dt>
          <dd className="min-w-0 break-words text-capiz-100">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Summary({ run }: { run: BenchRun }) {
  const counts = { good: 0, warn: 0, bad: 0, none: 0 };
  for (const s of run.scenes) counts[gradeScene(s)]++;
  const leak = run.leak;
  return (
    <p className="text-sm text-capiz-200" data-testid="bench-summary">
      {run.scenes.length} scenes in {run.seconds}s{run.aborted ? ' (stopped early)' : ''}:{' '}
      <span className="text-emerald-300">{counts.good} good</span> ·{' '}
      <span className="text-amber-300">{counts.warn} borderline</span> ·{' '}
      <span className="text-red-400">{counts.bad} slow</span>
      {leak && (
        <>
          <br />
          GPU textures {leak.texturesStart} → {leak.texturesEnd}, geometries {leak.geometriesStart}{' '}
          → {leak.geometriesEnd}
          {leak.heapStartMB !== null && `, JS heap ${leak.heapStartMB} → ${leak.heapEndMB} MB`}
        </>
      )}
    </p>
  );
}

async function copyText(text: string, fallback: HTMLTextAreaElement | null): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    if (!fallback) return false;
    fallback.focus();
    fallback.select();
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    }
  }
}

export default function Bench() {
  const [params] = useSearchParams();
  const setBench = useStage((s) => s.setBench);
  const [tier, setTier] = useState<Tier | null>(null);
  const [device, setDevice] = useState<DeviceInfo | null>(null);
  const [mode, setMode] = useState<'current' | 'all'>(
    params.get('mode') === 'all' ? 'all' : 'current',
  );
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<BenchProgress | null>(null);
  const [run, setRun] = useState<BenchRun | null>(() => loadLastRun());
  const [shown, setShown] = useState<ShownScene | null>(null);
  const [copied, setCopied] = useState<'idle' | 'ok' | 'fail'>('idle');
  const abort = useRef<AbortController | null>(null);
  const seq = useRef(0);
  const ran = useRef(false);
  const jsonBox = useRef<HTMLTextAreaElement>(null);

  // Optional: ?games=a,b (subset), ?window=ms (shorter windows for automated checks).
  const games = useMemo(() => {
    const list = params.get('games')?.split(',').filter(Boolean) ?? [];
    const known = list.filter((g) => SCENARIOS.some((s) => s.id === g)) as GameId[];
    return known.length ? known : undefined;
  }, [params]);
  const windowMs = useMemo(() => {
    const w = Number(params.get('window'));
    return Number.isFinite(w) && w >= 1500 && w <= 15000 ? w : WINDOW_MS;
  }, [params]);

  // Show the stage at the app's own tier (without writing settings) and read the device.
  useEffect(() => {
    let live = true;
    void appTier().then((t) => {
      if (!live) return;
      setTier(t);
      setBench({ tier: t, keepRendering: false });
    });
    return () => {
      live = false;
      setBench(null);
    };
  }, [setBench]);

  useEffect(() => {
    if (!tier || device) return;
    let live = true;
    const poll = async () => {
      for (let i = 0; i < 100 && live && !stageHandles(); i++) {
        await new Promise((r) => window.setTimeout(r, 100));
      }
      if (live) setDevice(await collectDevice());
    };
    void poll();
    return () => {
      live = false;
    };
  }, [tier, device]);

  // Leaving after a run reloads the app: the bench filled caches (every tier's bar, dice, cards)
  // that a real game shouldn't inherit on a low-memory phone.
  useEffect(
    () => () => {
      abort.current?.abort();
      if (ran.current) window.location.reload();
    },
    [],
  );

  const show = useCallback(
    (host: BenchHost | null) =>
      new Promise<void>((resolve) => {
        if (!host) {
          setShown(null);
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
          return;
        }
        seq.current += 1;
        let done = false;
        setShown({
          key: seq.current,
          host,
          onCommit: () => {
            if (done) return;
            done = true;
            resolve();
          },
        });
      }),
    [],
  );

  const start = async () => {
    if (running) return;
    ran.current = true;
    const ac = new AbortController();
    abort.current = ac;
    setRunning(true);
    setCopied('idle');
    window.scrollTo(0, 0);
    try {
      const result = await runBench(
        { mode, games, windowMs },
        {
          show,
          signal: ac.signal,
          progress: (p) =>
            setProgress((prev) => (p.index < 0 && prev ? { ...prev, phase: p.phase } : p)),
        },
      );
      saveLastRun(result);
      setRun(result);
      setDevice(result.device);
    } finally {
      abort.current = null;
      setRunning(false);
      setProgress(null);
    }
  };

  const json = useMemo(() => (run ? compactJson(run) : ''), [run]);
  const canShare = typeof navigator.share === 'function';

  if (running) {
    return (
      <main className="fixed inset-0" data-testid="bench" data-state="running">
        <BenchScene shown={shown} />
        <div className="absolute inset-x-0 top-0 z-20 flex items-center gap-2 bg-black/55 px-3 pt-[calc(env(safe-area-inset-top)+8px)] pb-2 text-sm">
          <span className="min-w-0 flex-1 truncate" data-testid="bench-progress">
            {progress
              ? `${Math.min(progress.index + 1, progress.total)}/${progress.total} · ${progress.tier} · ${progress.game ?? 'loading stage'} · ${progress.phase}`
              : 'Starting…'}
          </span>
          <button
            type="button"
            className="btn btn-wood min-h-10 px-3 text-sm"
            onClick={() => abort.current?.abort()}
            data-testid="bench-stop"
          >
            Stop
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="relative min-h-dvh bg-narra-950" data-testid="bench" data-state="idle">
      <div className="screen gap-4">
        <header className="flex min-h-12 items-center gap-3">
          {/* A full page load on purpose (see the reload note above). */}
          <a href="/" className="icon-btn" aria-label="Back to the app">
            ←
          </a>
          <h1 className="min-w-0 flex-1 truncate font-sign text-[1.5rem] leading-none text-brass-300">
            Performance bench
          </h1>
        </header>

        <p className="text-sm text-capiz-200">
          Plays each of the 13 game scenes for about {Math.round(windowMs / 1000)} seconds with four
          made-up players and measures how smoothly this phone draws them. It never touches your
          saved game, players or settings. Keep the screen on and the app in front while it runs
          (about {Math.round((SCENARIOS.length * (windowMs + 4000)) / 60000)} min per tier).
        </p>

        <section className="panel flex flex-col gap-3 p-4">
          <h2 className="eyebrow">This device</h2>
          {device ? (
            <DeviceRows device={device} />
          ) : (
            <p className="text-sm text-capiz-400">Reading…</p>
          )}
        </section>

        <section className="panel flex flex-col gap-3 p-4">
          <h2 className="eyebrow">Run</h2>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Tiers to test">
            {(
              [
                ['current', `This phone's tier${tier ? ` (${tier})` : ''}`],
                ['all', 'All tiers (low, mid, high)'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={mode === value}
                className={`btn min-h-12 px-2 text-sm ${mode === value ? 'btn-brass' : 'btn-wood'}`}
                onClick={() => setMode(value)}
                data-testid={`bench-mode-${value}`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn btn-brass min-h-14 text-lg"
            onClick={() => void start()}
            disabled={!tier}
            data-testid="bench-start"
          >
            Simulan ang test
          </button>
          <p className="text-xs text-capiz-400">
            Targets: 95% of frames under {P95_TARGET.mid} ms on mid/high (50 fps), under{' '}
            {Math.round(P95_TARGET.low)} ms on low (30 fps).
          </p>
        </section>

        {run && (
          <section className="flex flex-col gap-3" data-testid="bench-results">
            <h2 className="eyebrow">
              Results · {new Date(run.at).toLocaleString()} · build {run.build}
            </h2>
            <Summary run={run} />
            <ResultsTable scenes={run.scenes} />
            <p className="text-xs text-capiz-400">
              First = mount to first frame. p50/p95/Max = frame time (ms) while the game animates.
              Long = frames over 50 ms. Idle = frames drawn after the animation ended (should be 0).
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                className="btn btn-brass"
                onClick={() =>
                  void copyText(json, jsonBox.current).then((ok) => setCopied(ok ? 'ok' : 'fail'))
                }
                data-testid="bench-copy"
              >
                {copied === 'ok' ? 'Copied!' : 'Copy results'}
              </button>
              {canShare ? (
                <button
                  type="button"
                  className="btn btn-wood"
                  onClick={() =>
                    void navigator
                      .share({ title: 'Inuman bench results', text: json })
                      .catch(() => {})
                  }
                  data-testid="bench-share"
                >
                  Share…
                </button>
              ) : (
                <span />
              )}
            </div>
            {copied === 'fail' && (
              <p className="text-sm text-amber-300">
                Couldn’t copy automatically: long-press the box below, Select all, Copy.
              </p>
            )}
            <textarea
              ref={jsonBox}
              readOnly
              value={json}
              rows={5}
              className="field min-h-28 py-2 font-mono text-[0.7rem] leading-snug"
              onFocus={(e) => e.currentTarget.select()}
              data-testid="bench-json"
            />
            <p className="text-xs text-capiz-400">
              Send the copied text as-is (it’s plain JSON, no personal data beyond the phone model
              and browser). The last result is kept on this phone until the next run.
            </p>
          </section>
        )}
      </div>
    </main>
  );
}
