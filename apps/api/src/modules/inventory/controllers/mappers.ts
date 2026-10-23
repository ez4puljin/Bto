import { valueOf } from '@tugeel/shared/inventory';
import type { ProductSummary } from '../../catalog';
import type { AdjustmentDetailDto, AdjustmentSummaryDto } from '../dto/adjustments.dto';
import type { BinMoveDetailDto, BinMoveSummaryDto } from '../dto/bin-moves.dto';
import type { BinDto, ProductLocationDto } from '../dto/bins.dto';
import type {
  BinContentDto,
  LowStockRowDto,
  ProductStockDetailDto,
  ProductStockDto,
  ReconciliationRunDto,
  StockMovementDto,
  StockProductDto,
  WarehouseBalanceDto,
} from '../dto/stock.dto';
import type {
  ReceiptCostingDto,
  ReceiptDetailDto,
  ReceiptLineDto,
  ReceiptSummaryDto,
} from '../dto/receipts.dto';
import type {
  StocktakeBinDto,
  StocktakeDetailDto,
  StocktakeLineDto,
  StocktakeScanResultDto,
  StocktakeSummaryDto,
} from '../dto/stocktakes.dto';
import type { TransferDetailDto, TransferSummaryDto } from '../dto/transfers.dto';
import type { AdjustmentDetail, AdjustmentSummary } from '../services/adjustments.service';
import type { BinMoveDetail, BinMoveSummary } from '../services/bin-moves.service';
import type { Bin } from '../services/bins.service';
import type { ProductLocation } from '../services/product-locations.service';
import type {
  BinContent,
  LowStockRow,
  ProductStock,
  ProductStockDetail,
  ReconciliationSummary,
  StockMovement,
  WarehouseBalance,
} from '../services/stock-query.service';
import type {
  ReceiptCosting,
  ReceiptDetail,
  ReceiptLine,
  ReceiptSummary,
} from '../services/receipts.service';
import type {
  ScanResult,
  StocktakeBin,
  StocktakeDetail,
  StocktakeLine,
  StocktakeSummary,
} from '../services/stocktakes.service';
import type { TransferDetail, TransferSummary } from '../services/transfers.service';

export function toBinDto(bin: Bin): BinDto {
  return {
    id: bin.id,
    warehouseId: bin.warehouseId,
    code: bin.code,
    name: bin.name,
    type: bin.type,
    sellable: bin.sellable,
    status: bin.status,
    isSystem: bin.isSystem,
    pickSequence: bin.pickSequence,
    archivedAt: bin.archivedAt?.toISOString() ?? null,
  };
}

export function toLocationDto(location: ProductLocation): ProductLocationDto {
  return {
    id: location.id,
    warehouseId: location.warehouseId,
    productId: location.productId,
    isHome: location.isHome,
    defaultBinId: location.defaultBinId,
    defaultBinCode: location.defaultBinCode,
    minQty: location.minQty?.toFixed() ?? null,
    maxQty: location.maxQty?.toFixed() ?? null,
  };
}

export function toReceiptLineDto(line: ReceiptLine, withCosts = false): ReceiptLineDto {
  return {
    id: line.id,
    productId: line.productId,
    productSku: line.productSku,
    productName: line.productName,
    productUnitId: line.productUnitId,
    unitName: line.unitName,
    enteredQty: line.enteredQty.toFixed(),
    factorSnapshot: line.factorSnapshot.toFixed(),
    qtyBase: line.qtyBase.toFixed(),
    warehouseId: line.warehouseId,
    warehouseName: line.warehouseName,
    binId: line.binId,
    binCode: line.binCode,
    lotId: line.lotId,
    weightKg: line.weightKg?.toFixed() ?? null,
    salePrice: line.salePrice?.toFixed(0) ?? null,
    ...(withCosts
      ? {
          docUnitPrice: line.docUnitPrice?.toFixed(2) ?? null,
          docAmount: line.docAmount?.toFixed(2) ?? null,
          freeGoods: line.freeGoods,
          discountAmount: line.discountAmount?.toFixed(2) ?? null,
          netAmount: line.netAmount?.toFixed(2) ?? null,
          vatAmount: line.vatAmount?.toFixed(2) ?? null,
          costAmount: line.costAmount?.toFixed(2) ?? null,
        }
      : {}),
  };
}

/** Prices, amounts and totals only with `withCosts` (ADR-0033 #8, ADR-0078 #2). */
export function toReceiptDetailDto(receipt: ReceiptDetail, withCosts = false): ReceiptDetailDto {
  return {
    id: receipt.id,
    number: receipt.number,
    warehouses: receipt.warehouses,
    supplierId: receipt.supplierId,
    supplierCode: receipt.supplierCode,
    supplierName: receipt.supplierName,
    supplierDocNo: receipt.supplierDocNo,
    supplierDocDate: receipt.supplierDocDate,
    status: receipt.status,
    costingStatus: receipt.costingStatus,
    costingVersion: receipt.costingVersion,
    recostUntil: receipt.recostUntil,
    note: receipt.note,
    paymentMethod: receipt.paymentMethod,
    moneyAccountId: receipt.moneyAccountId,
    moneyAccountName: receipt.moneyAccountName,
    supplierVatPayer: receipt.supplierVatPayer,
    vatRatePct: receipt.vatRatePct.toFixed(),
    effectiveDate: receipt.effectiveDate,
    postedAt: receipt.postedAt?.toISOString() ?? null,
    createdAt: receipt.createdAt.toISOString(),
    updatedAt: receipt.updatedAt.toISOString(),
    lines: receipt.lines.map((line) => toReceiptLineDto(line, withCosts)),
    weightKg: receipt.totals.weightKg.toFixed(),
    weightMissing: receipt.totals.weightMissing,
    ...(withCosts
      ? {
          discountPct: receipt.discountPct?.toFixed() ?? null,
          discountAmount: receipt.discountAmount?.toFixed(2) ?? null,
          totals: {
            docTotal: receipt.totals.docTotal.toFixed(2),
            discountTotal: receipt.totals.discountTotal.toFixed(2),
            netTotal: receipt.totals.netTotal.toFixed(2),
            vatTotal: receipt.totals.vatTotal.toFixed(2),
            costTotal: receipt.totals.costTotal.toFixed(2),
            pricedLines: receipt.totals.pricedLines,
          },
        }
      : {}),
  };
}

/** The amount only with `withCosts` (ADR-0099 #8). */
export function toReceiptSummaryDto(summary: ReceiptSummary, withCosts = false): ReceiptSummaryDto {
  return {
    id: summary.id,
    number: summary.number,
    supplierId: summary.supplierId,
    supplierName: summary.supplierName,
    supplierDocNo: summary.supplierDocNo,
    supplierDocDate: summary.supplierDocDate,
    status: summary.status,
    costingStatus: summary.costingStatus,
    paymentMethod: summary.paymentMethod,
    lineCount: summary.lineCount,
    ...(withCosts ? { netAmount: summary.netAmount?.toFixed(2) ?? null } : {}),
    effectiveDate: summary.effectiveDate,
    createdAt: summary.createdAt.toISOString(),
  };
}

export function toReceiptCostingDto(costing: ReceiptCosting): ReceiptCostingDto {
  return {
    receiptId: costing.receiptId,
    number: costing.number,
    status: costing.status,
    costingStatus: costing.costingStatus,
    costingVersion: costing.costingVersion,
    recostUntil: costing.recostUntil,
    costedAt: costing.costedAt?.toISOString() ?? null,
    vatRatePct: costing.vatRatePct.toFixed(),
    discountPct: costing.discountPct?.toFixed() ?? null,
    discountAmount: costing.discountAmount?.toFixed(2) ?? null,
    total: costing.total?.toFixed(2) ?? null,
    docTotal: costing.docTotal?.toFixed(2) ?? null,
    lines: costing.lines.map((line) => ({
      lineId: line.lineId,
      productId: line.productId,
      productName: line.productName,
      unitName: line.unitName,
      enteredQty: line.enteredQty.toFixed(),
      qtyBase: line.qtyBase.toFixed(),
      provisionalUnitCost: line.provisionalUnitCost.toFixed(),
      amount: line.amount?.toFixed(2) ?? null,
      docAmount: line.docAmount?.toFixed(2) ?? null,
      discountAmount: line.discountAmount?.toFixed(2) ?? null,
      unitCost: line.unitCost?.toFixed() ?? null,
      freeGoods: line.freeGoods,
    })),
  };
}

export function toBinMoveDetailDto(move: BinMoveDetail): BinMoveDetailDto {
  return {
    id: move.id,
    number: move.number,
    warehouseId: move.warehouseId,
    status: move.status,
    note: move.note,
    effectiveDate: move.effectiveDate,
    postedAt: move.postedAt?.toISOString() ?? null,
    createdAt: move.createdAt.toISOString(),
    lines: move.lines.map((line) => ({
      id: line.id,
      productId: line.productId,
      productSku: line.productSku,
      productName: line.productName,
      productUnitId: line.productUnitId,
      unitName: line.unitName,
      enteredQty: line.enteredQty.toFixed(),
      qtyBase: line.qtyBase.toFixed(),
      fromBinId: line.fromBinId,
      fromBinCode: line.fromBinCode,
      toBinId: line.toBinId,
      toBinCode: line.toBinCode,
    })),
  };
}

export function toBinMoveSummaryDto(summary: BinMoveSummary): BinMoveSummaryDto {
  return {
    id: summary.id,
    number: summary.number,
    warehouseId: summary.warehouseId,
    note: summary.note,
    lineCount: summary.lineCount,
    effectiveDate: summary.effectiveDate,
    postedAt: summary.postedAt?.toISOString() ?? null,
  };
}

/** No cost ever reaches this DTO; approvers send costs, they never read them back here. */
export function toAdjustmentDetailDto(adjustment: AdjustmentDetail): AdjustmentDetailDto {
  return {
    id: adjustment.id,
    number: adjustment.number,
    warehouseId: adjustment.warehouseId,
    reason: adjustment.reason,
    status: adjustment.status,
    note: adjustment.note,
    submittedAt: adjustment.submittedAt?.toISOString() ?? null,
    effectiveDate: adjustment.effectiveDate,
    postedAt: adjustment.postedAt?.toISOString() ?? null,
    createdAt: adjustment.createdAt.toISOString(),
    updatedAt: adjustment.updatedAt.toISOString(),
    lines: adjustment.lines.map((line) => ({
      id: line.id,
      productId: line.productId,
      productSku: line.productSku,
      productName: line.productName,
      productUnitId: line.productUnitId,
      unitName: line.unitName,
      enteredQty: line.enteredQty.toFixed(),
      qtyBase: line.qtyBase.toFixed(),
      binId: line.binId,
      binCode: line.binCode,
      note: line.note,
    })),
  };
}

export function toAdjustmentSummaryDto(summary: AdjustmentSummary): AdjustmentSummaryDto {
  return {
    id: summary.id,
    number: summary.number,
    warehouseId: summary.warehouseId,
    reason: summary.reason,
    status: summary.status,
    lineCount: summary.lineCount,
    submittedAt: summary.submittedAt?.toISOString() ?? null,
    effectiveDate: summary.effectiveDate,
    createdAt: summary.createdAt.toISOString(),
  };
}

function toStockProductDto(product: ProductSummary): StockProductDto {
  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    baseUnitName: product.baseUnit.uomName,
    thumbUrl: product.thumbUrl,
  };
}

function toWarehouseBalanceDto(balance: WarehouseBalance, withCosts: boolean): WarehouseBalanceDto {
  return {
    warehouseId: balance.warehouseId,
    onHand: balance.onHand.toFixed(),
    sellableOnHand: balance.sellableOnHand.toFixed(),
    reserved: balance.reserved.toFixed(),
    available: balance.available.toFixed(),
    ...(withCosts ? { avgCost: balance.avgCost.toFixed(), value: balance.value.toFixed(2) } : {}),
  };
}

/** A movement of the history; costs only for cost holders (ADR-0033 #8). */
export function toStockMovementDto(row: StockMovement, withCosts: boolean): StockMovementDto {
  return {
    id: row.id,
    postedAt: row.postedAt.toISOString(),
    effectiveDate: row.effectiveDate,
    warehouseId: row.warehouseId,
    binId: row.binId,
    binCode: row.binCode,
    product: toStockProductDto(row.product),
    lotId: row.lotId,
    movementType: row.movementType,
    docType: row.docType,
    docId: row.docId,
    docNumber: row.docNumber,
    qtyBase: row.qtyBase.toFixed(),
    enteredQty: row.enteredQty.toFixed(),
    unitName: row.unitName,
    warehouseBalance: row.warehouseBalance?.toFixed() ?? null,
    binBalance: row.binBalance?.toFixed() ?? null,
    ...(withCosts
      ? { unitCost: row.unitCost.toFixed(), value: valueOf(row.qtyBase, row.unitCost).toFixed(2) }
      : {}),
  };
}

/** A low-stock row (ADR-0039): quantities in the product's base unit, never a cost. */
export function toLowStockRowDto(row: LowStockRow): LowStockRowDto {
  return {
    product: toStockProductDto(row.product),
    baseUnitId: row.product.baseUnit.id,
    status: row.status,
    onHand: row.onHand.toFixed(),
    minQty: row.minQty?.toFixed() ?? null,
    maxQty: row.maxQty?.toFixed() ?? null,
    suggestedQty: row.suggestedQty?.toFixed() ?? null,
    homeWarehouseId: row.homeWarehouseId,
  };
}

/** Without inventory.costs.manage no average or value reaches the response (ADR-0033 #8). */
export function toProductStockDto(stock: ProductStock, withCosts: boolean): ProductStockDto {
  return {
    product: toStockProductDto(stock.product),
    onHand: stock.onHand.toFixed(),
    available: stock.available.toFixed(),
    ...(withCosts ? { value: stock.value.toFixed(2) } : {}),
    warehouses: stock.warehouses.map((balance) => toWarehouseBalanceDto(balance, withCosts)),
  };
}

export function toProductStockDetailDto(
  stock: ProductStockDetail,
  withCosts: boolean,
): ProductStockDetailDto {
  return {
    ...toProductStockDto(stock, withCosts),
    bins: stock.bins.map((bin) => ({
      warehouseId: bin.warehouseId,
      binId: bin.binId,
      binCode: bin.binCode,
      binType: bin.binType,
      sellable: bin.sellable,
      lotId: bin.lotId,
      onHand: bin.onHand.toFixed(),
    })),
  };
}

export function toBinContentDto(content: BinContent): BinContentDto {
  return {
    bin: toBinDto(content.bin),
    lines: content.lines.map((line) => ({
      product: toStockProductDto(line.product),
      lotId: line.lotId,
      onHand: line.onHand.toFixed(),
    })),
  };
}

export function toReconciliationRunDto(run: ReconciliationSummary): ReconciliationRunDto {
  return {
    id: run.id,
    status: run.status,
    diffCount: run.diffCount,
    diffs: run.diffs,
    startedAt: run.startedAt.toISOString(),
    triggeredBy: run.triggeredBy,
  };
}

export function toTransferDetailDto(transfer: TransferDetail): TransferDetailDto {
  return {
    id: transfer.id,
    number: transfer.number,
    origin: transfer.origin,
    status: transfer.status,
    sourceWarehouseId: transfer.sourceWarehouseId,
    destWarehouseId: transfer.destWarehouseId,
    note: transfer.note,
    requestedAt: transfer.requestedAt?.toISOString() ?? null,
    shippedAt: transfer.shippedAt?.toISOString() ?? null,
    shipDate: transfer.shipDate,
    receivedAt: transfer.receivedAt?.toISOString() ?? null,
    receiveDate: transfer.receiveDate,
    cancelledAt: transfer.cancelledAt?.toISOString() ?? null,
    cancelReason: transfer.cancelReason,
    createdAt: transfer.createdAt.toISOString(),
    updatedAt: transfer.updatedAt.toISOString(),
    lines: transfer.lines.map((line) => ({
      id: line.id,
      productId: line.productId,
      productSku: line.productSku,
      productName: line.productName,
      requestUnitId: line.requestUnitId,
      unitName: line.unitName,
      requestFactor: line.requestFactor.toFixed(),
      requestedQty: line.requestedQty.toFixed(),
      baseUnitId: line.baseUnitId,
      baseUnitName: line.baseUnitName,
      shippedQtyBase: line.shippedQtyBase?.toFixed() ?? null,
      receivedQtyBase: line.receivedQtyBase?.toFixed() ?? null,
      fromBinId: line.fromBinId,
      fromBinCode: line.fromBinCode,
      toBinId: line.toBinId,
      toBinCode: line.toBinCode,
    })),
  };
}

export function toTransferSummaryDto(summary: TransferSummary): TransferSummaryDto {
  return {
    id: summary.id,
    number: summary.number,
    origin: summary.origin,
    status: summary.status,
    sourceWarehouseId: summary.sourceWarehouseId,
    destWarehouseId: summary.destWarehouseId,
    lineCount: summary.lineCount,
    requestedAt: summary.requestedAt?.toISOString() ?? null,
    shippedAt: summary.shippedAt?.toISOString() ?? null,
    receivedAt: summary.receivedAt?.toISOString() ?? null,
    createdAt: summary.createdAt.toISOString(),
  };
}

/**
 * What a reader of a stocktake may see (ADR-0038): counters their own counts only; approvers the
 * frozen quantities, differences and line totals; approvers holding costs also the values.
 */
export interface StocktakeView {
  withExpected: boolean;
  withCosts: boolean;
}

export function toStocktakeSummaryDto(summary: StocktakeSummary): StocktakeSummaryDto {
  return {
    id: summary.id,
    number: summary.number,
    warehouseId: summary.warehouseId,
    status: summary.status,
    note: summary.note,
    startedAt: summary.startedAt?.toISOString() ?? null,
    effectiveDate: summary.effectiveDate,
    postedAt: summary.postedAt?.toISOString() ?? null,
    createdAt: summary.createdAt.toISOString(),
    binCount: summary.binCount,
    finishedBinCount: summary.finishedBinCount,
  };
}

export function toStocktakeBinDto(bin: StocktakeBin, view: StocktakeView): StocktakeBinDto {
  return {
    id: bin.id,
    code: bin.code,
    type: bin.type,
    finishedAt: bin.finishedAt?.toISOString() ?? null,
    countedCount: bin.countedCount,
    ...(view.withExpected
      ? { lineCount: bin.lineCount, differenceCount: bin.differenceCount }
      : {}),
  };
}

export function toStocktakeDetailDto(
  detail: StocktakeDetail,
  view: StocktakeView,
): StocktakeDetailDto {
  const withValues = view.withExpected && view.withCosts;
  return {
    id: detail.id,
    number: detail.number,
    warehouseId: detail.warehouseId,
    status: detail.status,
    note: detail.note,
    startedAt: detail.startedAt?.toISOString() ?? null,
    effectiveDate: detail.effectiveDate,
    postedAt: detail.postedAt?.toISOString() ?? null,
    createdAt: detail.createdAt.toISOString(),
    updatedAt: detail.updatedAt.toISOString(),
    bins: detail.bins.map((bin) => toStocktakeBinDto(bin, view)),
    countedCount: detail.countedCount,
    ...(view.withExpected
      ? { lineCount: detail.lineCount, differenceCount: detail.differenceCount }
      : {}),
    ...(withValues && detail.shortageValue
      ? { shortageValue: detail.shortageValue.toFixed(2) }
      : {}),
    ...(withValues && detail.surplusValue ? { surplusValue: detail.surplusValue.toFixed(2) } : {}),
  };
}

export function toStocktakeLineDto(line: StocktakeLine, view: StocktakeView): StocktakeLineDto {
  return {
    id: line.id,
    binId: line.binId,
    binCode: line.binCode,
    productId: line.productId,
    productSku: line.productSku,
    productName: line.productName,
    baseUnitId: line.baseUnitId,
    baseUnitName: line.baseUnitName,
    countedQty: line.countedQty?.toFixed() ?? null,
    countedAt: line.countedAt?.toISOString() ?? null,
    ...(view.withExpected
      ? { expectedQty: line.expectedQty.toFixed(), difference: line.difference?.toFixed() ?? null }
      : {}),
    ...(view.withExpected && view.withCosts
      ? { unitCost: line.unitCost?.toFixed() ?? null, avgCost: line.avgCost?.toFixed() ?? null }
      : {}),
  };
}

export function toStocktakeScanResultDto(
  result: ScanResult,
  view: StocktakeView,
): StocktakeScanResultDto {
  return {
    line: toStocktakeLineDto(result.line, view),
    added: {
      qty: result.added.qty.toFixed(),
      unitName: result.added.unitName,
      qtyBase: result.added.qtyBase.toFixed(),
    },
    bin: toStocktakeBinDto(result.bin, view),
  };
}
