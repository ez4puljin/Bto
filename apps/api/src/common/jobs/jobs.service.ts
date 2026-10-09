import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { fromDrizzle, type PgBoss, type SendOptions } from 'pg-boss';
import type { Tx } from '../db/db.types';
import type { JobName, JobPayloads } from './job-registry';
import { PG_BOSS } from './pg-boss.provider';

export type EnqueueOptions = Omit<SendOptions, 'db'>;

/** Transactional enqueue (outbox semantics, ADR-0013). */
@Injectable()
export class JobsService {
  constructor(@Inject(PG_BOSS) private readonly boss: PgBoss) {}

  /**
   * Inserts the job inside `tx` through pg-boss's Drizzle adapter (every value is a bound parameter).
   * The job exists only if `tx` commits. Returns the job id, or null when a singleton or throttle
   * policy dropped it.
   */
  enqueue<N extends JobName>(
    tx: Tx,
    name: N,
    payload: JobPayloads[N],
    options: EnqueueOptions = {},
  ): Promise<string | null> {
    return this.boss.send(name, payload, { ...options, db: fromDrizzle(tx, sql) });
  }
}
