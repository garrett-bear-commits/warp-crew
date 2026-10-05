import { defineConfig } from 'vitest/config';

// Root runner: `pnpm test:unit|contract|pg|model|browser` select projects by name;
// each package's vitest.config.ts sets `test.name` to one of these.
export default defineConfig({
  test: {
    projects: [
      'packages/*/vitest.config.ts',
      'packages/*/vitest.pg.config.ts',
      'packages/*/vitest.model.config.ts',
      'apps/*/vitest.config.ts',
      'apps/*/vitest.pg.config.ts',
    ],
  },
});
