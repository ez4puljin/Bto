import { Injectable, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { JobWorkerService } from '../../common/jobs/worker/job-worker.service';
import { JobsWorkerModule } from '../../common/jobs/worker/jobs-worker.module';
import { CatalogModule } from '../catalog';
import { IdentityModule } from '../identity';
import { PartnersModule } from '../partners';
import { PricingModule } from '../pricing';
import { ErkhetController } from './controllers/erkhet.controller';
import { ErkhetNightlyJob } from './jobs/erkhet-nightly.job';
import { ErkhetSyncJob } from './jobs/erkhet-sync.job';
import { ErkhetApplyService } from './services/erkhet-apply.service';
import { ErkhetRunFlowService } from './services/erkhet-run-flow.service';
import { ErkhetSettingsFlowService } from './services/erkhet-settings-flow.service';
import { ErkhetSyncService } from './services/erkhet-sync.service';

const IMPORTS = [IdentityModule, PartnersModule, CatalogModule, PricingModule];

/**
 * «Эрхэт тулгалт» in the api (docs/modules/erkhet.md, ADR-0203): the sign-in, starting a check,
 * reading what it found and bringing Bto to Erkhet. Nobody imports this module. `ErkhetGateway`
 * comes from the global ErkhetIntegrationModule of the composition root.
 */
@Module({
  imports: IMPORTS,
  providers: [ErkhetSettingsFlowService, ErkhetSyncService, ErkhetApplyService],
  controllers: [ErkhetController],
})
export class ErkhetHttpModule {}

/** Registers the erkhet jobs and the night's schedule once the worker has started (worker only). */
@Injectable()
export class ErkhetJobsBootstrap implements OnApplicationBootstrap {
  constructor(
    private readonly worker: JobWorkerService,
    private readonly sync: ErkhetSyncJob,
    private readonly nightly: ErkhetNightlyJob,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.worker.register(this.sync);
    await this.worker.register(this.nightly);
  }
}

/** The worker's side: the check itself and the night's schedule. */
@Module({
  imports: [...IMPORTS, JobsWorkerModule],
  providers: [
    ErkhetSettingsFlowService,
    ErkhetSyncService,
    ErkhetRunFlowService,
    ErkhetSyncJob,
    ErkhetNightlyJob,
    ErkhetJobsBootstrap,
  ],
})
export class ErkhetWorkerModule {}
