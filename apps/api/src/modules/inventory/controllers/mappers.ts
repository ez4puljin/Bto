import type { ProductSummary } from '../../catalog';
import type { AdjustmentDetailDto, AdjustmentSummaryDto } from '../dto/adjustments.dto';
import type { BinMoveDetailDto, BinMoveSummaryDto } from '../dto/bin-moves.dto';
import type { BinDto, ProductLocationDto } from '../dto/bins.dto';
import type {
  BinContentDto,
  ProductStockDetailDto,
  ProductStockDto,
  ReconciliationRunDto,
  StockProductDto,
  WarehouseBalanceDto,
} from '../dto/stock.dto';
import type {
  ReceiptCostingDto,
  ReceiptDetailDto,
  ReceiptLineDto,
  ReceiptSummaryDto,
} from '../dto/receipts.dto';
import type { AdjustmentDetail, AdjustmentSummary } from '../services/adjustments.service';
import type { BinMoveDetail, BinMoveSummary } from '../services/bin-moves.service';
import type { Bin } from '../services/bins.service';
import type { ProductLocation } from '../services/product-locations.service';
import type {
  BinContent,
  ProductStock,
  ProductStockDetail,
  ReconciliationSummary,
  WarehouseBalance,
} from '../services/stock-query.service';
import type {
  ReceiptCosting,
  ReceiptDetail,
  ReceiptLine,
  ReceiptSummary,
} from '../services/receipts.service';

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

export function toReceiptLineDto(line: ReceiptLine): ReceiptLineDto {
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
    binId: line.binId,
    binCode: line.binCode,
    lotId: line.lotId,
  };
}

/** No cost, amount or average ever reaches this DTO (ADR-0033 #8). */
export function toReceiptDetailDto(receipt: ReceiptDetail): ReceiptDetailDto {
  return {
    id: receipt.id,
    number: receipt.number,
    warehouseId: receipt.warehouseId,
    warehouseName: receipt.warehouseName,
    supplierId: receipt.supplierId,
    supplierCode: receipt.supplierCode,
    supplierName: receipt.supplierName,
    supplierDocNo: receipt.supplierDocNo,
    supplierDocDate: receipt.supplierDocDate,
    status: receipt.status,
    costingStatus: receipt.costingStatus,
    note: receipt.note,
    effectiveDate: receipt.effectiveDate,
    postedAt: receipt.postedAt?.toISOString() ?? null,
    createdAt: receipt.createdAt.toISOString(),
    updatedAt: receipt.updatedAt.toISOString(),
    lines: receipt.lines.map(toReceiptLineDto),
  };
}

export function toReceiptSummaryDto(summary: ReceiptSummary): ReceiptSummaryDto {
  return {
    id: summary.id,
    number: summary.number,
    warehouseId: summary.warehouseId,
    supplierId: summary.supplierId,
    supplierName: summary.supplierName,
    supplierDocNo: summary.supplierDocNo,
    status: summary.status,
    costingStatus: summary.costingStatus,
    lineCount: summary.lineCount,
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
    total: costing.total?.toFixed(2) ?? null,
    lines: costing.lines.map((line) => ({
      lineId: line.lineId,
      productId: line.productId,
      productName: line.productName,
      unitName: line.unitName,
      enteredQty: line.enteredQty.toFixed(),
      qtyBase: line.qtyBase.toFixed(),
      provisionalUnitCost: line.provisionalUnitCost.toFixed(),
      amount: line.amount?.toFixed(2) ?? null,
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
