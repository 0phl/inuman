// The only door to the Rapier chunk: everything else imports presim types only, so the ~2 MB
// WASM loads when a dice scene first asks for it and never ships with the app shell.

type PresimModule = typeof import('./presim');

let mod: Promise<PresimModule> | null = null;

export function loadPresim(): Promise<PresimModule> {
  mod ??= import('./presim').catch((err: unknown) => {
    mod = null; // let a later roll retry (e.g. a flaky network on first load)
    throw err;
  });
  return mod;
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
