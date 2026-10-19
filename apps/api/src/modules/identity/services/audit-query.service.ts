import { Inject, Injectable } from '@nestjs/common';
import { BUSINESS_TZ, isIsoDate } from '@tugeel/shared/time';
import { and, desc, eq, lt, sql, type SQL } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import { AppError } from '../../../common/errors/app-error';
import { DEFAULT_PAGE_LIMIT, decodeCursor, toPage } from '../../../common/pagination/page';
import { auditLog, users } from '../schema';

export interface AuditQuery {
  entity?: string;
  entityId?: string;
  actorId?: number;
  /** Ulaanbaatar business dates, both inclusive. */
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
}

/** Reads audit_log newest first (SPEC §5.1: who changed which record and when). */
@Injectable()
export class AuditQueryService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async list(query: AuditQuery) {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const conditions: SQL[] = [];
    const after = decodeCursor(query.cursor);
    if (typeof after?.id === 'number') conditions.push(lt(auditLog.id, after.id));
    if (query.entity) conditions.push(eq(auditLog.entity, query.entity));
    if (query.entityId) conditions.push(eq(auditLog.entityId, query.entityId));
    // actorId is a staff user's id: a customer account's rows carry the same numbers (ADR-0079).
    if (query.actorId !== undefined) {
      conditions.push(eq(auditLog.actorKind, 'STAFF'), eq(auditLog.actorId, query.actorId));
    }
    for (const [field, value] of [
      ['from', query.from],
      ['to', query.to],
    ] as const) {
      if (value !== undefined && !isIsoDate(value)) {
        throw new AppError('VALIDATION_FAILED', `${field} is not a date`, undefined, [
          { path: field, constraint: 'isIsoDate', message: `${field} must be YYYY-MM-DD` },
        ]);
      }
    }
    // Business dates are Ulaanbaatar days: [from 00:00, to + 1 day 00:00) in that time zone.
    if (query.from) {
      conditions.push(
        sql`${auditLog.occurredAt} >= (${query.from}::date)::timestamp AT TIME ZONE ${BUSINESS_TZ}`,
      );
    }
    if (query.to) {
      conditions.push(
        sql`${auditLog.occurredAt} < ((${query.to}::date) + 1)::timestamp AT TIME ZONE ${BUSINESS_TZ}`,
      );
    }
    const rows = await this.db
      .select({
        id: auditLog.id,
        occurredAt: auditLog.occurredAt,
        actorKind: auditLog.actorKind,
        actorId: auditLog.actorId,
        actorUsername: users.username,
        actorLabel: auditLog.actorLabel,
        action: auditLog.action,
        entity: auditLog.entity,
        entityId: auditLog.entityId,
        before: auditLog.before,
        after: auditLog.after,
        requestId: auditLog.requestId,
      })
      .from(auditLog)
      .leftJoin(users, and(eq(users.id, auditLog.actorId), eq(auditLog.actorKind, 'STAFF')))
      .where(and(...conditions))
      .orderBy(desc(auditLog.id))
      .limit(limit + 1);
    return toPage(rows, limit, (row) => ({ id: row.id }));
  }
}
