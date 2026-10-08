/// <reference types="vite-plugin-pwa/vanillajs" />
import { registerSW } from 'virtual:pwa-register';

/** Precaches the app for offline play; updates apply on the next load (registerType: autoUpdate). */
export function registerPwa(): void {
  if (!('serviceWorker' in navigator)) return;
  registerSW({ immediate: true });
}
