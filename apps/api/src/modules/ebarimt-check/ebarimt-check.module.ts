import { Injectable, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { JobWorkerService } from '../../common/jobs/worker/job-worker.service';
import { JobsWorkerModule } from '../../common/jobs/worker/jobs-worker.module';
import { IdentityModule } from '../identity';
import { InventoryModule } from '../inventory';
import { PartnersModule } from '../partners';
import { ProcurementModule } from '../procurement';
import { EbarimtCheckController } from './controllers/ebarimt-check.controller';
import { EbarimtPullJob } from './jobs/ebarimt-pull.job';
import { EbarimtConnectionService } from './services/ebarimt-connection.service';
import { EbarimtDataService } from './services/ebarimt-data.service';
import { EbarimtEditsService } from './services/ebarimt-edits.service';
import { EbarimtFilesService } from './services/ebarimt-files.service';
import { EbarimtHistoryService } from './services/ebarimt-history.service';
import { EbarimtPullFlowService } from './services/ebarimt-pull-flow.service';
import { EbarimtReportService } from './services/ebarimt-report.service';
import { EbarimtSettingsService } from './services/ebarimt-settings.service';

const IMPORTS = [IdentityModule, PartnersModule, InventoryModule, ProcurementModule];
/** What a pull reads beside its own tables: the suppliers (their registers) and identity's audit. */
const PULL_IMPORTS = [IdentityModule, PartnersModule];

/** What a pull needs, in the api («Одоо татах») and in the worker (the night's pull). */
const PULL_PROVIDERS = [
  EbarimtDataService,
  EbarimtHistoryService,
  EbarimtFilesService,
  EbarimtConnectionService,
  EbarimtPullFlowService,
];

/**
 * «Ebarimt» (docs/modules/ebarimt-check.md, ADR-0168): a month's purchases from the posted goods
 * receipts against e-Barimt's file, by supplier. It reads the other modules and attaches its file
 * through identity's storage; nobody imports it, and it posts nothing and moves no stock or money.
 * A month's file may also come from e-Barimt's API (ADR-0228): `EbarimtApiGateway` comes from the
 * global EbarimtIntegrationModule of the composition roots.
 */
@Module({
  imports: IMPORTS,
  providers: [...PULL_PROVIDERS, EbarimtSettingsService, EbarimtEditsService, EbarimtReportService],
  controllers: [EbarimtCheckController],
})
export class EbarimtCheckHttpModule {}

/** Registers the night's pull once the worker has started (worker only). */
@Injectable()
export class EbarimtCheckJobsBootstrap implements OnApplicationBootstrap {
  constructor(
    private readonly worker: JobWorkerService,
    private readonly pull: EbarimtPullJob,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.worker.register(this.pull);
  }
}

/**
 * The worker's side: the night's pull from e-Barimt's API. It imports only what a pull needs:
 * procurement's module wants the api's LLM gateway, which the worker has not.
 */
@Module({
  imports: [...PULL_IMPORTS, JobsWorkerModule],
  providers: [...PULL_PROVIDERS, EbarimtPullJob, EbarimtCheckJobsBootstrap],
})
export class EbarimtCheckWorkerModule {}
