import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { PageQueryDto } from '../../../common/pagination/page';
import { BIN_TYPES } from '@tugeel/shared/inventory';
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
  @ApiProperty({ enum: ['BIN', 'WAREHOUSE', 'SELLABLE'] }) level: 'BIN' | 'WAREHOUSE' | 'SELLABLE';
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
