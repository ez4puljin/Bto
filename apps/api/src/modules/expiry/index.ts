// Public API of the expiry module (docs/modules/expiry.md, ADR-0172, ADR-0245); named
// exports only (ESLint G2 rejects `export *`).
export { ExpiryHttpModule, ExpiryModule } from './expiry.module';
export { ExpiryCommerceService } from './services/expiry-commerce.service';
export {
  EXPIRY_PAYROLL_SOURCE,
  type ExpiryPayrollSource,
  type ExpiryPayrollSourceInput,
  EXPIRY_SALE_CONTEXTS,
  type ExpirySaleContext,
  type ExpirySaleContexts,
  type ExpirySaleOffer,
  type ExpirySaleInput,
  type ExpiryReturnInput,
} from './ports';

export { ExpiryPosExceptionsService } from './services/expiry-pos-exceptions.service';
