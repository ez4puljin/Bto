import { Injectable, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { JobWorkerService } from '../../common/jobs/worker/job-worker.service';
import { JobsWorkerModule } from '../../common/jobs/worker/jobs-worker.module';
import { CatalogModule } from '../catalog';
import { IdentityModule } from '../identity';
import { InventoryModule } from '../inventory';
import { PartnersModule } from '../partners';
import { PricingModule } from '../pricing';
import { ImportsController } from './controllers/imports.controller';
import { CustomersImporter } from './importers/customers.importer';
import { LevelsImporter } from './importers/levels.importer';
import { OpeningStockImporter } from './importers/opening-stock.importer';
import { PricesImporter } from './importers/prices.importer';
import { ProductsImporter } from './importers/products.importer';
import { SuppliersImporter } from './importers/suppliers.importer';
import { CommitImportJob } from './jobs/commit-import.job';
import { ImportsHousekeepingJob } from './jobs/housekeeping.job';
import { RevertImportJob } from './jobs/revert-import.job';
import { ValidateImportJob } from './jobs/validate-import.job';
import { ImportPipelineService } from './services/import-pipeline.service';
import { ImportsHousekeepingService } from './services/imports-housekeeping.service';
import { ImportsService } from './services/imports.service';

const CORE_SERVICES = [
  CustomersImporter,
  LevelsImporter,
  ImportPipelineService,
  ImportsService,
  OpeningStockImporter,
  PricesImporter,
  ProductsImporter,
  SuppliersImporter,
];

/** Import services every process may use (the api requests, the worker carries out). */
@Module({
  imports: [IdentityModule, CatalogModule, PartnersModule, InventoryModule, PricingModule],
  providers: CORE_SERVICES,
  exports: CORE_SERVICES,
})
export class ImportsModule {}

/** The HTTP side of imports (api only). */
@Module({ imports: [ImportsModule], controllers: [ImportsController] })
export class ImportsHttpModule {}

/** Registers the import jobs (and the housekeeping schedule) once the worker has started. */
@Injectable()
export class ImportsJobsBootstrap implements OnApplicationBootstrap {
  constructor(
    private readonly worker: JobWorkerService,
    private readonly validate: ValidateImportJob,
    private readonly commit: CommitImportJob,
    private readonly revert: RevertImportJob,
    private readonly housekeeping: ImportsHousekeepingJob,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.worker.register(this.validate);
    await this.worker.register(this.commit);
    await this.worker.register(this.revert);
    await this.worker.register(this.housekeeping);
  }
}

/** The worker side of imports: the three pipeline jobs and the nightly housekeeping (ADR-0040). */
@Module({
  imports: [ImportsModule, IdentityModule, JobsWorkerModule],
  providers: [
    ValidateImportJob,
    CommitImportJob,
    RevertImportJob,
    ImportsHousekeepingService,
    ImportsHousekeepingJob,
    ImportsJobsBootstrap,
  ],
})
export class ImportsWorkerModule {}
