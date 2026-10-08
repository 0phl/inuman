import { useCallback, useRef, useState } from 'react';
import { simulateThrow } from './loadThrowSim';
import type { ThrowPlayback } from './ThrowReplay';
// Types only: the Rapier chunk is loaded on demand through loadThrowSim().
import type { PresimThrowInput, PresimThrowOutput, ThrowResult } from './throwSim';

/** True for a cup hit / a made coin. */
export const isMade = (r: ThrowResult): boolean => (r.kind === 'ball' ? r.hit !== null : r.made);

export interface ThrowReplayController {
  /** Feed this to <ThrowReplay playback>. */
  playback: ThrowPlayback | null;
  /**
   * Pre-simulates the throw (Rapier, lazily loaded; an analytic arc if that fails), hands it to the
   * replay, and resolves with the simulation once the replay has shown its last frame.
   */
  throwAndReplay(input: PresimThrowInput): Promise<PresimThrowOutput>;
  /** A throw is being simulated or replayed. */
  busy: boolean;
  /** Back to idle (the projectile returns to `idle`). */
  clear(): void;
}

/** State for one <ThrowReplay>: `const t = useThrowReplay(); await t.throwAndReplay({...})`. */
export function useThrowReplay(): ThrowReplayController {
  const [playback, setPlayback] = useState<ThrowPlayback | null>(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const throwAndReplay = useCallback(async (input: PresimThrowInput) => {
    const id = ++seq.current;
    setBusy(true);
    const sim = await simulateThrow(input);
    if (id !== seq.current) return sim; // superseded before it was shown
    return new Promise<PresimThrowOutput>((resolve) => {
      setPlayback({
        id,
        input,
        sim,
        settle: (s) => {
          if (id === seq.current) setBusy(false);
          resolve(s);
        },
      });
    });
  }, []);
  const clear = useCallback(() => {
    seq.current++;
    setBusy(false);
    setPlayback(null);
  }, []);
  return { playback, throwAndReplay, busy, clear };
}
