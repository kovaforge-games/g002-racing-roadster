import { defineConfig } from 'vite';

// In development the party server (npm run party-server) listens on 8787 and Vite proxies /ws to it.
const proxy = { '/ws': { target: 'ws://localhost:8787', ws: true } };

export default defineConfig({
  base: process.env.BASE ?? '/',
  server: { host: true, proxy },
  preview: { host: true, proxy },
  build: { target: 'es2022', chunkSizeWarningLimit: 6000 },
});
