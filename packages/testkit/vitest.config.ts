import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { name: 'testkit:unit', include: ['test/**/*.test.ts', 'src/**/*.test.ts'] },
});
