import { useSession } from '@/store/session';

// SETTLED is reported once per spin: by the scene when the animation lands, or by the HUD's
// fallback timer if the scene never got to run (e.g. a lost WebGL context). Keyed by game start,
// so a spin id that repeats in the next game still gets through.

const sent = new Set<string>();

/** Calls `send` the first time it sees this spin of this game; later calls do nothing. */
export function settleOnce(tag: string, id: number, send: () => void): void {
  const key = `${useSession.getState().startedAt}:${tag}:${id}`;
  if (sent.has(key)) return;
  sent.add(key);
  if (sent.size > 64) sent.delete(sent.values().next().value as string);
  send();
}

/** The scene's spin time plus a margin: the HUD settles the spin itself after this long. */
export const SETTLE_FALLBACK_MS = 7500;
