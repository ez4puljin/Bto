import {
  isSystemRole,
  PERMISSIONS,
  SYSTEM_ROLE_PERMISSIONS,
  SYSTEM_ROLES,
} from '@tugeel/shared/auth';
import { and, eq, notInArray, sql } from 'drizzle-orm';
import type { Tx } from '../../common/db/db.types';
import { permissions, rolePermissions, roles, warehouses } from './schema';
import { TRANSIT_CODE, type Warehouse } from './services/org.service';

/** Serialises concurrent boots (api replicas, the CLI) while they sync reference rows. */
const REFERENCE_DATA_LOCK = 72_026_102;

/**
 * Makes `permissions`, the system roles and their `role_permissions` equal to the code catalog in
 * @tugeel/shared/auth (ADR-0027 #4). Idempotent; custom roles keep their own permissions, except
 * codes that left the catalog (removed by the foreign-key cascade).
 */
export async function syncAccessCatalog(tx: Tx): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${REFERENCE_DATA_LOCK})`);
  const codes = [...PERMISSIONS];
  await tx
    .insert(permissions)
    .values(codes.map((code) => ({ code })))
    .onConflictDoNothing();
  await tx.delete(permissions).where(notInArray(permissions.code, codes));
  await tx
    .insert(roles)
    .values(SYSTEM_ROLES.map((code) => ({ code, isSystem: true })))
    .onConflictDoNothing({ target: roles.code });
  const systemRoles = await tx
    .select({ id: roles.id, code: roles.code })
    .from(roles)
    .where(eq(roles.isSystem, true));
  for (const role of systemRoles) {
    const desired: string[] = isSystemRole(role.code)
      ? [...SYSTEM_ROLE_PERMISSIONS[role.code]]
      : [];
    await tx
      .delete(rolePermissions)
      .where(
        desired.length
          ? and(
              eq(rolePermissions.roleId, role.id),
              notInArray(rolePermissions.permissionCode, desired),
            )
          : eq(rolePermissions.roleId, role.id),
      );
    if (desired.length) {
      await tx
        .insert(rolePermissions)
        .values(desired.map((permissionCode) => ({ roleId: role.id, permissionCode })))
        .onConflictDoNothing();
    }
  }
}

/** Creates the single TRANSIT warehouse if it is missing; returns it only when it was created. */
export async function ensureTransitWarehouse(tx: Tx): Promise<Warehouse | null> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${REFERENCE_DATA_LOCK})`);
  const [created] = await tx
    .insert(warehouses)
    .values({ code: TRANSIT_CODE, name: 'Transit', kind: 'TRANSIT' })
    .onConflictDoNothing({ target: warehouses.kind, where: sql`${warehouses.kind} = 'TRANSIT'` })
    .returning();
  return created ?? null;
}
