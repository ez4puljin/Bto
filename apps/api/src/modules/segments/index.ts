// Public API of the segments module (docs/modules/segments.md, ADR-0049). Nobody imports it (ESLint
// G1): the app module wires it, and other modules reach segments through the resolver hooks they
// declare themselves (catalog's PRODUCT_SET_RESOLVER, partners' PARTNER_SET_RESOLVER).
export { SegmentsHttpModule, SegmentsModule } from './segments.module';
