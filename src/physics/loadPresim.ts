// The only door to the dice pre-sim: everything else imports presim types only. It runs in the
// physics worker (Rapier's ~2 MB of WASM loads there, on first use); see physicsWorker.ts.
import { presimulateDice } from './physicsWorker';

const presim = { presimulateThrow: presimulateDice };

export function loadPresim(): Promise<typeof presim> {
  return Promise.resolve(presim);
}

/**
 * Start fetching and instantiating Rapier now (e.g. when a dice game scene mounts), then run one
 * tiny throw so the first real roll doesn't pay the JIT warm-up (~100 ms cold, ~3 ms warm).
 */
export function preloadDicePhysics(): void {
  loadPresim()
    .then((m) => m.presimulateThrow({ count: 2, throwSeed: 1, maxSteps: 30 }))
    .catch(() => {
      // A real roll will retry and surface the error then.
    });
}
