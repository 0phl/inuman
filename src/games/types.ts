import type { SessionAction } from '@/core/engine/session';
import type { Player } from '@/core/content/schemas';

/** Props every game Scene (inside the Canvas) and Hud (DOM overlay) receives. */
export interface GameViewProps<V> {
  view: V;
  rules: unknown;
  players: readonly Player[];
  dispatch(action: SessionAction): string | null;
}
