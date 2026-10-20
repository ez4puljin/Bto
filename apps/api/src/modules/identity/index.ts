// Public API of the identity module (docs/modules/identity.md). Other modules import only this
// file; named exports only (ESLint G2 rejects `export *`).
export {
  type Actor,
  actorUserId,
  type AuditActor,
  type AuthContext,
  type CustomerActor,
  type CustomerContext,
  systemActor,
} from './auth-context';
export { CUSTOMER_ACCOUNT_GATE, type CustomerAccountGate } from './customer-account-gate';
export {
  Authenticated,
  CurrentCustomer,
  CurrentUser,
  CustomerRoute,
  RequirePermission,
} from './decorators/access.decorators';
export { IdentityHttpModule, IdentityModule, IdentityWorkerModule } from './identity.module';
export { IdempotencyKey, Idempotent } from './interceptors/idempotency.interceptor';
export type { CustomerUserStatus } from './schema';
export { type AuditEntry, AuditService } from './services/audit.service';
export {
  type CustomerAccountView,
  CustomerAccountsService,
} from './services/customer-accounts.service';
export { NumberingService } from './services/numbering.service';
export {
  type Branch,
  OrgService,
  type Warehouse,
  WAREHOUSE_CREATED_HOOK,
  type WarehouseCreatedHook,
} from './services/org.service';
export type { IssuedCode } from './services/password-codes';
export { PermissionHoldersService } from './services/permission-holders.service';
export { ScopeService } from './services/scope.service';
export { SettingsService } from './services/settings.service';
export { StorageService, type StoredFile } from './services/storage.service';
export { UserNamesService, type UserSummary } from './services/user-names.service';
