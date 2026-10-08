import { Suspense, useDeferredValue } from 'react';
import type { Tier } from '@/store/settings';
import { useTheme } from '@/store/theme';
import { DiveBar } from './DiveBar';
import { DiveBarBaked } from './DiveBarBaked';
import { EnvFallback } from './EnvFallback';

/**
 * Picks the room from `theme.environmentId`:
 * - 'dive-bar' (default, and any unknown id): the baked Blender bar. The procedural bar is drawn
 *   while the GLB downloads (so the first frame is never blank) and replaces it for the session if
 *   the download fails.
 * - 'procedural-bar': the original procedural bar, no downloads.
 */
export function StageEnvironment({ tier }: { tier: Tier }) {
  const id = useTheme((s) => s.theme.environmentId);
  // A runtime tier step-down swaps GLB variants; keep showing the current room until the new one is ready.
  const bakedTier = useDeferredValue(tier);
  if (id === 'procedural-bar') return <DiveBar tier={tier} />;
  return (
    <EnvFallback fallback={<DiveBar tier={tier} />} label="baked dive bar">
      <Suspense fallback={<DiveBar tier={tier} />}>
        <DiveBarBaked tier={bakedTier} />
      </Suspense>
    </EnvFallback>
  );
}
