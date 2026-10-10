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
  brands,
  categories,
  internalBarcodeSeq,
  productBarcodes,
  productImages,
  products,
  productUnits,
  uoms,
} from '../modules/catalog/schema';
