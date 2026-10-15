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
  type ImportProfile,
  type NewPriceProfile,
  type PriceProfile,
  type PriceProfileVersion,
  PriceProfilesService,
} from './services/price-profiles.service';
export {
  PriceQuoteService,
  type Quote,
  type QuotedLine,
  type QuotedPart,
  type QuoteRequest,
} from './services/price-quote.service';
export {
  type CurrentTerms,
  type PriceProblem,
  type PriceTerms,
  ProductPricesService,
  type ProductPriceView,
  type SetTermsInput,
  type TermsInForce,
  type TermsRestore,
  type TermsSnapshot,
  type WrittenTerms,
} from './services/product-prices.service';
export {
  MAX_SALE_READY,
  type SaleReadyResult,
  SaleReadinessService,
} from './services/sale-readiness.service';
