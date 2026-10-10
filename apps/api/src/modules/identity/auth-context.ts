import type { Permission } from '@tugeel/shared/auth';

/**
 * The authenticated staff member of a request, resolved from the database on every request by the
 * global AuthGuard (ADR-0027 #2). Controllers take it from `@CurrentUser()` and pass it explicitly
 * into services, which pass it on to `AuditService.record` (ADR-0027 #10).
 */
export interface AuthContext {
  readonly kind: 'STAFF';
  readonly userId: number;
  readonly sessionId: string;
  readonly username: string;
  readonly fullName: string;
  readonly permissions: ReadonlySet<Permission>;
  readonly roleIds: readonly number[];
  /**
   * Warehouses this user may write documents for (ADR-0027 #7): `null` = every warehouse.
   * Branch scopes are expanded to their warehouses, and TRANSIT is always included.
   */
  readonly writableWarehouseIds: ReadonlySet<number> | null;
  readonly requestId?: string;
}

/** Who did something: a staff member (an AuthContext qualifies) or a job, CLI or boot step. */
export type Actor =
  | { readonly kind: 'STAFF'; readonly userId: number; readonly requestId?: string }
  | { readonly kind: 'SYSTEM'; readonly label: string; readonly requestId?: string };

export function systemActor(label: string): Actor {
  return { kind: 'SYSTEM', label };
}

/** users.id of a staff actor, for `created_by` columns; NULL for system actors. */
export function actorUserId(actor: Actor): number | null {
  return actor.kind === 'STAFF' ? actor.userId : null;
}
