// Public API of the procurement module (docs/modules/procurement.md, ADR-0115). Only ebarimt-check reads
// it (SupplierOrderersService, ADR-0170); else nobody imports it
// but the composition roots: inventory reaches it through the RECEIPT_PROGRESS hook it declares.
export { ProcurementHttpModule, ProcurementModule } from './procurement.module';
export {
  type SupplierOrdererChange,
  SupplierOrderersService,
} from './services/supplier-orderers.service';
