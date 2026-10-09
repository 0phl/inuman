import { describe, expect, it } from 'vitest';
import { detectPlatform, selectBannerVisible, useInstall } from './install';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPAD_DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const PIXEL =
  'Mozilla/5.0 (Linux; Android 15; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36';
const WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

describe('detectPlatform', () => {
  it('tells iPhone / iPad, Android and desktop apart', () => {
    expect(detectPlatform(IPHONE, 5)).toBe('ios');
    // iPadOS asks for the desktop site: a Mac UA, but with a touch screen.
    expect(detectPlatform(IPAD_DESKTOP_UA, 5)).toBe('ios');
    expect(detectPlatform(IPAD_DESKTOP_UA, 0)).toBe('desktop');
    expect(detectPlatform(PIXEL, 5)).toBe('android');
    expect(detectPlatform(WINDOWS, 0)).toBe('desktop');
  });
});

describe('selectBannerVisible', () => {
  const base = { ...useInstall.getState(), installed: false, dismissed: false, promptEvent: null };

  it('shows on phones until installed or closed', () => {
    expect(selectBannerVisible({ ...base, platform: 'android' })).toBe(true);
    expect(selectBannerVisible({ ...base, platform: 'ios' })).toBe(true);
    expect(selectBannerVisible({ ...base, platform: 'ios', installed: true })).toBe(false);
    expect(selectBannerVisible({ ...base, platform: 'android', dismissed: true })).toBe(false);
  });

  it('shows on desktop only when the browser can install', () => {
    expect(selectBannerVisible({ ...base, platform: 'desktop' })).toBe(false);
    const prompt = new Event('beforeinstallprompt') as never;
    expect(selectBannerVisible({ ...base, platform: 'desktop', promptEvent: prompt })).toBe(true);
  });
});
