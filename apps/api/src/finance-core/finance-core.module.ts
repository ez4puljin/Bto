import { Injectable, Module, type OnApplicationBootstrap } from '@nestjs/common';
import type { Pool } from 'pg';
import { DB_POOL } from '../common/db/db.tokens';
import { assertNoStaticCaller } from './context/static-caller-guard';
import { createFinDb, FIN_DB } from './db/fin-db';
import { FinChartService } from './ledger/chart.service';
import { FinOrgService } from './org/org.service';
import { FinPartiesService } from './parties/parties.service';
import { FinJournalPosting } from './posting/journal-posting.service';
import { FinJournalReader } from './posting/journal-reader.service';
import { FinConfig } from './config/fin-config.service';
import { FinReader } from './posting/fin-reader.service';
import { FinIntakeInTx } from './posting/intake.service';

/** Refuses to start a production process in which the test StaticCaller was loaded (ADR-0084 #4). */
@Injectable()
class FinBootGuard implements OnApplicationBootstrap {
  onApplicationBootstrap(): void {
    assertNoStaticCaller();
  }
}

/**
 * The Finance Core (ADR-0069): its own database handle, the organisation (P1) — companies and
 * parties behind `FinCallContext` —, the ledger (F1, ADR-0089) — the chart, rules, money accounts,
 * the journal's posting façade and reads — and the boot guard. It needs only the process's
 * `DB_POOL`, never a Bto module; F2 (ADR-0090) adds the intake, its reader and the configuration port.
 */
@Module({
  providers: [
    { provide: FIN_DB, inject: [DB_POOL], useFactory: (pool: Pool) => createFinDb(pool) },
    FinOrgService,
    FinPartiesService,
    FinChartService,
    FinJournalPosting,
    FinJournalReader,
    FinIntakeInTx,
    FinReader,
    FinConfig,
    FinBootGuard,
  ],
  exports: [
    FIN_DB,
    FinOrgService,
    FinPartiesService,
    FinChartService,
    FinJournalPosting,
    FinJournalReader,
    FinIntakeInTx,
    FinReader,
    FinConfig,
  ],
})
export class FinanceCoreModule {}
