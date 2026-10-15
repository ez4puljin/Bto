// Public API of the sales module (docs/modules/sales.md). Other modules import only this file;
// named exports only (ESLint G2 rejects `export *`).
export { SalesHttpModule, SalesModule } from './sales.module';
export {
  AllowAllCreditChecker,
  CreditChecker,
  type CreditDecision,
} from './services/credit-checker';
export {
  type OrderDetail,
  type OrderInput,
  type OrderLine,
  type OrderLineInput,
  type OrderSummary,
  SalesOrdersService,
} from './services/sales-orders.service';
