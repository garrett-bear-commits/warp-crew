import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { name: 'app-server:unit', include: ['test/unit/**/*.test.ts'] },
});
