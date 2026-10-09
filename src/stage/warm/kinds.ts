import type { GameId } from '@/core/engine/types';

/** Shared prop families a game draws (src/three); the Lobby warms these before Start. */
export type PropKind = 'cards' | 'dice' | 'cups' | 'coin';

const KINDS: Partial<Record<GameId, readonly PropKind[]>> = {
  'higher-lower': ['cards'],
  'kings-cup': ['cards'],
  'ride-the-bus': ['cards'],
  mexico: ['dice'],
  'ship-captain-crew': ['dice'],
  'liars-dice': ['dice'],
  'beer-pong': ['cups'],
  'flip-cup': ['cups'],
  quarters: ['coin'],
};

export const propKindsFor = (id: GameId): ReadonlySet<PropKind> => new Set(KINDS[id] ?? []);

/** Games whose first roll / throw needs Rapier (loaded and JIT-warmed from the Lobby). */
export const DICE_PHYSICS: ReadonlySet<GameId> = new Set<GameId>(['mexico', 'ship-captain-crew']);
export const THROW_PHYSICS: ReadonlySet<GameId> = new Set<GameId>(['beer-pong', 'quarters']);
