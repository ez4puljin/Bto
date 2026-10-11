import { Injectable, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { CatalogModule } from '../catalog';
import { IdentityModule, WAREHOUSE_CREATED_HOOK } from '../identity';
import { PartnersModule } from '../partners';
import { BinsController, ProductLocationsController } from './controllers/bins.controller';
import { ReceiptLinesController, ReceiptsController } from './controllers/receipts.controller';
import { BinsService } from './services/bins.service';
import { ProductLocationsService } from './services/product-locations.service';
import { ReceiptsService } from './services/receipts.service';
import { StockPostingService } from './services/stock-posting.service';
import { SystemBinsService } from './services/system-bins.service';

const CORE_SERVICES = [
  BinsService,
  ProductLocationsService,
  ReceiptsService,
  StockPostingService,
  SystemBinsService,
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
  ],
  providers: [InventoryBootstrap],
})
export class InventoryHttpModule {}
