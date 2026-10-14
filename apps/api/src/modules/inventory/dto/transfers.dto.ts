import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import {
  TRANSFER_ORIGINS,
  TRANSFER_STATUSES,
  type TransferOrigin,
  type TransferStatus,
} from '@tugeel/shared/inventory';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
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

const DIRECTIONS = ['INCOMING', 'OUTGOING'] as const;

@ApiSchema({ name: 'TransferLine' })
export class TransferLineDto {
  @ApiProperty() id: number;
  @ApiProperty() productId: number;
  @ApiProperty() productSku: string;
  @ApiProperty() productName: string;
  @ApiProperty({ description: 'The unit asked for' }) requestUnitId: number;
  @ApiProperty({ example: 'хайрцаг' }) unitName: string;
  @ApiProperty({ example: '24', description: 'Base units per request unit, frozen on the line' })
  requestFactor: string;
  @ApiProperty({ example: '5', description: 'In the request unit' }) requestedQty: string;
  @ApiProperty() baseUnitId: number;
  @ApiProperty({ example: 'ширхэг' }) baseUnitName: string;
  @ApiProperty({ type: String, nullable: true, example: '120', description: 'Base units' })
  shippedQtyBase: string | null;
  @ApiProperty({ type: String, nullable: true, example: '118', description: 'Base units' })
  receivedQtyBase: string | null;
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Chosen when shipped; before, the suggested shelf (null: to be scanned)',
  })
  fromBinId: number | null;
  @ApiProperty({ type: String, nullable: true, example: 'A-01-03' }) fromBinCode: string | null;
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Chosen when received; while in transit, the suggested bin',
  })
  toBinId: number | null;
  @ApiProperty({ type: String, nullable: true, example: 'SALESFLOOR' }) toBinCode: string | null;
}

@ApiSchema({ name: 'TransferDetail' })
export class TransferDetailDto {
  @ApiProperty() id: number;
  @ApiProperty({ type: String, nullable: true, example: 'TR-2026-000001' }) number: string | null;
  @ApiProperty({ enum: TRANSFER_ORIGINS }) origin: TransferOrigin;
  @ApiProperty({ enum: TRANSFER_STATUSES }) status: TransferStatus;
  @ApiProperty() sourceWarehouseId: number;
  @ApiProperty() destWarehouseId: number;
  @ApiProperty({ type: String, nullable: true }) note: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) requestedAt: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) shippedAt: string | null;
  @ApiProperty({ type: String, format: 'date', nullable: true }) shipDate: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) receivedAt: string | null;
  @ApiProperty({ type: String, format: 'date', nullable: true }) receiveDate: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) cancelledAt: string | null;
  @ApiProperty({ type: String, nullable: true }) cancelReason: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: string;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt: string;
  @ApiProperty({ type: [TransferLineDto] }) lines: TransferLineDto[];
}

@ApiSchema({ name: 'TransferSummary' })
export class TransferSummaryDto {
  @ApiProperty() id: number;
  @ApiProperty({ type: String, nullable: true }) number: string | null;
  @ApiProperty({ enum: TRANSFER_ORIGINS }) origin: TransferOrigin;
  @ApiProperty({ enum: TRANSFER_STATUSES }) status: TransferStatus;
  @ApiProperty() sourceWarehouseId: number;
  @ApiProperty() destWarehouseId: number;
  @ApiProperty() lineCount: number;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) requestedAt: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) shippedAt: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) receivedAt: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: string;
}

@ApiSchema({ name: 'TransferPage' })
export class TransferPageDto {
  @ApiProperty({ type: [TransferSummaryDto] }) data: TransferSummaryDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
}

export class TransferListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({
    enum: DIRECTIONS,
    description:
      'INCOMING = received by, OUTGOING = sent by warehouseId; without it, by the warehouses the caller writes for',
  })
  @IsOptional()
  @IsIn(DIRECTIONS)
  direction?: (typeof DIRECTIONS)[number];
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) warehouseId?: number;
  @ApiPropertyOptional({ enum: TRANSFER_STATUSES })
  @IsOptional()
  @IsIn(TRANSFER_STATUSES)
  status?: TransferStatus;
}

@ApiSchema({ name: 'TransferLineRequest' })
export class TransferLineRequestDto {
  @ApiProperty({ description: 'The unit asked for' }) @IsInt() @Min(1) productUnitId: number;
  @ApiProperty({ example: '5', description: 'Positive, in that unit' })
  @Matches(QTY)
  qty: string;
}

@ApiSchema({ name: 'TransferCreateRequest' })
export class CreateTransferDto {
  @ApiProperty({
    enum: TRANSFER_ORIGINS,
    description: 'REQUEST: the destination asks; PUSH: the source sends on its own',
  })
  @IsIn(TRANSFER_ORIGINS)
  origin: TransferOrigin;
  @ApiProperty() @IsInt() @Min(1) sourceWarehouseId: number;
  @ApiProperty() @IsInt() @Min(1) destWarehouseId: number;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 500 })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(500)
  note?: string | null;
  @ApiPropertyOptional({ type: [TransferLineRequestDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_TRANSFER_LINES)
  @ValidateNested({ each: true })
  @Type(() => TransferLineRequestDto)
  lines?: TransferLineRequestDto[];
}

@ApiSchema({ name: 'TransferUpdateRequest' })
export class UpdateTransferDto {
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 500 })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

@ApiSchema({ name: 'TransferLineUpdateRequest' })
export class UpdateTransferLineDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) productUnitId?: number;
  @ApiPropertyOptional({ example: '6' }) @IsOptional() @Matches(QTY) qty?: string;
}

@ApiSchema({ name: 'TransferCount' })
export class TransferCountDto {
  @ApiProperty() @IsInt() @Min(1) lineId: number;
  @ApiPropertyOptional({ description: 'A current unit of the product; default the line’s unit' })
  @IsOptional()
  @IsInt()
  @Min(1)
  productUnitId?: number;
  @ApiPropertyOptional({
    example: '5',
    description: 'In that unit; 0 = none. Default: requested (ship) or shipped (receive)',
  })
  @IsOptional()
  @Matches(QTY)
  qty?: string;
  @ApiPropertyOptional({ description: 'The source shelf (ship) or destination bin (receive)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  binId?: number;
}

@ApiSchema({ name: 'TransferCountRequest' })
export class TransferCountsDto {
  @ApiPropertyOptional({
    type: [TransferCountDto],
    description: 'Lines left out take the default quantity and bin',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_TRANSFER_LINES)
  @ValidateNested({ each: true })
  @Type(() => TransferCountDto)
  lines?: TransferCountDto[];
}

@ApiSchema({ name: 'TransferCancelRequest' })
export class CancelTransferDto {
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 300,
    description: 'Required when the source declines a request',
  })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(300)
  reason?: string | null;
}
