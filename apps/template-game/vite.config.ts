// Template game build (ADR-010 URL-hosted, auto-updating client): hashed immutable assets, a
// no-cache index.html served by the static host, no source maps in the bundle, `.ts` imports
// straight from the workspace packages (Vite strips types). VITE_API_URL / VITE_BUILD_VERSION are
// plus the Jest platform/login/notification settings are build-time inputs (see src/config.ts).
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  base: './',
  plugins: [react()],
  build: {
    outDir: resolve(here, 'dist'),
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    modulePreload: { polyfill: false },
    assetsInlineLimit: 0,
    rollupOptions: { input: resolve(here, 'index.html') },
  },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
});
