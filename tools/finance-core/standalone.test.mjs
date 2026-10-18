// Proves the `pnpm core:standalone` classifier refuses what reaches beyond the whitelist.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classify, npmPackageOf } from './standalone.mjs';

test('core files, whitelisted platform files and allowed packages pass', () => {
  const { refused } = classify([
    'apps/api/src/finance-core/index.ts',
    'apps/api/src/finance-core/posting/post.ts',
    'apps/api/src/common/db/any-tx.ts',
    'packages/shared/dist/money/index.d.ts',
    'packages/shared/dist/time/index.d.ts',
    'packages/fin-contract/dist/index.d.ts',
    'node_modules/drizzle-orm/pg-core/index.d.ts',
    'node_modules/@types/node/index.d.ts',
    'C:/x/node_modules/typescript/lib/lib.es2025.d.ts',
  ]);
  assert.deepEqual(refused, []);
});

test('Bto code, other shared subpaths and other npm packages are refused', () => {
  const refusedPaths = [
    'apps/api/src/modules/sales/index.ts',
    'apps/api/src/db/schema.ts',
    'apps/api/src/edge/db/edge-db.ts',
    'apps/api/src/common/config/app-config.ts',
    'apps/api/src/common/db/db.types.ts',
    'apps/api/src/common/errors/app-error.ts',
    'packages/shared/dist/sales/index.d.ts',
    'packages/shared/dist/index.d.ts',
    'packages/shared/src/money/index.ts',
    'node_modules/exceljs/index.d.ts',
    'node_modules/@nestjs/swagger/index.d.ts',
  ];
  assert.deepEqual(classify(refusedPaths).refused, refusedPaths);
});

test('reads the package of a node_modules path', () => {
  assert.equal(npmPackageOf('node_modules/@types/pg/index.d.ts'), '@types/pg');
  assert.equal(npmPackageOf('a/node_modules/pg/lib/index.d.ts'), 'pg');
  assert.equal(npmPackageOf('apps/api/src/finance-core/index.ts'), null);
});
