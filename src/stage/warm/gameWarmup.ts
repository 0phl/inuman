import type { GameId } from '@/core/engine/types';
import { loadPresim } from '@/physics/loadPresim';
import { loadThrowSim } from '@/physics/loadThrowSim';
import { useStage } from '../stageStore';
import { DICE_PHYSICS, THROW_PHYSICS } from './kinds';

// Everything a game screen needs that can be done before Start: its Scene and Hud chunks, Rapier
// for the physics games (2 MB of WASM to compile, otherwise paid on the first roll or throw), and
// the shared props' shaders and textures (PropWarmup, in the Canvas).

const SCENES = import.meta.glob('/src/games/*/Scene.tsx');
const HUDS = import.meta.glob('/src/games/*/Hud.tsx');

let nonce = 0;

const warmDicePhysics = () =>
  loadPresim().then((m) => m.presimulateThrow({ count: 2, throwSeed: 1, maxSteps: 30 }));
const warmThrowPhysics = () =>
  loadThrowSim().then((m) =>
    m.presimThrow({
      kind: 'ball',
      origin: [0, 1, 0],
      impulse: [0, 0, 0],
      targets: [],
      seed: 1,
      maxSteps: 20,
    }),
  );

/** Dice games paint their cup and tray textures on first use: done here instead. */
const DICE_LOOKS: ReadonlySet<GameId> = new Set<GameId>([
  'mexico',
  'liars-dice',
  'ship-captain-crew',
]);
const warmDiceLooks = () => import('@/games/mexico/diceCup').then((m) => m.prepareDiceLooks());

export const isWarmableGame = (id: string): id is GameId => `/src/games/${id}/Scene.tsx` in SCENES;

/** Loads the game screen's code (Scene + Hud chunks) and its physics. Never rejects. */
export async function preloadGameCode(id: GameId): Promise<void> {
  const jobs: Promise<unknown>[] = [
    SCENES[`/src/games/${id}/Scene.tsx`]?.() ?? Promise.resolve(),
    HUDS[`/src/games/${id}/Hud.tsx`]?.() ?? Promise.resolve(),
  ];
  if (DICE_PHYSICS.has(id)) jobs.push(warmDicePhysics());
  if (DICE_LOOKS.has(id)) jobs.push(warmDiceLooks());
  if (THROW_PHYSICS.has(id)) jobs.push(warmThrowPhysics());
  await Promise.allSettled(jobs);
}

/**
 * Asks the mounted stage to compile and upload this game's shared props. Resolves once done (or
 * after `timeoutMs`, e.g. when no stage is mounted).
 */
export function warmGameProps(id: GameId, timeoutMs = 15_000): Promise<boolean> {
  const n = ++nonce;
  useStage.getState().setWarm({ gameId: id, nonce: n });
  return new Promise((resolve) => {
    let timer = 0;
    const done = (ok: boolean) => {
      unsub();
      window.clearTimeout(timer);
      resolve(ok);
    };
    const unsub = useStage.subscribe((s) => {
      if (s.warmedNonce >= n) done(true);
    });
    timer = window.setTimeout(() => done(false), timeoutMs);
    if (useStage.getState().warmedNonce >= n) done(true);
  });
}

/** The Lobby's (and the bench's) warm-up for a game: code, physics, then props. */
export async function warmGame(id: GameId): Promise<void> {
  await preloadGameCode(id);
  await warmGameProps(id);
}
