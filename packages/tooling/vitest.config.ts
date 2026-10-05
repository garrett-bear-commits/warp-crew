import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { name: 'tooling:unit', include: ['test/**/*.test.ts'] } });
