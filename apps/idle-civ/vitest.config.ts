import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    name: 'idle-civ:unit',
    environment: 'happy-dom',
    include: ['test/unit/**/*.test.ts', 'test/unit/**/*.test.tsx'],
    setupFiles: ['./test/setup.ts'],
  },
});
