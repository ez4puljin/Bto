import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import {
  ISSUE_RECIPIENT_KINDS,
  type IssueRecipientKind,
  MAX_ISSUE_LINES,
} from '@tugeel/shared/inventory';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
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
import { ISSUE_STATUSES } from '../schema';
import { QTY, trimmed } from './bins.dto';
import { ISO_DATE } from './receipts.dto';

type IssueStatus = (typeof ISSUE_STATUSES)[number];

@ApiSchema({ name: 'IssueExpenseType' })
export class IssueExpenseTypeDto {
  @ApiProperty() id: number;
  @ApiProperty() name: string;
  @ApiProperty({ type: String, nullable: true, description: 'A seeded type’s stable code' })
  code: string | null;
  @ApiProperty() active: boolean;
  @ApiProperty() sortOrder: number;
}

@ApiSchema({ name: 'IssueExpenseTypeCreateRequest' })
export class CreateIssueExpenseTypeDto {
  @ApiProperty({ maxLength: 100 }) @Transform(trimmed) @IsString() @MaxLength(100) name: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) sortOrder?: number;
}

@ApiSchema({ name: 'IssueExpenseTypeUpdateRequest' })
export class UpdateIssueExpenseTypeDto {
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(100)
  name?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) sortOrder?: number;
}

@ApiSchema({ name: 'IssueLine' })
export class IssueLineDto {
  @ApiProperty() id: number;
  @ApiProperty() productId: number;
  @ApiProperty() productSku: string;
  @ApiProperty() productName: string;
  @ApiProperty() productUnitId: number;
  @ApiProperty() unitName: string;
  @ApiProperty() enteredQty: string;
  @ApiProperty() factorSnapshot: string;
  @ApiProperty({ description: 'Base units' }) qtyBase: string;
  @ApiProperty() binId: number;
  @ApiProperty() binCode: string;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Cost holders only' })
  unitCost?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Cost holders only' })
  amount?: string | null;
}

@ApiSchema({ name: 'IssueDetail' })
export class IssueDetailDto {
  @ApiProperty() id: number;
  @ApiProperty({ type: String, nullable: true, example: 'GI-2026-000001' }) number: string | null;
  @ApiProperty() warehouseId: number;
  @ApiProperty() warehouseName: string;
  @ApiProperty({ type: String, format: 'date' }) issuedOn: string;
  @ApiProperty() expenseTypeId: number;
  @ApiProperty() expenseTypeName: string;
  @ApiProperty({ enum: ISSUE_RECIPIENT_KINDS }) recipientKind: IssueRecipientKind;
  @ApiProperty({ type: Number, nullable: true }) recipientUserId: number | null;
  @ApiProperty({ type: Number, nullable: true }) recipientCustomerId: number | null;
  @ApiProperty({ type: Number, nullable: true }) recipientSupplierId: number | null;
  @ApiProperty({ type: String, nullable: true }) recipientName: string | null;
  @ApiProperty({ enum: ISSUE_STATUSES }) status: IssueStatus;
  @ApiProperty({ type: String, nullable: true }) note: string | null;
  @ApiProperty({ type: String, format: 'date', nullable: true }) effectiveDate: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) postedAt: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: string;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt: string;
  @ApiProperty({ type: [IssueLineDto] }) lines: IssueLineDto[];
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Cost holders only' })
  total?: string | null;
}

@ApiSchema({ name: 'IssueSummary' })
export class IssueSummaryDto {
  @ApiProperty() id: number;
  @ApiProperty({ type: String, nullable: true }) number: string | null;
  @ApiProperty() warehouseId: number;
  @ApiProperty({ type: String, format: 'date' }) issuedOn: string;
  @ApiProperty() expenseTypeId: number;
  @ApiProperty() expenseTypeName: string;
  @ApiProperty({ enum: ISSUE_RECIPIENT_KINDS }) recipientKind: IssueRecipientKind;
  @ApiProperty({ type: String, nullable: true }) recipientName: string | null;
  @ApiProperty({ enum: ISSUE_STATUSES }) status: IssueStatus;
  @ApiProperty() lineCount: number;
  @ApiProperty({ type: String, format: 'date', nullable: true }) effectiveDate: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: string;
}

@ApiSchema({ name: 'IssuePage' })
export class IssuePageDto {
  @ApiProperty({ type: [IssueSummaryDto] }) data: IssueSummaryDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
}

export class IssueListQueryDto extends PageQueryDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) warehouseId?: number;
  @ApiPropertyOptional({ enum: ISSUE_STATUSES })
  @IsOptional()
  @IsIn(ISSUE_STATUSES)
  status?: IssueStatus;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) expenseTypeId?: number;
  @ApiPropertyOptional({ description: 'Issue number or recipient' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

@ApiSchema({ name: 'IssueRecipientRequest' })
export class IssueRecipientDto {
  @ApiProperty({ enum: ISSUE_RECIPIENT_KINDS })
  @IsIn(ISSUE_RECIPIENT_KINDS)
  kind: IssueRecipientKind;
  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  userId?: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  customerId?: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  supplierId?: number | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 200 })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(200)
  name?: string | null;
}

@ApiSchema({ name: 'IssueLineRequest' })
export class IssueLineRequestDto {
  @ApiProperty() @IsInt() @Min(1) productUnitId: number;
  @ApiProperty({ example: '2', description: 'In the product unit' })
  @Matches(QTY)
  enteredQty: string;
  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description: 'Omitted: the fixed shelf when it holds the product, else the fullest',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  binId?: number | null;
}

@ApiSchema({ name: 'IssueCreateRequest' })
export class CreateIssueDto {
  @ApiProperty() @IsInt() @Min(1) warehouseId: number;
  @ApiPropertyOptional({ type: String, format: 'date', description: 'Default today' })
  @IsOptional()
  @Matches(ISO_DATE)
  issuedOn?: string;
  @ApiProperty() @IsInt() @Min(1) expenseTypeId: number;
  @ApiProperty({ type: IssueRecipientDto })
  @ValidateNested()
  @Type(() => IssueRecipientDto)
  recipient: IssueRecipientDto;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 500 })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(500)
  note?: string | null;
  @ApiPropertyOptional({ type: [IssueLineRequestDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ISSUE_LINES)
  @ValidateNested({ each: true })
  @Type(() => IssueLineRequestDto)
  lines?: IssueLineRequestDto[];
}

@ApiSchema({ name: 'IssueUpdateRequest' })
export class UpdateIssueDto {
  @ApiPropertyOptional({ type: String, format: 'date' })
  @IsOptional()
  @Matches(ISO_DATE)
  issuedOn?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) expenseTypeId?: number;
  @ApiPropertyOptional({ type: IssueRecipientDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => IssueRecipientDto)
  recipient?: IssueRecipientDto;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 500 })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

@ApiSchema({ name: 'IssueLineUpdateRequest' })
export class UpdateIssueLineDto {
  @ApiPropertyOptional({ example: '3' }) @IsOptional() @Matches(QTY) enteredQty?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) binId?: number;
}
