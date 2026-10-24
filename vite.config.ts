import { defineConfig } from 'vite';

// In development the party server (npm run party-server) listens on 8787 and Vite proxies /ws to it.
const proxy = { '/ws': { target: 'ws://localhost:8787', ws: true } };

export default defineConfig({
  base: process.env.BASE ?? '/',
  server: { host: true, proxy },
  preview: { host: true, proxy },
  // Safari 15 (older iPads): three.js uses class static blocks, which Safari only parses from 16.4
  build: { target: ['es2020', 'safari15', 'chrome100', 'firefox100'], chunkSizeWarningLimit: 6000 },
});
