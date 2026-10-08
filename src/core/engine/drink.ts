import type { Intensity, Player } from '../content/schemas';
import type { DrinkEffect, Msg, PlayerId } from './types';

export const SIPS_PER_TAGAY = 3;

export interface DrinkEntry {
  playerId: PlayerId;
  amount: number;
  unit: 'sip' | 'tagay';
  alcoholic: boolean;
  finish: boolean;
  kind: DrinkEffect['kind'];
  reason: Msg;
}

/**
 * The single place where drink amounts are decided. Games emit base sips;
 * this applies the multiplier, the per-turn cap, the finish rule,
 * non-alcoholic players/mode, and skips anyone sitting out.
 */
export function resolveDrink(
  effect: DrinkEffect,
  intensity: Intensity,
  players: readonly Player[],
): DrinkEntry[] {
  const byId = new Map(players.map((p) => [p.id, p]));
  const seen = new Set<PlayerId>();
  const out: DrinkEntry[] = [];

  for (const id of effect.to) {
    if (seen.has(id)) continue;
    seen.add(id);
    const player = byId.get(id);
    if (!player || player.sittingOut) continue;
    if (effect.amount <= 0 && !effect.finish) continue;

    const alcoholic = intensity.mode === 'alcohol' && !player.nonAlcoholic;
    const finish = Boolean(effect.finish) && intensity.allowFinish && alcoholic;
    // A finish that isn't allowed (or isn't alcoholic) becomes the per-turn cap.
    const raw = effect.finish
      ? intensity.maxSipsPerTurn
      : Math.round(effect.amount * intensity.multiplier);
    const sips = Math.min(Math.max(raw, 1), intensity.maxSipsPerTurn);

    const tagay = alcoholic && intensity.unit === 'tagay';
    out.push({
      playerId: id,
      amount: tagay ? Math.ceil(sips / SIPS_PER_TAGAY) : sips,
      unit: tagay ? 'tagay' : 'sip',
      alcoholic,
      finish,
      kind: effect.kind,
      reason: effect.reason,
    });
  }
  return out;
}
