import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import { int, rowsOf } from './report-sql';

export interface RefreshState {
  /** The time the daily sales totals are as of. */
  refreshedAt: Date | null;
  durationMs: number | null;
}

/** «Шинэчлэх» rebuilds the totals at most once a minute; the job every 15 minutes (ADR-0108 #6). */
export const MANUAL_REFRESH_GAP_MS = 60_000;

/**
 * The daily sales totals `reporting.mv_sales_daily` (ADR-0108 #6): rebuilt by
 * `reporting.refresh_sales()`, which runs as the view's owner, one call at a time.
 */
@Injectable()
export class RefreshService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async state(): Promise<RefreshState> {
    const [row] = await rowsOf<{ refreshed_at: Date | null; duration_ms: unknown }>(
      this.db,
      sql`SELECT refreshed_at, duration_ms FROM reporting.refresh_state WHERE id = 1`,
    );
    return {
      refreshedAt: row?.refreshed_at ? new Date(row.refreshed_at) : null,
      durationMs:
        row?.duration_ms === null || row?.duration_ms === undefined ? null : int(row.duration_ms),
    };
  }

  /** Rebuilds now (the job), or returns the state when another rebuild holds the lock. */
  async refresh(): Promise<RefreshState> {
    await this.db.execute(sql`SELECT reporting.refresh_sales()`);
    return this.state();
  }

  /** «Шинэчлэх»: rebuilds unless the totals are younger than a minute. */
  async refreshByUser(now: Date = new Date()): Promise<RefreshState> {
    const current = await this.state();
    if (
      current.refreshedAt &&
      now.getTime() - current.refreshedAt.getTime() < MANUAL_REFRESH_GAP_MS
    ) {
      return current;
    }
    return this.refresh();
  }
}
