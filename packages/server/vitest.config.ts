import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    name: 'server:unit',
    include: ['src/**/*.test.ts', 'test/unit/**/*.test.ts'],
  },
});
