import { Inject, Injectable } from '@nestjs/common';
import type { Permission } from '@tugeel/shared/auth';
import { and, eq, inArray } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
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

  async namesOf(userIds: readonly number[]): Promise<Map<number, string>> {
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .select({ id: users.id, fullName: users.fullName })
      .from(users)
      .where(inArray(users.id, ids));
    return new Map(rows.map((row) => [row.id, row.fullName]));
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
