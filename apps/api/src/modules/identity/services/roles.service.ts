import { Inject, Injectable } from '@nestjs/common';
import {
  ADMIN_LOCKED_PERMISSIONS,
  isAssignablePermission,
  isPermission,
  isSystemRole,
  type Permission,
  PERMISSIONS,
  type SystemRole,
  systemRoleOverrides,
} from '@tugeel/shared/auth';
import { asc, desc, eq, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError } from '../../../common/errors/app-error';
import { databaseErrorOf } from '../../../common/errors/problem-details';
import type { AuthContext } from '../auth-context';
import {
  rolePermissionOverrides,
  rolePermissions,
  roles,
  userCompanyRoles,
  userRoles,
} from '../schema';
import { AuditService } from './audit.service';

export interface RoleView {
  id: number;
  code: string | null;
  name: string | null;
  isSystem: boolean;
  permissions: Permission[];
  /** A system role an admin has changed (it differs from the code's set, ADR-0165). */
  customized: boolean;
  userCount: number;
}

export interface CustomRoleInput {
  name: string;
  permissions: string[];
}

function invalid(path: string, constraint: string, message: string): AppError {
  return new AppError('VALIDATION_FAILED', message, undefined, [{ path, constraint, message }]);
}

/**
 * Admins build custom roles from the assignable permissions (ADR-0027 #5) and change the rights of
 * system roles too (ADR-0165): a system role keeps its code and label and cannot be deleted, and
 * its ticks are stored as differences from the code's set, so they survive every boot.
 */
@Injectable()
export class RolesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  catalog(): { code: Permission; assignable: boolean }[] {
    return PERMISSIONS.map((code) => ({ code, assignable: isAssignablePermission(code) }));
  }

  async list(executor: Db | Tx = this.db): Promise<RoleView[]> {
    const rows = await executor
      .select({
        id: roles.id,
        code: roles.code,
        name: roles.name,
        isSystem: roles.isSystem,
        permissions: sql<string[]>`ARRAY(SELECT rp.permission_code FROM role_permissions rp
          WHERE rp.role_id = ${roles.id} ORDER BY rp.permission_code)`,
        customized: sql<boolean>`EXISTS (SELECT 1 FROM role_permission_overrides o
          WHERE o.role_id = ${roles.id})`,
        userCount: sql<number>`(SELECT count(*)::int FROM user_roles ur WHERE ur.role_id = ${roles.id})`,
      })
      .from(roles)
      .orderBy(desc(roles.isSystem), asc(roles.id));
    return rows.map((row) => ({ ...row, permissions: row.permissions.filter(isPermission) }));
  }

  async get(id: number, executor: Db | Tx = this.db): Promise<RoleView> {
    const role = (await this.list(executor)).find((row) => row.id === id);
    if (!role) throw new AppError('NOT_FOUND', `role ${id} not found`, { id });
    return role;
  }

  async create(actor: AuthContext, input: CustomRoleInput): Promise<RoleView> {
    const name = input.name.trim();
    const permissions = this.assignable(input.permissions);
    return inTransaction(this.db, async (tx) => {
      const [row] = await tx.insert(roles).values({ name }).returning({ id: roles.id });
      if (!row) throw new Error('role insert returned no row');
      await this.replacePermissions(tx, row.id, permissions);
      const created = await this.get(row.id, tx);
      await this.audit.record(tx, actor, {
        action: 'CREATE',
        entity: 'roles',
        entityId: row.id,
        after: created,
      });
      return created;
    });
  }

  async update(actor: AuthContext, id: number, patch: Partial<CustomRoleInput>): Promise<RoleView> {
    return inTransaction(this.db, async (tx) => {
      const before = await this.lock(tx, id);
      const system = before.code !== null && isSystemRole(before.code) ? before.code : null;
      if (system && patch.name !== undefined) {
        // A system role is labelled by its code everywhere (the staff form's hint, the app).
        throw invalid('name', 'systemRole', 'a system role keeps its name');
      }
      if (patch.name !== undefined) {
        await tx
          .update(roles)
          .set({ name: patch.name.trim(), updatedAt: sql`now()` })
          .where(eq(roles.id, id));
      }
      if (patch.permissions !== undefined) {
        if (system) {
          await this.setSystemPermissions(tx, id, system, patch.permissions);
        } else {
          await this.replacePermissions(tx, id, this.assignable(patch.permissions));
        }
      }
      const after = await this.get(id, tx);
      await this.audit.record(tx, actor, {
        action: 'UPDATE',
        entity: 'roles',
        entityId: id,
        before,
        after,
      });
      return after;
    });
  }

  async remove(actor: AuthContext, id: number): Promise<void> {
    await inTransaction(this.db, async (tx) => {
      const before = await this.lockCustom(tx, id);
      // Users holding it directly or in a company (ADR-0084 #2; the two agree unless a mirror drifted).
      const [assigned] = await tx
        .execute<{ count: number }>(
          sql`
        SELECT count(*)::int AS count FROM (
          SELECT ${userRoles.userId} FROM ${userRoles} WHERE ${userRoles.roleId} = ${id}
          UNION
          SELECT ${userCompanyRoles.userId} FROM ${userCompanyRoles} WHERE ${userCompanyRoles.roleId} = ${id}
        ) holders`,
        )
        .then((result) => result.rows);
      if ((assigned?.count ?? 0) > 0) {
        throw new AppError('ROLE_IN_USE', `role ${id} is assigned to users`, {
          id,
          userCount: assigned?.count ?? 0,
        });
      }
      try {
        await tx.delete(roles).where(eq(roles.id, id));
      } catch (error) {
        // Holders are counted above and every other reference cascades, so what is left is an expiry
        // record naming the role as liable (ADR-0172). Identity cannot read that table, and it must
        // not cascade: that would erase who was held liable.
        if (databaseErrorOf(error)?.code === '23503') {
          throw new AppError('ROLE_NAMED_ON_RECORDS', `role ${id} is named on records`, { id });
        }
        throw error;
      }
      await this.audit.record(tx, actor, {
        action: 'DELETE',
        entity: 'roles',
        entityId: id,
        before,
      });
    });
  }

  private async lock(tx: Tx, id: number): Promise<RoleView> {
    const [row] = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.id, id))
      .for('update');
    if (!row) throw new AppError('NOT_FOUND', `role ${id} not found`, { id });
    return this.get(id, tx);
  }

  /** Locks a role to delete it; a system role stays (409 ROLE_SYSTEM_READONLY). */
  private async lockCustom(tx: Tx, id: number): Promise<RoleView> {
    const role = await this.lock(tx, id);
    if (role.isSystem)
      throw new AppError('ROLE_SYSTEM_READONLY', `role ${id} is a system role`, { id });
    return role;
  }

  /**
   * The ticks on a system role (ADR-0165): the rights it holds now, and the differences from the
   * code's set the boot sync rebuilds them from. The admin-only codes stay with ADMIN, which
   * cannot lose what keeps this screen reachable (#3).
   */
  private async setSystemPermissions(
    tx: Tx,
    id: number,
    role: SystemRole,
    codes: string[],
  ): Promise<void> {
    const permissions = role === 'ADMIN' ? this.known(codes) : this.assignable(codes);
    if (role === 'ADMIN') {
      const missing = ADMIN_LOCKED_PERMISSIONS.find((code) => !permissions.includes(code));
      if (missing) throw invalid('permissions', 'adminLocked', `ADMIN keeps ${missing}`);
    }
    await this.replacePermissions(tx, id, permissions);
    await tx.delete(rolePermissionOverrides).where(eq(rolePermissionOverrides.roleId, id));
    const overrides = systemRoleOverrides(role, permissions);
    if (overrides.length) {
      await tx
        .insert(rolePermissionOverrides)
        .values(overrides.map((override) => ({ roleId: id, ...override })));
    }
  }

  private known(codes: string[]): Permission[] {
    const unique = [...new Set(codes)];
    for (const code of unique) {
      if (!isPermission(code))
        throw invalid('permissions', 'isPermission', `unknown permission ${code}`);
    }
    return unique as Permission[];
  }

  private assignable(codes: string[]): Permission[] {
    const unique = this.known(codes);
    for (const code of unique) {
      if (!isAssignablePermission(code)) {
        throw invalid('permissions', 'isAssignable', `${code} is reserved for the ADMIN role`);
      }
    }
    return unique;
  }

  private async replacePermissions(tx: Tx, roleId: number, codes: Permission[]): Promise<void> {
    await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
    if (codes.length) {
      await tx
        .insert(rolePermissions)
        .values(codes.map((permissionCode) => ({ roleId, permissionCode })));
    }
  }
}
