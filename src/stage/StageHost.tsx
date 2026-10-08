import { lazy, Suspense, useEffect } from 'react';
import { useLocation } from 'react-router';
import { StageBoundary } from './StageBoundary';
import { useStage } from './stageStore';

const Stage = lazy(() => import('./Stage'));

/**
 * Lives in the root layout. Mounts the one <Canvas> the first time /play is visited and then keeps it
 * mounted (hidden elsewhere) so iOS doesn't churn WebGL contexts. three/R3F load only from here.
 */
export function StageHost() {
  const { pathname } = useLocation();
  const onPlay = pathname === '/play';
  const onLobby = pathname.startsWith('/games/');
  const wanted = useStage((s) => s.wanted);
  const want = useStage((s) => s.want);

  useEffect(() => {
    if (onPlay) want();
  }, [onPlay, want]);

  // The Lobby is the step before /play: warm the bar's GLB while the players pick rules.
  useEffect(() => {
    if (!onLobby) return;
    const id = window.setTimeout(() => {
      import('./preloadStage')
        .then((m) => m.preloadStage())
        .catch((e: unknown) => console.warn('[stage] preload skipped:', e));
    }, 300);
    return () => window.clearTimeout(id);
  }, [onLobby]);

  if (!wanted) return null;
  return (
    <div
      aria-hidden={!onPlay}
      data-testid="stage"
      className="fixed inset-0 z-0"
      style={{ visibility: onPlay ? 'visible' : 'hidden', pointerEvents: onPlay ? 'auto' : 'none' }}
    >
      <StageBoundary>
        <Suspense fallback={null}>
          <Stage active={onPlay} />
        </Suspense>
      </StageBoundary>
    </div>
  );
}
