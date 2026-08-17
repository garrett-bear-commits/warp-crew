import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    name: 'app-server:pg',
    include: ['test/pg/**/*.test.ts'],
    testTimeout: 90_000,
    hookTimeout: 120_000,
  },
});
