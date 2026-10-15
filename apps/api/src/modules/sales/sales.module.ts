import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog';
import { IdentityModule } from '../identity';
import { InventoryModule } from '../inventory';
import { PartnersModule } from '../partners';
import { PricingModule } from '../pricing';
import { SalesOrdersController } from './controllers/sales-orders.controller';
import { AllowAllCreditChecker, CreditChecker } from './services/credit-checker';
import { SalesOrdersService } from './services/sales-orders.service';

/**
 * Sales (docs/modules/sales.md, ADR-0055): customer orders. The credit check allows every order
 * until finance binds its own checker in delivery 3.
 */
@Module({
  imports: [IdentityModule, CatalogModule, PartnersModule, InventoryModule, PricingModule],
  providers: [SalesOrdersService, { provide: CreditChecker, useClass: AllowAllCreditChecker }],
  exports: [SalesOrdersService],
})
export class SalesModule {}

/** The HTTP side of sales (api only). */
@Module({ imports: [SalesModule], controllers: [SalesOrdersController] })
export class SalesHttpModule {}
