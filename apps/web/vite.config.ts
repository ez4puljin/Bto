/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig } from 'vite';

const API_ORIGIN = 'http://localhost:3000';

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
