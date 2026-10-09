// The only door to the throw pre-sim: everything else imports throwSim types only. It runs in the
// physics worker (Rapier's ~2 MB of WASM loads there, on first use); see physicsWorker.ts.
import { presimulateThrowInWorker } from './physicsWorker';
import { fallbackThrow } from './throwMath';
import type { PresimThrowInput, PresimThrowOutput } from './throwSim';

const throwSim = { presimThrow: presimulateThrowInWorker };

export function loadThrowSim(): Promise<typeof throwSim> {
  return Promise.resolve(throwSim);
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
