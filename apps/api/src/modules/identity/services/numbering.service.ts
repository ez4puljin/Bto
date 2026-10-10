import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '../../../common/db/db.types';
import { numberSequences } from '../schema';

/**
 * Gap-free document numbers (ADR-0002 #7, SPEC §6.13). Call inside the posting transaction under
 * READ COMMITTED (the default of `inTransaction`): the upsert locks the (scope, period) row until
 * commit, so concurrent callers queue and a rollback gives its number back.
 */
@Injectable()
export class NumberingService {
  /** The next value for `scopeKey` (e.g. `GR`, `BILLID:<posNo>`) in `period` (e.g. `2026`). */
  async next(tx: Tx, scopeKey: string, period: string): Promise<number> {
    const rows = await tx
      .insert(numberSequences)
      .values({ scopeKey, period, lastValue: 1 })
      .onConflictDoUpdate({
        target: [numberSequences.scopeKey, numberSequences.period],
        set: { lastValue: sql`${numberSequences.lastValue} + 1` },
      })
      .returning({ value: numberSequences.lastValue });
    const value = rows[0]?.value;
    if (value === undefined) throw new Error(`number sequence ${scopeKey}/${period} not returned`);
    return value;
  }
}
