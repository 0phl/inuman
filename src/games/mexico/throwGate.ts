import { useEffect, useState } from 'react';
import { reducedMotion } from './dice3d';

interface GateState {
  /** Roll id handed to DiceReplay (it throws when this changes). */
  shown: number;
  /** A new roll waiting for the cup to finish its shake, or null. */
  leading: number | null;
  /** Bumped every time a lead-in starts, so the cup knows to animate. */
  cue: number;
  /** Rolls that were already settled when first seen: shown at rest, never re-reported. */
  restIds: number[];
}

export interface ThrowGate {
  rollId: number;
  /** True while the cup shakes: hide the previous dice (they're back in the cup). */
  leading: boolean;
  cue: number;
  /** Pass to DiceReplay `instant`: true for settled rolls (resume), else the reduced-motion default. */
  instant: true | undefined;
}

/**
 * Sequences a public roll for the scene: a fresh, unsettled roll first waits `leadMs` for the cup's
 * scoop-and-shake, then goes to DiceReplay. Rolls that were settled before the scene saw them (a
 * reload, coming back from Settings) land instantly. Reduced motion skips the lead-in.
 */
export function useThrowGate(
  roll: { id: number; settled: boolean } | null,
  leadMs: number,
): ThrowGate {
  const id = roll?.id ?? 0;
  const settled = roll ? roll.settled : true;
  const [state, setState] = useState<GateState>(() => ({
    shown: id,
    leading: null,
    cue: 0,
    restIds: settled ? [id] : [],
  }));

  let s = state;
  if (id !== s.shown && id !== s.leading) {
    // Adjusting state while rendering (React's "store info from previous renders" pattern).
    const lead = !settled && id !== 0 && leadMs > 0 && !reducedMotion();
    s = lead
      ? { ...s, leading: id, cue: s.cue + 1 }
      : {
          ...s,
          shown: id,
          leading: null,
          restIds: settled ? [...s.restIds.slice(-4), id] : s.restIds,
        };
    setState(s);
  }

  useEffect(() => {
    const target = state.leading;
    if (target === null) return;
    const t = window.setTimeout(
      () => setState((p) => (p.leading === target ? { ...p, shown: target, leading: null } : p)),
      leadMs,
    );
    return () => window.clearTimeout(t);
  }, [state.leading, leadMs]);

  return {
    rollId: s.shown,
    leading: s.leading !== null,
    cue: s.cue,
    instant: s.restIds.includes(s.shown) ? true : undefined,
  };
}
