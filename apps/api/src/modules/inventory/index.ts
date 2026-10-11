// Public API of the inventory module (docs/modules/inventory.md). Other modules import only this
// file; named exports only (ESLint G2 rejects `export *`).
export { InventoryHttpModule, InventoryModule } from './inventory.module';
export {
  type AdjustmentDetail,
  type AdjustmentInput,
  type AdjustmentLineInput,
  AdjustmentsService,
  type AdjustmentStatus,
  type AdjustmentSummary,
} from './services/adjustments.service';
export {
  type BinMoveDetail,
  type BinMoveInput,
  type BinMoveLineInput,
  BinMovesService,
  type BinMoveSummary,
} from './services/bin-moves.service';
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
  type CostLineInput,
  type ReceiptCosting,
  type ReceiptDetail,
  type ReceiptInput,
  type ReceiptLineInput,
  ReceiptsService,
  type ReceiptSummary,
} from './services/receipts.service';
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
export {
  type BinContent,
  type ProductStock,
  type ProductStockDetail,
  type StockQuery,
  StockQueryService,
  type WarehouseBalance,
} from './services/stock-query.service';
export {
  type CountEntry,
  type StocktakeDetail,
  type StocktakeInput,
  StocktakesService,
  type StocktakeStatus,
} from './services/stocktakes.service';
export { SystemBinsService } from './services/system-bins.service';
