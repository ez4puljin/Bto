// Public API of the inventory module (docs/modules/inventory.md). Other modules import only this
// file; named exports only (ESLint G2 rejects `export *`).
export { InventoryHttpModule, InventoryModule } from './inventory.module';
export {
  type Bin,
  type BinInput,
  type BinQuery,
  type BinRangeInput,
  type BinRangeResult,
  BinsService,
} from './services/bins.service';
export {
  type LocationInput,
  type ProductLocation,
  ProductLocationsService,
} from './services/product-locations.service';
export {
  type CostedLine,
  type Movement,
  type PostedDocType,
  type PostingDoc,
  type PostingResult,
  type ReconciliationDiff,
  type ReconciliationRun,
  StockPostingService,
  type Valuation,
} from './services/stock-posting.service';
export { SystemBinsService } from './services/system-bins.service';
