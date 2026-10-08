import { beats } from '@/core/games/liars-dice/logic';
import type { Face } from '@/core/primitives/dice';

// The bid composer's rules: what the quantity stepper and face picker allow, so a player can never
// put together a bid the reducer would reject as too low (`beats`) or too many (`totalDice`).

export interface BidDraft {
  quantity: number;
  face: Face;
}

export const FACES: readonly Face[] = [1, 2, 3, 4, 5, 6];

/** Fewest dice that still beat `last` on `face` (1 when there's no bid yet). */
export const minQuantity = (last: BidDraft | null, face: Face): number =>
  last ? (face > last.face ? last.quantity : last.quantity + 1) : 1;

/** Faces that have at least one legal quantity on a table of `total` dice. */
export const legalFaces = (last: BidDraft | null, total: number): Face[] =>
  FACES.filter((f) => minQuantity(last, f) <= total);

/** Whether the reducer would accept this bid. */
export const isLegalBid = (bid: BidDraft, last: BidDraft | null, total: number): boolean =>
  bid.quantity >= 1 && bid.quantity <= total && (!last || beats(bid, last));

/**
 * What the composer starts on: the smallest raise (skipping 1s when they're wild), or a modest
 * opening of about a quarter of the table on 2s. Can be illegal only when no raise exists at all.
 */
export function suggestBid(last: BidDraft | null, total: number, onesWild: boolean): BidDraft {
  if (!last) return { quantity: Math.max(1, Math.min(total, Math.floor(total / 4))), face: 2 };
  if (last.face < 6) return { quantity: last.quantity, face: (last.face + 1) as Face };
  return { quantity: Math.min(total, last.quantity + 1), face: onesWild ? 2 : 1 };
}

/** Pulls a draft back into the legal range for its face: never below the minimum raise. */
export const clampDraft = (d: BidDraft, last: BidDraft | null, total: number): BidDraft => ({
  face: d.face,
  quantity: Math.min(total, Math.max(minQuantity(last, d.face), d.quantity)),
});
