// Public API of the printing module (docs/modules/printing.md, ADR-0226): its HTTP module, which
// the api's AppModule loads. No other module imports it; named exports only (ESLint G2).
export { PrintingHttpModule } from './printing.module';
