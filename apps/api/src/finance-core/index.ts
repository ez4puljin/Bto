/**
 * The Finance Core's only public file (ADR-0069 #2; docs/modules/finance-core.md). Every other
 * element imports from here and nothing else; the core itself imports no module, only its whitelist
 * in `common/**`, `@tugeel/shared/money`, `@tugeel/shared/time` and `@tugeel/fin-contract`
 * (ESLint `api-finance-core`, `pnpm core:standalone`). `createFinCallContext` and
 * `ensureDefaultCompany` are for `modules/fin-bridge` only (ESLint G2, §3.1 rule 8).
 */
export {
  createFinCallContext,
  type FinCallContext,
  type FinCallContextInput,
  type FinPrincipal,
} from './context/call-context';
export { assertNoStaticCaller, STATIC_CALLER_MARK } from './context/static-caller-guard';
export { FIN_DB, type FinDb, type FinTx } from './db/fin-db';
export { FIN_ERROR_HTTP_STATUS, FinError } from './errors';
export { FinanceCoreModule } from './finance-core.module';
export {
  ENSURE_COMPANY_LOCK,
  ensureDefaultCompany,
  type FinAccountControl,
  type FinInstallationSpec,
} from './org/ensure-default-company';
export { type FinCompanyPatch, type FinCompanyView, FinOrgService } from './org/org.service';
export { type FinPartyRef, FinPartiesService } from './parties/parties.service';
