/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig, loadEnv } from 'vite';

// The api's local port lives in apps/api/.env (API_PORT), the file the api itself reads. IPv4
// loopback: the api listens on 0.0.0.0, and another dev server may own [::1] on the same port.
const apiEnv = loadEnv('development', fileURLToPath(new URL('../api', import.meta.url)), [
  'API_PORT',
  'EDGE_PORT',
]);
const API_ORIGIN = `http://127.0.0.1:${apiEnv.API_PORT ?? '3000'}`;
// The store edge (ADR-0067) the till kiosk (pos.html) talks to: EDGE_PORT, 3400 locally.
const EDGE_ORIGIN = `http://127.0.0.1:${apiEnv.EDGE_PORT ?? '3400'}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // Workspace packages are read from their TypeScript source (ADR-0025).
    conditions: ['@tugeel/source', ...defaultClientConditions],
    // fileURLToPath, never URL.pathname: keeps "Rog Strix" / "project 2026" unescaped.
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    strictPort: true,
    // start.bat sets DEV_LAN=1: Vite then listens on every interface, so a PC on the same network
    // opens http://<this PC's address>:5173. The proxy below keeps the Host header, so the api's
    // same-origin check on cookie routes passes for that address too.
    host: process.env.DEV_LAN === '1' ? true : 'localhost',
    // SPA routes never start with /api or /health: these prefixes always go to the API. The
    // kiosk's /edge goes to the store edge, as Caddy sends it there in the store.
    proxy: {
      '/api': { target: API_ORIGIN },
      '/health': { target: API_ORIGIN },
      '/edge': { target: EDGE_ORIGIN },
    },
  },
  build: {
    // Two pages: the admin (index.html) and the till kiosk (pos.html, served by the store edge).
    rolldownOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        pos: fileURLToPath(new URL('./pos.html', import.meta.url)),
      },
    },
  },
  preview: { port: 4173, strictPort: true },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // Waits of up to 5 s (src/test/setup.ts) need room inside a test; still no retries.
    testTimeout: 15_000,
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
