import { useMemo } from 'react';
import { create } from 'zustand';
import type { PlayerId } from '@/core/engine/types';
import type { View } from '@/core/games/liars-dice/logic';
import { getLogic } from '@/core/games/registry';
import { useSession } from '@/store/session';

/**
 * One seat's own projection of the running game: `getLogic(id).project(state.game, playerId)`.
 * Read-only. The play screen otherwise renders only the 'table' view (no hidden dice), so call this
 * only while that player is looking (pass null otherwise and nothing private is computed).
 */
export function usePrivateView<V>(playerId: PlayerId | null): V | null {
  const session = useSession((s) => s.session);
  return useMemo(
    () =>
      session && playerId && !session.over
        ? (getLogic(session.gameId).project(session.game, playerId) as V)
        : null,
    [session, playerId],
  );
}

/**
 * Identifies "this bidder, at this point of this round". A peek is only valid while the key still
 * matches, so any bid, call, new round or pass closes it on its own: nothing of the previous
 * player's hand survives a hand-over.
 */
export const peekKeyOf = (v: View): string | null =>
  v.phase === 'bidding' && v.current !== null
    ? `${v.round}:${v.roll.id}:${v.current}:${v.bids.length}`
    : null;

interface PeekState {
  key: string | null;
  open(key: string): void;
  close(): void;
}

/** Shared by the HUD (dice overlay) and the Scene (cup tipped up over the bidder's dice). */
export const usePeek = create<PeekState>()((set) => ({
  key: null,
  open: (key) => set({ key }),
  close: () => set({ key: null }),
}));

/** True while the current bidder is peeking at their own dice. */
export function usePeeking(view: View): boolean {
  const key = usePeek((s) => s.key);
  const now = peekKeyOf(view);
  return now !== null && key === now;
}
