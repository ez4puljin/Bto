import { Inject, Injectable } from '@nestjs/common';
import type { Permission } from '@tugeel/shared/auth';
import { and, asc, eq, ilike, inArray, or } from 'drizzle-orm';
import { escapeLike } from '../../../common/db/like';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { rolePermissions, userRoles, users } from '../schema';

export interface UserSummary {
  id: number;
  username: string;
  fullName: string;
  status: 'ACTIVE' | 'DISABLED';
}

/**
 * Staff names for other modules' lists ("saved by", "posted by"): user id → full name, nothing
 * else about the user. Batch reads only (ADR-0037).
 */
@Injectable()
export class UserNamesService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** In the caller's transaction when one is given, never a second pooled connection beside it. */
  async namesOf(
    userIds: readonly number[],
    executor: Db | Tx = this.db,
  ): Promise<Map<number, string>> {
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return new Map();
    const rows = await executor
      .select({ id: users.id, fullName: users.fullName })
      .from(users)
      .where(inArray(users.id, ids));
    return new Map(rows.map((row) => [row.id, row.fullName]));
  }

  /**
   * Active staff by name or login, for pickers anyone signed in may use (a goods issue's
   * recipient, ADR-0081 #6): id and full name only.
   */
  async search(q: string, limit = 20): Promise<{ id: number; fullName: string }[]> {
    const text = q.trim();
    const pattern = `%${escapeLike(text)}%`;
    return this.db
      .select({ id: users.id, fullName: users.fullName })
      .from(users)
      .where(
        and(
          eq(users.status, 'ACTIVE'),
          text ? or(ilike(users.fullName, pattern), ilike(users.username, pattern)) : undefined,
        ),
      )
      .orderBy(asc(users.fullName), asc(users.id))
      .limit(limit);
  }

  /** Name, login and status by id, for modules that keep a list of staff (the POS cashiers). */
  async summariesOf(userIds: readonly number[]): Promise<Map<number, UserSummary>> {
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .select({
        id: users.id,
        username: users.username,
        fullName: users.fullName,
        status: users.status,
      })
      .from(users)
      .where(inArray(users.id, ids));
    return new Map(rows.map((row) => [row.id, row]));
  }

  /** Of these users, those who hold a permission through one of their roles (the POS supervisors). */
  async holdersOf(permission: Permission, userIds: readonly number[]): Promise<Set<number>> {
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return new Set();
    const rows = await this.db
      .selectDistinct({ userId: userRoles.userId })
      .from(userRoles)
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
      .where(and(inArray(userRoles.userId, ids), eq(rolePermissions.permissionCode, permission)));
    return new Set(rows.map((row) => row.userId));
  }
}
