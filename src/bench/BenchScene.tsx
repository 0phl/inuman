import { Suspense, useLayoutEffect, useSyncExternalStore } from 'react';
import { getView } from '@/games/views';
import { sceneTunnel } from '@/stage/tunnel';
import type { BenchHost } from './session';

export interface ShownScene {
  /** Bumped per mount, so a new run of the same game remounts from scratch. */
  key: number;
  host: BenchHost;
  /** Called once the scene has committed inside the Canvas (after any lazy chunk loaded). */
  onCommit(): void;
}

/** Sits after the Scene in the tunnel: its layout effect runs when the Scene's Suspense boundary commits. */
function CommitMarker({ onCommit }: { onCommit(): void }) {
  useLayoutEffect(() => onCommit(), [onCommit]);
  return null;
}

function Mounted({ shown }: { shown: ShownScene }) {
  const { host } = shown;
  const state = useSyncExternalStore(host.subscribe, host.getState);
  const gameView = getView(host.gameId);
  if (!gameView) return null;
  const { Scene, Hud } = gameView;
  // The same props Play hands to a game, wired to the bench's in-memory session.
  const props = {
    view: host.getView(),
    rules: state.rules,
    players: state.players,
    dispatch: host.dispatch,
  };
  return (
    <>
      <sceneTunnel.In>
        <Scene {...props} />
        <CommitMarker onCommit={shown.onCommit} />
      </sceneTunnel.In>
      {/* The game's HUD, as in play (its re-renders are part of the cost), but not tappable. */}
      <div
        inert
        aria-hidden
        className="pointer-events-none fixed inset-0 flex flex-col px-4 pt-[calc(env(safe-area-inset-top)+64px)] pb-[calc(env(safe-area-inset-bottom)+16px)]"
      >
        <div className="mx-auto min-h-0 w-full max-w-[528px] flex-1">
          <Suspense fallback={null}>
            <Hud {...props} />
          </Suspense>
        </div>
      </div>
    </>
  );
}

/** Mounts a bench game the way Play does: Scene through the stage tunnel, Hud in the DOM. */
export function BenchScene({ shown }: { shown: ShownScene | null }) {
  return shown ? <Mounted key={shown.key} shown={shown} /> : null;
}
