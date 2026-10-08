import { create } from 'zustand';
import { useSettings, type Tier } from '@/store/settings';

interface StageState {
  /** Set once the player first reaches /play; the Canvas stays mounted afterwards. */
  wanted: boolean;
  want(): void;
}

export const useStage = create<StageState>()((set) => ({
  wanted: false,
  want: () => set({ wanted: true }),
}));

export const TIER_ORDER: readonly Tier[] = ['low', 'mid', 'high'];

export const TIER_SPEC: Record<Tier, { dpr: number; msaa: boolean; contactShadows: boolean; glass: boolean }> = {
  low: { dpr: 1, msaa: false, contactShadows: false, glass: false },
  mid: { dpr: 1.5, msaa: false, contactShadows: true, glass: false },
  high: { dpr: 2, msaa: true, contactShadows: true, glass: true },
};

/** The tier in effect: a manual choice wins, else the detected/stepped-down tier. */
export function useTier(): Tier | null {
  return useSettings((s) => (s.quality === 'auto' ? s.detectedTier : s.quality));
}

export const lowerTier = (t: Tier): Tier => TIER_ORDER[Math.max(0, TIER_ORDER.indexOf(t) - 1)] as Tier;
