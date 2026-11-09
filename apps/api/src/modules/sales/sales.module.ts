import { Module } from '@nestjs/common';
import { SalesDocumentTemplatesController } from './controllers/sales-document-templates.controller';
import { CatalogModule } from '../catalog';
import { IdentityModule } from '../identity';
import { InventoryModule } from '../inventory';
import { PartnersModule } from '../partners';
import { PricingModule } from '../pricing';
import { SalesBoardsController } from './controllers/sales-boards.controller';
import { SalesOrdersController } from './controllers/sales-orders.controller';
import { SalesPicksController } from './controllers/sales-picks.controller';
import {
  SalesPipelinesController,
  SalesStagesController,
} from './controllers/sales-pipelines.controller';
import { SalesRepController } from './controllers/sales-rep.controller';
import { SalesSettingsController } from './controllers/sales-settings.controller';
import { SalesAccessService } from './services/sales-access.service';
import { SalesBoardsService } from './services/sales-boards.service';
import { SalesOrderExportService } from './services/sales-order-export.service';
import { SalesOrderQueryService } from './services/sales-order-query.service';
import { SalesOrdersService } from './services/sales-orders.service';
import { SalesPicksService } from './services/sales-picks.service';
import { SalesDocumentTemplatesService } from './services/sales-document-templates.service';
import { SalesPipelinesService } from './services/sales-pipelines.service';
import { SalesRepOrdersService } from './services/sales-rep-orders.service';
import { SalesRepShopService } from './services/sales-rep-shop.service';
import { StaffAppAssortmentsController } from './controllers/staff-app-assortments.controller';
import { StaffAppAssortmentsService } from './services/staff-app-assortments.service';
import { CustomerOrdersService } from './services/customer-orders.service';
import { SalesSettingsService } from './services/sales-settings.service';
import { AppSettingsService } from './services/app-settings.service';
import { AppSettingsController } from './controllers/app-settings.controller';
import { SalesRepLiveStockController } from './controllers/live-stock.controller';
import { LiveStockHub } from './services/live-stock.hub';

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
    SalesDocumentTemplatesService,
    SalesPipelinesService,
    SalesSettingsService,
    AppSettingsService,
    StaffAppAssortmentsService,
    SalesOrderQueryService,
    SalesOrderExportService,
    SalesOrdersService,
    SalesPicksService,
    SalesRepOrdersService,
    SalesRepShopService,
    CustomerOrdersService,
  ],
  exports: [
    SalesAccessService,
    SalesBoardsService,
    SalesDocumentTemplatesService,
    SalesPipelinesService,
    SalesSettingsService,
    AppSettingsService,
    StaffAppAssortmentsService,
    SalesOrderQueryService,
    SalesOrderExportService,
    SalesOrdersService,
    SalesPicksService,
    SalesRepOrdersService,
    SalesRepShopService,
    CustomerOrdersService,
  ],
})
export class SalesModule {}

/**
 * The apps' live stock hub (ADR-0173 #4), api only: one LISTEN connection per api process. The
 * HTTP modules of sales and customer import it, so the worker, the edge and the CLIs never hold it.
 */
@Module({
  imports: [SalesModule],
  providers: [LiveStockHub],
  exports: [LiveStockHub],
})
export class SalesLiveModule {}

/** The HTTP side of sales (api only). */
@Module({
  imports: [SalesModule, SalesLiveModule],
  controllers: [
    SalesOrdersController,
    SalesBoardsController,
    SalesPipelinesController,
    SalesDocumentTemplatesController,
    SalesStagesController,
    SalesSettingsController,
    AppSettingsController,
    StaffAppAssortmentsController,
    SalesRepController,
    SalesRepLiveStockController,
    SalesPicksController,
  ],
})
export class SalesHttpModule {}
