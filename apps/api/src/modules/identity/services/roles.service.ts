import { Inject, Injectable } from '@nestjs/common';
import {
  isAssignablePermission,
  isPermission,
  type Permission,
  PERMISSIONS,
} from '@tugeel/shared/auth';
import { asc, desc, eq, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError } from '../../../common/errors/app-error';
import type { AuthContext } from '../auth-context';
import { rolePermissions, roles, userRoles } from '../schema';
import { AuditService } from './audit.service';

export interface RoleView {
  id: number;
  code: string | null;
  name: string | null;
  isSystem: boolean;
  permissions: Permission[];
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
 * System roles come from the code catalog and are read-only; admins build custom roles from the
 * assignable permissions (ADR-0027 #5).
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
    const permissions =
      patch.permissions === undefined ? undefined : this.assignable(patch.permissions);
    return inTransaction(this.db, async (tx) => {
      const before = await this.lockCustom(tx, id);
      if (patch.name !== undefined) {
        await tx
          .update(roles)
          .set({ name: patch.name.trim(), updatedAt: sql`now()` })
          .where(eq(roles.id, id));
      }
      if (permissions) await this.replacePermissions(tx, id, permissions);
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
      const [assigned] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(userRoles)
        .where(eq(userRoles.roleId, id));
      if ((assigned?.count ?? 0) > 0) {
        throw new AppError('ROLE_IN_USE', `role ${id} is assigned to users`, {
          id,
          userCount: assigned?.count ?? 0,
        });
      }
      await tx.delete(roles).where(eq(roles.id, id));
      await this.audit.record(tx, actor, {
        action: 'DELETE',
        entity: 'roles',
        entityId: id,
        before,
      });
    });
  }

  /** Locks a custom role for change; system roles are read-only (409 ROLE_SYSTEM_READONLY). */
  private async lockCustom(tx: Tx, id: number): Promise<RoleView> {
    const [row] = await tx
      .select({ id: roles.id, isSystem: roles.isSystem })
      .from(roles)
      .where(eq(roles.id, id))
      .for('update');
    if (!row) throw new AppError('NOT_FOUND', `role ${id} not found`, { id });
    if (row.isSystem)
      throw new AppError('ROLE_SYSTEM_READONLY', `role ${id} is a system role`, { id });
    return this.get(id, tx);
  }

  private assignable(codes: string[]): Permission[] {
    const unique = [...new Set(codes)];
    for (const code of unique) {
      if (!isPermission(code))
        throw invalid('permissions', 'isPermission', `unknown permission ${code}`);
      if (!isAssignablePermission(code)) {
        throw invalid('permissions', 'isAssignable', `${code} is reserved for the ADMIN role`);
      }
    }
    return unique as Permission[];
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
