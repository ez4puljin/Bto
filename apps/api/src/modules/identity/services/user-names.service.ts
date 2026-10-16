import { Inject, Injectable } from '@nestjs/common';
import { inArray } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import { users } from '../schema';

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
}
