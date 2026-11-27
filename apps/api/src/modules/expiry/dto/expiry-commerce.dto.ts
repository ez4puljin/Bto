import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { EXPIRY_CHANNELS, EXPIRY_QTY_PATTERN, type ExpiryChannel } from '@tugeel/shared/expiry';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  Min,
  MaxLength,
  MinLength,
} from 'class-validator';

export class ExpirySourceRequestDto {
  @ApiProperty({ description: 'sourceVersion, zero when no source is linked' })
  @IsInt()
  @Min(0)
  expectedVersion: number;
  @ApiProperty() @IsInt() @IsPositive() receiptLineId: number;
  @ApiProperty() @IsString() @Matches(EXPIRY_QTY_PATTERN) qtyBase: string;
}
export class ExpiryMarkdownRequestDto {
  @ApiProperty({ description: 'Expiry item editVersion' }) @IsInt() @Min(1) expectedVersion: number;
  @ApiProperty() @IsInt() @Min(1) expectedSourceVersion: number;
  @ApiProperty() @IsInt() @Min(1) expectedCostingVersion: number;
  @ApiProperty() @Matches(/^[a-f0-9]{64}$/) expectedLiabilityFingerprint: string;
  @ApiProperty() @IsInt() @IsPositive() receiptLineId: number;
  @ApiProperty() @IsString() @Matches(EXPIRY_QTY_PATTERN) qtyBase: string;
  @ApiProperty() @IsInt() @IsPositive() warehouseId: number;
  @ApiProperty({ enum: EXPIRY_CHANNELS, enumName: 'ExpiryChannel' })
  @IsIn(EXPIRY_CHANNELS)
  channel: ExpiryChannel;
  @ApiProperty({ description: 'Retail till or wholesale pipeline ID' })
  @IsInt()
  @IsPositive()
  contextId: number;
  @ApiProperty({ description: 'Fixed gross price for one base unit, including tax' })
  @IsString()
  @Matches(/^(?=.*[1-9])\d{1,10}(\.\d{1,2})?$/)
  unitPrice: string;
  @ApiPropertyOptional({ description: 'Explicit payroll month for future sold losses' })
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  payrollMonth?: string;
}
export class ExpiryExceptionResolutionDto {
  @ApiProperty({ description: 'Explicit reason for closing without an employee charge' })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  note: string;
}
export class ExpiryBarcodeQueryDto {
  @ApiProperty() @Type(() => Number) @IsInt() @IsPositive() pipelineId: number;
}

export class ExpiryFirstCostingDto {
  @ApiProperty() version: number;
  @ApiProperty() qtyBase: string;
  @ApiProperty({ type: String, nullable: true }) grossAmount: string | null;
  @ApiProperty({ type: String, nullable: true }) discountAmount: string | null;
  @ApiProperty() freeGoods: boolean;
}
export class ExpiryCurrentCostingDto {
  @ApiProperty() version: number;
  @ApiProperty() accountingAmount: string;
  @ApiProperty() unitCost: string;
  @ApiProperty({ type: String, nullable: true }) grossAmount: string | null;
  @ApiProperty({ type: String, nullable: true }) discountAmount: string | null;
  @ApiProperty({ type: String, nullable: true }) supplierNetAmount: string | null;
  @ApiProperty() freeGoods: boolean;
}
export class ExpiryReceiptSourceDto {
  @ApiProperty() receiptLineId: number;
  @ApiProperty() receiptId: number;
  @ApiProperty() receiptNumber: string;
  @ApiProperty() receiptDate: string;
  @ApiProperty() warehouseId: number;
  @ApiProperty() qtyBase: string;
  @ApiProperty({ type: ExpiryFirstCostingDto, nullable: true }) first: ExpiryFirstCostingDto | null;
  @ApiProperty({ type: ExpiryCurrentCostingDto, nullable: true })
  current: ExpiryCurrentCostingDto | null;
  @ApiProperty({ enum: ['FREE_GOODS', 'DISCOUNT', 'NONE', 'UNAVAILABLE'] }) promotionEvidence:
    'FREE_GOODS' | 'DISCOUNT' | 'NONE' | 'UNAVAILABLE';
}
export class ExpiryReceiptSourcesDto {
  @ApiProperty({ type: [ExpiryReceiptSourceDto] }) data: ExpiryReceiptSourceDto[];
}
/** Cashier-safe contract: acquisition values, responsible staff and payroll metadata are absent. */
export class ExpirySaleOfferDto {
  @ApiProperty() id: number;
  @ApiProperty() itemId: number;
  @ApiProperty() barcode: string;
  @ApiProperty() expiryDate: string;
  @ApiProperty() productId: number;
  @ApiProperty() productUnitId: number;
  @ApiProperty() warehouseId: number;
  @ApiProperty({ enum: EXPIRY_CHANNELS, enumName: 'ExpiryChannel' }) channel: ExpiryChannel;
  @ApiProperty() contextId: number;
  @ApiProperty() unitPrice: string;
  @ApiProperty() qtyAvailable: string;
  @ApiProperty({ format: 'date-time' }) startsAt: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) stoppedAt: string | null;
}
export class ExpiryMarkdownDto extends ExpirySaleOfferDto {
  @ApiProperty() revision: number;
  @ApiProperty() qtyBudget: string;
  @ApiProperty() qtySold: string;
  @ApiProperty() receiptLineId: number;
  @ApiProperty() costingVersion: number;
  @ApiProperty() accountingUnitCost: string;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Redacted without expiry.liability.manage',
  })
  payrollMonth: string | null;
  @ApiProperty({ type: [Number], description: 'Redacted without expiry.liability.manage' })
  liableUserIds: number[];
}
export class ExpirySaleExceptionDto {
  @ApiProperty() id: number;
  @ApiProperty() markdownId: number;
  @ApiProperty({ enum: ['POS', 'WHOLESALE'] }) sourceKind: 'POS' | 'WHOLESALE';
  @ApiProperty() saleId: string;
  @ApiProperty() lineId: string;
  @ApiProperty() reason: string;
  @ApiProperty() qtyBase: string;
  @ApiProperty({ format: 'date-time' }) soldAt: string;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) resolvedAt: string | null;
  @ApiProperty({ type: String, nullable: true }) resolutionNote: string | null;
}
export class ExpiryLiablePreviewDto {
  @ApiProperty() id: number;
  @ApiProperty() fullName: string;
}
export class ExpiryCommerceDto {
  @ApiProperty() itemVersion: number;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Draft concurrency token; redacted without liability permission',
  })
  liabilityFingerprint: string | null;
  @ApiProperty({ type: [ExpiryLiablePreviewDto] }) liableUsers: ExpiryLiablePreviewDto[];
  @ApiProperty() sourceVersion: number;
  @ApiProperty({ type: String, nullable: true }) sourceQtyBase: string | null;
  @ApiProperty({ type: ExpiryReceiptSourceDto, nullable: true })
  source: ExpiryReceiptSourceDto | null;
  @ApiProperty({ type: [ExpiryMarkdownDto] }) markdowns: ExpiryMarkdownDto[];
  @ApiProperty({ type: [ExpirySaleExceptionDto] }) exceptions: ExpirySaleExceptionDto[];
}
export class ExpiryContextPriceDto {
  @ApiProperty() warehouseId: number;
  @ApiProperty({ enum: EXPIRY_CHANNELS, enumName: 'ExpiryChannel' }) channel: ExpiryChannel;
  @ApiProperty() contextId: number;
  @ApiProperty() name: string;
  @ApiProperty({ type: String, nullable: true }) unitPrice: string | null;
  @ApiProperty({ type: String, nullable: true }) netUnitPrice: string | null;
}
export class ExpiryContextPricesDto {
  @ApiProperty({ type: Number, nullable: true }) productUnitId: number | null;
  @ApiProperty({ description: 'One base unit, quoted on its own cart' }) qty: string;
  @ApiProperty({ type: [ExpiryContextPriceDto] }) data: ExpiryContextPriceDto[];
}

export class ExpiryExceptionAcknowledgementDto {
  @ApiProperty({ enum: ['SALE_EXCEPTION', 'POS_EXCEPTION'] })
  @IsIn(['SALE_EXCEPTION', 'POS_EXCEPTION'])
  origin: 'SALE_EXCEPTION' | 'POS_EXCEPTION';
  @ApiProperty({ description: 'Acknowledgement only; no employee charge or reversal is created' })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  note: string;
}
export class ExpiryExceptionViewDto {
  @ApiProperty({ enum: ['SALE_EXCEPTION', 'POS_EXCEPTION'] }) origin:
    'SALE_EXCEPTION' | 'POS_EXCEPTION';
  @ApiProperty() id: number;
  @ApiProperty({ enum: ['SALE', 'RETURN'] }) operation: 'SALE' | 'RETURN';
  @ApiProperty() documentId: string;
  @ApiProperty() lineId: string;
  @ApiProperty({ type: String, nullable: true }) originalSaleId: string | null;
  @ApiProperty({ type: String, nullable: true }) originalLineId: string | null;
  @ApiProperty() barcode: string;
  @ApiProperty() productId: number;
  @ApiProperty() warehouseId: number;
  @ApiProperty() reason: string;
  @ApiProperty() qtyBase: string;
  @ApiProperty() occurredAt: string;
  @ApiProperty() createdAt: string;
  @ApiProperty({ type: String, nullable: true }) acknowledgedAt: string | null;
  @ApiProperty({ type: String, nullable: true }) acknowledgementNote: string | null;
  @ApiProperty({ enum: ['SALE_UNALLOCATED', 'RETURN_REVERSAL_UNRESOLVED'] }) financialEffect:
    'SALE_UNALLOCATED' | 'RETURN_REVERSAL_UNRESOLVED';
}
export class ExpiryExceptionsDto {
  @ApiProperty({ type: [ExpiryExceptionViewDto] }) data: ExpiryExceptionViewDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
}

export class ExpirySalesRowDto {
  @ApiProperty() id: number;
  @ApiProperty({ enum: ['SALE', 'RETURN'] }) kind: 'SALE' | 'RETURN';
  @ApiProperty({ format: 'date-time' }) occurredAt: string;
  @ApiProperty() qtyBase: string;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Realized gross sale amount per base unit; not a refund quote',
  })
  unitPrice: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Persisted gross sale amount; actual refund amount is unavailable',
  })
  totalAmount: string | null;
  @ApiProperty() warehouseId: number;
  @ApiProperty({ type: String, nullable: true }) warehouseName: string | null;
  @ApiProperty({ enum: EXPIRY_CHANNELS, enumName: 'ExpiryChannel' }) channel: ExpiryChannel;
  @ApiProperty() contextId: number;
  @ApiProperty({ type: String, nullable: true }) contextName: string | null;
  @ApiProperty() saleId: string;
}
export class ExpirySalesPageDto {
  @ApiProperty({ type: [ExpirySalesRowDto] }) data: ExpirySalesRowDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
}
