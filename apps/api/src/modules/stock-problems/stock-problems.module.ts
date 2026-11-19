import { Injectable, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { JobWorkerService } from '../../common/jobs/worker/job-worker.service';
import { JobsWorkerModule } from '../../common/jobs/worker/jobs-worker.module';
import { CatalogModule } from '../catalog';
import { IdentityModule } from '../identity';
import { InventoryModule } from '../inventory';
import { PartnersModule } from '../partners';
import { PosModule } from '../pos';
import { StockProblemsController } from './controllers/stock-problems.controller';
import { MorningSheetsJob } from './jobs/morning-sheets.job';
import { ProblemSourcesService } from './services/problem-sources.service';
import { StockProblemSheetsService } from './services/stock-problem-sheets.service';
import { StockProblemsService } from './services/stock-problems.service';

const SERVICES = [ProblemSourcesService, StockProblemsService, StockProblemSheetsService];

/**
 * «Асуудалтай бараа» (docs/modules/stock-problems.md, ADR-0230): the products whose stock the
 * system got wrong, per warehouse, and what puts them right. It reads the tills' shortfalls (pos)
 * and the orders' cut lines, moves stock only through inventory's goods issues and adjustments,
 * and nobody imports it.
 */
@Module({
  imports: [IdentityModule, CatalogModule, PartnersModule, InventoryModule, PosModule],
  providers: SERVICES,
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

/** The worker side: the morning sheets (ADR-0230 #6). */
@Module({
  imports: [StockProblemsModule, JobsWorkerModule],
  providers: [MorningSheetsJob, StockProblemsJobsBootstrap],
})
export class StockProblemsWorkerModule {}
