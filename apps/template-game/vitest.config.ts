import { defineConfig } from 'vitest/config';

// `template:unit`: engine property tests, the v1 engine conformance kit, save corpus round-trips
// and codec fuzz (§9). Browser acceptance lives in Playwright (`pnpm test:e2e`), not here.
export default defineConfig({
  test: {
    name: 'template:unit',
    environment: 'happy-dom',
    include: ['test/unit/**/*.test.ts', 'test/unit/**/*.test.tsx'],
  },
});
