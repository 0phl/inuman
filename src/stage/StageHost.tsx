import { lazy, Suspense, useEffect } from 'react';
import { useLocation } from 'react-router';
import { StageBoundary } from './StageBoundary';
import { isStageRoute, useStage } from './stageStore';

const Stage = lazy(() => import('./Stage'));

/**
 * Lives in the root layout. Mounts the one <Canvas> the first time a stage route (/play, or a
 * /dev/* bench in dev builds) is visited and then keeps it mounted (hidden elsewhere) so iOS
 * doesn't churn WebGL contexts. three/R3F load only from here.
 */
export function StageHost() {
  const { pathname } = useLocation();
  const onStage = isStageRoute(pathname);
  const onLobby = pathname.startsWith('/games/');
  const wanted = useStage((s) => s.wanted);
  const want = useStage((s) => s.want);

  useEffect(() => {
    if (onStage) want();
  }, [onStage, want]);

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
      aria-hidden={!onStage}
      data-testid="stage"
      className="fixed inset-0 z-0"
      style={{ visibility: onStage ? 'visible' : 'hidden', pointerEvents: onStage ? 'auto' : 'none' }}
    >
      <StageBoundary>
        <Suspense fallback={null}>
          <Stage active={onStage} />
        </Suspense>
      </StageBoundary>
    </div>
  );
}
