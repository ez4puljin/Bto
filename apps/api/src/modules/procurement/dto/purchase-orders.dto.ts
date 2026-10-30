import { ApiProperty, ApiPropertyOptional, ApiSchema, OmitType } from '@nestjs/swagger';
import {
  MAX_PO_CHANGES,
  MAX_PO_SUPPLIERS,
  PO_GRID_PAGE,
  PO_HISTORY_KINDS,
  PO_HISTORY_PAGE,
  PO_SUPPLIER_STATUSES,
  type PoHistoryKind,
  type PoSupplierStatus,
} from '@tugeel/shared/procurement';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PageQueryDto } from '../../../common/pagination/page';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const QTY = /^\d{1,11}(\.\d{1,3})?$/;

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** "true"/"false" query strings as booleans (other values fail @IsBoolean). */
const queryBoolean = ({ value }: { value: unknown }) => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
};

const GRID_FILTERS = ['ALL', 'ORDERED', 'BELOW_MIN'] as const;
const GRID_FIELDS = ['ORDERED', 'SHIPPED'] as const;
const GRID_REFUSALS = ['SCOPE', 'NO_HOME', 'NOT_SUPPLIER', 'NO_LINE'] as const;
const ARRIVAL_REFUSALS = ['SCOPE', 'CONFIRMED', 'NOT_FOUND'] as const;

@ApiSchema({ name: 'PurchaseOrderSupplier' })
export class PurchaseOrderSupplierDto {
  @ApiProperty() supplierId: number;
  @ApiProperty() supplierCode: string;
  @ApiProperty() supplierName: string;
  @ApiProperty({ enum: PO_SUPPLIER_STATUSES }) status: PoSupplierStatus;
  @ApiProperty({ type: String, format: 'date-time' }) statusChangedAt: string;
  @ApiProperty({ type: Number, nullable: true }) ordererId: number | null;
  @ApiProperty({ type: String, nullable: true }) ordererName: string | null;
  @ApiProperty() lineCount: number;
  @ApiProperty({ description: 'Σ ordered quantity in the lines’ own unit (boxes)' }) boxes: string;
  @ApiProperty({ description: 'Σ ordered base quantity' }) qtyBase: string;
  @ApiProperty({ description: 'Σ weight, kg (products with a weight)' }) weightKg: string;
  @ApiProperty({ description: 'Σ shipped quantity, base units (lines typed at «Ачигдаж»)' })
  shippedBase: string;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Σ counted base quantity of the receipt (null before the receipt)',
  })
  arrivedBase: string | null;
  @ApiProperty({ description: 'Receipt lines not yet counted' }) uncheckedLines: number;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Σ ordered × last price per base unit (price readers)',
  })
  estimatedCost: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The receipt’s payable so far (price readers; null before the receipt)',
  })
  finalAmount: string | null;
  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Lines priced differently from the product’s previous price (posted receipt, price readers)',
  })
  priceDiffCount: number | null;
  @ApiProperty({ type: String, nullable: true }) noteTotalQty: string | null;
  @ApiProperty({ type: String, nullable: true }) noteTotalAmount: string | null;
  @ApiProperty({ type: Number, nullable: true }) receiptId: number | null;
  @ApiProperty({ type: String, nullable: true }) receiptNumber: string | null;
  @ApiProperty() canEdit: boolean;
  @ApiProperty({ description: 'May type the shipped quantities now' }) canShip: boolean;
  @ApiProperty({ description: 'May type a count on at least one line now' }) canCount: boolean;
  @ApiProperty({ description: 'May run the price check now' }) canPrice: boolean;
  @ApiProperty() canMoveNext: boolean;
  @ApiProperty() canMoveBack: boolean;
}

@ApiSchema({ name: 'PurchaseOrderDetail' })
export class PurchaseOrderDetailDto {
  @ApiProperty() id: number;
  @ApiProperty({ example: 'PO-2026-000001' }) number: string;
  @ApiProperty({ type: String, format: 'date' }) orderDate: string;
  @ApiProperty({ type: String, nullable: true }) note: string | null;
  @ApiProperty({ enum: PO_SUPPLIER_STATUSES, description: 'The lowest supplier status' })
  status: PoSupplierStatus;
  @ApiProperty({ type: String, nullable: true }) createdBy: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: string;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) archivedAt: string | null;
  @ApiProperty({ type: String, nullable: true }) archivedBy: string | null;
  @ApiProperty({ description: 'A manager may archive it now' }) canArchive: boolean;
  @ApiProperty({ type: [PurchaseOrderSupplierDto] }) suppliers: PurchaseOrderSupplierDto[];
}

@ApiSchema({ name: 'PurchaseOrderVersion' })
export class PurchaseOrderVersionDto {
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  receiptsUpdatedAt: string | null;
}

@ApiSchema({ name: 'PurchaseOrderStatusCount' })
export class PurchaseOrderStatusCountDto {
  @ApiProperty({ enum: PO_SUPPLIER_STATUSES }) status: PoSupplierStatus;
  @ApiProperty() count: number;
}

@ApiSchema({ name: 'PurchaseOrderSummary' })
export class PurchaseOrderSummaryDto {
  @ApiProperty() id: number;
  @ApiProperty() number: string;
  @ApiProperty({ type: String, format: 'date' }) orderDate: string;
  @ApiProperty({ type: String, nullable: true }) note: string | null;
  @ApiProperty({ enum: PO_SUPPLIER_STATUSES }) status: PoSupplierStatus;
  @ApiProperty() supplierCount: number;
  @ApiProperty({ type: [String] }) supplierNames: string[];
  @ApiProperty({
    type: [PurchaseOrderStatusCountDto],
    description: 'Suppliers per status, zeros left out',
  })
  statusCounts: PurchaseOrderStatusCountDto[];
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) archivedAt: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: string;
}

@ApiSchema({ name: 'PurchaseOrderPage' })
export class PurchaseOrderPageDto {
  @ApiProperty({ type: [PurchaseOrderSummaryDto] }) data: PurchaseOrderSummaryDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
}

export class PurchaseOrderListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: PO_SUPPLIER_STATUSES })
  @IsOptional()
  @IsIn(PO_SUPPLIER_STATUSES)
  status?: PoSupplierStatus;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) supplierId?: number;
  @ApiPropertyOptional({ description: 'Orders with a supplier the caller orders from' })
  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean()
  mine?: boolean;
  @ApiPropertyOptional({ description: 'Archived orders only (default: the live ones)' })
  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean()
  archived?: boolean;
  @ApiPropertyOptional({ description: 'Order number' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  q?: string;
}

@ApiSchema({ name: 'PurchaseOrderCreateRequest' })
export class CreatePurchaseOrderDto {
  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  @IsOptional()
  @Matches(ISO_DATE)
  orderDate?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 500 })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(500)
  note?: string | null;
  @ApiProperty({ type: [Number] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_PO_SUPPLIERS)
  @IsInt({ each: true })
  @Min(1, { each: true })
  supplierIds: number[];
}

@ApiSchema({ name: 'PurchaseOrderUpdateRequest' })
export class UpdatePurchaseOrderDto {
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 500 })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

@ApiSchema({ name: 'PurchaseOrderAddSuppliersRequest' })
export class AddSuppliersDto {
  @ApiProperty({ type: [Number] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_PO_SUPPLIERS)
  @IsInt({ each: true })
  @Min(1, { each: true })
  supplierIds: number[];
}

@ApiSchema({ name: 'PurchaseOrderMoveRequest' })
export class MoveSupplierDto {
  @ApiProperty({ enum: PO_SUPPLIER_STATUSES, description: 'The next status, or the one before' })
  @IsIn(PO_SUPPLIER_STATUSES)
  to: PoSupplierStatus;
}

export class GridQueryDto {
  @ApiPropertyOptional({ description: 'Product code, name or barcode' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
  @ApiPropertyOptional({ enum: GRID_FILTERS })
  @IsOptional()
  @IsIn(GRID_FILTERS)
  filter?: (typeof GRID_FILTERS)[number];
  @ApiPropertyOptional({ description: 'Rows whose home warehouse is this one' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  warehouseId?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) cursor?: string;
  @ApiPropertyOptional({ maximum: PO_GRID_PAGE })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PO_GRID_PAGE)
  limit?: number;
}

/** The facets' query: the rows' filters, no page. */
export class GridFacetsQueryDto extends OmitType(GridQueryDto, ['cursor', 'limit'] as const) {}

@ApiSchema({ name: 'PurchaseOrderSupplierFacet' })
export class SupplierFacetDto {
  @ApiProperty() supplierId: number;
  @ApiProperty({ description: 'Rows the query keeps for this supplier' }) rowCount: number;
}

@ApiSchema({ name: 'PurchaseOrderFacets' })
export class GridFacetsDto {
  @ApiProperty({ description: "Σ of the suppliers' rowCount" }) rowCount: number;
  @ApiProperty({ type: [SupplierFacetDto] }) suppliers: SupplierFacetDto[];
}

@ApiSchema({ name: 'PurchaseOrderGridUnit' })
export class GridUnitDto {
  @ApiProperty() id: number;
  @ApiProperty() name: string;
  @ApiProperty() factor: string;
  @ApiProperty() isBase: boolean;
}

@ApiSchema({ name: 'PurchaseOrderGridLine' })
export class GridLineDto {
  @ApiProperty() productUnitId: number;
  @ApiProperty() qty: string;
  @ApiProperty() qtyBase: string;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'What the supplier shipped, in the line’s unit; null until typed',
  })
  shippedQty: string | null;
}

@ApiSchema({ name: 'PurchaseOrderGridSales' })
export class GridSalesDto {
  @ApiProperty({ description: 'Average outflow per month over the last 12 months, base units' })
  avg12: string;
  @ApiProperty({ description: 'Average over the last 3 months' }) avg3: string;
  @ApiProperty() lastMonth: string;
  @ApiProperty({ description: 'This month last year' }) sameMonthLastYear: string;
}

@ApiSchema({ name: 'PurchaseOrderGridReceiptLine' })
export class GridReceiptLineDto {
  @ApiProperty() lineId: number;
  @ApiProperty() warehouseId: number;
  @ApiProperty({ description: 'The receipt line’s unit (pieces once counted in pieces)' })
  unitName: string;
  @ApiProperty({ description: 'Pieces per that unit' }) factor: string;
  @ApiProperty({ type: String, nullable: true, description: 'Expected, base units' })
  expectedBase: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Counted, base units; null while unchecked',
  })
  arrivedBase: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) checkedAt: string | null;
  @ApiProperty({ type: String, nullable: true }) note: string | null;
  @ApiProperty({ description: 'The line’s warehouse is confirmed (frozen)' }) confirmed: boolean;
  @ApiProperty({ description: 'The caller may type this count now' }) canCount: boolean;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Cost holders only' })
  docUnitPrice?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Cost holders only' })
  docAmount?: string | null;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'The product’s price on the receipt before, per this unit (posted, cost holders)',
  })
  previousUnitPrice?: string | null;
  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  previousDate?: string | null;
}

@ApiSchema({ name: 'PurchaseOrderGridRow' })
export class GridRowDto {
  @ApiProperty() productId: number;
  @ApiProperty() sku: string;
  @ApiProperty() name: string;
  @ApiProperty({ type: String, nullable: true, description: 'kg per base unit' })
  weightKg: string | null;
  @ApiProperty({ type: [GridUnitDto], description: 'Base first, then by factor' })
  units: GridUnitDto[];
  @ApiProperty({ type: Number, nullable: true }) homeWarehouseId: number | null;
  @ApiProperty({ type: String, nullable: true }) homeWarehouseName: string | null;
  @ApiProperty({ description: 'On hand in the home warehouse, base units' }) onHand: string;
  @ApiProperty({ type: String, nullable: true, description: 'The home warehouse’s minimum' })
  minQty: string | null;
  @ApiProperty({ description: 'Last month’s outflow from the home warehouse, base units' })
  lastMonthOut: string;
  @ApiProperty({ type: GridSalesDto }) sales: GridSalesDto;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Last delivery-note price per base unit (price readers only)',
  })
  lastBasePrice?: string | null;
  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  lastPriceDate?: string | null;
  @ApiProperty({ type: GridLineDto, nullable: true }) line: GridLineDto | null;
  @ApiProperty({ description: 'May the caller change the ordered quantity now' }) editable: boolean;
  @ApiProperty({ description: 'May the caller type the shipped quantity now' }) canShip: boolean;
  @ApiProperty({ type: GridReceiptLineDto, nullable: true }) receipt: GridReceiptLineDto | null;
  @ApiProperty({ description: 'A receipt line of a product not on the order' }) extra: boolean;
}

@ApiSchema({ name: 'PurchaseOrderGridRights' })
export class GridRightsDto {
  @ApiProperty() order: boolean;
  @ApiProperty() shipped: boolean;
  @ApiProperty() count: boolean;
  @ApiProperty() price: boolean;
}

@ApiSchema({ name: 'PurchaseOrderGridReceipt' })
export class GridReceiptDto {
  @ApiProperty() id: number;
  @ApiProperty({ type: String, nullable: true }) number: string | null;
  @ApiProperty({ enum: ['DRAFT', 'POSTED', 'CANCELLED'] }) status: 'DRAFT' | 'POSTED' | 'CANCELLED';
  @ApiProperty() costingVersion: number;
  @ApiProperty({ type: String, nullable: true }) noteTotalQty: string | null;
  @ApiProperty({ type: String, nullable: true }) noteTotalAmount: string | null;
  @ApiProperty({ type: [Number] }) confirmedWarehouseIds: number[];
}

@ApiSchema({ name: 'PurchaseOrderGridPage' })
export class GridPageDto {
  @ApiProperty({ type: [GridRowDto] }) data: GridRowDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
  @ApiProperty() total: number;
  @ApiProperty({ type: String, format: 'date' }) outflowFrom: string;
  @ApiProperty({ type: String, format: 'date' }) outflowTo: string;
  @ApiProperty({ description: 'YYYY-MM, the first of the 12 sales months' }) salesFrom: string;
  @ApiProperty({ description: 'YYYY-MM, the last one' }) salesTo: string;
  @ApiProperty({ type: GridRightsDto }) rights: GridRightsDto;
  @ApiProperty({ type: GridReceiptDto, nullable: true }) receipt: GridReceiptDto | null;
  @ApiProperty({
    type: [GridRowDto],
    description: 'Receipt lines of products not in the grid (first page only)',
  })
  extra: GridRowDto[];
}

@ApiSchema({ name: 'PurchaseOrderGridChange' })
export class GridChangeDto {
  @ApiProperty() @IsInt() @Min(1) productId: number;
  @ApiPropertyOptional({
    enum: GRID_FIELDS,
    description: 'ORDERED (default): the ordered quantity; SHIPPED: the shipped one («Ачигдаж»)',
  })
  @IsOptional()
  @IsIn(GRID_FIELDS)
  field?: (typeof GRID_FIELDS)[number];
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'The unit now (null with no quantity; ignored for SHIPPED)',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  productUnitId: number | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The quantity now; null or 0 removes an ordered line, null clears a shipped one',
  })
  @IsOptional()
  @Matches(QTY)
  qty: string | null;
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'The unit when the page opened (null: no line then; ignored for SHIPPED)',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  previousUnitId: number | null;
  @ApiProperty({ type: String, nullable: true, description: 'The quantity when the page opened' })
  @IsOptional()
  @Matches(QTY)
  previousQty: string | null;
}

@ApiSchema({ name: 'PurchaseOrderGridSaveRequest' })
export class SaveGridDto {
  @ApiProperty({ type: [GridChangeDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_PO_CHANGES)
  @ValidateNested({ each: true })
  @Type(() => GridChangeDto)
  changes: GridChangeDto[];
}

@ApiSchema({ name: 'PurchaseOrderGridConflict' })
export class GridConflictDto {
  @ApiProperty() productId: number;
  @ApiProperty({ enum: GRID_FIELDS }) field: (typeof GRID_FIELDS)[number];
  @ApiProperty({ type: Number, nullable: true }) productUnitId: number | null;
  @ApiProperty({ type: String, nullable: true }) qty: string | null;
}

@ApiSchema({ name: 'PurchaseOrderGridRefusal' })
export class GridRefusalDto {
  @ApiProperty() productId: number;
  @ApiProperty({ enum: GRID_REFUSALS })
  reason: (typeof GRID_REFUSALS)[number];
}

@ApiSchema({ name: 'PurchaseOrderGridSaveResult' })
export class GridSaveResultDto {
  @ApiProperty() applied: number;
  @ApiProperty({ type: [GridConflictDto], description: 'Changed by someone else: skipped' })
  conflicts: GridConflictDto[];
  @ApiProperty({ type: [GridRefusalDto] }) refused: GridRefusalDto[];
}

@ApiSchema({ name: 'PurchaseOrderArrivalChange' })
export class ArrivalChangeDto {
  @ApiProperty({ description: 'The receipt line' }) @IsInt() @Min(1) lineId: number;
  @ApiPropertyOptional({
    description:
      'The counted quantity in base units (boxes × pieces); absent when only the note changes',
  })
  @IsOptional()
  @Matches(QTY)
  arrivedQtyBase?: string;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 500 })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(500)
  note?: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The count when the page opened (null while unchecked)',
  })
  @IsOptional()
  @Matches(QTY)
  previousArrivedQtyBase: string | null;
}

@ApiSchema({ name: 'PurchaseOrderArrivalsSaveRequest' })
export class SaveArrivalsDto {
  @ApiProperty({ type: [ArrivalChangeDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_PO_CHANGES)
  @ValidateNested({ each: true })
  @Type(() => ArrivalChangeDto)
  changes: ArrivalChangeDto[];
}

@ApiSchema({ name: 'PurchaseOrderArrivalConflict' })
export class ArrivalConflictDto {
  @ApiProperty() lineId: number;
  @ApiProperty({ type: String, nullable: true }) arrivedQtyBase: string | null;
  @ApiProperty({ type: String, nullable: true }) note: string | null;
}

@ApiSchema({ name: 'PurchaseOrderArrivalRefusal' })
export class ArrivalRefusalDto {
  @ApiProperty() lineId: number;
  @ApiProperty({ enum: ARRIVAL_REFUSALS }) reason: (typeof ARRIVAL_REFUSALS)[number];
}

@ApiSchema({ name: 'PurchaseOrderArrivalsSaveResult' })
export class ArrivalSaveResultDto {
  @ApiProperty() applied: number;
  @ApiProperty({ type: [ArrivalConflictDto] }) conflicts: ArrivalConflictDto[];
  @ApiProperty({ type: [ArrivalRefusalDto] }) refused: ArrivalRefusalDto[];
}

export class HistoryQueryDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) userId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) supplierId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) productId?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) cursor?: string;
  @ApiPropertyOptional({ maximum: PO_HISTORY_PAGE })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PO_HISTORY_PAGE)
  limit?: number;
}

@ApiSchema({ name: 'PurchaseOrderHistoryRow' })
export class HistoryRowDto {
  @ApiProperty() id: number;
  @ApiProperty({ type: String, format: 'date-time' }) at: string;
  @ApiProperty({ type: Number, nullable: true }) userId: number | null;
  @ApiProperty({ type: String, nullable: true }) userName: string | null;
  @ApiProperty({ enum: PO_HISTORY_KINDS }) kind: PoHistoryKind;
  @ApiProperty({ type: Number, nullable: true }) supplierId: number | null;
  @ApiProperty({ type: String, nullable: true }) supplierName: string | null;
  @ApiProperty({ type: Number, nullable: true }) productId: number | null;
  @ApiProperty({ type: String, nullable: true }) productSku: string | null;
  @ApiProperty({ type: String, nullable: true }) productName: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Before (a status code for STATUS)' })
  from: string | null;
  @ApiProperty({ type: String, nullable: true }) to: string | null;
  @ApiProperty({ type: String, nullable: true }) detail: string | null;
}

@ApiSchema({ name: 'PurchaseOrderHistoryPage' })
export class HistoryPageDto {
  @ApiProperty({ type: [HistoryRowDto] }) data: HistoryRowDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
}

export class PrintQueryDto {
  @ApiPropertyOptional({ description: 'One supplier; all when absent' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  supplierId?: number;
}

@ApiSchema({ name: 'PurchaseOrderSheetLine' })
export class SheetLineDto {
  @ApiProperty() productId: number;
  @ApiProperty() sku: string;
  @ApiProperty() name: string;
  @ApiProperty({ type: String, nullable: true }) warehouseName: string | null;
  @ApiProperty() unitName: string;
  @ApiProperty() qty: string;
  @ApiProperty() qtyBase: string;
  @ApiProperty() baseUnitName: string;
  @ApiProperty({ type: String, nullable: true, description: 'kg of the line' })
  weightKg: string | null;
}

@ApiSchema({ name: 'PurchaseOrderSheet' })
export class SheetDto {
  @ApiProperty() supplierId: number;
  @ApiProperty() supplierName: string;
  @ApiProperty({ enum: PO_SUPPLIER_STATUSES }) status: PoSupplierStatus;
  @ApiProperty({ type: String, nullable: true }) ordererName: string | null;
  @ApiProperty({ type: [SheetLineDto] }) lines: SheetLineDto[];
}

@ApiSchema({ name: 'PurchaseOrderPrint' })
export class PrintDto {
  @ApiProperty() number: string;
  @ApiProperty({ type: String, format: 'date' }) orderDate: string;
  @ApiProperty({ type: String, nullable: true }) note: string | null;
  @ApiProperty({ type: [SheetDto] }) sheets: SheetDto[];
}

@ApiSchema({ name: 'SupplierOrderer' })
export class SupplierOrdererDto {
  @ApiProperty() supplierId: number;
  @ApiProperty({ type: Number, nullable: true }) userId: number | null;
  @ApiProperty({ type: String, nullable: true }) fullName: string | null;
}

@ApiSchema({ name: 'SupplierOrdererRequest' })
export class SetOrdererDto {
  @ApiProperty({ type: Number, nullable: true, description: 'null removes the orderer' })
  @IsOptional()
  @IsInt()
  @Min(1)
  userId: number | null;
}

@ApiSchema({ name: 'PurchaseOrderSupplierCandidate' })
export class SupplierCandidateDto {
  @ApiProperty() id: number;
  @ApiProperty() code: string;
  @ApiProperty() name: string;
  @ApiProperty({ type: String, nullable: true }) phone: string | null;
  @ApiProperty({ type: String, nullable: true }) tin: string | null;
  @ApiProperty({ description: 'Active products this supplier is the main supplier of' })
  mainProductCount: number;
}

@ApiSchema({ name: 'PurchaseOrderSupplierCandidatePage' })
export class SupplierCandidatePageDto {
  @ApiProperty({ type: [SupplierCandidateDto] }) data: SupplierCandidateDto[];
  @ApiProperty({ type: String, nullable: true, description: 'Always null: one list' })
  nextCursor: string | null;
}

@ApiSchema({ name: 'OrdererCandidate' })
export class OrdererCandidateDto {
  @ApiProperty() id: number;
  @ApiProperty() fullName: string;
}
