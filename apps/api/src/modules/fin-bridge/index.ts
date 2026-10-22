// Public API of the fin-bridge module (docs/modules/fin-bridge.md): Bto's side of the Finance Core.
// Only the composition roots import it; named exports only (ESLint G2 rejects `export *`).
export { newCommandId } from './command-id';
export { FinBridgeHttpModule, FinBridgeModule } from './fin-bridge.module';
export {
  BTO_SOURCE,
  BTO_TENANT,
  btoChartTemplate,
  btoInstallationSpec,
  customerIdOfRef,
  customerRef,
  supplierIdOfRef,
  supplierRef,
  ALLOCATION_NUMBER_DEFAULT,
  FIN_DOC_TYPES,
  FIN_SOURCE,
  LEGACY_PARTY_REF,
  MANUAL_KEY,
  POSTING_KEY_OF_ROLE,
  ROLE_OF_POSTING_KEY,
  STOCK_NUMBER_DEFAULT,
} from './installation';
export { type CompanyEdit, FinCompanyBridge } from './services/company-bridge.service';
export { FinContexts } from './services/contexts.service';
export { FinPartiesBridge } from './services/parties-bridge.service';
