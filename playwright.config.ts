import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  // 3D scenes under SwiftShader are CPU-heavy; more workers make timing-based assertions flaky.
  workers: 2,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    // The app starts on High graphics; under SwiftShader that only makes every test slower and
    // flakier, so tests start on Low (what Auto used to detect here). defaults.spec.ts checks the
    // real first-run defaults (graphics, install banner) with empty storage.
    storageState: {
      cookies: [],
      origins: [
        {
          origin: 'http://localhost:4173',
          localStorage: [
            { name: 'inuman.settings', value: '{"state":{"quality":"low"},"version":3}' },
            // The floating install banner would sit over bottom buttons other tests tap.
            { name: 'inuman.installDismissed', value: '1' },
          ],
        },
      ],
    },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'android', use: { ...devices['Pixel 7'] } },
    { name: 'iphone', use: { ...devices['iPhone 14'] } },
  ],
  webServer: {
    command: 'pnpm build && pnpm preview --port 4173 --strictPort',
    port: 4173,
    reuseExistingServer: true,
    timeout: 240_000,
  },
});
