import { Module } from '@nestjs/common';
import { CatalogModule, UNIT_SUPERSEDED_HOOK } from '../catalog';
import { IdentityModule } from '../identity';
import {
  DiscountProgramsController,
  PricingController,
  UnitPricesController,
} from './controllers/pricing.controller';
import { DiscountProgramsService } from './services/discount-programs.service';
import { PriceQuoteService } from './services/price-quote.service';
import { PricingUnitsHook } from './services/pricing-units.hook';
import { SaleReadinessService } from './services/sale-readiness.service';
import { UnitPricesService } from './services/unit-prices.service';

const CORE_SERVICES = [
  DiscountProgramsService,
  PriceQuoteService,
  SaleReadinessService,
  UnitPricesService,
];

/**
 * Pricing services every process may use (the api now; orders and the price import next).
 * Binding catalog's UNIT_SUPERSEDED_HOOK here closes a superseded unit's prices and programs in
 * the supersede transaction (catalog resolves the hook with ModuleRef, strict: false).
 */
@Module({
  imports: [IdentityModule, CatalogModule],
  providers: [
    ...CORE_SERVICES,
    PricingUnitsHook,
    { provide: UNIT_SUPERSEDED_HOOK, useExisting: PricingUnitsHook },
  ],
  exports: CORE_SERVICES,
})
export class PricingModule {}

/** The HTTP side of pricing (api only). */
@Module({
  imports: [PricingModule],
  controllers: [UnitPricesController, DiscountProgramsController, PricingController],
})
export class PricingHttpModule {}
