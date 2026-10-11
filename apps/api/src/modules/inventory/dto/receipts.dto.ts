import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
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
import { COSTING_STATUSES, RECEIPT_STATUSES } from '../schema';
import { QTY, queryBoolean, trimmed } from './bins.dto';

export const MONEY = /^\d{1,12}(\.\d{1,2})?$/;
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];
type CostingStatus = (typeof COSTING_STATUSES)[number];

@ApiSchema({ name: 'ReceiptLine' })
export class ReceiptLineDto {
  @ApiProperty() id: number;
  @ApiProperty() productId: number;
  @ApiProperty() productSku: string;
  @ApiProperty() productName: string;
  @ApiProperty() productUnitId: number;
  @ApiProperty({ example: 'хайрцаг' }) unitName: string;
  @ApiProperty({ example: '2' }) enteredQty: string;
  @ApiProperty({ example: '24' }) factorSnapshot: string;
  @ApiProperty({ example: '48', description: 'Base units' }) qtyBase: string;
  @ApiProperty() binId: number;
  @ApiProperty({ example: 'A-01-03' }) binCode: string;
  @ApiProperty({ type: Number, nullable: true }) lotId: number | null;
}

/** A receipt without any cost: what every user sees (ADR-0033 #8). */
@ApiSchema({ name: 'ReceiptDetail' })
export class ReceiptDetailDto {
  @ApiProperty() id: number;
  @ApiProperty({ type: String, nullable: true, example: 'GR-2026-000001' }) number: string | null;
  @ApiProperty() warehouseId: number;
  @ApiProperty() warehouseName: string;
  @ApiProperty() supplierId: number;
  @ApiProperty() supplierCode: string;
  @ApiProperty() supplierName: string;
  @ApiProperty({ type: String, nullable: true, description: 'The supplier’s delivery note number' })
  supplierDocNo: string | null;
  @ApiProperty({ type: String, format: 'date', nullable: true }) supplierDocDate: string | null;
  @ApiProperty({ enum: RECEIPT_STATUSES }) status: ReceiptStatus;
  @ApiProperty({ enum: COSTING_STATUSES, nullable: true }) costingStatus: CostingStatus | null;
  @ApiProperty({ type: String, nullable: true }) note: string | null;
  @ApiProperty({ type: String, format: 'date', nullable: true }) effectiveDate: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) postedAt: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: string;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt: string;
  @ApiProperty({ type: [ReceiptLineDto] }) lines: ReceiptLineDto[];
}

@ApiSchema({ name: 'ReceiptSummary' })
export class ReceiptSummaryDto {
  @ApiProperty() id: number;
  @ApiProperty({ type: String, nullable: true }) number: string | null;
  @ApiProperty() warehouseId: number;
  @ApiProperty() supplierId: number;
  @ApiProperty() supplierName: string;
  @ApiProperty({ type: String, nullable: true }) supplierDocNo: string | null;
  @ApiProperty({ enum: RECEIPT_STATUSES }) status: ReceiptStatus;
  @ApiProperty({ enum: COSTING_STATUSES, nullable: true }) costingStatus: CostingStatus | null;
  @ApiProperty() lineCount: number;
  @ApiProperty({ type: String, format: 'date', nullable: true }) effectiveDate: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: string;
}

@ApiSchema({ name: 'ReceiptPage' })
export class ReceiptPageDto {
  @ApiProperty({ type: [ReceiptSummaryDto] }) data: ReceiptSummaryDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
}

export class ReceiptListQueryDto extends PageQueryDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) warehouseId?: number;
  @ApiPropertyOptional({ enum: RECEIPT_STATUSES })
  @IsOptional()
  @IsIn(RECEIPT_STATUSES)
  status?: ReceiptStatus;
  @ApiPropertyOptional({ description: 'Posted receipts waiting for the accountant' })
  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean()
  costingPending?: boolean;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) supplierId?: number;
  @ApiPropertyOptional({ description: 'Receipt or delivery note number' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  q?: string;
}

@ApiSchema({ name: 'ReceiptLineRequest' })
export class ReceiptLineRequestDto {
  @ApiProperty() @IsInt() @Min(1) productUnitId: number;
  @ApiProperty({ example: '2', description: 'In the product unit' })
  @Matches(QTY)
  enteredQty: string;
  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description: 'Omitted: the fixed shelf of the product, else the receiving area',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  binId?: number | null;
}

class ReceiptHeaderFieldsDto {
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 50 })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(50)
  supplierDocNo?: string | null;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  @IsOptional()
  @Matches(ISO_DATE)
  supplierDocDate?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 500 })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

@ApiSchema({ name: 'ReceiptCreateRequest' })
export class CreateReceiptDto extends ReceiptHeaderFieldsDto {
  @ApiProperty() @IsInt() @Min(1) warehouseId: number;
  @ApiProperty() @IsInt() @Min(1) supplierId: number;
  @ApiPropertyOptional({ type: [ReceiptLineRequestDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ReceiptLineRequestDto)
  lines?: ReceiptLineRequestDto[];
}

@ApiSchema({ name: 'ReceiptUpdateRequest' })
export class UpdateReceiptDto extends ReceiptHeaderFieldsDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) supplierId?: number;
}

@ApiSchema({ name: 'ReceiptLineUpdateRequest' })
export class UpdateReceiptLineDto {
  @ApiPropertyOptional({ example: '3' }) @IsOptional() @Matches(QTY) enteredQty?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) binId?: number;
}

@ApiSchema({ name: 'ReceiptCostLineRequest' })
export class CostLineRequestDto {
  @ApiProperty() @IsInt() @Min(1) lineId: number;
  @ApiPropertyOptional({ example: '48000', description: 'Line amount, MNT ex-VAT' })
  @IsOptional()
  @Matches(MONEY)
  amount?: string;
  @ApiPropertyOptional({ example: '24000', description: 'Price per entered unit, MNT ex-VAT' })
  @IsOptional()
  @Matches(MONEY)
  unitPrice?: string;
  @ApiPropertyOptional({ description: 'Free bonus goods (amount 0)' })
  @IsOptional()
  @IsBoolean()
  freeGoods?: boolean;
}

@ApiSchema({ name: 'ReceiptCostRequest' })
export class CostReceiptDto {
  @ApiProperty({ description: 'The costing version the form was opened at' })
  @IsInt()
  @Min(0)
  costingVersion: number;
  @ApiProperty({ type: [CostLineRequestDto] })
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => CostLineRequestDto)
  lines: CostLineRequestDto[];
}

@ApiSchema({ name: 'ReceiptCostingLine' })
export class CostedReceiptLineDto {
  @ApiProperty() lineId: number;
  @ApiProperty() productId: number;
  @ApiProperty() productName: string;
  @ApiProperty() unitName: string;
  @ApiProperty() enteredQty: string;
  @ApiProperty() qtyBase: string;
  @ApiProperty({ description: 'Cost per base unit the goods went in at' })
  provisionalUnitCost: string;
  @ApiProperty({ type: String, nullable: true }) amount: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Per base unit' }) unitCost:
    string | null;
  @ApiProperty() freeGoods: boolean;
}

/** Costs of a receipt: only for holders of inventory.costs.manage. */
@ApiSchema({ name: 'ReceiptCosting' })
export class ReceiptCostingDto {
  @ApiProperty() receiptId: number;
  @ApiProperty({ type: String, nullable: true }) number: string | null;
  @ApiProperty({ enum: RECEIPT_STATUSES }) status: ReceiptStatus;
  @ApiProperty({ enum: COSTING_STATUSES, nullable: true }) costingStatus: CostingStatus | null;
  @ApiProperty() costingVersion: number;
  @ApiProperty({ type: String, format: 'date', nullable: true }) recostUntil: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) costedAt: string | null;
  @ApiProperty({ type: String, nullable: true }) total: string | null;
  @ApiProperty({ type: [CostedReceiptLineDto] }) lines: CostedReceiptLineDto[];
}
