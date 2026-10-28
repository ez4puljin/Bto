// Public API of the procurement module (docs/modules/procurement.md, ADR-0115). Nobody imports it
// but the composition roots: inventory reaches it through the RECEIPT_PROGRESS hook it declares.
export { ProcurementHttpModule, ProcurementModule } from './procurement.module';
