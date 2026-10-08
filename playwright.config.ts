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
