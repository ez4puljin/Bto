// Public API of the customer module (docs/modules/customer.md): only its HTTP module, which the
// api's AppModule loads. No other module imports it (ESLint, ADR-0082).
export { CustomerHttpModule } from './customer.module';
