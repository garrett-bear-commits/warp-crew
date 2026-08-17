import { defineConfig } from 'vitest/config';

// `client:unit`: pure + DOM tests under happy-dom. The model-based project (§9, never deferrable)
// lives in vitest.model.config.ts so the root runner can select it with `--project '*:model'`.
export default defineConfig({
  test: {
    name: 'client:unit',
    environment: 'happy-dom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'test/unit/**/*.test.ts', 'test/unit/**/*.test.tsx'],
  },
});
