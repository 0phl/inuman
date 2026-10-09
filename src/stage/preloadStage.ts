import { useSettings } from '@/store/settings';
import { useTheme } from '@/store/theme';
import { detectTier } from './detectTier';
import { preloadDiveBar } from './environments/diveBarAssets';

let started: Promise<void> | null = null;

/**
 * Called while the Lobby is open: resolves the quality tier (running GPU detection early if it has
 * never run) and downloads + decodes the matching bar GLB, so /play opens on the finished room
 * instead of the procedural stand-in. Resolves once the room is ready (a failed download resolves
 * too: the stage then falls back to the procedural bar, as it always has).
 */
export function preloadStage(): Promise<void> {
  started ??= (async () => {
    const settings = useSettings.getState();
    let tier = settings.quality === 'auto' ? settings.detectedTier : settings.quality;
    if (!tier) {
      tier = await detectTier();
      if (useSettings.getState().detectedTier === null)
        useSettings.getState().setDetectedTier(tier);
    }
    if (useTheme.getState().theme.environmentId !== 'procedural-bar') {
      await preloadDiveBar(tier).catch((e: unknown) =>
        console.warn('[stage] bar preload failed:', e),
      );
    }
  })();
  return started;
}
