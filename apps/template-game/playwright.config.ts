import { defineConfig, devices } from '@playwright/test';
import { E2E_API_PORT, E2E_GAME_PORT, E2E_HOST_PORT, E2E_JEST_GAME_PORT } from './e2e/const.ts';

// Real-browser acceptance (§9): Chromium + WebKit (mobile emulation), the template game built and
// served by `vite preview` (4173), the API on 8090 (fresh Postgres, GAME_ENV=lab), and a
// jest.com-shaped host harness on 4174 for the cross-site iframe path. `pnpm test:e2e` builds the
// game with VITE_API_URL=http://127.0.0.1:8090 first (see package.json). Specs use fresh player ids
// so they are independent; workers=1 keeps the shared lab API state simple.
export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.ts/,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: `http://localhost:${E2E_GAME_PORT}`, trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['iPhone 13'] } },
  ],
  webServer: [
    {
      command: 'node --experimental-strip-types e2e/server.ts',
      url: `http://127.0.0.1:${E2E_API_PORT}/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { E2E_API_PORT: String(E2E_API_PORT) },
    },
    {
      command: 'node --experimental-strip-types e2e/host/serve.ts',
      url: `http://127.0.0.1:${E2E_HOST_PORT}/`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: { E2E_HOST_PORT: String(E2E_HOST_PORT) },
    },
    {
      command: `pnpm exec vite preview --port ${E2E_GAME_PORT} --strictPort`,
      url: `http://localhost:${E2E_GAME_PORT}/`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      // Local/mock evidence only: serve the source through a second Vite origin so the spec can
      // select ?platform=jest without changing the normal mock acceptance build.
      command: `VITE_API_URL=http://127.0.0.1:${E2E_API_PORT} VITE_ALLOW_QA_QUERY=true pnpm exec vite --host 127.0.0.1 --port ${E2E_JEST_GAME_PORT} --strictPort`,
      url: `http://127.0.0.1:${E2E_JEST_GAME_PORT}/`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
