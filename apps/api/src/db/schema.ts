// Aggregated Drizzle schema: the only input of drizzle-kit and of drizzle({ schema }) (ADR-0024).
// Each module adds its tables here by name when it is created. Named re-exports only: ESLint G2
// rejects `export * from './…'` in apps/api.
export {
  auditLog,
  authSessions,
  branches,
  customerPasswordCodes,
  customerUsers,
  files,
  idempotencyKeys,
  numberSequences,
  passwordResets,
  permissions,
  rolePermissions,
  roles,
  settings,
  userCompanyRoles,
  userRoles,
  userScopes,
  users,
  warehouses,
} from '../modules/identity/schema';
export {
  categories,
  internalBarcodeSeq,
  productBarcodes,
  productImages,
  products,
  productUnits,
  uoms,
} from '../modules/catalog/schema';
export {
  customerAddresses,
  customerContacts,
  customers,
  productSuppliers,
  supplierContacts,
  suppliers,
} from '../modules/partners/schema';
// The ledger, the valuation history and the snapshots are not exported: their DDL is hand-written
// and their Drizzle objects live in modules/inventory/ledger.schema.ts (ADR-0034, ESLint G2).
export {
  adjustmentLines,
  adjustments,
  binMoveLines,
  binMoves,
  bins,
  binStock,
  goodsIssueLines,
  goodsIssues,
  goodsReceiptLines,
  goodsReceipts,
  issueExpenseTypes,
  lots,
  productLocations,
  reconciliationRuns,
  stockReservations,
  stocktakeBins,
  stocktakeLines,
  stocktakes,
  transferLines,
  transfers,
  warehouseStock,
} from '../modules/inventory/schema';
export { importDocuments, importJobs, importRows } from '../modules/imports/schema';
export {
  discountPrograms,
  discountSteps,
  priceProfiles,
  priceProfileVersions,
  productPrices,
} from '../modules/pricing/schema';
export { aiConversations, aiQuestions, aiReports } from '../modules/ai/schema';
export { segmentProducts, segments } from '../modules/segments/schema';
export {
  orderStatusEvents,
  salesBoards,
  salesChannelDefaults,
  salesOrderLineParts,
  salesOrderLines,
  salesOrders,
  salesPipelineRoles,
  salesPipelines,
  salesSettings,
  salesStageMoves,
  salesStageRoles,
  salesStages,
} from '../modules/sales/schema';
export {
  allocations,
  arEntries,
  creditNoteLines,
  creditNotes,
  customerBalances,
  financeReconcileRuns,
  financeSettings,
  glAccounts,
  invoiceLines,
  invoices,
  journalEntries,
  journalLines,
  moneyAccounts,
  payments,
} from '../modules/finance/schema';
export {
  posCashiers,
  posEdgeNodes,
  posSaleLines,
  posSales,
  posSettings,
  posShifts,
  posShortfalls,
  posSyncRejections,
  posTenders,
  posTillDevices,
  posTills,
} from '../modules/pos/schema';
export {
  appNoticeCustomerReads,
  appNoticeProducts,
  appNoticeReads,
  appNotices,
  customerNotifications,
  userNotifications,
} from '../modules/notifications/schema';
export { companyContacts, customerFavourites } from '../modules/customer/schema';
export {
  finAuditLog,
  finBranches,
  finBranchRefs,
  finCompanies,
  finCompanyTaxRegistrations,
  finParties,
  finPartyCompanies,
  finPartyRefs,
  finPostingKeys,
  finSchema,
  finSourceGrants,
  finSourceSystems,
  finTenants,
} from '../finance-core/schema';
