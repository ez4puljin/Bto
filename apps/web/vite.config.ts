/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig, loadEnv } from 'vite';

// The api's local port lives in apps/api/.env (API_PORT), the file the api itself reads. IPv4
// loopback: the api listens on 0.0.0.0, and another dev server may own [::1] on the same port.
const apiEnv = loadEnv(
  'development',
  fileURLToPath(new URL('../api', import.meta.url)),
  'API_PORT',
);
const API_ORIGIN = `http://127.0.0.1:${apiEnv.API_PORT ?? '3000'}`;

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
    // SPA routes never start with /api or /health: these prefixes always go to the API.
    proxy: { '/api': { target: API_ORIGIN }, '/health': { target: API_ORIGIN } },
  },
  preview: { port: 4173, strictPort: true },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
