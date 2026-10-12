import { Injectable, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { CatalogModule } from '../catalog';
import { IdentityModule, WAREHOUSE_CREATED_HOOK } from '../identity';
import { PartnersModule } from '../partners';
import { BinsController, ProductLocationsController } from './controllers/bins.controller';
import {
  AdjustmentLinesController,
  AdjustmentsController,
  BinMovesController,
} from './controllers/moves-adjustments.controller';
import { ReceiptLinesController, ReceiptsController } from './controllers/receipts.controller';
import { StockController } from './controllers/stock.controller';
import { StocktakesController } from './controllers/stocktakes.controller';
import { TransferLinesController, TransfersController } from './controllers/transfers.controller';
import { AdjustmentsService } from './services/adjustments.service';
import { BinMovesService } from './services/bin-moves.service';
import { BinsService } from './services/bins.service';
import { ProductLocationsService } from './services/product-locations.service';
import { ReceiptsService } from './services/receipts.service';
import { StockPostingService } from './services/stock-posting.service';
import { StockQueryService } from './services/stock-query.service';
import { StocktakesService } from './services/stocktakes.service';
import { SystemBinsService } from './services/system-bins.service';
import { TransfersService } from './services/transfers.service';

const CORE_SERVICES = [
  AdjustmentsService,
  BinMovesService,
  BinsService,
  ProductLocationsService,
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

/** Creates the system bins of warehouses made before inventory existed, before requests arrive. */
@Injectable()
export class InventoryBootstrap implements OnApplicationBootstrap {
  constructor(private readonly systemBins: SystemBinsService) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.systemBins.backfill();
  }
}

/** The HTTP side of inventory (api only). */
@Module({
  imports: [InventoryModule],
  controllers: [
    BinsController,
    ProductLocationsController,
    ReceiptsController,
    ReceiptLinesController,
    BinMovesController,
    AdjustmentsController,
    AdjustmentLinesController,
    StockController,
    StocktakesController,
    TransfersController,
    TransferLinesController,
  ],
  providers: [InventoryBootstrap],
})
export class InventoryHttpModule {}
