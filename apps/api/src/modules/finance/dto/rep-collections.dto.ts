import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import {
  COLLECTION_METHODS,
  COLLECTION_NOTE_MAX,
  COLLECTION_STATUSES,
  type CollectionMethod,
  type CollectionStatus,
} from '@tugeel/shared/finance';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PageQueryDto } from '../../../common/pagination/page';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const AMOUNT = /^[1-9]\d{0,11}(\.\d{1,2})?$/;

@ApiSchema({ name: 'RepCollection' })
export class RepCollectionDto {
  @ApiProperty() id: number;
  @ApiProperty() userId: number;
  @ApiProperty() userName: string;
  @ApiProperty() customerId: number;
  @ApiProperty() customerCode: string;
  @ApiProperty() customerName: string;
  @ApiProperty({ example: '500000.00' }) amount: string;
  @ApiProperty({ enum: COLLECTION_METHODS }) method: CollectionMethod;
  @ApiProperty({ type: String, nullable: true }) note: string | null;
  @ApiProperty({ type: String, format: 'date' }) collectedOn: string;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: string;
  @ApiProperty({ enum: COLLECTION_STATUSES }) status: CollectionStatus;
  @ApiProperty({ type: Number, nullable: true, description: 'The voucher once recorded' })
  paymentId: number | null;
  @ApiProperty({ type: String, nullable: true }) paymentNumber: string | null;
  @ApiProperty({ type: String, nullable: true }) decidedByName: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) decidedAt: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Why it was refused' })
  decisionNote: string | null;
}

@ApiSchema({ name: 'RepCollectionPage' })
export class RepCollectionPageDto {
  @ApiProperty({ type: [RepCollectionDto] }) data: RepCollectionDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
  @ApiProperty({ description: 'Every pending report, whatever the filters' }) pendingCount: number;
  @ApiProperty({ example: '1500000.00' }) pendingAmount: string;
}

@ApiSchema({ name: 'RepCollectionRequest' })
export class RepCollectionRequestDto {
  @ApiProperty() @IsInt() @Min(1) customerId: number;
  @ApiProperty({ example: '500000' }) @IsString() @Matches(AMOUNT) amount: string;
  @ApiProperty({ enum: COLLECTION_METHODS }) @IsIn(COLLECTION_METHODS) method: CollectionMethod;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: COLLECTION_NOTE_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(COLLECTION_NOTE_MAX)
  note?: string | null;
}

@ApiSchema({ name: 'RepCollectionRecordRequest' })
export class RepCollectionRecordDto {
  @ApiProperty({ description: 'The cash or bank account the money went into' })
  @IsInt()
  @Min(1)
  moneyAccountId: number;
  @ApiProperty({ format: 'date', description: 'Not in the future (Ulaanbaatar)' })
  @Matches(ISO_DATE)
  paidOn: string;
}

@ApiSchema({ name: 'RepCollectionRejectRequest' })
export class RepCollectionRejectDto {
  @ApiProperty({ maxLength: COLLECTION_NOTE_MAX })
  @IsString()
  @MinLength(1)
  @MaxLength(COLLECTION_NOTE_MAX)
  reason: string;
}

export class RepCollectionQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: COLLECTION_STATUSES })
  @IsOptional()
  @IsIn(COLLECTION_STATUSES)
  status?: CollectionStatus;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) userId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) customerId?: number;
  @ApiPropertyOptional({ format: 'date' }) @IsOptional() @Matches(ISO_DATE) from?: string;
  @ApiPropertyOptional({ format: 'date' }) @IsOptional() @Matches(ISO_DATE) to?: string;
}
