import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import { ADJUSTMENT_REASON_CODES, type AdjustmentReason } from '@tugeel/shared/inventory';
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
import { ADJUSTMENT_STATUSES } from '../schema';
import { QTY, trimmed } from './bins.dto';

/** Cost per base unit, NUMERIC(14,4). */
export const UNIT_COST = /^\d{1,10}(\.\d{1,4})?$/;

type AdjustmentStatus = (typeof ADJUSTMENT_STATUSES)[number];

@ApiSchema({ name: 'AdjustmentLine' })
export class AdjustmentLineDto {
  @ApiProperty() id: number;
  @ApiProperty() productId: number;
  @ApiProperty() productSku: string;
  @ApiProperty() productName: string;
  @ApiProperty() productUnitId: number;
  @ApiProperty({ example: 'ширхэг' }) unitName: string;
  @ApiProperty({ example: '2', description: 'Positive; the reason sets the direction' })
  enteredQty: string;
  @ApiProperty({ example: '2', description: 'Base units' }) qtyBase: string;
  @ApiProperty() binId: number;
  @ApiProperty({ example: 'A-01-03' }) binCode: string;
  @ApiProperty({ type: String, nullable: true }) note: string | null;
}

/** An adjustment without any cost: what every user sees. */
@ApiSchema({ name: 'AdjustmentDetail' })
export class AdjustmentDetailDto {
  @ApiProperty() id: number;
  @ApiProperty({ type: String, nullable: true, example: 'ADJ-2026-000001' }) number: string | null;
  @ApiProperty() warehouseId: number;
  @ApiProperty({ enum: ADJUSTMENT_REASON_CODES }) reason: AdjustmentReason;
  @ApiProperty({ enum: ADJUSTMENT_STATUSES }) status: AdjustmentStatus;
  @ApiProperty({ type: String, nullable: true }) note: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) submittedAt: string | null;
  @ApiProperty({ type: String, format: 'date', nullable: true }) effectiveDate: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) postedAt: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: string;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt: string;
  @ApiProperty({ type: [AdjustmentLineDto] }) lines: AdjustmentLineDto[];
}

@ApiSchema({ name: 'AdjustmentSummary' })
export class AdjustmentSummaryDto {
  @ApiProperty() id: number;
  @ApiProperty({ type: String, nullable: true }) number: string | null;
  @ApiProperty() warehouseId: number;
  @ApiProperty({ enum: ADJUSTMENT_REASON_CODES }) reason: AdjustmentReason;
  @ApiProperty({ enum: ADJUSTMENT_STATUSES }) status: AdjustmentStatus;
  @ApiProperty() lineCount: number;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) submittedAt: string | null;
  @ApiProperty({ type: String, format: 'date', nullable: true }) effectiveDate: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: string;
}

@ApiSchema({ name: 'AdjustmentPage' })
export class AdjustmentPageDto {
  @ApiProperty({ type: [AdjustmentSummaryDto] }) data: AdjustmentSummaryDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
}

export class AdjustmentListQueryDto extends PageQueryDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) warehouseId?: number;
  @ApiPropertyOptional({ enum: ADJUSTMENT_STATUSES })
  @IsOptional()
  @IsIn(ADJUSTMENT_STATUSES)
  status?: AdjustmentStatus;
}

class AdjustmentNoteDto {
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 300 })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(300)
  note?: string | null;
}

@ApiSchema({ name: 'AdjustmentLineRequest' })
export class AdjustmentLineRequestDto extends AdjustmentNoteDto {
  @ApiProperty() @IsInt() @Min(1) productUnitId: number;
  @ApiProperty({ example: '2', description: 'Positive, in the product unit' })
  @Matches(QTY)
  enteredQty: string;
  @ApiProperty() @IsInt() @Min(1) binId: number;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: '1250.5',
    description: 'Inbound reasons, cost holders only: cost per base unit; omitted = the average',
  })
  @IsOptional()
  @Matches(UNIT_COST)
  unitCost?: string | null;
}

@ApiSchema({ name: 'AdjustmentCreateRequest' })
export class CreateAdjustmentDto {
  @ApiProperty() @IsInt() @Min(1) warehouseId: number;
  @ApiProperty({ enum: ADJUSTMENT_REASON_CODES, description: 'OPENING: approvers only' })
  @IsIn(ADJUSTMENT_REASON_CODES)
  reason: AdjustmentReason;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 500 })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(500)
  note?: string | null;
  @ApiPropertyOptional({ type: [AdjustmentLineRequestDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => AdjustmentLineRequestDto)
  lines?: AdjustmentLineRequestDto[];
}

@ApiSchema({ name: 'AdjustmentUpdateRequest' })
export class UpdateAdjustmentDto {
  @ApiPropertyOptional({ enum: ADJUSTMENT_REASON_CODES })
  @IsOptional()
  @IsIn(ADJUSTMENT_REASON_CODES)
  reason?: AdjustmentReason;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 500 })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

@ApiSchema({ name: 'AdjustmentLineUpdateRequest' })
export class UpdateAdjustmentLineDto extends AdjustmentNoteDto {
  @ApiPropertyOptional({ example: '3' }) @IsOptional() @Matches(QTY) enteredQty?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) binId?: number;
}

@ApiSchema({ name: 'AdjustmentCostRequest' })
export class AdjustmentCostDto {
  @ApiProperty() @IsInt() @Min(1) lineId: number;
  @ApiProperty({ example: '1250.5', description: 'Cost per base unit' })
  @Matches(UNIT_COST)
  unitCost: string;
}

@ApiSchema({ name: 'AdjustmentApproveRequest' })
export class ApproveAdjustmentDto {
  @ApiPropertyOptional({
    type: [AdjustmentCostDto],
    description: 'Inbound reasons, cost holders only; lines without a cost take the average',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => AdjustmentCostDto)
  costs?: AdjustmentCostDto[];
}
