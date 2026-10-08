// Truth/dare prompt decks, shared by Truth or Dare and Spin the Bottle.
import type { PromptItem } from '../../content/schemas';
import type { Rng } from '../../engine/rng';
import type { PlayerId } from '../../engine/types';
import { at } from '../../primitives/turn';

export const KINDS = ['truth', 'dare'] as const;
export type Kind = (typeof KINDS)[number];

export interface TodDecks {
  /** Shuffled at setup and again whenever a kind runs out. Hidden from views. */
  truth: PromptItem[];
  dare: PromptItem[];
  /** Index of the next prompt to draw, per kind. */
  idx: Record<Kind, number>;
}

export interface DrawnPrompt {
  item: PromptItem;
  /** The kind actually drawn. */
  kind: Kind;
  /** The kind that was asked for. Differs from `kind` only when the pool has none of the asked kind. */
  asked: Kind;
  /**
   * Placeholder targets fixed at draw time. `{player}` is whoever has to answer or do it;
   * `{left}`/`{right}` come from `order` around `player`.
   */
  targets: { player: PlayerId; random?: PlayerId };
}

/** Items marked `dare` are dares; everything else (truth, prompt, unmarked) is a question. */
export const kindOf = (item: PromptItem): Kind => (item.kind === 'dare' ? 'dare' : 'truth');

export const otherKind = (kind: Kind): Kind => (kind === 'truth' ? 'dare' : 'truth');

const mentions = (item: PromptItem, placeholder: string): boolean =>
  item.text.includes(placeholder) ||
  Object.values(item.alt ?? {}).some((t) => t?.includes(placeholder));

export function buildDecks(
  prompts: readonly PromptItem[] | undefined,
  maxSpice: number,
  rng: Rng,
): TodDecks {
  const pool = (prompts ?? []).filter((p) => p.spice <= maxSpice);
  return {
    truth: rng.shuffle(pool.filter((p) => kindOf(p) === 'truth')),
    dare: rng.shuffle(pool.filter((p) => kindOf(p) === 'dare')),
    idx: { truth: 0, dare: 0 },
  };
}

/** Kinds with at least one prompt in the pool. */
export const availableKinds = (decks: TodDecks): Kind[] => KINDS.filter((k) => decks[k].length > 0);

/** Pool size per kind (decks reshuffle, so this is what's in rotation, not what's left). */
export const poolOf = (decks: TodDecks): Record<Kind, number> => ({
  truth: decks.truth.length,
  dare: decks.dare.length,
});

/**
 * Draws the next prompt of `asked` (or the other kind when the pool has none of it) for the
 * player at `subject`. A kind that runs out is reshuffled, without repeating the prompt that
 * was just played. Returns a null prompt only when the pool is empty.
 */
export function drawPrompt(
  decks: TodDecks,
  asked: Kind,
  order: readonly PlayerId[],
  subject: number,
  rng: Rng,
): { decks: TodDecks; prompt: DrawnPrompt | null } {
  const kind =
    decks[asked].length > 0 ? asked : decks[otherKind(asked)].length > 0 ? otherKind(asked) : null;
  if (kind === null) return { decks, prompt: null };

  let deck = decks[kind];
  let i = decks.idx[kind];
  if (i >= deck.length) {
    const just = deck[deck.length - 1] as PromptItem;
    deck = rng.shuffle(deck);
    if (deck.length > 1 && (deck[0] as PromptItem).id === just.id) {
      deck = [deck[deck.length - 1] as PromptItem, ...deck.slice(1, -1), deck[0] as PromptItem];
    }
    i = 0;
  }
  const item = deck[i] as PromptItem;

  const targets: DrawnPrompt['targets'] = { player: at(order, subject) };
  if (mentions(item, '{random}')) {
    // Prefer someone other than the player so the prompt makes sense.
    const others = order.length > 1 ? order.filter((_, j) => j !== subject) : order;
    targets.random = rng.pick(others);
  }
  return {
    decks: { ...decks, [kind]: deck, idx: { ...decks.idx, [kind]: i + 1 } },
    prompt: { item, kind, asked, targets },
  };
}
