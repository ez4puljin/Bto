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

/**
 * A store's customer app account acting (ADR-0079): deliberately not an `Actor`, so no staff
 * service can take a customer for a trusted caller; only the audit and the services built for the
 * customer routes accept it.
 */
export interface CustomerActor {
  readonly kind: 'CUSTOMER';
  readonly customerUserId: number;
  readonly requestId?: string;
}

/**
 * The signed-in store of a customer route, resolved per request by the AuthGuard (ADR-0079 #3):
 * `customerId` is always the token's own store; no customer route takes one from the client.
 */
export interface CustomerContext extends CustomerActor {
  readonly customerId: number;
  readonly sessionId: string;
  readonly phone: string;
}

/** Who an audit row names: staff, a job, or a customer account. */
export type AuditActor = Actor | CustomerActor;

export function systemActor(label: string): Actor {
  return { kind: 'SYSTEM', label };
}

/** users.id of a staff actor, for `created_by` columns; NULL for system and customer actors. */
export function actorUserId(actor: AuditActor): number | null {
  return actor.kind === 'STAFF' ? actor.userId : null;
}
