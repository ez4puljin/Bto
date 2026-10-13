// Public API of the pricing module (docs/modules/pricing.md). Other modules import only this file;
// named exports only (ESLint G2 rejects `export *`).
export { PricingHttpModule, PricingModule } from './pricing.module';
export {
  type DiscountProgram,
  type DiscountProgramInput,
  DiscountProgramsService,
  PROGRAM_STATUSES,
  type ProgramStatus,
} from './services/discount-programs.service';
export {
  PriceQuoteService,
  type Quote,
  type QuotedLine,
  type QuoteRequest,
} from './services/price-quote.service';
export {
  MAX_SALE_READY,
  type SaleReadyResult,
  SaleReadinessService,
} from './services/sale-readiness.service';
export {
  type CurrentPrice,
  type PriceEntry,
  type PricePeriod,
  type ProductPrices,
  type SetPricesInput,
  type UnitPriceView,
  UnitPricesService,
} from './services/unit-prices.service';
