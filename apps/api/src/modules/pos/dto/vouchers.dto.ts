import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import {
  POS_LIMITS,
  VOUCHER_BATCH_STATUSES,
  VOUCHER_EFFECTS,
  VOUCHER_ISSUES,
  VOUCHER_KINDS,
  VOUCHER_LIMITS,
  VOUCHER_STATUSES,
  type VoucherBatchStatus,
  type VoucherEffect,
  type VoucherIssue,
  type VoucherKind,
  type VoucherStatus,
} from '@tugeel/shared/pos';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PageQueryDto } from '../../../common/pagination/page';

const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const VALUE = /^[0-9]{1,8}(\.[0-9]{1,2})?$/;

/** A new batch of the till's codes (ADR-0110). */
@ApiSchema({ name: 'PosVoucherBatchRequest' })
export class VoucherBatchRequestDto {
  @ApiProperty({ enum: VOUCHER_KINDS }) @IsIn(VOUCHER_KINDS) kind: VoucherKind;
  @ApiProperty({ example: 'Шинэ жилийн купон', maxLength: VOUCHER_LIMITS.maxName })
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(VOUCHER_LIMITS.maxName)
  name: string;
  @ApiProperty({ enum: VOUCHER_EFFECTS, description: 'A partner voucher is AMOUNT' })
  @IsIn(VOUCHER_EFFECTS)
  effect: VoucherEffect;
  @ApiProperty({ example: '10', description: 'A percentage (0–100] or whole tugriks' })
  @IsString()
  @Matches(VALUE)
  value: string;
  @ApiPropertyOptional({ type: Number, nullable: true, description: 'The partner (PARTNER only)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  customerId?: number | null;
  @ApiProperty({ example: '2026-11-01' }) @IsString() @Matches(DAY) validFrom: string;
  @ApiProperty({ example: '2026-12-31' }) @IsString() @Matches(DAY) validTo: string;
  @ApiProperty({ minimum: 1, maximum: VOUCHER_LIMITS.maxBatchQty })
  @IsInt()
  @Min(1)
  @Max(VOUCHER_LIMITS.maxBatchQty)
  qty: number;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: POS_LIMITS.maxNote })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(POS_LIMITS.maxNote)
  note?: string | null;
}

export class VoucherBatchListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: VOUCHER_KINDS }) @IsOptional() @IsIn(VOUCHER_KINDS) kind?: VoucherKind;
  @ApiPropertyOptional({ enum: VOUCHER_BATCH_STATUSES })
  @IsOptional()
  @IsIn(VOUCHER_BATCH_STATUSES)
  status?: VoucherBatchStatus;
  @ApiPropertyOptional({ description: 'The name, or a code of the batch' })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(80)
  q?: string;
}

export class VoucherUsesQueryDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) batchId?: number;
  @ApiPropertyOptional({ description: 'Only the uses the office has to check' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === true || value === 'true')
  toCheck?: boolean;
}

@ApiSchema({ name: 'PosVoucherBatch' })
export class VoucherBatchDto {
  @ApiProperty() id: number;
  @ApiProperty({ example: 'В-0001' }) number: string;
  @ApiProperty({ enum: VOUCHER_KINDS }) kind: VoucherKind;
  @ApiProperty() name: string;
  @ApiProperty({ enum: VOUCHER_EFFECTS }) effect: VoucherEffect;
  @ApiProperty({ example: '10.00' }) value: string;
  @ApiProperty({ type: Number, nullable: true }) customerId: number | null;
  @ApiProperty({ type: String, nullable: true }) customerName: string | null;
  @ApiProperty({ example: '2026-11-01' }) validFrom: string;
  @ApiProperty({ example: '2026-12-31' }) validTo: string;
  @ApiProperty() qty: number;
  @ApiProperty() redeemed: number;
  @ApiProperty({ enum: VOUCHER_BATCH_STATUSES }) status: VoucherBatchStatus;
  @ApiProperty({ type: String, nullable: true }) note: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: string;
  @ApiProperty({ type: String, nullable: true }) createdByName: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) stoppedAt: string | null;
}

@ApiSchema({ name: 'PosVoucherBatchPage' })
export class VoucherBatchPageDto {
  @ApiProperty({ type: [VoucherBatchDto] }) data: VoucherBatchDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
}

@ApiSchema({ name: 'PosVoucherCode' })
export class VoucherCodeDto {
  @ApiProperty() id: number;
  @ApiProperty() seq: number;
  @ApiProperty({ example: '9912345678901234' }) code: string;
  @ApiProperty({ enum: VOUCHER_STATUSES }) status: VoucherStatus;
  @ApiProperty({ type: Number, nullable: true }) saleId: number | null;
  @ApiProperty({ type: String, nullable: true }) saleNumber: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) redeemedAt: string | null;
  @ApiProperty({ type: String, nullable: true, example: '42000.00' }) amount: string | null;
}

@ApiSchema({ name: 'PosVoucherUse' })
export class VoucherUseDto {
  @ApiProperty() id: number;
  @ApiProperty() saleId: number;
  @ApiProperty() saleNumber: string;
  @ApiProperty({ type: String, format: 'date-time' }) soldAt: string;
  @ApiProperty() voucherId: number;
  @ApiProperty() batchId: number;
  @ApiProperty() batchNumber: string;
  @ApiProperty({ enum: VOUCHER_KINDS }) kind: VoucherKind;
  @ApiProperty() code: string;
  @ApiProperty({ example: '50000.00' }) face: string;
  @ApiProperty({ example: '42000.00' }) amount: string;
  @ApiProperty({ enum: VOUCHER_ISSUES, nullable: true }) issue: VoucherIssue | null;
  @ApiProperty({ type: Number, nullable: true }) invoiceId: number | null;
  @ApiProperty({ type: String, nullable: true }) invoiceNumber: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) reviewedAt: string | null;
  @ApiProperty({ type: String, nullable: true }) reviewNote: string | null;
}

@ApiSchema({ name: 'PosVoucherBatchDetail' })
export class VoucherBatchDetailDto extends VoucherBatchDto {
  @ApiProperty({ type: [VoucherCodeDto] }) codes: VoucherCodeDto[];
  @ApiProperty({ type: [VoucherUseDto] }) uses: VoucherUseDto[];
}

@ApiSchema({ name: 'PosVoucherReviewRequest' })
export class VoucherReviewDto {
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: POS_LIMITS.maxNote })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(POS_LIMITS.maxNote)
  note?: string | null;
}
