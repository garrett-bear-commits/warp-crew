import { defineConfig } from 'vitest/config';

// Two projects: `unit` (pure + DOM tests under happy-dom) and `model` (fast-check model-based
// runs over the sync client + ratchet + generations against a server-truth model, §9 — never
// deferrable). `vitest run --project unit|model` selects one; plain `vitest run` runs both.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'happy-dom',
          include: [
            'src/**/*.test.ts',
            'src/**/*.test.tsx',
            'test/unit/**/*.test.ts',
            'test/unit/**/*.test.tsx',
          ],
        },
      },
      {
        test: {
          name: 'model',
          environment: 'node',
          include: ['test/model/**/*.test.ts'],
          testTimeout: 120_000,
        },
      },
    ],
  },
});
