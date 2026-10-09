import { useSyncExternalStore } from 'react';
import { loadManifest, manifestNow, subscribeManifest, type AudioManifest } from './manifest';

/** The audio manifest (null while loading or when it's missing), for credits and track titles. */
export function useAudioManifest(): AudioManifest | null {
  return useSyncExternalStore(
    (cb) => {
      void loadManifest();
      return subscribeManifest(cb);
    },
    () => manifestNow() ?? null,
    () => null,
  );
}
