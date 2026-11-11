import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import {
  EBARIMT_PAYMENT_CODES,
  EBARIMT_TAX_TYPES,
  type EbarimtPaymentCode,
  type EbarimtTaxType,
  RECEIPT_TYPES,
  type ReceiptType,
  RELAY_OUTCOMES,
  type RelayOutcome,
  WHOLESALE_CANCEL_STATUSES,
  WHOLESALE_ERROR_CODES,
  WHOLESALE_RECEIPT_STATUSES,
  type WholesaleCancelStatus,
  type WholesaleErrorCode,
  type WholesaleReceiptStatus,
} from '@tugeel/shared/mn';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { PageQueryDto } from '../../../common/pagination/page';

const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;
const flag = ({ value }: { value: unknown }): unknown =>
  value === 'true' || value === true ? true : value === 'false' || value === false ? false : value;

@ApiSchema({ name: 'EbarimtReceiptLine' })
export class EbarimtReceiptLineDto {
  @ApiProperty() name: string;
  @ApiProperty({ type: String, nullable: true }) barCode: string | null;
  @ApiProperty({ enum: ['GS1', 'ISBN', 'UNDEFINED'] }) barCodeType: 'GS1' | 'ISBN' | 'UNDEFINED';
  @ApiProperty({ type: String, nullable: true }) classificationCode: string | null;
  @ApiProperty({ enum: EBARIMT_TAX_TYPES }) taxType: EbarimtTaxType;
  @ApiProperty({ type: String, nullable: true }) taxProductCode: string | null;
  @ApiProperty() measureUnit: string;
  @ApiProperty({ example: '2.000' }) qty: string;
  @ApiProperty({ example: '5500.00' }) total: string;
  @ApiProperty({ example: '500.00' }) vat: string;
  @ApiProperty({ example: '0.00' }) cityTax: string;
}

@ApiSchema({ name: 'EbarimtReceiptPayment' })
export class EbarimtReceiptPaymentDto {
  @ApiProperty({ enum: EBARIMT_PAYMENT_CODES }) code: EbarimtPaymentCode;
  @ApiProperty({ example: '5500.00' }) amount: string;
}

@ApiSchema({ name: 'EbarimtReceipt' })
export class EbarimtReceiptDto {
  @ApiProperty() id: number;
  @ApiProperty() sourceSystem: string;
  @ApiProperty({ example: 'SALES_INVOICE' }) sourceDocType: string;
  @ApiProperty({ description: 'The source document id (an invoice id)' }) sourceDocId: string;
  @ApiProperty() docNumber: string;
  @ApiProperty({ type: String, nullable: true }) orderNumber: string | null;
  @ApiProperty() buyerName: string;
  @ApiProperty({ enum: RECEIPT_TYPES }) receiptType: ReceiptType;
  @ApiProperty({ enum: WHOLESALE_RECEIPT_STATUSES }) status: WholesaleReceiptStatus;
  @ApiProperty({ enum: WHOLESALE_ERROR_CODES, nullable: true })
  errorCode: WholesaleErrorCode | null;
  @ApiProperty({ type: String, nullable: true }) message: string | null;
  @ApiProperty({ type: String, nullable: true }) customerTin: string | null;
  @ApiProperty({ type: String, nullable: true }) consumerNo: string | null;
  @ApiProperty({ example: '5500.00' }) total: string;
  @ApiProperty({ example: '500.00' }) vatTotal: string;
  @ApiProperty({ example: '0.00' }) cityTaxTotal: string;
  @ApiProperty() attempt: number;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) claimedAt: string | null;
  @ApiProperty({ type: String, nullable: true }) claimedNodeCode: string | null;
  @ApiProperty({ type: String, nullable: true }) ddtd: string | null;
  @ApiProperty({ type: String, nullable: true, example: '2026-11-11 10:00:00' })
  posapiDate: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) issuedAt: string | null;
  @ApiProperty({ enum: WHOLESALE_CANCEL_STATUSES, nullable: true })
  cancelStatus: WholesaleCancelStatus | null;
  @ApiProperty({ type: String, nullable: true }) cancelReason: string | null;
  @ApiProperty({ type: String, nullable: true }) cancelMessage: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) cancelledAt: string | null;
  @ApiProperty({ description: 'The next print still carries the lottery and the QR code' })
  printable: boolean;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: string;
}

@ApiSchema({ name: 'EbarimtReceiptDetail' })
export class EbarimtReceiptDetailDto extends EbarimtReceiptDto {
  @ApiProperty({ type: [EbarimtReceiptLineDto] }) lines: EbarimtReceiptLineDto[];
  @ApiProperty({ type: [EbarimtReceiptPaymentDto] }) payments: EbarimtReceiptPaymentDto[];
  @ApiProperty({ type: String, nullable: true }) merchantTin: string | null;
  @ApiProperty({ type: String, nullable: true }) merchantName: string | null;
}

@ApiSchema({ name: 'EbarimtReceiptPage' })
export class EbarimtReceiptPageDto {
  @ApiProperty({ type: [EbarimtReceiptDto] }) data: EbarimtReceiptDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
}

@ApiSchema({ name: 'EbarimtReceiptListQuery' })
export class EbarimtReceiptListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: WHOLESALE_RECEIPT_STATUSES })
  @IsOptional()
  @IsIn(WHOLESALE_RECEIPT_STATUSES)
  status?: WholesaleReceiptStatus;
  @ApiPropertyOptional({ description: 'Cancellations asked and not done' })
  @IsOptional()
  @Transform(flag)
  @IsBoolean()
  cancelOpen?: boolean;
  @ApiPropertyOptional({ enum: RECEIPT_TYPES })
  @IsOptional()
  @IsIn(RECEIPT_TYPES)
  type?: ReceiptType;
  @ApiPropertyOptional({ description: 'Document or order number, buyer, TIN or ДДТД' })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(80)
  q?: string;
}

@ApiSchema({ name: 'EbarimtReceiptAttention' })
export class EbarimtReceiptAttentionDto {
  @ApiProperty() pending: number;
  @ApiProperty() error: number;
  @ApiProperty() indeterminate: number;
  @ApiProperty() cancelOpen: number;
  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'When a store edge last asked for work (since the api started)',
  })
  relaySeenAt: string | null;
  @ApiProperty({ type: String, nullable: true }) relayNodeCode: string | null;
}

@ApiSchema({ name: 'EbarimtReceiptResolve' })
export class EbarimtReceiptResolveDto {
  @ApiProperty({ enum: ['ISSUED', 'NOT_ISSUED'] })
  @IsIn(['ISSUED', 'NOT_ISSUED'])
  outcome: 'ISSUED' | 'NOT_ISSUED';
  @ApiPropertyOptional({ type: String, nullable: true, description: 'ISSUED: the ДДТД' })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(40)
  ddtd?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, example: '2026-11-11 10:00:00' })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(19)
  posapiDate?: string | null;
}

@ApiSchema({ name: 'EbarimtCancelResolve' })
export class EbarimtCancelResolveDto {
  @ApiProperty({ enum: ['RETRY', 'CANCELLED'] })
  @IsIn(['RETRY', 'CANCELLED'])
  outcome: 'RETRY' | 'CANCELLED';
}

@ApiSchema({ name: 'EbarimtPrintSecrets' })
export class EbarimtPrintSecretsDto {
  @ApiProperty({ type: String, nullable: true }) lottery: string | null;
  @ApiProperty({ type: String, nullable: true }) qrData: string | null;
}

@ApiSchema({ name: 'EbarimtPrintableReceipt' })
export class EbarimtPrintableReceiptDto {
  @ApiProperty({ type: EbarimtReceiptDetailDto }) receipt: EbarimtReceiptDetailDto;
  @ApiProperty({
    type: EbarimtPrintSecretsDto,
    nullable: true,
    description: 'Only on the one print while the api still holds them; never stored',
  })
  secrets: EbarimtPrintSecretsDto | null;
  @ApiProperty({ description: '«ХУУЛБАР»: printed before, or the secrets are gone' })
  copy: boolean;
}

// ------------------------------------------------------------------ the store edge's relay

/** `RelayResultWire` of @tugeel/shared/mn as the edge posts it. */
@ApiSchema({ name: 'EbarimtRelayResult' })
export class EbarimtRelayResultDto {
  @ApiProperty() @IsInt() @Min(1) receiptId: number;
  @ApiProperty() @IsInt() @Min(1) attempt: number;
  @ApiProperty({ enum: ['ISSUE', 'CANCEL'] }) @IsIn(['ISSUE', 'CANCEL']) op: 'ISSUE' | 'CANCEL';
  @ApiProperty({ enum: RELAY_OUTCOMES }) @IsIn(RELAY_OUTCOMES) outcome: RelayOutcome;
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  ddtd?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'PosAPI’s date, verbatim' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  posapiDate?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  merchantTin?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  merchantName?: string | null;
  @ApiPropertyOptional({ enum: ['POSAPI_REFUSED', 'EDGE_BUILD'], nullable: true })
  @IsOptional()
  @IsIn(['POSAPI_REFUSED', 'EDGE_BUILD'])
  errorCode?: 'POSAPI_REFUSED' | 'EDGE_BUILD' | null;
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(600)
  message?: string | null;
  /** In memory for one print, never stored or logged (ADR-0185 #6). */
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  lottery?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(4_000)
  qrData?: string | null;
}

@ApiSchema({ name: 'EbarimtRelayResultResponse' })
export class EbarimtRelayResultResponseDto {
  @ApiProperty() acknowledged: true;
  @ApiProperty() applied: boolean;
}
