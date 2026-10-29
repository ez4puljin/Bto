import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog';
import { IdentityModule } from '../identity';
import { InventoryModule, RECEIPT_PROGRESS } from '../inventory';
import { PartnersModule } from '../partners';
import {
  PurchaseOrdersController,
  SupplierOrderersController,
} from './controllers/purchase-orders.controller';
import { OrderHistoryService } from './services/order-history.service';
import { OrderProgressService } from './services/order-progress.service';
import { PurchaseOrderGridService } from './services/purchase-order-grid.service';
import { PurchaseOrdersService } from './services/purchase-orders.service';
import { SupplierOrderersService } from './services/supplier-orderers.service';

/**
 * Purchase orders by supplier (ADR-0115, docs/modules/procurement.md). It binds inventory's
 * RECEIPT_PROGRESS, so a supplier follows its receipt from the keepers' confirmation to the
 * accountant's price check without inventory importing this module.
 */
@Module({
  imports: [IdentityModule, CatalogModule, PartnersModule, InventoryModule],
  providers: [
    PurchaseOrdersService,
    PurchaseOrderGridService,
    SupplierOrderersService,
    OrderProgressService,
    OrderHistoryService,
    { provide: RECEIPT_PROGRESS, useExisting: OrderProgressService },
  ],
  exports: [
    PurchaseOrdersService,
    PurchaseOrderGridService,
    SupplierOrderersService,
    OrderHistoryService,
    RECEIPT_PROGRESS,
  ],
})
export class ProcurementModule {}

/** The HTTP side of procurement (api only). */
@Module({
  imports: [ProcurementModule],
  controllers: [PurchaseOrdersController, SupplierOrderersController],
})
export class ProcurementHttpModule {}
