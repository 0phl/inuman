import type { Rng } from '../engine/rng';

/** A card is 0..51: suit = floor(card / 13), rank = card % 13 + 2 (2..14, where 14 is the ace). */
export type Card = number;

export const SUITS = ['S', 'H', 'D', 'C'] as const;
export type Suit = (typeof SUITS)[number];

export const RANK_KEYS = [
  'A',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  'J',
  'Q',
  'K',
] as const;
export type RankKey = (typeof RANK_KEYS)[number];

export const rankOf = (card: Card): number => (card % 13) + 2;
export const suitOf = (card: Card): Suit => SUITS[Math.floor(card / 13)] as Suit;
export const isRed = (card: Card): boolean => suitOf(card) === 'H' || suitOf(card) === 'D';

export function rankKey(card: Card): RankKey {
  const r = rankOf(card);
  if (r === 14) return 'A';
  if (r === 11) return 'J';
  if (r === 12) return 'Q';
  if (r === 13) return 'K';
  return String(r) as RankKey;
}

/** Comparable value; aces are 14 when high, 1 when low. */
export const cardValue = (card: Card, aceHigh: boolean): number => {
  const r = rankOf(card);
  return r === 14 && !aceHigh ? 1 : r;
};

export const newDeck = (): Card[] => Array.from({ length: 52 }, (_, i) => i);

export const shuffledDeck = (rng: Rng): Card[] => rng.shuffle(newDeck());
