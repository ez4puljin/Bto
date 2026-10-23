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
  type FinDocumentClassSpec,
  type FinInstallationSpec,
} from './org/ensure-default-company';
export {
  ensureDefaultChart,
  type FinAccountGroupView,
  type FinAccountKind,
  type FinAccountView,
  type FinBranchRef,
  type FinChartImportApplied,
  type FinChartImportRow,
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
export {
  type FinCloseCheck,
  type FinPeriodAction,
  type FinPeriodEventView,
  type FinPeriodStatus,
  type FinPeriodView,
  FinPeriodsService,
} from './ledger/period-close.service';
export { type FinCompanyPatch, type FinCompanyView, FinOrgService } from './org/org.service';
export {
  FinConfig,
  type FinDocumentTypeInput,
  type FinNumberSeriesView,
} from './config/fin-config.service';
export { FIN_SERIES, seriesNumber, seriesPrefix } from './numbering/numbers';
export {
  type FinAllocationRow,
  type FinDocumentRow,
  type FinItemSource,
  type FinOpenItemRow,
  type FinPartyBalanceRow,
  type FinPartyKey,
  type FinPartyLedgerRow,
  FinReader,
} from './posting/fin-reader.service';
export { type FinDocumentClass } from './posting/intake-command';
export {
  type FinAccountPartyBalance,
  FinReports,
  type FinResultBalance,
  type FinTrialBalance,
  type FinTrialBalanceRow,
  type FinVatDocument,
  type FinVatGroup,
  type FinVatReport,
  type FinVatSide,
} from './posting/report-reader.service';
export { type FinIntakeResult, type FinIntakeVia, FinIntakeInTx } from './posting/intake.service';
export {
  type FinReconcileDrift,
  type FinReconcileKind,
  type FinReconcileRun,
  type FinTransactor,
  postingKeyBalances,
  type FinKeyBalance,
  reconcileBooks,
  sourceOpenAmounts,
} from './posting/reconcile';
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
