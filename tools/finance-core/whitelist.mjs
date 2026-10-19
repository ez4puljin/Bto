// The Finance Core's import whitelist (ADR-0069 #2, docs/modules/finance-core.md §3): the one list
// both eslint.config.mjs (element api-finance-core) and `pnpm core:standalone` read. Each file is
// Bto-free: it imports only the files below and the allowed npm packages. A session that adds a
// file here says why in docs/modules/finance-core.md §3.3.

/** Files of apps/api the core may import, relative to apps/api. */
export const FINANCE_CORE_API_FILES = [
  'src/common/db/any-tx.ts',
  'src/common/db/counters.ts',
  'src/common/db/db.tokens.ts',
  'src/common/db/types.ts',
  'src/common/errors/coded-error.ts',
  'src/common/json/canonical.ts',
  'src/common/jobs/job-catalog.ts',
  'src/common/jobs/jobs.service.ts',
  'src/common/jobs/jobs.tokens.ts',
  'src/common/jobs/worker/job-handler.ts',
];

/** Workspace packages (and subpaths) the core may import. */
export const FINANCE_CORE_PACKAGES = [
  '@tugeel/shared/money',
  '@tugeel/shared/time',
  '@tugeel/fin-contract',
];

/**
 * npm packages the core's build may pull in, directly or through the files above (checked by
 * `pnpm core:standalone`, not by ESLint, which allows every npm import).
 */
export const FINANCE_CORE_NPM_PACKAGES = [
  'typescript',
  '@types/node',
  'undici-types',
  '@nestjs/common',
  '@nestjs/core',
  'rxjs',
  'reflect-metadata',
  'drizzle-orm',
  'pg',
  '@types/pg',
  'pg-protocol',
  'pg-types',
  'buffer',
  'pg-boss',
  'zod',
  '@standard-schema/spec',
  'decimal.js',
  'dayjs',
];
