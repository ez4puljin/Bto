import { Module } from '@nestjs/common';
import type { Pool } from 'pg';
import { DB_POOL } from '../common/db/db.tokens';
import { createFinDb, FIN_DB } from './db/fin-db';

/**
 * The Finance Core (ADR-0069): empty in P0b apart from its own database handle. It needs only the
 * process's `DB_POOL` (and from A1 the job providers), never a Bto module; P1 adds the organisation,
 * P2 the ledger, P3 the intake (docs/modules/finance-core.md §16).
 */
@Module({
  providers: [
    { provide: FIN_DB, inject: [DB_POOL], useFactory: (pool: Pool) => createFinDb(pool) },
  ],
  exports: [FIN_DB],
})
export class FinanceCoreModule {}
