import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog';
import { IdentityModule } from '../identity';
import { InventoryModule } from '../inventory';
import { PartnersModule } from '../partners';
import { PricingModule } from '../pricing';
import { SalesBoardsController } from './controllers/sales-boards.controller';
import { SalesOrdersController } from './controllers/sales-orders.controller';
import {
  SalesPipelinesController,
  SalesStagesController,
} from './controllers/sales-pipelines.controller';
import { SalesRepController } from './controllers/sales-rep.controller';
import { SalesSettingsController } from './controllers/sales-settings.controller';
import { SalesAccessService } from './services/sales-access.service';
import { SalesBoardsService } from './services/sales-boards.service';
import { SalesOrderQueryService } from './services/sales-order-query.service';
import { SalesOrdersService } from './services/sales-orders.service';
import { SalesPipelinesService } from './services/sales-pipelines.service';
import { SalesRepOrdersService } from './services/sales-rep-orders.service';
import { SalesRepShopService } from './services/sales-rep-shop.service';
import { SalesSettingsService } from './services/sales-settings.service';

/**
 * Sales (docs/modules/sales.md, ADR-0055, ADR-0056, ADR-0057): customer orders on boards,
 * pipelines and stages. Finance binds the credit checker and the sale sink (ADR-0060 #1,
 * `hooks.ts`); without it every order passes and a sale ends DELIVERED.
 */
@Module({
  imports: [IdentityModule, CatalogModule, PartnersModule, InventoryModule, PricingModule],
  providers: [
    SalesAccessService,
    SalesBoardsService,
    SalesPipelinesService,
    SalesSettingsService,
    SalesOrderQueryService,
    SalesOrdersService,
    SalesRepOrdersService,
    SalesRepShopService,
  ],
  exports: [
    SalesAccessService,
    SalesBoardsService,
    SalesPipelinesService,
    SalesSettingsService,
    SalesOrderQueryService,
    SalesOrdersService,
    SalesRepOrdersService,
    SalesRepShopService,
  ],
})
export class SalesModule {}

/** The HTTP side of sales (api only). */
@Module({
  imports: [SalesModule],
  controllers: [
    SalesOrdersController,
    SalesBoardsController,
    SalesPipelinesController,
    SalesStagesController,
    SalesSettingsController,
    SalesRepController,
  ],
})
export class SalesHttpModule {}
