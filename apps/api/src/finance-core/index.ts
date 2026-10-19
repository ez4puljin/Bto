/**
 * The Finance Core's only public file (ADR-0069 #2; docs/modules/finance-core.md). Every other
 * element imports from here and nothing else; the core itself imports no module, only its whitelist
 * in `common/**`, `@tugeel/shared/money`, `@tugeel/shared/time` and `@tugeel/fin-contract`
 * (ESLint `api-finance-core`, `pnpm core:standalone`).
 */
export { FIN_DB, type FinDb, type FinTx } from './db/fin-db';
export { FIN_ERROR_HTTP_STATUS, FinError } from './errors';
export { FinanceCoreModule } from './finance-core.module';
