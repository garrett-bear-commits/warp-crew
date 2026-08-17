// Admin inspector build (ADR-021): static page, hashed immutable assets, relative URLs so the
// dist folder can be served from any path on the admin origin. No inline scripts/styles (CSP).
import { defineConfig } from 'vite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  base: './',
  publicDir: false,
  build: {
    outDir: resolve(here, 'dist'),
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    modulePreload: { polyfill: false },
    assetsInlineLimit: 0,
    rollupOptions: { input: resolve(here, 'index.html') },
  },
});
