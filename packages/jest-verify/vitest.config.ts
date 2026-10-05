import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { name: 'jest-verify:unit', include: ['test/**/*.test.ts', 'src/**/*.test.ts'] },
});
