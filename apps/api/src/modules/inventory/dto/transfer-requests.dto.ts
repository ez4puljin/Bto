import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import { TRANSFER_STATUSES, type TransferStatus } from '@tugeel/shared/inventory';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PageQueryDto } from '../../../common/pagination/page';
import { MAX_TRANSFER_LINES } from '../services/transfers.service';
import { QTY, trimmed } from './bins.dto';
import { TransferDetailDto } from './transfers.dto';

const ROW_FILTERS = ['ALL', 'REQUESTED'] as const;

@ApiSchema({ name: 'TransferRequestContext' })
export class TransferRequestContextDto {
  @ApiProperty({
    type: 'array',
    items: {
      type: 'object',
      properties: { id: { type: 'number' }, name: { type: 'string' } },
      required: ['id', 'name'],
    },
    description: 'The STORE warehouses the caller may request for',
  })
  storeWarehouses: { id: number; name: string }[];
  @ApiProperty({ type: String, format: 'date', description: 'The server’s business date' })
  today: string;
}

export class TransferRequestRowsQueryDto extends PageQueryDto {
  @ApiProperty({ description: 'The store the request is for' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  warehouseId: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) q?: string;
  @ApiPropertyOptional({ description: 'Show this request’s lines beside the products' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  requestId?: number;
  @ApiPropertyOptional({ enum: ROW_FILTERS, description: 'REQUESTED: only the request’s products' })
  @IsOptional()
  @IsIn(ROW_FILTERS)
  filter?: (typeof ROW_FILTERS)[number];
}

@ApiSchema({ name: 'TransferRequestRowUnit' })
export class TransferRequestRowUnitDto {
  @ApiProperty({ description: 'The product unit id' }) id: number;
  @ApiProperty({ example: 'хайрцаг' }) name: string;
  @ApiProperty({ type: String, nullable: true, example: 'BOX' }) uomCode: string | null;
  @ApiProperty({ example: '24', description: 'Base units per unit' }) factor: string;
  @ApiProperty() isBase: boolean;
}

@ApiSchema({ name: 'TransferRequestRowLine' })
export class TransferRequestRowLineDto {
  @ApiProperty() transferId: number;
  @ApiProperty() lineId: number;
  @ApiProperty() productUnitId: number;
  @ApiProperty({ example: '3', description: 'In that unit' }) qty: string;
}

@ApiSchema({ name: 'TransferRequestRow' })
export class TransferRequestRowDto {
  @ApiProperty() productId: number;
  @ApiProperty() sku: string;
  @ApiProperty() name: string;
  @ApiProperty({ type: String, nullable: true }) thumbUrl: string | null;
  @ApiProperty({ type: [TransferRequestRowUnitDto], description: 'Current units, base first' })
  units: TransferRequestRowUnitDto[];
  @ApiProperty({ type: Number, nullable: true }) homeWarehouseId: number | null;
  @ApiProperty({ type: String, nullable: true }) homeWarehouseName: string | null;
  @ApiProperty({ example: '240', description: 'On hand in the home warehouse, base units' })
  homeOnHand: string;
  @ApiProperty({ example: '12', description: 'On hand at the store, base units' })
  storeOnHand: string;
  @ApiProperty({
    example: '96',
    description: 'Last calendar month’s till sales at the store, base units',
  })
  lastMonthOut: string;
  @ApiProperty({ type: TransferRequestRowLineDto, nullable: true })
  line: TransferRequestRowLineDto | null;
}

@ApiSchema({ name: 'TransferRequestRowsPage' })
export class TransferRequestRowsPageDto {
  @ApiProperty({ type: [TransferRequestRowDto] }) data: TransferRequestRowDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
  @ApiProperty() total: number;
  @ApiProperty({ type: String, format: 'date' }) outflowFrom: string;
  @ApiProperty({ type: String, format: 'date' }) outflowTo: string;
}

@ApiSchema({ name: 'TransferRequestLineRequest' })
export class TransferRequestLineRequestDto {
  @ApiProperty() @IsInt() @Min(1) productId: number;
  @ApiProperty({ description: 'The unit asked for' }) @IsInt() @Min(1) productUnitId: number;
  @ApiProperty({ example: '5', description: 'Positive, in that unit' }) @Matches(QTY) qty: string;
}

@ApiSchema({ name: 'TransferRequestCreateRequest' })
export class CreateTransferRequestDto {
  @ApiProperty({ description: 'The store (a STORE warehouse in the caller’s scope)' })
  @IsInt()
  @Min(1)
  destWarehouseId: number;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 500 })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(500)
  note?: string | null;
  @ApiProperty({ type: [TransferRequestLineRequestDto], description: 'One line per product' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_TRANSFER_LINES)
  @ValidateNested({ each: true })
  @Type(() => TransferRequestLineRequestDto)
  lines: TransferRequestLineRequestDto[];
}

@ApiSchema({ name: 'TransferRequestUpdateRequest' })
export class UpdateTransferRequestDto {
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 500 })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

@ApiSchema({ name: 'TransferRequestChange' })
export class TransferRequestChangeDto {
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
  @ApiProperty({ type: Number, nullable: true, description: 'The unit when the page opened' })
  @IsOptional()
  @IsInt()
  @Min(1)
  previousUnitId: number | null;
  @ApiProperty({ type: String, nullable: true, description: 'The quantity when the page opened' })
  @IsOptional()
  @Matches(QTY)
  previousQty: string | null;
}

@ApiSchema({ name: 'TransferRequestSaveLinesRequest' })
export class SaveTransferRequestLinesDto {
  @ApiProperty({ type: [TransferRequestChangeDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => TransferRequestChangeDto)
  changes: TransferRequestChangeDto[];
}

@ApiSchema({ name: 'TransferRequestConflict' })
export class TransferRequestConflictDto {
  @ApiProperty() productId: number;
  @ApiProperty({ type: Number, nullable: true }) productUnitId: number | null;
  @ApiProperty({ type: String, nullable: true }) qty: string | null;
}

@ApiSchema({ name: 'TransferRequestRefusal' })
export class TransferRequestRefusalDto {
  @ApiProperty() productId: number;
  @ApiProperty({ enum: ['NO_HOME'] }) reason: 'NO_HOME';
}

@ApiSchema({ name: 'TransferRequestSaveResult' })
export class TransferRequestSaveResultDto {
  @ApiProperty() applied: number;
  @ApiProperty({
    type: [TransferRequestConflictDto],
    description: 'Changed by someone else: skipped',
  })
  conflicts: TransferRequestConflictDto[];
  @ApiProperty({ type: [TransferRequestRefusalDto] }) refused: TransferRequestRefusalDto[];
}

@ApiSchema({ name: 'TransferRequestGroup' })
export class TransferRequestGroupDto extends TransferDetailDto {
  @ApiProperty() sourceWarehouseName: string;
}

@ApiSchema({ name: 'TransferRequestDetail' })
export class TransferRequestDetailDto {
  @ApiProperty() id: number;
  @ApiProperty() destWarehouseId: number;
  @ApiProperty() destWarehouseName: string;
  @ApiProperty({ enum: TRANSFER_STATUSES, description: 'The lowest of the live groups' })
  status: TransferStatus;
  @ApiProperty({ type: String, nullable: true }) note: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) requestedAt: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: string;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt: string;
  @ApiProperty({
    type: [TransferRequestGroupDto],
    description: 'One per source warehouse, cancelled ones left out',
  })
  groups: TransferRequestGroupDto[];
}

@ApiSchema({ name: 'TransferRequestSummary' })
export class TransferRequestSummaryDto {
  @ApiProperty() id: number;
  @ApiProperty() destWarehouseId: number;
  @ApiProperty({ enum: TRANSFER_STATUSES }) status: TransferStatus;
  @ApiProperty({ type: String, nullable: true }) note: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) requestedAt: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: string;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt: string;
  @ApiProperty() groupCount: number;
  @ApiProperty() lineCount: number;
  @ApiProperty({ type: [String], description: 'The groups’ TR- numbers, by group' })
  numbers: string[];
}

@ApiSchema({ name: 'TransferRequestPage' })
export class TransferRequestPageDto {
  @ApiProperty({ type: [TransferRequestSummaryDto] }) data: TransferRequestSummaryDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
}

export class TransferRequestListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ description: 'The store; without it, the caller’s own warehouses' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  warehouseId?: number;
  @ApiPropertyOptional({ enum: TRANSFER_STATUSES })
  @IsOptional()
  @IsIn(TRANSFER_STATUSES)
  status?: TransferStatus;
}

@ApiSchema({ name: 'TransferRequestCancelRequest' })
export class CancelTransferRequestDto {
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 300 })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(300)
  reason?: string | null;
}
