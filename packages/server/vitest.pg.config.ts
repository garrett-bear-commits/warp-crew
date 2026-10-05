import { defineConfig } from 'vitest/config';
// Real-Postgres integration project (ADR-025). `pnpm test:pg` or `vitest run -c vitest.pg.config.ts`.
export default defineConfig({
  test: {
    name: 'server:pg',
    include: ['test/pg/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: true,
  },
});
