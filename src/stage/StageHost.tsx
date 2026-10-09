import { lazy, Suspense, useEffect, useMemo } from 'react';
import { useLocation } from 'react-router';
import { perfOverlayEnabled } from './perf/flag';
import { StageBoundary } from './StageBoundary';
import { BENCH_PATH, isStageRoute, useStage } from './stageStore';

const Stage = lazy(() => import('./Stage'));

/** How long the Lobby is open before the stage warm-up starts (a quick back-out costs nothing). */
const LOBBY_WARM_DELAY_MS = 700;

const whenIdle = (fn: () => void) => {
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: object) => number };
  if (w.requestIdleCallback) w.requestIdleCallback(fn, { timeout: 1500 });
  else window.setTimeout(fn, 50);
};

/**
 * Lives in the root layout. Mounts the one <Canvas> the first time a stage route (/play, /bench, or
 * a /dev/* bench in dev builds) or a game's Lobby is visited, and then keeps it mounted (hidden
 * elsewhere) so iOS doesn't churn WebGL contexts. three/R3F load only from here.
 */
export function StageHost() {
  const { pathname, search } = useLocation();
  const onStage = isStageRoute(pathname);
  const lobbyGame = pathname.startsWith('/games/') ? pathname.slice('/games/'.length) : null;
  const perf = useMemo(() => perfOverlayEnabled(search), [search]);
  const wanted = useStage((s) => s.wanted);
  const want = useStage((s) => s.want);
  const sceneReady = useStage((s) => s.sceneReady);

  useEffect(() => {
    if (onStage) want();
  }, [onStage, want]);

  // The Lobby is the step before /play. While the players pick rules: load the bar, mount the
  // (hidden) stage so the room is uploaded and its shaders compiled, then warm this game's code,
  // physics and shared props. Start then opens on a ready table instead of freezing on it.
  useEffect(() => {
    if (!lobbyGame) return;
    let live = true;
    const id = window.setTimeout(() => {
      import('./preloadStage')
        .then((m) => m.preloadStage())
        .then(() => {
          if (!live) return;
          want();
          whenIdle(() => {
            if (!live) return;
            void import('./warm/gameWarmup').then((m) =>
              live && m.isWarmableGame(lobbyGame) ? m.warmGame(lobbyGame) : undefined,
            );
          });
        })
        .catch((e: unknown) => console.warn('[stage] preload skipped:', e));
    }, LOBBY_WARM_DELAY_MS);
    return () => {
      live = false;
      window.clearTimeout(id);
    };
  }, [lobbyGame, want]);

  if (!wanted) return null;
  return (
    <div
      aria-hidden={!onStage}
      data-testid="stage"
      // "ready" once a game scene is mounted, compiled and on screen: moves animate from here on.
      data-scene={sceneReady ? 'ready' : 'pending'}
      className="fixed inset-0 z-0"
      style={{
        visibility: onStage ? 'visible' : 'hidden',
        pointerEvents: onStage ? 'auto' : 'none',
      }}
    >
      <StageBoundary>
        <Suspense fallback={null}>
          <Stage
            active={onStage}
            calibrate={pathname === '/play'}
            benchRoute={pathname === BENCH_PATH}
            perf={perf}
          />
        </Suspense>
      </StageBoundary>
    </div>
  );
}
