import { useSettings } from '@/store/settings';
import { useTheme } from '@/store/theme';
import { detectTier } from './detectTier';
import { preloadDiveBar } from './environments/diveBarAssets';

let started = false;

/**
 * Called while the Lobby is open: resolves the quality tier (running GPU detection early if it has
 * never run) and starts downloading the matching bar GLB, so /play opens on the finished room
 * instead of the procedural stand-in.
 */
export async function preloadStage(): Promise<void> {
  if (started) return;
  started = true;
  const settings = useSettings.getState();
  let tier = settings.quality === 'auto' ? settings.detectedTier : settings.quality;
  if (!tier) {
    tier = await detectTier();
    if (useSettings.getState().detectedTier === null) useSettings.getState().setDetectedTier(tier);
  }
  if (useTheme.getState().theme.environmentId !== 'procedural-bar') preloadDiveBar(tier);
}
