import { Inject, Injectable } from '@nestjs/common';
import { isPermission, type Permission } from '@tugeel/shared/auth';
import { and, eq, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { rolePermissions, roles, userCompanyRoles, userRoles, users } from '../schema';

/**
 * Who holds a permission now (ADR-0062 #2): the active users whose roles carry it, for modules
 * that count or address the holders. Ids only, ascending; nothing else about the users.
 */
@Injectable()
export class PermissionHoldersService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * `excludeAdminOnly` leaves out the users who hold the code only through ADMIN (which carries
   * every code), so a count names the people the right was given to.
   */
  async activeHolders(
    permission: Permission,
    options: { excludeAdminOnly?: boolean } = {},
    executor: Db | Tx = this.db,
  ): Promise<number[]> {
    const rows = await executor
      .selectDistinct({ id: users.id })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(
        and(
          eq(users.status, 'ACTIVE'),
          eq(rolePermissions.permissionCode, permission),
          options.excludeAdminOnly ? sql`${roles.code} IS DISTINCT FROM 'ADMIN'` : undefined,
        ),
      )
      .orderBy(users.id);
    return rows.map((row) => row.id);
  }

  /**
   * An active staff member's finance rights per company (`user_company_roles`, ADR-0084 #2), as the
   * AuthGuard reads them for a request: for a job that acts for the user who asked for it (an
   * import's commit, ADR-0102 #6). Empty for an inactive or unknown user.
   */
  async companyPermissionsOf(
    userId: number,
    executor: Db | Tx = this.db,
  ): Promise<Map<string, Set<Permission>>> {
    const rows = await executor
      .selectDistinct({
        company: userCompanyRoles.companyCode,
        permission: rolePermissions.permissionCode,
      })
      .from(userCompanyRoles)
      .innerJoin(users, eq(users.id, userCompanyRoles.userId))
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, userCompanyRoles.roleId))
      .where(
        and(
          eq(userCompanyRoles.userId, userId),
          eq(users.status, 'ACTIVE'),
          sql`${rolePermissions.permissionCode} LIKE 'finance.%'`,
        ),
      );
    const rights = new Map<string, Set<Permission>>();
    for (const row of rows) {
      if (!isPermission(row.permission)) continue;
      const codes = rights.get(row.company) ?? new Set<Permission>();
      codes.add(row.permission);
      rights.set(row.company, codes);
    }
    return rights;
  }
}
