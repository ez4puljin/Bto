// Aggregated Drizzle schema: the only input of drizzle-kit and of drizzle({ schema }) (ADR-0024).
// Each module adds its tables here by name when it is created. Named re-exports only: ESLint G2
// rejects `export * from './…'` in apps/api.
export {
  auditLog,
  authSessions,
  branches,
  files,
  idempotencyKeys,
  numberSequences,
  passwordResets,
  permissions,
  rolePermissions,
  roles,
  settings,
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
  goodsReceiptLines,
  goodsReceipts,
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
export { discountPrograms, discountSteps, unitPrices } from '../modules/pricing/schema';
export { aiConversations, aiQuestions, aiReports } from '../modules/ai/schema';
