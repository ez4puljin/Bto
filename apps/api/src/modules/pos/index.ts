// Public surface of the pos module (docs/modules/pos.md, ADR-0063, ADR-0064). Modules import only
// this file; named exports only (ESLint G2 rejects `export *`).
export { PosHttpModule, PosModule } from './pos.module';
export type {
  Accepted,
  EbarimtFacts,
  ReceiptStatusDoc,
  SaleDoc,
  SaleDocLine,
  SaleDocTender,
  ShiftCloseDoc,
  ShiftOpenDoc,
  SyncEvent,
  SyncOutcome,
  TillBoundDoc,
  VoidDoc,
  VoidDocLine,
} from './sale-doc';
export { PosAcceptService } from './services/pos-accept.service';
export { type Cashier, PosCashiersService } from './services/pos-cashiers.service';
export { PosDevService } from './services/pos-dev.service';
export {
  type EdgeNode,
  type EdgeNodeInput,
  PosEdgeNodesService,
} from './services/pos-edge-nodes.service';
export {
  type PosAttention,
  PosQueryService,
  type SaleDetail,
  type SaleSummary,
  type ShiftSummary,
  type ShortfallView,
} from './services/pos-query.service';
export {
  PosQuickButtonsService,
  type QuickButton,
  type QuickButtonsInput,
  type QuickGroup,
} from './services/pos-quick-buttons.service';
export { type PosSettings, PosSettingsService } from './services/pos-settings.service';
export { PosShiftsService, type ShiftTotals } from './services/pos-shifts.service';
export { PosTillsService, type Till, type TillInput } from './services/pos-tills.service';
export {
  type VoidDetail,
  type VoidLineView,
  type VoidQuery,
  PosVoidsService,
  type VoidSummary,
} from './services/pos-voids.service';
