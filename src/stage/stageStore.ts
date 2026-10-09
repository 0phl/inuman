import { create } from 'zustand';
import type { GameId } from '@/core/engine/types';
import { useSettings, type Tier } from '@/store/settings';

/** The on-device benchmark (/bench). It shows the stage, in production builds too. */
export const BENCH_PATH = '/bench';

/**
 * Routes that show the 3D stage: /play and /bench, plus the dev benches (/dev/*) in dev builds
 * only (in a production build `import.meta.env.DEV` is false and the dev routes don't exist).
 */
export const isStageRoute = (pathname: string): boolean =>
  pathname === '/play' ||
  pathname === BENCH_PATH ||
  (import.meta.env.DEV && pathname.startsWith('/dev/'));

/**
 * What /bench asks of the stage while it runs. Never persisted: the user's quality setting and
 * detected tier are left alone, and the bench's tier only lasts while it is set.
 */
export interface BenchControl {
  /** Tier to render at instead of the settings' one (null: the settings' tier). */
  tier: Tier | null;
  /** Render every frame (frame-time measurement) instead of on demand. */
  keepRendering: boolean;
}

/** A game whose shared props (cards, dice, cups…) the stage keeps compiled, hidden, in the Canvas. */
export interface WarmRequest {
  gameId: GameId;
  nonce: number;
}

interface StageState {
  /** Set once the player first reaches a stage route (or the Lobby); the Canvas stays mounted afterwards. */
  wanted: boolean;
  want(): void;
  bench: BenchControl | null;
  setBench(bench: BenchControl | null): void;
  /** Bumped every time the scene gate shows a newly mounted game scene (see warm/SceneGate). */
  revealed: number;
  /** A game scene is mounted and shown (StageHost mirrors it as data-scene="ready" for tests). */
  sceneReady: boolean;
  markRevealed(): void;
  setSceneReady(ready: boolean): void;
  warm: WarmRequest | null;
  /** The last warm request whose props are compiled and uploaded. */
  warmedNonce: number;
  setWarm(warm: WarmRequest): void;
  markWarmed(nonce: number): void;
}

export const useStage = create<StageState>()((set) => ({
  wanted: false,
  want: () => set((s) => (s.wanted ? s : { wanted: true })),
  bench: null,
  setBench: (bench) => set({ bench }),
  revealed: 0,
  sceneReady: false,
  markRevealed: () => set((s) => ({ revealed: s.revealed + 1, sceneReady: true })),
  setSceneReady: (sceneReady) => set((s) => (s.sceneReady === sceneReady ? s : { sceneReady })),
  warm: null,
  warmedNonce: 0,
  setWarm: (warm) => set({ warm }),
  markWarmed: (nonce) => set((s) => ({ warmedNonce: Math.max(s.warmedNonce, nonce) })),
}));

export const TIER_ORDER: readonly Tier[] = ['low', 'mid', 'high'];

export const TIER_SPEC: Record<
  Tier,
  { dpr: number; msaa: boolean; contactShadows: boolean; glass: boolean }
> = {
  low: { dpr: 1, msaa: false, contactShadows: false, glass: false },
  mid: { dpr: 1.5, msaa: false, contactShadows: true, glass: false },
  high: { dpr: 2, msaa: true, contactShadows: true, glass: true },
};

/** The tier in effect: the bench's override, else a manual choice, else the detected/stepped-down tier. */
export function useTier(): Tier | null {
  const override = useStage((s) => s.bench?.tier ?? null);
  const setting = useSettings((s) => (s.quality === 'auto' ? s.detectedTier : s.quality));
  return override ?? setting;
}

/** Non-hook read of the tier in effect (same rule as useTier). */
export function currentTier(): Tier | null {
  const override = useStage.getState().bench?.tier ?? null;
  const s = useSettings.getState();
  return override ?? (s.quality === 'auto' ? s.detectedTier : s.quality);
}

/**
 * The MSAA the Canvas should be created with. MSAA is a context-creation flag, so changing it means
 * a new Canvas (and a remounted game scene). It is fixed when the Canvas is first made and only
 * follows the tier while `canSwitch` (no game on screen, or /bench).
 */
export function latchMsaa(current: boolean | null, wanted: boolean, canSwitch: boolean): boolean {
  return current === null || canSwitch ? wanted : current;
}

export const lowerTier = (t: Tier): Tier =>
  TIER_ORDER[Math.max(0, TIER_ORDER.indexOf(t) - 1)] as Tier;
