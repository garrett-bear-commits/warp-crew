import { defineConfig } from 'vite';

const base = process.env.VITE_BASE || './';

export default defineConfig({
  base,
  server: { host: true, port: 5173 },
  build: { outDir: 'dist', assetsDir: 'assets' },
  publicDir: 'public',
});
