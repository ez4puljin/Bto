import { Injectable, Module, type OnApplicationBootstrap } from '@nestjs/common';
import type { Pool } from 'pg';
import { DB_POOL } from '../common/db/db.tokens';
import { assertNoStaticCaller } from './context/static-caller-guard';
import { createFinDb, FIN_DB } from './db/fin-db';
import { FinOrgService } from './org/org.service';
import { FinPartiesService } from './parties/parties.service';

/** Refuses to start a production process in which the test StaticCaller was loaded (ADR-0084 #4). */
@Injectable()
class FinBootGuard implements OnApplicationBootstrap {
  onApplicationBootstrap(): void {
    assertNoStaticCaller();
  }
}

/**
 * The Finance Core (ADR-0069): its own database handle, the organisation (P1) — companies and
 * parties behind `FinCallContext` — and the boot guard. It needs only the process's `DB_POOL`,
 * never a Bto module; P2 adds the ledger, P3 the intake (docs/modules/finance-core.md §16).
 */
@Module({
  providers: [
    { provide: FIN_DB, inject: [DB_POOL], useFactory: (pool: Pool) => createFinDb(pool) },
    FinOrgService,
    FinPartiesService,
    FinBootGuard,
  ],
  exports: [FIN_DB, FinOrgService, FinPartiesService],
})
export class FinanceCoreModule {}
