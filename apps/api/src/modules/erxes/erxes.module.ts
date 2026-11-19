import { Injectable, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { JobWorkerService } from '../../common/jobs/worker/job-worker.service';
import { JobsWorkerModule } from '../../common/jobs/worker/jobs-worker.module';
import { CatalogModule } from '../catalog';
import { IdentityModule } from '../identity';
import { PartnersModule } from '../partners';
import { SalesModule } from '../sales';
import { ErxesController } from './controllers/erxes.controller';
import { ERXES_FETCH, type ErxesFetch } from './erxes.client';
import { ErxesPullJob } from './jobs/erxes-pull.job';
import { ErxesCopyService } from './services/erxes-copy.service';
import { ErxesDealsService } from './services/erxes-deals.service';
import { ErxesDirectoryFlowService } from './services/erxes-directory-flow.service';
import { ErxesPullFlowService } from './services/erxes-pull-flow.service';
import { ErxesSettingsFlowService } from './services/erxes-settings-flow.service';

const IMPORTS = [IdentityModule, PartnersModule, CatalogModule, SalesModule];

/** The module's own way out to erxes; tests replace ERXES_FETCH with a scripted fetch. */
const PROVIDERS = [
  { provide: ERXES_FETCH, useValue: ((url, init) => fetch(url, init)) satisfies ErxesFetch },
  ErxesSettingsFlowService,
  ErxesDirectoryFlowService,
  ErxesCopyService,
  ErxesDealsService,
  ErxesPullFlowService,
];

/**
 * erxes's deals as Bto's draft orders, in the api (docs/modules/erxes.md, ADR-0218): the sign-in,
 * the pipelines, the users, the list «Erxes-ээс ирсэн», «Одоо татах» and the order panel's
 * section. Nobody imports this module.
 */
@Module({
  imports: IMPORTS,
  providers: PROVIDERS,
  controllers: [ErxesController],
})
export class ErxesHttpModule {}

/** Registers the every-minute pull once the worker has started (worker only). */
@Injectable()
export class ErxesJobsBootstrap implements OnApplicationBootstrap {
  constructor(
    private readonly worker: JobWorkerService,
    private readonly pull: ErxesPullJob,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.worker.register(this.pull);
  }
}

/** The worker's side: the pull every minute. */
@Module({
  imports: [...IMPORTS, JobsWorkerModule],
  providers: [...PROVIDERS, ErxesPullJob, ErxesJobsBootstrap],
})
export class ErxesWorkerModule {}
