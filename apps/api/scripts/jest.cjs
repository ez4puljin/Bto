'use strict';
// NestJS 12 and pg-boss 12 are ESM-only (ADR-0025). Jest >= 30.4 can require() them only when
// node:vm exposes SourceTextModule, i.e. with --experimental-vm-modules (same as the Nest 12 template).
// Spawned without a shell, so the spaces in the repository path are safe.
const { spawnSync } = require('node:child_process');

const result = spawnSync(
  process.execPath,
  [
    '--experimental-vm-modules',
    '--disable-warning=ExperimentalWarning',
    require.resolve('jest/bin/jest'),
    ...process.argv.slice(2),
  ],
  { stdio: 'inherit' },
);
process.exit(result.status ?? 1);
