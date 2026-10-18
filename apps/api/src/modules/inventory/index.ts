// Public API of the inventory module (docs/modules/inventory.md). Other modules import only this
// file; named exports only (ESLint G2 rejects `export *`).
export {
  RECEIPT_MONEY_ACCOUNTS,
  type ReceiptMoneyAccount,
  type ReceiptMoneyAccountKind,
  type ReceiptMoneyAccounts,
} from './hooks';
export { InventoryHttpModule, InventoryModule, InventoryWorkerModule } from './inventory.module';
export {
  type AdjustmentDetail,
  type AdjustmentInput,
  type AdjustmentLineInput,
  AdjustmentsService,
  type AdjustmentStatus,
  type AdjustmentSummary,
  type SystemAdjustmentInput,
  type SystemAdjustmentLine,
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
  NO_SHELF_CODE,
} from './services/bins.service';
export {
  type LevelChange,
  type LevelRestore,
  type LevelState,
  type LocationChange,
  type LocationInput,
  type LocationState,
  type ProductLocation,
  ProductLocationsService,
} from './services/product-locations.service';
export {
  ProductRegistrationService,
  type RegistrationInput,
} from './services/product-registration.service';
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
  type AnyPostingDoc,
  type BinSnapshot,
  type CostedLine,
  type ExternalDocType,
  type ExternalPostingDoc,
  MAX_MOVEMENTS_PER_POST,
  type Movement,
  type PostedDocType,
  type PostingDoc,
  type PostingResult,
  type ReconciliationDiff,
  type ReconciliationRun,
  type ReservationConsume,
  type SnapshotPartitions,
  StockPostingService,
  type Valuation,
} from './services/stock-posting.service';
export {
  type Availability,
  type ReservationLine,
  ReservationService,
  type ReservedLine,
} from './services/reservation.service';
export {
  type BinContent,
  type LowStockRow,
  type LowStockStatus,
  type ProductStock,
  type ProductStockDetail,
  type StockQuery,
  StockQueryService,
  type WarehouseBalance,
} from './services/stock-query.service';
export {
  type BinPreview,
  type BinSelection,
  type CountEntry,
  MAX_STOCKTAKE_BINS,
  MAX_STOCKTAKE_LINES,
  type ScanInput,
  type ScanResult,
  type StocktakeBin,
  type StocktakeDetail,
  type StocktakeInput,
  type StocktakeLine,
  type StocktakeLineQuery,
  StocktakesService,
  type StocktakeStatus,
  type StocktakeSummary,
} from './services/stocktakes.service';
export { SystemBinsService } from './services/system-bins.service';
export {
  MAX_TRANSFER_LINES,
  type TransferCount,
  type TransferDetail,
  type TransferInput,
  type TransferLineInput,
  type TransferQuery,
  TransfersService,
  type TransferSummary,
} from './services/transfers.service';
