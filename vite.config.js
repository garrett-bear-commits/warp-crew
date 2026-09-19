import { defineConfig } from 'vite';

// Local: './'  |  GitHub Pages: '/warp-crew/'
const base = process.env.VITE_BASE || './';

export default defineConfig({
  base,
  server: { host: true, port: 5173 },
  build: { outDir: 'dist', assetsDir: 'assets' },
  // Keep public/ files (qa.html) at site root
  publicDir: 'public',
});
