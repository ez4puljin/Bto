// Public API of the fin-bridge module (docs/modules/fin-bridge.md): Bto's side of the Finance Core.
// Only the composition roots import it; named exports only (ESLint G2 rejects `export *`).
export { FinBridgeHttpModule, FinBridgeModule } from './fin-bridge.module';
export {
  BTO_SOURCE,
  BTO_TENANT,
  btoChartTemplate,
  btoInstallationSpec,
  customerIdOfRef,
  customerRef,
  FIN_SOURCE,
  LEGACY_PARTY_REF,
  POSTING_KEY_OF_ROLE,
  ROLE_OF_POSTING_KEY,
} from './installation';
export { type CompanyEdit, FinCompanyBridge } from './services/company-bridge.service';
export { FinContexts } from './services/contexts.service';
export { FinPartiesBridge } from './services/parties-bridge.service';
