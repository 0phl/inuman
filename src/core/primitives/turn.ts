import type { Player } from '../content/schemas';
import type { PlayerId } from '../engine/types';

export const nextIndex = (i: number, n: number): number => (n === 0 ? 0 : (i + 1) % n);
export const prevIndex = (i: number, n: number): number => (n === 0 ? 0 : (i - 1 + n) % n);

/** Seat order for a new game: everyone not sitting out, in roster order. */
export const seatOrder = (players: readonly Player[]): PlayerId[] =>
  players.filter((p) => !p.sittingOut).map((p) => p.id);

export const at = (order: readonly PlayerId[], i: number): PlayerId => {
  const id = order[i];
  if (id === undefined) throw new Error(`no seat at index ${i}`);
  return id;
};

/** Seat convention shared by every game and the UI: play passes to the left, so left = next seat. */
export const leftOf = (order: readonly PlayerId[], i: number): PlayerId =>
  at(order, nextIndex(i, order.length));
export const rightOf = (order: readonly PlayerId[], i: number): PlayerId =>
  at(order, prevIndex(i, order.length));
