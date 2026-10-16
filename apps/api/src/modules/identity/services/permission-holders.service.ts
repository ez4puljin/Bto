import { Inject, Injectable } from '@nestjs/common';
import type { Permission } from '@tugeel/shared/auth';
import { and, eq, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { rolePermissions, roles, userRoles, users } from '../schema';

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
}
