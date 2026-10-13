// Public API of the identity module (docs/modules/identity.md). Other modules import only this
// file; named exports only (ESLint G2 rejects `export *`).
export { type Actor, actorUserId, type AuthContext, systemActor } from './auth-context';
export { Authenticated, CurrentUser, RequirePermission } from './decorators/access.decorators';
export { IdentityHttpModule, IdentityModule, IdentityWorkerModule } from './identity.module';
export { Idempotent } from './interceptors/idempotency.interceptor';
export { type AuditEntry, AuditService } from './services/audit.service';
export { NumberingService } from './services/numbering.service';
export {
  type Branch,
  OrgService,
  type Warehouse,
  WAREHOUSE_CREATED_HOOK,
  type WarehouseCreatedHook,
} from './services/org.service';
export { ScopeService } from './services/scope.service';
export { SettingsService } from './services/settings.service';
export { StorageService, type StoredFile } from './services/storage.service';
export { UserNamesService } from './services/user-names.service';
