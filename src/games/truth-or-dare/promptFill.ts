import type { PlayerId } from '@/core/engine/types';
import type { PromptItem } from '@/core/content/schemas';
import { leftOf, rightOf } from '@/core/primitives/turn';

export type Slot = 'player' | 'random' | 'left' | 'right';

/**
 * Names for a prompt's placeholders: `{player}` is the subject, `{left}`/`{right}` sit next to
 * them in `order`, `{random}` was fixed by the reducer when the prompt was drawn.
 */
export function promptFills(
  order: readonly PlayerId[],
  subject: PlayerId | null | undefined,
  random: PlayerId | null | undefined,
  nameOf: (id: PlayerId) => string,
): Record<Slot, string> {
  const i = subject ? order.indexOf(subject) : -1;
  const near = i >= 0 && order.length > 0;
  return {
    player: subject ? nameOf(subject) : '?',
    random: random ? nameOf(random) : '?',
    left: near ? nameOf(leftOf(order, i)) : '?',
    right: near ? nameOf(rightOf(order, i)) : '?',
  };
}

/** The prompt in the UI language when the pack has a translation, else as written. */
export const promptText = (item: PromptItem, locale: string): string =>
  item.alt?.[locale as keyof NonNullable<PromptItem['alt']>] ?? item.text;
