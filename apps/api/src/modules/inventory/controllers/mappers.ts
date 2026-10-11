import type { BinDto, ProductLocationDto } from '../dto/bins.dto';
import type {
  ReceiptCostingDto,
  ReceiptDetailDto,
  ReceiptLineDto,
  ReceiptSummaryDto,
} from '../dto/receipts.dto';
import type { Bin } from '../services/bins.service';
import type { ProductLocation } from '../services/product-locations.service';
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
