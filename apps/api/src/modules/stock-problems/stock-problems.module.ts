import { Injectable, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { JobWorkerService } from '../../common/jobs/worker/job-worker.service';
import { JobsWorkerModule } from '../../common/jobs/worker/jobs-worker.module';
import { CatalogModule } from '../catalog';
import { IdentityModule } from '../identity';
import { InventoryModule } from '../inventory';
import { PartnersModule } from '../partners';
import { PosModule, PosQueryService } from '../pos';
import { StockProblemsController } from './controllers/stock-problems.controller';
import { MorningSheetsJob } from './jobs/morning-sheets.job';
import { ProblemSourcesService } from './services/problem-sources.service';
import { ShortfallResolver, WorkerShortfallResolver } from './services/shortfall-resolver';
import { StockProblemSheetsService } from './services/stock-problem-sheets.service';
import { StockProblemsService } from './services/stock-problems.service';

const SERVICES = [ProblemSourcesService, StockProblemsService, StockProblemSheetsService];
/** What both sides need; neither constructs the pos module's PIN hasher through these. */
const COMMON_IMPORTS = [IdentityModule, CatalogModule, PartnersModule, InventoryModule];

/**
 * «Асуудалтай бараа» (docs/modules/stock-problems.md, ADR-0230): the products whose stock the
 * system got wrong, per warehouse, and what puts them right. It reads the tills' shortfalls (pos)
 * and the orders' cut lines, moves stock only through inventory's goods issues and adjustments,
 * and nobody imports it. The api side binds the shortfalls' resolve to pos; the worker side does
 * not import pos at all (its PinHasher needs AUTH_PEPPER, which the worker is not given).
 */
@Module({
  imports: [...COMMON_IMPORTS, PosModule],
  providers: [...SERVICES, { provide: ShortfallResolver, useExisting: PosQueryService }],
  exports: SERVICES,
})
export class StockProblemsModule {}

/** The HTTP side (api only). */
@Module({
  imports: [StockProblemsModule],
  controllers: [StockProblemsController],
})
export class StockProblemsHttpModule {}

/** Registers the 07:00 sheets once the worker has started (worker only). */
@Injectable()
export class StockProblemsJobsBootstrap implements OnApplicationBootstrap {
  constructor(
    private readonly worker: JobWorkerService,
    private readonly morning: MorningSheetsJob,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.worker.register(this.morning);
  }
}

/**
 * The worker side: the morning sheets (ADR-0230 #6). Its own copy of the services without the pos
 * module: the 07:00 build reads the shortfalls by plain SQL and never resolves one.
 */
@Module({
  imports: [...COMMON_IMPORTS, JobsWorkerModule],
  providers: [
    ...SERVICES,
    { provide: ShortfallResolver, useClass: WorkerShortfallResolver },
    MorningSheetsJob,
    StockProblemsJobsBootstrap,
  ],
})
export class StockProblemsWorkerModule {}
