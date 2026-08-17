import { defineConfig, devices } from '@playwright/test';

// Real-browser acceptance (§9): Chromium + WebKit (mobile emulation), the template game built and
// served by `vite preview` (4173), the API on 8090 (fresh Postgres, GAME_ENV=lab), and a
// jest.com-shaped host harness on 4174 for the cross-site iframe path.
export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.ts/,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://localhost:4173', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['iPhone 13'] } },
  ],
  webServer: [
    {
      command: 'node --experimental-strip-types e2e/server.ts',
      url: 'http://127.0.0.1:8090/health',
      reuseExistingServer: false,
      timeout: 120_000,
      env: { E2E_API_PORT: '8090' },
    },
    {
      command: 'node --experimental-strip-types e2e/host/serve.ts',
      url: 'http://127.0.0.1:4174/',
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: 'pnpm exec vite preview --port 4173 --strictPort',
      url: 'http://localhost:4173/',
      reuseExistingServer: false,
      timeout: 60_000,
      env: { VITE_API_URL: 'http://127.0.0.1:8090' },
    },
  ],
});
