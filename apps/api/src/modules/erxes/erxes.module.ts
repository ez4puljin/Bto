import { Injectable, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { JobWorkerService } from '../../common/jobs/worker/job-worker.service';
import { JobsWorkerModule } from '../../common/jobs/worker/jobs-worker.module';
import { CatalogModule } from '../catalog';
import { IdentityModule } from '../identity';
import { InventoryModule } from '../inventory';
import { PartnersModule } from '../partners';
import { SalesModule } from '../sales';
import { ErxesController } from './controllers/erxes.controller';
import { ErxesStockController } from './controllers/erxes-stock.controller';
import { ERXES_FETCH, type ErxesFetch } from './erxes.client';
import { ErxesPullJob } from './jobs/erxes-pull.job';
import { ErxesStockReadJob } from './jobs/erxes-stock-read.job';
import { ErxesCopyService } from './services/erxes-copy.service';
import { ErxesDealsService } from './services/erxes-deals.service';
import { ErxesDirectoryFlowService } from './services/erxes-directory-flow.service';
import { ErxesProductMatchService } from './services/erxes-product-match.service';
import { ErxesPullFlowService } from './services/erxes-pull-flow.service';
import { ErxesRangeFlowService } from './services/erxes-range-flow.service';
import { ErxesSettingsFlowService } from './services/erxes-settings-flow.service';
import {
  DEFAULT_STOCK_PACE,
  ERXES_STOCK_PACE,
  ErxesStockRunFlowService,
} from './services/erxes-stock-run-flow.service';
import { ErxesStockService } from './services/erxes-stock.service';

const IMPORTS = [IdentityModule, PartnersModule, CatalogModule, SalesModule, InventoryModule];

/** The module's own way out to erxes; tests replace ERXES_FETCH with a scripted fetch. */
const PROVIDERS = [
  { provide: ERXES_FETCH, useValue: ((url, init) => fetch(url, init)) satisfies ErxesFetch },
  { provide: ERXES_STOCK_PACE, useValue: DEFAULT_STOCK_PACE },
  ErxesSettingsFlowService,
  ErxesDirectoryFlowService,
  ErxesProductMatchService,
  ErxesCopyService,
  ErxesDealsService,
  ErxesPullFlowService,
  ErxesRangeFlowService,
  ErxesStockService,
  ErxesStockRunFlowService,
];

/**
 * erxes's deals as Bto's draft orders, in the api (docs/modules/erxes.md, ADR-0218): the sign-in,
 * the pipelines, the users, the list «Erxes-ээс ирсэн», «Одоо татах» and the order panel's
 * section. Nobody imports this module.
 */
@Module({
  imports: IMPORTS,
  providers: PROVIDERS,
  controllers: [ErxesController, ErxesStockController],
})
export class ErxesHttpModule {}

/** Registers the every-minute pull and the stock read once the worker has started (worker only). */
@Injectable()
export class ErxesJobsBootstrap implements OnApplicationBootstrap {
  constructor(
    private readonly worker: JobWorkerService,
    private readonly pull: ErxesPullJob,
    private readonly stockRead: ErxesStockReadJob,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.worker.register(this.pull);
    await this.worker.register(this.stockRead);
  }
}

/** The worker's side: the pull every minute and Erkhet's stock reads (ADR-0221). */
@Module({
  imports: [...IMPORTS, JobsWorkerModule],
  providers: [...PROVIDERS, ErxesPullJob, ErxesStockReadJob, ErxesJobsBootstrap],
})
export class ErxesWorkerModule {}
