import { defineConfig } from 'vitest/config';

// Tests read the workspace packages this one imports (@tugeel/fin-contract) from their TypeScript
// source, as the web and Jest do (ADR-0025 #4).
export default defineConfig({
  resolve: { conditions: ['@tugeel/source'] },
  ssr: { resolve: { conditions: ['@tugeel/source'] } },
});
