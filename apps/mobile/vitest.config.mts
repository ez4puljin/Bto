import { defineConfig } from 'vitest/config';

// Unit tests of the app's pure modules (ADR-0061 #9): Node, no React Native. @tugeel/shared is read
// from source, like Metro does (ADR-0025).
const conditions = ['@tugeel/source', 'node', 'import', 'default'];

export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions, externalConditions: conditions } },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'],
  },
});
