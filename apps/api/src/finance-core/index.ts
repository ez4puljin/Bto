/**
 * The Finance Core's only public file (ADR-0069 #2; docs/modules/finance-core.md). Every other
 * element imports from here and nothing else; the core itself imports no module, only its whitelist
 * in `common/**`, `@tugeel/shared/money`, `@tugeel/shared/time` and `@tugeel/fin-contract`
 * (ESLint `api-finance-core`, `pnpm core:standalone`). `createFinCallContext`,
 * `ensureDefaultCompany` and `ensureDefaultChart` are for `modules/fin-bridge` only, the posting
 * façade `FinJournalPosting` for `modules/finance` only (ESLint G2, §3.1 rule 8, ADR-0089).
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
export {
  ensureDefaultChart,
  type FinAccountKind,
  type FinAccountView,
  type FinBranchRef,
  FinChartService,
  type FinChartTemplateAccount,
  type FinMoneyAccountInput,
  type FinMoneyAccountKind,
  type FinMoneyAccountPatch,
  type FinMoneyAccountView,
  type FinRuleView,
  type FinSide,
  type FinStatus,
  FIN_RULES_FROM_START,
} from './ledger/chart.service';
export { type FinCompanyPatch, type FinCompanyView, FinOrgService } from './org/org.service';
export { type FinPartyRef, FinPartiesService } from './parties/parties.service';
export {
  type FinEntryIn,
  type FinEntryLineIn,
  type FinEntryRef,
  FinJournalPosting,
  FIN_OWN_SOURCE,
} from './posting/journal-posting.service';
export {
  type FinEntryDetail,
  type FinEntryLine,
  type FinEntryOrigin,
  type FinEntrySummary,
  FinJournalReader,
  type FinLedgerRow,
} from './posting/journal-reader.service';
