import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import {
  MAX_PO_CHANGES,
  MAX_PO_SUPPLIERS,
  PO_GRID_PAGE,
  PO_SUPPLIER_STATUSES,
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
  @ApiProperty({ description: 'Σ ordered base quantity' }) qtyBase: string;
  @ApiProperty({ description: 'Σ weight, kg (products with a weight)' }) weightKg: string;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Σ ordered × last price per base unit (price readers)',
  })
  estimatedCost: string | null;
  @ApiProperty({ type: Number, nullable: true }) receiptId: number | null;
  @ApiProperty({ type: String, nullable: true }) receiptNumber: string | null;
  @ApiProperty() canEdit: boolean;
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
  @ApiProperty({ type: [PurchaseOrderSupplierDto] }) suppliers: PurchaseOrderSupplierDto[];
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
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) cursor?: string;
  @ApiPropertyOptional({ maximum: PO_GRID_PAGE })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PO_GRID_PAGE)
  limit?: number;
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
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Last delivery-note price per base unit (price readers only)',
  })
  lastBasePrice?: string | null;
  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  lastPriceDate?: string | null;
  @ApiProperty({ type: GridLineDto, nullable: true }) line: GridLineDto | null;
  @ApiProperty() editable: boolean;
}

@ApiSchema({ name: 'PurchaseOrderGridPage' })
export class GridPageDto {
  @ApiProperty({ type: [GridRowDto] }) data: GridRowDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
  @ApiProperty() total: number;
  @ApiProperty({ type: String, format: 'date' }) outflowFrom: string;
  @ApiProperty({ type: String, format: 'date' }) outflowTo: string;
}

@ApiSchema({ name: 'PurchaseOrderGridChange' })
export class GridChangeDto {
  @ApiProperty() @IsInt() @Min(1) productId: number;
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'The unit now (null with no quantity)',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  productUnitId: number | null;
  @ApiProperty({ type: String, nullable: true, description: 'The quantity now; null or 0 removes' })
  @IsOptional()
  @Matches(QTY)
  qty: string | null;
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'The unit when the page opened (null: no line then)',
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
  @ApiProperty({ type: Number, nullable: true }) productUnitId: number | null;
  @ApiProperty({ type: String, nullable: true }) qty: string | null;
}

@ApiSchema({ name: 'PurchaseOrderGridRefusal' })
export class GridRefusalDto {
  @ApiProperty() productId: number;
  @ApiProperty({ enum: ['SCOPE', 'NO_HOME', 'NOT_SUPPLIER'] })
  reason: 'SCOPE' | 'NO_HOME' | 'NOT_SUPPLIER';
}

@ApiSchema({ name: 'PurchaseOrderGridSaveResult' })
export class GridSaveResultDto {
  @ApiProperty() applied: number;
  @ApiProperty({ type: [GridConflictDto], description: 'Changed by someone else: skipped' })
  conflicts: GridConflictDto[];
  @ApiProperty({ type: [GridRefusalDto] }) refused: GridRefusalDto[];
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

@ApiSchema({ name: 'OrdererCandidate' })
export class OrdererCandidateDto {
  @ApiProperty() id: number;
  @ApiProperty() fullName: string;
}
