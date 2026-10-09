import mlt from './packs/most-likely-to.json';
import nhie from './packs/never-have-i-ever.json';
import tod from './packs/truth-or-dare.json';
import { PromptPackSchema, type PackGame, type PromptItem, type PromptPack } from './schemas';

/**
 * Packs that ship with the app, validated at load so a bad edit fails fast (and in tests). One
 * bilingual pack per game: `text` is Filipino (Taglish), `alt.en` the English, and the UI shows
 * whichever matches the app language.
 */
export const BUILTIN_PACKS: PromptPack[] = [nhie, tod, mlt].map((raw) =>
  PromptPackSchema.parse(raw),
);

/** The per-language built-in packs these replaced, for lobby picks remembered before the merge. */
export const LEGACY_BUILTIN_IDS: Readonly<Record<string, string>> = {
  'builtin-nhie-taglish': 'builtin-nhie',
  'builtin-nhie-en': 'builtin-nhie',
  'builtin-tod-taglish': 'builtin-tod',
  'builtin-tod-en': 'builtin-tod',
  'builtin-mlt-taglish': 'builtin-mlt',
  'builtin-mlt-en': 'builtin-mlt',
};

/** Every prompt carries a translation, so the pack reads in either app language. */
export const isBilingual = (pack: PromptPack): boolean =>
  pack.items.length > 0 && pack.items.every((i) => Object.values(i.alt ?? {}).some(Boolean));

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
