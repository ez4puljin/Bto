import { Injectable, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { JobWorkerService } from '../../common/jobs/worker/job-worker.service';
import { JobsWorkerModule } from '../../common/jobs/worker/jobs-worker.module';
import { CatalogModule } from '../catalog';
import { ErxesFactsModule } from '../erxes';
import { FinBridgeModule } from '../fin-bridge';
import { FinanceModule } from '../finance';
import { IdentityModule } from '../identity';
import { PartnersModule } from '../partners';
import { PricingModule } from '../pricing';
import { ErkhetController } from './controllers/erkhet.controller';
import { ErkhetLedgerController } from './controllers/erkhet-ledger.controller';
import { ErkhetLedgerJob, ErkhetLedgerNightlyJob } from './jobs/erkhet-ledger.job';
import { ErkhetNightlyJob } from './jobs/erkhet-nightly.job';
import { ErkhetSyncJob } from './jobs/erkhet-sync.job';
import { ErkhetApplyService } from './services/erkhet-apply.service';
import { ErkhetLedgerFlowService } from './services/erkhet-ledger-flow.service';
import { ErkhetLedgerService } from './services/erkhet-ledger.service';
import { ErkhetRunFlowService } from './services/erkhet-run-flow.service';
import { ErkhetSettingsFlowService } from './services/erkhet-settings-flow.service';
import { ErkhetSyncService } from './services/erkhet-sync.service';

// fin-bridge posts the copies of Erkhet's transactions; finance reverses Bto's own documents that
// would count twice beside them (ADR-0219).
const IMPORTS = [
  IdentityModule,
  PartnersModule,
  CatalogModule,
  PricingModule,
  FinBridgeModule,
  FinanceModule,
];

/**
 * «Эрхэт тулгалт» in the api (docs/modules/erkhet.md, ADR-0203): the sign-in, starting a check,
 * reading what it found and bringing Bto to Erkhet. Nobody imports this module. `ErkhetGateway`
 * comes from the global ErkhetIntegrationModule of the composition root.
 */
@Module({
  // ADR-0223: «Bto-д нэмэх» files a product as erxes files it (read only).
  imports: [...IMPORTS, ErxesFactsModule],
  providers: [
    ErkhetSettingsFlowService,
    ErkhetSyncService,
    ErkhetApplyService,
    ErkhetLedgerService,
  ],
  controllers: [ErkhetController, ErkhetLedgerController],
})
export class ErkhetHttpModule {}

/** Registers the erkhet jobs and the night's schedule once the worker has started (worker only). */
@Injectable()
export class ErkhetJobsBootstrap implements OnApplicationBootstrap {
  constructor(
    private readonly worker: JobWorkerService,
    private readonly sync: ErkhetSyncJob,
    private readonly nightly: ErkhetNightlyJob,
    private readonly ledger: ErkhetLedgerJob,
    private readonly ledgerNightly: ErkhetLedgerNightlyJob,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.worker.register(this.sync);
    await this.worker.register(this.nightly);
    await this.worker.register(this.ledger);
    await this.worker.register(this.ledgerNightly);
  }
}

/** The worker's side: the check itself and the night's schedule. */
@Module({
  imports: [...IMPORTS, JobsWorkerModule],
  providers: [
    ErkhetSettingsFlowService,
    ErkhetSyncService,
    ErkhetRunFlowService,
    ErkhetLedgerService,
    ErkhetLedgerFlowService,
    ErkhetSyncJob,
    ErkhetNightlyJob,
    ErkhetLedgerJob,
    ErkhetLedgerNightlyJob,
    ErkhetJobsBootstrap,
  ],
})
export class ErkhetWorkerModule {}
