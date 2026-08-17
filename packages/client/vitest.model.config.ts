import { defineConfig } from 'vitest/config';

// `client:model`: fast-check model-based runs over the sync client + ratchet + generations against a
// server-truth model (§9 — never deferrable). `pnpm test:model` from the root, or
// `vitest run -c vitest.model.config.ts` here.
export default defineConfig({
  test: { name: 'client:model', environment: 'node', include: ['test/model/**/*.test.ts'], testTimeout: 120_000 },
});
