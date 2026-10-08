import enMlt from './packs/en/most-likely-to.json';
import enNhie from './packs/en/never-have-i-ever.json';
import enTod from './packs/en/truth-or-dare.json';
import tlMlt from './packs/taglish/most-likely-to.json';
import tlNhie from './packs/taglish/never-have-i-ever.json';
import tlTod from './packs/taglish/truth-or-dare.json';
import { PromptPackSchema, type PackGame, type PromptItem, type PromptPack } from './schemas';

/** Packs that ship with the app, validated at load so a bad edit fails fast (and in tests). */
export const BUILTIN_PACKS: PromptPack[] = [tlNhie, enNhie, tlTod, enTod, tlMlt, enMlt].map((raw) =>
  PromptPackSchema.parse(raw),
);

/**
 * Flattens packs into one prompt list: drops items above `maxSpice` and keeps the first item for
 * each id. Pass `game` to ignore packs made for another game.
 */
export function collectPrompts(
  packs: readonly PromptPack[],
  opts: { maxSpice: number; game?: PackGame },
): PromptItem[] {
  const seen = new Set<string>();
  const out: PromptItem[] = [];
  for (const pack of packs) {
    if (opts.game && pack.game !== opts.game) continue;
    for (const item of pack.items) {
      if (item.spice > opts.maxSpice || seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
  }
  return out;
}
