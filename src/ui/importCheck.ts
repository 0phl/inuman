import type { PromptPack, Theme } from '@/core/content/schemas';
import type { GameId } from '@/core/engine/types';
import { getLogic, hasLogic } from '@/core/games/registry';
import type { SharePayload } from '@/core/share/codec';
import { isGameId } from '@/games/catalog';
import { normalizeTheme } from '@/store/theme';

type Checked =
  | { kind: 'pack'; pack: PromptPack }
  | { kind: 'rules'; gameId: GameId; rules: unknown; name: string }
  | { kind: 'theme'; theme: Theme; name: string }
  | { kind: 'error'; error: string };

/**
 * Second line of defence after the codec: rules must belong to a game this app can play, and a
 * theme's room / card back / dice ids this version doesn't know fall back to the defaults.
 */
export function checkPayload(payload: SharePayload): Checked {
  if (payload.kind === 'pack') return { kind: 'pack', pack: payload };
  if (payload.kind === 'theme')
    return { kind: 'theme', theme: normalizeTheme(payload.theme), name: payload.name };
  const id = payload.gameId;
  if (!isGameId(id) || !hasLogic(id)) return { kind: 'error', error: 'import.unknownGame' };
  const parsed = getLogic(id).rulesSchema.safeParse(payload.rules);
  if (!parsed.success) return { kind: 'error', error: 'share.invalid' };
  return { kind: 'rules', gameId: id, rules: parsed.data, name: payload.name };
}
