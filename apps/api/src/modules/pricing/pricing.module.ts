import { Module } from '@nestjs/common';
import { CatalogModule, UNIT_SUPERSEDED_HOOK } from '../catalog';
import { IdentityModule } from '../identity';
import {
  DiscountProgramsController,
  PriceProfilesController,
  PricingController,
  ProductPricesController,
} from './controllers/pricing.controller';
import { DiscountProgramsService } from './services/discount-programs.service';
import { PriceProfilesService } from './services/price-profiles.service';
import { PriceQuoteService } from './services/price-quote.service';
import { PricingUnitsHook } from './services/pricing-units.hook';
import { ProductDealsService } from './services/product-deals.service';
import { ProductPricesService } from './services/product-prices.service';
import { SaleReadinessService } from './services/sale-readiness.service';

const CORE_SERVICES = [
  DiscountProgramsService,
  PriceProfilesService,
  PriceQuoteService,
  ProductDealsService,
  ProductPricesService,
  SaleReadinessService,
];

/**
 * Pricing services every process may use (the api now; orders and the price import next).
 * Binding catalog's UNIT_SUPERSEDED_HOOK here stops a superseded unit's discount programs in the
 * supersede transaction (catalog resolves the hook with ModuleRef, strict: false).
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
  controllers: [
    ProductPricesController,
    PriceProfilesController,
    DiscountProgramsController,
    PricingController,
  ],
})
export class PricingHttpModule {}
