import type { Family, GameId } from '@/core/engine/types';

export interface CatalogEntry {
  id: GameId;
  family: Family;
}

export const FAMILIES: readonly Family[] = ['cards', 'dice', 'skill', 'party'];

/** Every game in the app, in display order. Titles live at `game.<id>.title` / `game.<id>.desc`. */
export const CATALOG: readonly CatalogEntry[] = [
  { id: 'higher-lower', family: 'cards' },
  { id: 'kings-cup', family: 'cards' },
  { id: 'ride-the-bus', family: 'cards' },
  { id: 'mexico', family: 'dice' },
  { id: 'liars-dice', family: 'dice' },
  { id: 'ship-captain-crew', family: 'dice' },
  { id: 'beer-pong', family: 'skill' },
  { id: 'flip-cup', family: 'skill' },
  { id: 'quarters', family: 'skill' },
  { id: 'spin-the-bottle', family: 'party' },
  { id: 'truth-or-dare', family: 'party' },
  { id: 'never-have-i-ever', family: 'party' },
  { id: 'most-likely-to', family: 'party' },
];

export const isGameId = (id: string | undefined): id is GameId => CATALOG.some((g) => g.id === id);

export const byFamily = (family: Family): CatalogEntry[] => CATALOG.filter((g) => g.family === family);
