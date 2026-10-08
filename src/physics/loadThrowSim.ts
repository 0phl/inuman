// The only door to the throw pre-sim chunk (Rapier). Everything else imports throwSim types only,
// so the WASM loads when a skill game first asks for it and never ships with the app shell.
import { fallbackThrow } from './throwMath';
import type { PresimThrowInput, PresimThrowOutput } from './throwSim';

type ThrowSimModule = typeof import('./throwSim');

let mod: Promise<ThrowSimModule> | null = null;

export function loadThrowSim(): Promise<ThrowSimModule> {
  mod ??= import('./throwSim').catch((err: unknown) => {
    mod = null; // let a later throw retry (e.g. a flaky network on first load)
    throw err;
  });
  return mod;
}

/**
 * Start fetching and instantiating Rapier now (e.g. when a skill-game scene mounts), then run one
 * tiny throw so the first real one doesn't pay the JIT warm-up.
 */
export function preloadThrowPhysics(): void {
  loadThrowSim()
    .then((m) =>
      m.presimThrow({
        kind: 'ball',
        origin: [0, 1, 0],
        impulse: [0, 0, 0],
        targets: [],
        seed: 1,
        maxSteps: 20,
      }),
    )
    .catch(() => {
      // A real throw will retry and fall back then.
    });
}

/**
 * Pre-simulates a throw with Rapier (lazily loaded). If the physics can't load, returns an
 * analytic stand-in (no collisions) so the game never stalls.
 */
export async function simulateThrow(input: PresimThrowInput): Promise<PresimThrowOutput> {
  try {
    const m = await loadThrowSim();
    return await m.presimThrow(input);
  } catch (err) {
    console.warn('[throw] physics unavailable; using a plain arc', err);
    return fallbackThrow(input);
  }
}
