import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { PageQueryDto } from '../../../common/pagination/page';
import { BIN_TYPES, MOVEMENT_TYPES, STOCK_DOC_TYPES } from '@tugeel/shared/inventory';
import { RECONCILIATION_STATUSES } from '../schema';
import { BinDto, queryBoolean } from './bins.dto';

type ReconciliationStatus = (typeof RECONCILIATION_STATUSES)[number];

@ApiSchema({ name: 'StockProduct' })
export class StockProductDto {
  @ApiProperty() id: number;
  @ApiProperty() sku: string;
  @ApiProperty() name: string;
  @ApiProperty({ example: 'ширхэг' }) baseUnitName: string;
  @ApiProperty({ type: String, nullable: true }) thumbUrl: string | null;
}

/** A product's balance in one warehouse; `avgCost` and `value` only for cost holders. */
@ApiSchema({ name: 'WarehouseBalance' })
export class WarehouseBalanceDto {
  @ApiProperty() warehouseId: number;
  @ApiProperty({ example: '48', description: 'Base units' }) onHand: string;
  @ApiProperty() sellableOnHand: string;
  @ApiProperty() reserved: string;
  @ApiProperty({ description: 'Sellable minus reserved' }) available: string;
  @ApiPropertyOptional({ description: 'Cost holders only' }) avgCost?: string;
  @ApiPropertyOptional({ description: 'Cost holders only, MNT' }) value?: string;
}

@ApiSchema({ name: 'ProductStock' })
export class ProductStockDto {
  @ApiProperty({ type: StockProductDto }) product: StockProductDto;
  @ApiProperty() onHand: string;
  @ApiProperty() available: string;
  @ApiPropertyOptional({ description: 'Cost holders only, MNT' }) value?: string;
  @ApiProperty({ type: [WarehouseBalanceDto] }) warehouses: WarehouseBalanceDto[];
}

@ApiSchema({ name: 'ProductStockPage' })
export class ProductStockPageDto {
  @ApiProperty({ type: [ProductStockDto] }) data: ProductStockDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
}

@ApiSchema({ name: 'BinBalance' })
export class BinBalanceDto {
  @ApiProperty() warehouseId: number;
  @ApiProperty() binId: number;
  @ApiProperty({ example: 'A-01-03' }) binCode: string;
  @ApiProperty({ enum: BIN_TYPES }) binType: string;
  @ApiProperty() sellable: boolean;
  @ApiProperty({ type: Number, nullable: true }) lotId: number | null;
  @ApiProperty() onHand: string;
}

@ApiSchema({ name: 'ProductStockDetail' })
export class ProductStockDetailDto extends ProductStockDto {
  @ApiProperty({ type: [BinBalanceDto] }) bins: BinBalanceDto[];
}

@ApiSchema({ name: 'BinContentLine' })
export class BinContentLineDto {
  @ApiProperty({ type: StockProductDto }) product: StockProductDto;
  @ApiProperty({ type: Number, nullable: true }) lotId: number | null;
  @ApiProperty() onHand: string;
}

@ApiSchema({ name: 'BinContent' })
export class BinContentDto {
  @ApiProperty({ type: BinDto }) bin: BinDto;
  @ApiProperty({ type: [BinContentLineDto] }) lines: BinContentLineDto[];
}

export class StockQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ description: 'Name, SKU or barcode, as in the catalog search' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) categoryId?: number;
  @ApiPropertyOptional({ description: 'Show this warehouse’s quantities only' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  warehouseId?: number;
  @ApiPropertyOptional({ description: 'Without q: only products holding stock' })
  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean()
  inStock?: boolean;
}

@ApiSchema({ name: 'ReconciliationDiff' })
export class ReconciliationDiffDto {
  @ApiProperty({ enum: ['BIN', 'WAREHOUSE', 'SELLABLE', 'RESERVED'] })
  level: 'BIN' | 'WAREHOUSE' | 'SELLABLE' | 'RESERVED';
  @ApiProperty() warehouseId: number;
  @ApiProperty({ type: Number, nullable: true }) binId: number | null;
  @ApiProperty() productId: number;
  @ApiProperty({ type: Number, nullable: true }) lotId: number | null;
  @ApiProperty({ description: 'Sum of the ledger' }) ledger: string;
  @ApiProperty({ description: 'The cached balance' }) cache: string;
}

@ApiSchema({ name: 'ReconciliationRun' })
export class ReconciliationRunDto {
  @ApiProperty() id: number;
  @ApiProperty({ enum: RECONCILIATION_STATUSES }) status: ReconciliationStatus;
  @ApiProperty() diffCount: number;
  @ApiProperty({ type: [ReconciliationDiffDto], description: 'The first 100' })
  diffs: ReconciliationDiffDto[];
  @ApiProperty({ type: String, format: 'date-time' }) startedAt: string;
  @ApiProperty() triggeredBy: string;
}

@ApiSchema({ name: 'ReconciliationStatus' })
export class ReconciliationStatusDto {
  @ApiProperty({ type: ReconciliationRunDto, nullable: true }) lastRun: ReconciliationRunDto | null;
}

const MOVEMENT_DOC_TYPES = ['GR', 'BM', 'TR', 'ADJ', 'ST', 'SO'] as const;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Movement history filters (SPEC §8.2 #1); dates are Ulaanbaatar business days, inclusive. */
export class StockMovementQueryDto extends PageQueryDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) productId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) warehouseId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) binId?: number;

  @ApiPropertyOptional({ enum: MOVEMENT_DOC_TYPES })
  @IsOptional()
  @IsIn(MOVEMENT_DOC_TYPES)
  docType?: (typeof MOVEMENT_DOC_TYPES)[number];

  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsOptional()
  @Matches(DAY)
  @IsISO8601({ strict: true, strictSeparator: true })
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-31' })
  @IsOptional()
  @Matches(DAY)
  @IsISO8601({ strict: true, strictSeparator: true })
  to?: string;
}

/** A ledger row of the movement history; `unitCost` and `value` only for cost holders. */
@ApiSchema({ name: 'StockMovement' })
export class StockMovementDto {
  @ApiProperty() id: number;
  @ApiProperty({ format: 'date-time' }) postedAt: string;
  @ApiProperty({ example: '2026-10-11' }) effectiveDate: string;
  @ApiProperty() warehouseId: number;
  @ApiProperty() binId: number;
  @ApiProperty({ example: 'A-01-03' }) binCode: string;
  @ApiProperty({ type: StockProductDto }) product: StockProductDto;
  @ApiProperty({ type: Number, nullable: true }) lotId: number | null;
  @ApiProperty({ enum: Object.keys(MOVEMENT_TYPES) }) movementType: string;
  @ApiProperty({ enum: STOCK_DOC_TYPES }) docType: string;
  @ApiProperty() docId: number;
  @ApiProperty({ type: String, nullable: true, example: 'GR-2026-000001' }) docNumber:
    string | null;
  @ApiProperty({ example: '-24', description: 'Base units, negative when it left the bin' })
  qtyBase: string;
  @ApiProperty({ example: '2', description: 'As entered on the document line' }) enteredQty: string;
  @ApiProperty({ example: 'хайрцаг' }) unitName: string;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The product’s balance in this warehouse after the movement (product filter only)',
  })
  warehouseBalance: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The product’s balance on this bin after the movement (product filter only)',
  })
  binBalance: string | null;
  @ApiPropertyOptional({ description: 'Cost holders only' }) unitCost?: string;
  @ApiPropertyOptional({ description: 'Cost holders only, MNT, signed' }) value?: string;
}

@ApiSchema({ name: 'StockMovementPage' })
export class StockMovementPageDto {
  @ApiProperty({ type: [StockMovementDto] }) data: StockMovementDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
}

const LOW_STOCK_STATUSES = ['OUT', 'LOW'] as const;

export class LowStockQueryDto extends PageQueryDto {
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) warehouseId: number;
}

/** A row of a warehouse's low-stock list (ADR-0039); quantities in the base unit. */
@ApiSchema({ name: 'LowStockRow' })
export class LowStockRowDto {
  @ApiProperty({ type: StockProductDto }) product: StockProductDto;
  @ApiProperty({ description: 'The base unit: every quantity here is in it' }) baseUnitId: number;
  @ApiProperty({
    enum: LOW_STOCK_STATUSES,
    description: 'OUT: none left; LOW: at or below the minimum',
  })
  status: (typeof LOW_STOCK_STATUSES)[number];
  @ApiProperty({ example: '12' }) onHand: string;
  @ApiProperty({ type: String, nullable: true, example: '20' }) minQty: string | null;
  @ApiProperty({ type: String, nullable: true, example: '100' }) maxQty: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    example: '88',
    description: 'Up to the maximum, else the minimum; null without a level',
  })
  suggestedQty: string | null;
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'The product’s home (wholesale) warehouse',
  })
  homeWarehouseId: number | null;
}

@ApiSchema({ name: 'LowStockPage' })
export class LowStockPageDto {
  @ApiProperty({ type: [LowStockRowDto] }) data: LowStockRowDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
}
