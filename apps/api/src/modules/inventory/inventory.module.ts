import { Injectable, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { JobWorkerService } from '../../common/jobs/worker/job-worker.service';
import { JobsWorkerModule } from '../../common/jobs/worker/jobs-worker.module';
import { CatalogModule } from '../catalog';
import { IdentityModule, WAREHOUSE_CREATED_HOOK } from '../identity';
import { PartnersModule } from '../partners';
import { InventoryAttentionController } from './controllers/attention.controller';
import { BinsController, ProductLocationsController } from './controllers/bins.controller';
import { IssueLinesController, IssuesController } from './controllers/issues.controller';
import {
  AdjustmentLinesController,
  AdjustmentsController,
  BinMovesController,
} from './controllers/moves-adjustments.controller';
import { ProductRegistrationsController } from './controllers/product-registrations.controller';
import { ReceiptLinesController, ReceiptsController } from './controllers/receipts.controller';
import { StockController } from './controllers/stock.controller';
import { StocktakesController } from './controllers/stocktakes.controller';
import { TransferLinesController, TransfersController } from './controllers/transfers.controller';
import { ReconcileJob } from './jobs/reconcile.job';
import { SnapshotMonthlyJob } from './jobs/snapshot-monthly.job';
import { AdjustmentsService } from './services/adjustments.service';
import { InventoryAttentionService } from './services/attention.service';
import { BinMovesService } from './services/bin-moves.service';
import { BinsService } from './services/bins.service';
import { ProductLocationsService } from './services/product-locations.service';
import { ProductRegistrationService } from './services/product-registration.service';
import { PurchaseBooksService } from './services/purchase-books.service';
import { ReceiptsService } from './services/receipts.service';
import { ReservationService } from './services/reservation.service';
import { StockPostingService } from './services/stock-posting.service';
import { GoodsIssuesService } from './services/goods-issues.service';
import { IssueExpenseTypesService } from './services/issue-expense-types.service';
import { StockQueryService } from './services/stock-query.service';
import { StocktakesService } from './services/stocktakes.service';
import { SystemBinsService } from './services/system-bins.service';
import { TransfersService } from './services/transfers.service';

const CORE_SERVICES = [
  AdjustmentsService,
  GoodsIssuesService,
  IssueExpenseTypesService,
  InventoryAttentionService,
  BinMovesService,
  BinsService,
  ProductLocationsService,
  ProductRegistrationService,
  PurchaseBooksService,
  ReservationService,
  ReceiptsService,
  StockPostingService,
  StockQueryService,
  StocktakesService,
  SystemBinsService,
  TransfersService,
];

/**
 * Inventory services every process may use (api, worker jobs, imports). Binding identity's
 * WAREHOUSE_CREATED_HOOK here makes every new warehouse get its system bins in its creating
 * transaction (identity resolves the hook with ModuleRef, strict: false).
 */
@Module({
  imports: [IdentityModule, CatalogModule, PartnersModule],
  providers: [
    ...CORE_SERVICES,
    { provide: WAREHOUSE_CREATED_HOOK, useExisting: SystemBinsService },
  ],
  exports: CORE_SERVICES,
})
export class InventoryModule {}

/**
 * Creates the system bins of warehouses made before inventory existed and the default expense types
 * of goods issues (ADR-0081), before requests arrive.
 */
@Injectable()
export class InventoryBootstrap implements OnApplicationBootstrap {
  constructor(
    private readonly systemBins: SystemBinsService,
    private readonly expenseTypes: IssueExpenseTypesService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.systemBins.backfill();
    await this.expenseTypes.ensureDefaults();
  }
}

/** The HTTP side of inventory (api only). */
@Module({
  imports: [InventoryModule],
  controllers: [
    BinsController,
    IssuesController,
    IssueLinesController,
    ProductLocationsController,
    ProductRegistrationsController,
    ReceiptsController,
    ReceiptLinesController,
    BinMovesController,
    AdjustmentsController,
    AdjustmentLinesController,
    StockController,
    StocktakesController,
    TransfersController,
    TransferLinesController,
    InventoryAttentionController,
  ],
  providers: [InventoryBootstrap],
})
export class InventoryHttpModule {}

/** Registers the inventory jobs and their schedules once the worker has started (worker only). */
@Injectable()
export class InventoryJobsBootstrap implements OnApplicationBootstrap {
  constructor(
    private readonly worker: JobWorkerService,
    private readonly reconcile: ReconcileJob,
    private readonly snapshotMonthly: SnapshotMonthlyJob,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.worker.register(this.reconcile);
    await this.worker.register(this.snapshotMonthly);
  }
}

/** The worker side of inventory: the nightly reconciliation and the monthly snapshot (ADR-0040). */
@Module({
  imports: [InventoryModule, JobsWorkerModule],
  providers: [ReconcileJob, SnapshotMonthlyJob, InventoryJobsBootstrap],
})
export class InventoryWorkerModule {}
