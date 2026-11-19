import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import { idempotencyKeys } from '../schema';

/** At most this many keys in one question (`POST /sales-rep/orders/known`, ADR-0225 #5). */
export const KNOWN_KEYS_MAX = 200;

/** A key the server holds for its caller, as the interceptor stored it (ADR-0225 #5). */
export interface KnownIdempotencyKey {
  /** Lower case, as PostgreSQL stores a uuid. */
  key: string;
  status: 'IN_PROGRESS' | 'COMPLETED';
  createdAt: Date;
  method: string;
  /** The request's path without its query (`/api/v1/sales-rep/orders`). */
  path: string;
  /** Null while IN_PROGRESS. */
  responseStatus: number | null;
  /**
   * The stored response's top-level `id` when it is a whole number (the created document's id);
   * null otherwise. Only this is read, never the whole stored body.
   */
  resultId: number | null;
}

/**
 * Reads of the `Idempotency-Key` store (ADR-0002 #6, ADR-0004 #5, ADR-0027 #11) for a client that
 * asks which of its keys the server still knows (ADR-0225 #5: a phone after a restore from an older
 * backup). Read-only: the interceptor alone claims, completes and releases keys.
 */
@Injectable()
export class IdempotencyKeysService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * The keys among `keys` this staff member holds (the interceptor's own scoping: the actor kind and
   * id), one row each; the others are left out. Keys are UUIDs (the caller validates them), at most
   * KNOWN_KEYS_MAX; one indexed read on `idempotency_keys_actor_key`.
   */
  async knownToStaff(userId: number, keys: readonly string[]): Promise<KnownIdempotencyKey[]> {
    const unique = [...new Set(keys.map((key) => key.toLowerCase()))];
    if (unique.length === 0) return [];
    const rows = await this.db
      .select({
        key: idempotencyKeys.key,
        status: idempotencyKeys.status,
        createdAt: idempotencyKeys.createdAt,
        method: idempotencyKeys.method,
        path: idempotencyKeys.path,
        responseStatus: idempotencyKeys.responseStatus,
        resultId: sql<string | null>`CASE
          WHEN jsonb_typeof(${idempotencyKeys.responseBody} -> 'id') = 'number'
            AND (${idempotencyKeys.responseBody} ->> 'id') ~ '^[0-9]{1,15}$'
          THEN ${idempotencyKeys.responseBody} ->> 'id' END`,
      })
      .from(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.actorKind, 'STAFF'),
          eq(idempotencyKeys.actorId, userId),
          inArray(idempotencyKeys.key, unique),
        ),
      );
    return rows.map((row) => ({
      key: row.key,
      status: row.status,
      createdAt: row.createdAt,
      method: row.method,
      path: row.path,
      responseStatus: row.responseStatus,
      resultId: row.resultId === null ? null : Number.parseInt(row.resultId, 10),
    }));
  }
}
