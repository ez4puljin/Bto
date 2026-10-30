import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import {
  EBARIMT_STATUSES,
  type EbarimtStatus,
  POS_EVENT_KINDS,
  POS_LIMITS,
  POS_STATUSES,
  DENOMINATIONS,
  type PosEventKind,
  type PosStatus,
  RECEIPT_TYPES,
  type ReceiptType,
  SALE_KINDS,
  type SaleKind,
  SHIFT_STATUSES,
  type ShiftStatus,
  SYNC_RESULTS,
  type SyncResult,
  PAYMENT_TYPE_KINDS,
  type PaymentTypeKind,
  TENDER_KINDS,
  type TenderKind,
  VOID_REASONS,
  type VoidReason,
  VOUCHER_CODE_PATTERN,
  VOUCHER_KINDS,
  VOUCHER_LIMITS,
  type VoucherKind,
} from '@tugeel/shared/pos';
import { CLASSIFICATION_CODE_PATTERN, DISTRICT_CODE_PATTERN } from '@tugeel/shared/mn';
import { PRICE_BASES, type PriceBasis } from '@tugeel/shared/pricing';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PageQueryDto } from '../../../common/pagination/page';
import { VAT_TYPES, type VatType } from '../../catalog';

const MONEY = /^\d{1,12}(\.\d{1,2})?$/;
const SIGNED_MONEY = /^-?\d{1,12}(\.\d{1,2})?$/;
const QTY = /^\d{1,11}(\.\d{1,3})?$/;
const FACTOR = /^\d{1,12}(\.\d{1,6})?$/;
const PERCENT = /^\d{1,3}(\.\d{1,2})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIN = /^[0-9]{11,14}$/;
const CONSUMER = /^([0-9]{8}|11\*{6})$/;
const HASH = /^[0-9a-f]{64}$/;

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
/** "true"/"false" query strings as booleans (other values fail @IsBoolean). */
const queryBoolean = ({ value }: { value: unknown }) => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
};

// ---------------------------------------------------------------- settings

@ApiSchema({ name: 'PosSettings' })
export class PosSettingsDto {
  @ApiProperty({ type: Number, nullable: true }) storeWarehouseId: number | null;
  @ApiProperty({ type: String, nullable: true }) storeWarehouseName: string | null;
  @ApiProperty({ type: Number, nullable: true }) handoverMoneyAccountId: number | null;
  @ApiProperty({ type: String, nullable: true }) handoverMoneyAccountName: string | null;
  @ApiProperty({ example: 14 }) returnWindowDays: number;
  @ApiProperty({ example: 60 }) snapshotIntervalSec: number;
  @ApiProperty() supervisorRequired: boolean;
  @ApiProperty({ type: String, nullable: true }) receiptTitle: string | null;
  @ApiProperty({ type: String, nullable: true }) receiptFooter: string | null;
  @ApiProperty({ type: String, nullable: true, example: '0000' })
  ebarimtDistrictCode: string | null;
  @ApiProperty({ type: String, nullable: true, example: '0000000' })
  ebarimtClassificationCode: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) updatedAt: string | null;
}

@ApiSchema({ name: 'PosSettingsPatch' })
export class PosSettingsPatchDto {
  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  storeWarehouseId?: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  handoverMoneyAccountId?: number | null;
  @ApiPropertyOptional({ minimum: 0, maximum: POS_LIMITS.maxReturnWindowDays })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(POS_LIMITS.maxReturnWindowDays)
  returnWindowDays?: number;
  @ApiPropertyOptional({
    minimum: POS_LIMITS.minSnapshotIntervalSec,
    maximum: POS_LIMITS.maxSnapshotIntervalSec,
  })
  @IsOptional()
  @IsInt()
  @Min(POS_LIMITS.minSnapshotIntervalSec)
  @Max(POS_LIMITS.maxSnapshotIntervalSec)
  snapshotIntervalSec?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() supervisorRequired?: boolean;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: POS_LIMITS.maxReceiptText })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(POS_LIMITS.maxReceiptText)
  receiptTitle?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: POS_LIMITS.maxReceiptText })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(POS_LIMITS.maxReceiptText)
  receiptFooter?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, pattern: DISTRICT_CODE_PATTERN.source })
  @IsOptional()
  @Transform(trimmed)
  @Matches(DISTRICT_CODE_PATTERN)
  ebarimtDistrictCode?: string | null;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    pattern: CLASSIFICATION_CODE_PATTERN.source,
  })
  @IsOptional()
  @Transform(trimmed)
  @Matches(CLASSIFICATION_CODE_PATTERN)
  ebarimtClassificationCode?: string | null;
}

// ---------------------------------------------------------------- edge nodes

@ApiSchema({ name: 'PosEdgeNode' })
export class EdgeNodeDto {
  @ApiProperty() id: number;
  @ApiProperty({ example: 'SM1' }) code: string;
  @ApiProperty() name: string;
  @ApiProperty() warehouseId: number;
  @ApiProperty({ type: String, nullable: true }) warehouseName: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'First 8 hex of the token hash' })
  tokenPrefix: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) tokenIssuedAt: string | null;
  @ApiProperty({ type: String, nullable: true }) appVersion: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) lastSeenAt: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) lastPullAt: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) lastPushAt: string | null;
  @ApiProperty({ description: 'Documents the edge still has to replay' }) backlog: number;
  @ApiProperty({ type: Number, nullable: true }) clockSkewMs: number | null;
  @ApiProperty({ type: String, nullable: true }) snapshotVersion: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'The store PosAPI (ADR-0065)' })
  posapiVersion: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'PosAPI lastSentDate verbatim' })
  posapiLastSent: string | null;
  @ApiProperty({ type: Number, nullable: true }) posapiLeftLotteries: number | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  posapiCheckedAt: string | null;
  @ApiProperty({ type: String, nullable: true }) posapiError: string | null;
  @ApiProperty({ enum: POS_STATUSES }) status: PosStatus;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: string;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt: string;
}

@ApiSchema({ name: 'PosEdgeNodeRequest' })
export class EdgeNodeRequestDto {
  @ApiProperty({ example: 'SM1', description: 'A-Z, 0-9, _ and -, 1–16' })
  @Transform(trimmed)
  @IsString()
  @MaxLength(POS_LIMITS.maxCode)
  code: string;
  @ApiProperty({ maxLength: POS_LIMITS.maxName })
  @Transform(trimmed)
  @IsString()
  @MaxLength(POS_LIMITS.maxName)
  name: string;
  @ApiProperty({ description: 'The STORE warehouse the tills sell from' })
  @IsInt()
  @Min(1)
  warehouseId: number;
}

@ApiSchema({ name: 'PosEdgeNodePatch' })
export class EdgeNodePatchDto {
  @ApiPropertyOptional({ maxLength: POS_LIMITS.maxName })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(POS_LIMITS.maxName)
  name?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) warehouseId?: number;
  @ApiPropertyOptional({ enum: POS_STATUSES }) @IsOptional() @IsIn(POS_STATUSES) status?: PosStatus;
}

@ApiSchema({ name: 'PosEdgeToken' })
export class EdgeTokenDto {
  @ApiProperty({ description: 'Shown once; the edge keeps it in its environment' }) token: string;
  @ApiProperty() prefix: string;
}

// ---------------------------------------------------------------- tills

@ApiSchema({ name: 'PosTill' })
export class TillDto {
  @ApiProperty() id: number;
  @ApiProperty() edgeNodeId: number;
  @ApiProperty({ description: 'The STORE warehouse it sells from (ADR-0123)' }) warehouseId: number;
  @ApiProperty({ type: String, nullable: true }) warehouseName: string | null;
  @ApiProperty({
    type: [Number],
    description: 'Who may sign in here (ADR-0124); empty: every cashier',
  })
  cashierUserIds: number[];
  @ApiProperty({ type: [Number], description: 'Who may approve here; empty: every supervisor' })
  supervisorUserIds: number[];
  @ApiProperty({
    type: [Number],
    description: 'The categories it sells, subtrees included; empty: everything',
  })
  categoryIds: number[];
  @ApiProperty({ example: 'К3' }) code: string;
  @ApiProperty() name: string;
  @ApiProperty({ type: String, nullable: true }) printerHost: string | null;
  @ApiProperty({ example: 9100 }) printerPort: number;
  @ApiProperty({ type: String, nullable: true, description: 'ADR-0111: information only' })
  printerName: string | null;
  @ApiProperty() drawerKick: boolean;
  @ApiProperty({ enum: POS_STATUSES }) status: PosStatus;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) lastSaleAt: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  pairingExpiresAt: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: string;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt: string;
}

@ApiSchema({ name: 'PosTillRequest' })
export class TillRequestDto {
  @ApiProperty() @IsInt() @Min(1) edgeNodeId: number;
  @ApiPropertyOptional({
    description: 'A STORE warehouse of the edge’s branch; the edge’s when absent',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  warehouseId?: number;
  @ApiProperty({ example: 'К3', description: 'Capitals, digits and dashes, 1–8' })
  @Transform(trimmed)
  @IsString()
  @MaxLength(POS_LIMITS.maxTillCode)
  code: string;
  @ApiProperty({ maxLength: POS_LIMITS.maxName })
  @Transform(trimmed)
  @IsString()
  @MaxLength(POS_LIMITS.maxName)
  name: string;
  @ApiPropertyOptional({ type: String, nullable: true, example: '192.168.1.31' })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(253)
  printerHost?: string | null;
  @ApiPropertyOptional({ example: 9100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65_535)
  printerPort?: number;
  @ApiPropertyOptional({ type: String, nullable: true, example: 'XP-80C (USB)' })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(POS_LIMITS.maxName)
  printerName?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() drawerKick?: boolean;
}

@ApiSchema({ name: 'PosTillPatch' })
export class TillPatchDto {
  @ApiPropertyOptional({ description: 'A STORE warehouse of the edge’s branch' })
  @IsOptional()
  @IsInt()
  @Min(1)
  warehouseId?: number;
  @ApiPropertyOptional({ maxLength: POS_LIMITS.maxName })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(POS_LIMITS.maxName)
  name?: string;
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(253)
  printerHost?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(65_535) printerPort?: number;
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(POS_LIMITS.maxName)
  printerName?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() drawerKick?: boolean;
  @ApiPropertyOptional({ enum: POS_STATUSES }) @IsOptional() @IsIn(POS_STATUSES) status?: PosStatus;
}

@ApiSchema({ name: 'PosTillAccess' })
export class TillAccessDto {
  @ApiProperty({ type: [Number] })
  @IsArray()
  @ArrayMaxSize(200)
  @IsInt({ each: true })
  cashierUserIds: number[];
  @ApiProperty({ type: [Number] })
  @IsArray()
  @ArrayMaxSize(200)
  @IsInt({ each: true })
  supervisorUserIds: number[];
  @ApiProperty({ type: [Number] })
  @IsArray()
  @ArrayMaxSize(500)
  @IsInt({ each: true })
  categoryIds: number[];
}

@ApiSchema({ name: 'PosTillsQuery' })
export class TillsQueryDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) edgeNodeId?: number;
}

@ApiSchema({ name: 'PosPairingCode' })
export class PairingCodeDto {
  @ApiProperty({ example: '482913', description: 'Shown once' }) code: string;
  @ApiProperty({ type: String, format: 'date-time' }) expiresAt: string;
}

// ---------------------------------------------------------------- cashiers

@ApiSchema({ name: 'PosCashier' })
export class CashierDto {
  @ApiProperty() userId: number;
  @ApiProperty() username: string;
  @ApiProperty() fullName: string;
  @ApiProperty({ enum: ['ACTIVE', 'DISABLED'] }) userStatus: 'ACTIVE' | 'DISABLED';
  @ApiProperty({ enum: POS_STATUSES }) status: PosStatus;
  @ApiProperty({ type: String, format: 'date-time' }) pinSetAt: string;
  @ApiProperty({ type: String, nullable: true }) pinSetByName: string | null;
  @ApiProperty() failedCount: number;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) lockedUntil: string | null;
  @ApiProperty({ description: 'Holds pos.till.supervise: may approve at a till' })
  supervisor: boolean;
}

@ApiSchema({ name: 'PosPinRequest' })
export class PinRequestDto {
  @ApiProperty({ example: '123456', description: 'Six digits' })
  @IsString()
  @Matches(/^[0-9]{6}$/)
  pin: string;
}

@ApiSchema({ name: 'PosCashierStatusRequest' })
export class CashierStatusDto {
  @ApiProperty({ enum: POS_STATUSES }) @IsIn(POS_STATUSES) status: PosStatus;
}

// ---------------------------------------------------------------- shifts

@ApiSchema({ name: 'PosShiftPayment' })
export class ShiftPaymentDto {
  @ApiProperty({ type: Number, nullable: true }) paymentTypeId: number | null;
  @ApiProperty({ type: String, nullable: true }) name: string | null;
  @ApiProperty({ enum: TENDER_KINDS }) kind: TenderKind;
  @ApiProperty({ example: '2515000.00' }) sales: string;
  @ApiProperty({ example: '0.00' }) refunds: string;
}

@ApiSchema({ name: 'PosShift' })
export class ShiftDto {
  @ApiProperty() id: number;
  @ApiProperty({ example: 'К3-261016-Э1' }) number: string;
  @ApiProperty({ enum: SHIFT_STATUSES }) status: ShiftStatus;
  @ApiProperty() edgeNodeId: number;
  @ApiProperty() edgeNodeCode: string;
  @ApiProperty() tillId: number;
  @ApiProperty() tillCode: string;
  @ApiProperty() tillName: string;
  @ApiProperty() cashierUserId: number;
  @ApiProperty({ type: String, nullable: true }) cashierName: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) openedAt: string;
  @ApiProperty({ example: '50000.00' }) openingFloat: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) closedAt: string | null;
  @ApiProperty({ type: String, nullable: true }) countedCash: string | null;
  @ApiProperty({ type: String, nullable: true }) floatKept: string | null;
  @ApiProperty({ type: String, nullable: true }) expectedCash: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'counted − expected' })
  variance: string | null;
  @ApiProperty({ type: String, nullable: true }) note: string | null;
  @ApiProperty() salesCount: number;
  @ApiProperty() returnsCount: number;
  @ApiProperty({ example: '320000.00' }) cashSales: string;
  @ApiProperty({ example: '0.00' }) cashRefunds: string;
  @ApiProperty({ example: '120000.00' }) cardSales: string;
  @ApiProperty({ example: '0.00' }) cardRefunds: string;
  @ApiProperty({ example: '0.00', description: 'ADR-0109: sold on credit' }) creditSales: string;
  @ApiProperty({ example: '0.00', description: 'ADR-0109: taken off customers’ debts' })
  creditRefunds: string;
  @ApiProperty({ example: '0.00', description: 'ADR-0110: paid by partner vouchers' })
  voucherSales: string;
  @ApiProperty({ example: '0.00', description: 'ADR-0111: bank transfers' }) transferSales: string;
  @ApiProperty({ example: '0.00' }) transferRefunds: string;
  @ApiPropertyOptional({ type: () => [ShiftPaymentDto], description: 'On one shift’s read' })
  payments?: ShiftPaymentDto[];
  @ApiProperty({ example: '440000.00' }) salesTotal: string;
  @ApiProperty({ example: '0.00' }) returnsTotal: string;
  @ApiProperty({ example: '40000.00' }) salesVat: string;
  @ApiProperty({ example: '0.00' }) returnsVat: string;
  @ApiProperty({ type: Number, nullable: true }) journalEntryId: number | null;
  @ApiProperty({ type: String, nullable: true }) journalNumber: string | null;
  @ApiProperty({ type: Number, nullable: true }) handoverPaymentId: number | null;
  @ApiProperty({ type: String, nullable: true }) handoverNumber: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) handedOverAt: string | null;
  @ApiProperty({ type: String, nullable: true }) handedOverByName: string | null;
}

@ApiSchema({ name: 'PosShiftListQuery' })
export class ShiftListQueryDto extends PageQueryDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) edgeNodeId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) tillId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) cashierUserId?: number;
  @ApiPropertyOptional({ enum: SHIFT_STATUSES })
  @IsOptional()
  @IsIn(SHIFT_STATUSES)
  status?: ShiftStatus;
  @ApiPropertyOptional({ example: '2026-10-01' }) @IsOptional() @Matches(DATE) from?: string;
  @ApiPropertyOptional({ example: '2026-10-31' }) @IsOptional() @Matches(DATE) to?: string;
}

@ApiSchema({ name: 'PosShiftPage' })
export class ShiftPageDto {
  @ApiProperty({ type: [ShiftDto] }) data: ShiftDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
}

@ApiSchema({ name: 'PosHandoverRequest' })
export class HandoverRequestDto {
  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Default: the settings’ box' })
  @IsOptional()
  @IsInt()
  @Min(1)
  moneyAccountId?: number | null;
  @ApiPropertyOptional({ example: '314000', description: 'Default: counted − float kept' })
  @IsOptional()
  @IsString()
  @Matches(MONEY)
  amount?: string | null;
  @ApiPropertyOptional({ example: '2026-10-16', description: 'Default: today' })
  @IsOptional()
  @Matches(DATE)
  paidOn?: string | null;
}

// ---------------------------------------------------------------- sales

@ApiSchema({ name: 'PosSale' })
export class SaleDto {
  @ApiProperty() id: number;
  @ApiProperty({ example: 'К3-261016-0045' }) number: string;
  @ApiProperty({ enum: SALE_KINDS }) kind: SaleKind;
  @ApiProperty() edgeNodeId: number;
  @ApiProperty() tillId: number;
  @ApiProperty() tillCode: string;
  @ApiProperty() shiftId: number;
  @ApiProperty() shiftNumber: string;
  @ApiProperty() cashierUserId: number;
  @ApiProperty({ type: String, nullable: true }) cashierName: string | null;
  @ApiProperty({ type: String, nullable: true }) approvedByName: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) soldAt: string;
  @ApiProperty({ example: '2026-10-16' }) soldDay: string;
  @ApiProperty({ example: '12000.00' }) subtotal: string;
  @ApiProperty({ example: '0.00' }) discountTotal: string;
  @ApiProperty({ example: '12000.00' }) total: string;
  @ApiProperty({ example: '1090.91' }) vatTotal: string;
  @ApiProperty({ example: '12000.00' }) cashAmount: string;
  @ApiProperty({ example: '0.00' }) cardAmount: string;
  @ApiProperty({ example: '0.00', description: 'ADR-0109: the part on credit' })
  creditAmount: string;
  @ApiProperty({ type: Number, nullable: true }) creditCustomerId: number | null;
  @ApiProperty({ type: String, nullable: true }) creditCustomerCode: string | null;
  @ApiProperty({ type: String, nullable: true }) creditCustomerName: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'The invoice or the credit note' })
  creditDocNumber: string | null;
  @ApiProperty({ type: Number, nullable: true }) invoiceId: number | null;
  @ApiProperty({ type: Number, nullable: true }) creditNoteId: number | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'What the limit was passed by when accepted (the whole credit on a hold)',
  })
  creditExcess: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  creditReviewedAt: string | null;
  @ApiProperty({ enum: RECEIPT_TYPES }) receiptType: ReceiptType;
  @ApiProperty({ type: String, nullable: true }) customerTin: string | null;
  @ApiProperty({ type: String, nullable: true }) customerName: string | null;
  @ApiProperty({ enum: EBARIMT_STATUSES }) ebarimtStatus: EbarimtStatus;
  @ApiProperty({ type: String, nullable: true }) ddtd: string | null;
  @ApiProperty({ type: Number, nullable: true }) refundsSaleId: number | null;
  @ApiProperty({ type: String, nullable: true }) refundsSaleNumber: string | null;
  @ApiProperty() lineCount: number;
  @ApiProperty() shortfallCount: number;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: string;
}

@ApiSchema({ name: 'PosSaleLine' })
export class SaleLineDto {
  @ApiProperty() id: number;
  @ApiProperty() lineNo: number;
  @ApiProperty() productId: number;
  @ApiProperty() productSku: string;
  @ApiProperty() productName: string;
  @ApiProperty() productUnitId: number;
  @ApiProperty() uomName: string;
  @ApiProperty({ example: '2' }) qty: string;
  @ApiProperty({ example: '1' }) factorSnapshot: string;
  @ApiProperty({ example: '2' }) qtyBase: string;
  @ApiProperty({ enum: PRICE_BASES }) basis: PriceBasis;
  @ApiProperty({ example: '6000.00' }) listPrice: string;
  @ApiProperty({ example: '6000.00' }) unitPrice: string;
  @ApiProperty({ example: '0.00' }) discountAmount: string;
  @ApiProperty({ example: '12000.00' }) subtotal: string;
  @ApiProperty({ example: '12000.00' }) total: string;
  @ApiProperty({ enum: VAT_TYPES }) vatType: VatType;
  @ApiProperty({ example: '10.00' }) vatRatePct: string;
  @ApiProperty({ example: '1090.91' }) vatAmount: string;
  @ApiProperty({ type: Number, nullable: true }) refundsLineId: number | null;
  @ApiProperty() damaged: boolean;
  @ApiProperty({ example: '0' }) returnedBase: string;
}

@ApiSchema({ name: 'PosTender' })
export class TenderDto {
  @ApiProperty() id: number;
  @ApiProperty() tenderNo: number;
  @ApiProperty({ enum: TENDER_KINDS }) kind: TenderKind;
  @ApiProperty({ type: Number, nullable: true }) paymentTypeId: number | null;
  @ApiProperty({ type: String, nullable: true, example: 'Khaanbank terminal' })
  paymentTypeName: string | null;
  @ApiProperty({ example: '12000.00' }) amount: string;
  @ApiProperty({ type: String, nullable: true, example: '20000.00' }) tendered: string | null;
  @ApiProperty({ type: String, nullable: true }) terminalId: string | null;
  @ApiProperty({ type: String, nullable: true }) rrn: string | null;
  @ApiProperty({ type: String, nullable: true }) maskedPan: string | null;
}

@ApiSchema({ name: 'PosShortfall' })
export class ShortfallDto {
  @ApiProperty() id: number;
  @ApiProperty() saleId: number;
  @ApiProperty() saleNumber: string;
  @ApiProperty() saleLineId: number;
  @ApiProperty() productId: number;
  @ApiProperty() productSku: string;
  @ApiProperty() productName: string;
  @ApiProperty() warehouseId: number;
  @ApiProperty({ example: '3' }) qtyBase: string;
  @ApiProperty() adjustmentId: number;
  @ApiProperty({ example: 'ADJ-2026-000012' }) adjustmentNumber: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) resolvedAt: string | null;
  @ApiProperty({ type: String, nullable: true }) resolvedByName: string | null;
  @ApiProperty({ type: String, nullable: true }) note: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: string;
}

@ApiSchema({ name: 'PosSaleReturn' })
export class SaleReturnDto {
  @ApiProperty() id: number;
  @ApiProperty() number: string;
  @ApiProperty({ type: String, format: 'date-time' }) soldAt: string;
  @ApiProperty({ example: '6000.00' }) total: string;
}

@ApiSchema({ name: 'PosSaleDetail' })
export class SaleDetailDto extends SaleDto {
  @ApiProperty({ type: String, nullable: true }) consumerNo: string | null;
  @ApiProperty({ type: String, nullable: true }) posapiDate: string | null;
  @ApiProperty({ type: String, nullable: true }) billIdSuffix: string | null;
  @ApiProperty({ type: String, nullable: true }) inactiveId: string | null;
  @ApiProperty({ type: String, nullable: true }) snapshotVersion: string | null;
  @ApiProperty({ type: String, nullable: true }) note: string | null;
  @ApiProperty({ type: String, nullable: true }) creditReviewedByName: string | null;
  @ApiProperty({ type: String, nullable: true }) creditReviewNote: string | null;
  @ApiProperty({ type: [SaleLineDto] }) lines: SaleLineDto[];
  @ApiProperty({ type: [TenderDto] }) tenders: TenderDto[];
  @ApiProperty({ type: [ShortfallDto] }) shortfalls: ShortfallDto[];
  @ApiProperty({ type: [SaleReturnDto] }) returns: SaleReturnDto[];
}

@ApiSchema({ name: 'PosSaleListQuery' })
export class SaleListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ description: 'Part of the number, ДДТД, TIN or buyer name' })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(80)
  q?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) edgeNodeId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) tillId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) shiftId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) cashierUserId?: number;
  @ApiPropertyOptional({ enum: SALE_KINDS }) @IsOptional() @IsIn(SALE_KINDS) kind?: SaleKind;
  @ApiPropertyOptional({ enum: EBARIMT_STATUSES })
  @IsOptional()
  @IsIn(EBARIMT_STATUSES)
  ebarimtStatus?: EbarimtStatus;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) customerId?: number;
  @ApiPropertyOptional({
    type: Boolean,
    description: 'Credit sales past their limit not checked yet',
  })
  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean()
  creditToCheck?: boolean;
  @ApiPropertyOptional({ example: '2026-10-01' }) @IsOptional() @Matches(DATE) from?: string;
  @ApiPropertyOptional({ example: '2026-10-31' }) @IsOptional() @Matches(DATE) to?: string;
}

@ApiSchema({ name: 'PosSalePage' })
export class SalePageDto {
  @ApiProperty({ type: [SaleDto] }) data: SaleDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
  @ApiProperty({ type: Number, nullable: true, description: 'On the first page only' })
  total: number | null;
}

// ---------------------------------------------------------------- shortfalls, rejections, attention

@ApiSchema({ name: 'PosShortfallListQuery' })
export class ShortfallListQueryDto extends PageQueryDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) productId?: number;
  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean()
  resolved?: boolean;
}

@ApiSchema({ name: 'PosShortfallPage' })
export class ShortfallPageDto {
  @ApiProperty({ type: [ShortfallDto] }) data: ShortfallDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
}

@ApiSchema({ name: 'PosResolveShortfallRequest' })
export class ResolveShortfallDto {
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: POS_LIMITS.maxNote })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(POS_LIMITS.maxNote)
  note?: string | null;
}

@ApiSchema({ name: 'PosSyncRejection' })
export class RejectionDto {
  @ApiProperty() id: number;
  @ApiProperty() edgeNodeId: number;
  @ApiProperty() edgeNodeCode: string;
  @ApiProperty() clientId: string;
  @ApiProperty({ enum: POS_EVENT_KINDS }) kind: PosEventKind;
  @ApiProperty({ example: 'POS_TOTALS_MISMATCH' }) code: string;
  @ApiProperty({ type: Object, nullable: true }) params: Record<string, unknown> | null;
  @ApiProperty({ type: Object }) payload: Record<string, unknown>;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) replayedAt: string | null;
  @ApiProperty({ type: String, nullable: true }) replayedByName: string | null;
}

@ApiSchema({ name: 'PosRejectionListQuery' })
export class RejectionListQueryDto extends PageQueryDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) edgeNodeId?: number;
  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean()
  replayed?: boolean;
}

@ApiSchema({ name: 'PosRejectionPage' })
export class RejectionPageDto {
  @ApiProperty({ type: [RejectionDto] }) data: RejectionDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
}

@ApiSchema({ name: 'PosAttention' })
export class PosAttentionDto {
  @ApiProperty() openShifts: number;
  @ApiProperty() shiftsToHandOver: number;
  @ApiProperty() openShortfalls: number;
  @ApiProperty() rejections: number;
  @ApiProperty({ description: 'Sales whose e-Barimt failed or went unanswered (ADR-0065)' })
  receiptsToCheck: number;
  @ApiProperty({ description: 'Credit sales past their limit or hold, not checked (ADR-0109)' })
  creditToCheck: number;
  @ApiProperty({ description: 'Codes used twice, stopped or out of date, not checked (ADR-0110)' })
  vouchersToCheck: number;
  @ApiProperty({ description: 'Bonus card sales on a blocked card or overdrawn (ADR-0112)' })
  loyaltyToCheck: number;
}

@ApiSchema({ name: 'PosDayCountRow' })
export class DayCountRowDto {
  @ApiProperty({ example: 20000 }) @IsIn([...DENOMINATIONS]) note: number;
  @ApiProperty({ example: 12 }) @IsInt() @Min(0) @Max(POS_LIMITS.maxNoteCount) count: number;
}

@ApiSchema({ name: 'PosPaymentType' })
export class PaymentTypeDto {
  @ApiProperty() id: number;
  @ApiProperty({ example: 'Khaanbank terminal' }) name: string;
  @ApiProperty({ enum: PAYMENT_TYPE_KINDS }) kind: PaymentTypeKind;
  @ApiProperty({ enum: POS_STATUSES }) status: PosStatus;
  @ApiProperty() sort: number;
}

@ApiSchema({ name: 'PosPaymentTypeInput' })
export class PaymentTypeInputDto {
  @ApiProperty({ type: Number, nullable: true, description: 'Null adds a type' })
  @IsOptional()
  @IsInt()
  @Min(1)
  id: number | null;
  @ApiProperty({ maxLength: POS_LIMITS.maxPaymentTypeName })
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(POS_LIMITS.maxPaymentTypeName)
  name: string;
  @ApiProperty({ enum: PAYMENT_TYPE_KINDS }) @IsIn(PAYMENT_TYPE_KINDS) kind: PaymentTypeKind;
  @ApiProperty({ enum: POS_STATUSES }) @IsIn(POS_STATUSES) status: PosStatus;
}

@ApiSchema({ name: 'PosPaymentTypesRequest' })
export class PaymentTypesRequestDto {
  @ApiProperty({ type: [PaymentTypeInputDto], description: 'The whole list, in order' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(POS_LIMITS.maxPaymentTypes)
  @ValidateNested({ each: true })
  @Type(() => PaymentTypeInputDto)
  types: PaymentTypeInputDto[];
}

@ApiSchema({ name: 'PosDayCount' })
export class DayCountDto {
  @ApiProperty() id: number;
  @ApiProperty() tillId: number;
  @ApiProperty() tillCode: string;
  @ApiProperty({ example: '2026-10-27' }) day: string;
  @ApiProperty() cashierUserId: number;
  @ApiProperty({ type: String, nullable: true }) cashierName: string | null;
  @ApiProperty({ type: [DayCountRowDto] }) counts: DayCountRowDto[];
  @ApiProperty({ example: '2515000.00' }) total: string;
  @ApiProperty({ type: String, format: 'date-time' }) countedAt: string;
}

@ApiSchema({ name: 'PosDayCountsQuery' })
export class DayCountsQueryDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) tillId?: number;
  @ApiPropertyOptional({ example: '2026-10-01' }) @IsOptional() @Matches(DATE) from?: string;
  @ApiPropertyOptional({ example: '2026-10-31' }) @IsOptional() @Matches(DATE) to?: string;
}

@ApiSchema({ name: 'PosCreditReviewRequest' })
export class CreditReviewDto {
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: POS_LIMITS.maxNote })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(POS_LIMITS.maxNote)
  note?: string | null;
}

// ---------------------------------------------------------------- sync (the edge's documents)

@ApiSchema({ name: 'PosEbarimtFacts' })
export class EbarimtFactsDto {
  @ApiProperty({ enum: EBARIMT_STATUSES }) @IsIn(EBARIMT_STATUSES) status: EbarimtStatus;
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  ddtd?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  posapiDate?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  billIdSuffix?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  inactiveId?: string | null;
}

@ApiSchema({ name: 'PosSaleDocLine' })
export class SaleDocLineDto {
  @ApiProperty() @IsInt() @Min(1) lineNo: number;
  @ApiProperty() @IsInt() @Min(1) productId: number;
  @ApiProperty() @IsInt() @Min(1) productUnitId: number;
  @ApiProperty({ example: '2' }) @IsString() @Matches(QTY) qty: string;
  @ApiProperty({ example: '1' }) @IsString() @Matches(FACTOR) factorSnapshot: string;
  @ApiProperty({ enum: PRICE_BASES }) @IsIn(PRICE_BASES) basis: PriceBasis;
  @ApiProperty({ example: '6000' }) @IsString() @Matches(MONEY) listPrice: string;
  @ApiProperty({ example: '6000' }) @IsString() @Matches(MONEY) unitPrice: string;
  @ApiProperty({ example: '0' }) @IsString() @Matches(MONEY) discountAmount: string;
  @ApiProperty({ example: '12000' }) @IsString() @Matches(MONEY) subtotal: string;
  @ApiProperty({ example: '12000' }) @IsString() @Matches(MONEY) total: string;
  @ApiProperty({ example: '10' }) @IsString() @Matches(PERCENT) vatRatePct: string;
  @ApiProperty({ example: '1090.91' }) @IsString() @Matches(MONEY) vatAmount: string;
  @ApiPropertyOptional({ type: [Object] }) @IsOptional() @IsArray() applied?: unknown[];
  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  refundsLineNo?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() damaged?: boolean;
}

@ApiSchema({ name: 'PosSaleDocTender' })
export class SaleDocTenderDto {
  @ApiProperty({ enum: TENDER_KINDS }) @IsIn(TENDER_KINDS) kind: TenderKind;
  @ApiPropertyOptional({ type: Number, nullable: true, description: 'ADR-0111: the payment type' })
  @IsOptional()
  @IsInt()
  @Min(1)
  paymentTypeId?: number | null;
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(POS_LIMITS.maxPaymentTypeName)
  paymentTypeName?: string | null;
  @ApiProperty({ example: '12000' }) @IsString() @Matches(MONEY) amount: string;
  @ApiPropertyOptional({ type: String, nullable: true, example: '20000' })
  @IsOptional()
  @IsString()
  @Matches(MONEY)
  tendered?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(POS_LIMITS.maxCardField)
  terminalId?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(POS_LIMITS.maxCardField)
  rrn?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(POS_LIMITS.maxCardField)
  maskedPan?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'ADR-0110: a VOUCHER tender' })
  @IsOptional()
  @IsString()
  @Matches(VOUCHER_CODE_PATTERN)
  voucherCode?: string | null;
}

@ApiSchema({ name: 'PosSaleDocVoucher' })
export class SaleDocVoucherDto {
  @ApiProperty() @IsInt() @Min(1) voucherId: number;
  @ApiProperty({ example: '9910000000000001' })
  @IsString()
  @Matches(VOUCHER_CODE_PATTERN)
  code: string;
  @ApiProperty({ enum: VOUCHER_KINDS }) @IsIn(VOUCHER_KINDS) kind: VoucherKind;
  @ApiProperty({ example: '50000' }) @IsString() @Matches(MONEY) face: string;
  @ApiProperty({ example: '42000' }) @IsString() @Matches(MONEY) amount: string;
}

/** A bonus card member's part of a sale or a return (ADR-0112). */
export class SaleDocLoyaltyDto {
  @ApiProperty() @IsInt() @Min(1) memberId: number;
  @ApiProperty({ example: '40000' }) @IsString() @Matches(MONEY) earnBase: string;
  @ApiProperty({ example: '1' }) @IsString() @Matches(MONEY) percent: string;
  @ApiProperty({ example: '400' }) @IsString() @Matches(MONEY) earned: string;
  @ApiProperty({ example: '10000' }) @IsString() @Matches(MONEY) spent: string;
  @ApiProperty({ example: '0' }) @IsString() @Matches(MONEY) givenBack: string;
  @ApiProperty({ example: '0' }) @IsString() @Matches(MONEY) clawback: string;
  @ApiProperty({ example: '40000', description: 'Negative on a return' })
  @IsString()
  @Matches(SIGNED_MONEY)
  spendDelta: string;
}

@ApiSchema({ name: 'PosSaleDoc' })
export class SaleDocDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() clientId: string;
  @ApiProperty({ enum: SALE_KINDS }) @IsIn(SALE_KINDS) kind: SaleKind;
  @ApiProperty({ example: 'К3' }) @Transform(trimmed) @IsString() @MaxLength(8) tillCode: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() shiftClientId: string;
  @ApiProperty() @IsInt() @Min(1) cashierUserId: number;
  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  approvedByUserId?: number | null;
  @ApiProperty({ example: 'К3-261016-0045' })
  @Transform(trimmed)
  @IsString()
  @MaxLength(40)
  number: string;
  @ApiProperty({ type: String, format: 'date-time' }) @IsISO8601() soldAt: string;
  @ApiPropertyOptional({ enum: RECEIPT_TYPES, default: 'B2C' })
  @IsOptional()
  @IsIn(RECEIPT_TYPES)
  receiptType?: ReceiptType;
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @Matches(TIN)
  customerTin?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(POS_LIMITS.maxName)
  customerName?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @Matches(CONSUMER)
  consumerNo?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  refundsSaleClientId?: string | null;
  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description: 'ADR-0109: the customer a CREDIT tender charges',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  customerId?: number | null;
  @ApiProperty({ type: [SaleDocLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(POS_LIMITS.maxLines)
  @ValidateNested({ each: true })
  @Type(() => SaleDocLineDto)
  lines: SaleDocLineDto[];
  @ApiProperty({ type: [SaleDocTenderDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(POS_LIMITS.maxTenders)
  @ValidateNested({ each: true })
  @Type(() => SaleDocTenderDto)
  tenders: SaleDocTenderDto[];
  @ApiPropertyOptional({ type: [SaleDocVoucherDto], description: 'ADR-0110: the codes taken' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(VOUCHER_LIMITS.maxPerSale)
  @ValidateNested({ each: true })
  @Type(() => SaleDocVoucherDto)
  vouchers?: SaleDocVoucherDto[];
  @ApiPropertyOptional({ type: SaleDocLoyaltyDto, nullable: true, description: 'ADR-0112' })
  @IsOptional()
  @ValidateNested()
  @Type(() => SaleDocLoyaltyDto)
  loyalty?: SaleDocLoyaltyDto | null;
  @ApiProperty({ example: '12000' }) @IsString() @Matches(MONEY) subtotal: string;
  @ApiProperty({ example: '0' }) @IsString() @Matches(MONEY) discountTotal: string;
  @ApiProperty({ example: '12000' }) @IsString() @Matches(MONEY) total: string;
  @ApiProperty({ example: '1090.91' }) @IsString() @Matches(MONEY) vatTotal: string;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: POS_LIMITS.maxNote })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(POS_LIMITS.maxNote)
  note?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  snapshotVersion?: string | null;
  @ApiPropertyOptional({ type: EbarimtFactsDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => EbarimtFactsDto)
  ebarimt?: EbarimtFactsDto | null;
}

@ApiSchema({ name: 'PosShiftOpenDoc' })
export class ShiftOpenDocDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() clientId: string;
  @ApiProperty({ example: 'К3' }) @Transform(trimmed) @IsString() @MaxLength(8) tillCode: string;
  @ApiProperty() @IsInt() @Min(1) cashierUserId: number;
  @ApiProperty({ example: 'К3-261016-Э1' })
  @Transform(trimmed)
  @IsString()
  @MaxLength(40)
  number: string;
  @ApiProperty({ type: String, format: 'date-time' }) @IsISO8601() openedAt: string;
  @ApiProperty({ example: '50000' }) @IsString() @Matches(MONEY) openingFloat: string;
}

@ApiSchema({ name: 'PosShiftCloseDoc' })
export class ShiftCloseDocDto {
  @ApiProperty({ format: 'uuid', description: 'The shift’s clientId' }) @IsUUID() clientId: string;
  @ApiProperty({ type: String, format: 'date-time' }) @IsISO8601() closedAt: string;
  @ApiProperty({ example: '364000' }) @IsString() @Matches(MONEY) countedCash: string;
  @ApiProperty({ example: '50000' }) @IsString() @Matches(MONEY) floatKept: string;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: POS_LIMITS.maxNote })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(POS_LIMITS.maxNote)
  note?: string | null;
}

@ApiSchema({ name: 'PosReceiptStatusDoc' })
export class ReceiptStatusDocDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() saleClientId: string;
  @ApiProperty({ type: EbarimtFactsDto })
  @ValidateNested()
  @Type(() => EbarimtFactsDto)
  ebarimt: EbarimtFactsDto;
}

@ApiSchema({ name: 'PosTillBoundDoc' })
export class TillBoundDocDto {
  @ApiProperty({ example: 'К3' }) @Transform(trimmed) @IsString() @MaxLength(8) tillCode: string;
  @ApiProperty({ description: 'sha-256 hex of the device token' })
  @IsString()
  @Matches(HASH)
  deviceTokenHash: string;
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  userAgent?: string | null;
  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  boundByUserId?: number | null;
  @ApiProperty({ type: String, format: 'date-time' }) @IsISO8601() boundAt: string;
}

@ApiSchema({ name: 'PosVoidDocLine' })
export class VoidDocLineDto {
  @ApiProperty() @IsInt() @Min(1) productId: number;
  @ApiProperty() @IsInt() @Min(1) productUnitId: number;
  @ApiProperty({ example: '2' }) @IsString() @Matches(QTY) qty: string;
  @ApiProperty({ example: '3500' }) @IsString() @Matches(MONEY) unitPrice: string;
  @ApiProperty({ example: '7000' }) @IsString() @Matches(MONEY) total: string;
}

/** ADR-0111: a till's banknote count for its day summary. */
@ApiSchema({ name: 'PosDayCountDoc' })
export class DayCountDocDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() clientId: string;
  @ApiProperty({ example: 'К3' }) @Transform(trimmed) @IsString() @MaxLength(8) tillCode: string;
  @ApiProperty({ example: '2026-10-27' }) @Matches(DATE) day: string;
  @ApiProperty() @IsInt() @Min(1) cashierUserId: number;
  @ApiProperty({ type: [DayCountRowDto] })
  @IsArray()
  @ArrayMaxSize(DENOMINATIONS.length)
  @ValidateNested({ each: true })
  @Type(() => DayCountRowDto)
  counts: DayCountRowDto[];
  @ApiProperty({ example: '2515000.00' }) @Matches(MONEY) total: string;
  @ApiProperty({ type: String, format: 'date-time' }) @IsISO8601() countedAt: string;
}

@ApiSchema({ name: 'PosVoidDoc' })
export class VoidDocDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() clientId: string;
  @ApiProperty({ example: 'К3' }) @Transform(trimmed) @IsString() @MaxLength(8) tillCode: string;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  shiftClientId?: string | null;
  @ApiProperty() @IsInt() @Min(1) cashierUserId: number;
  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  approvedByUserId?: number | null;
  @ApiProperty({ type: String, format: 'date-time' }) @IsISO8601() voidedAt: string;
  @ApiProperty({ enum: VOID_REASONS }) @IsIn(VOID_REASONS) reason: VoidReason;
  @ApiProperty({ type: [VoidDocLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(POS_LIMITS.maxLines)
  @ValidateNested({ each: true })
  @Type(() => VoidDocLineDto)
  lines: VoidDocLineDto[];
  @ApiProperty({ example: '7000' }) @IsString() @Matches(MONEY) total: string;
}

/** One replayed document: `kind` says which of the optional bodies is filled. */
@ApiSchema({ name: 'PosSyncEvent' })
export class SyncEventDto {
  @ApiProperty({ enum: POS_EVENT_KINDS }) @IsIn(POS_EVENT_KINDS) kind: PosEventKind;
  @ApiProperty({ format: 'uuid', description: 'The document’s id; a batch never repeats one' })
  @IsUUID()
  clientId: string;
  @ApiPropertyOptional({ type: SaleDocDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SaleDocDto)
  sale?: SaleDocDto;
  @ApiPropertyOptional({ type: ShiftOpenDocDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ShiftOpenDocDto)
  shiftOpened?: ShiftOpenDocDto;
  @ApiPropertyOptional({ type: ShiftCloseDocDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ShiftCloseDocDto)
  shiftClosed?: ShiftCloseDocDto;
  @ApiPropertyOptional({ type: ReceiptStatusDocDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ReceiptStatusDocDto)
  receiptStatus?: ReceiptStatusDocDto;
  @ApiPropertyOptional({ type: TillBoundDocDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => TillBoundDocDto)
  tillBound?: TillBoundDocDto;
  @ApiPropertyOptional({ type: VoidDocDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => VoidDocDto)
  voided?: VoidDocDto;
  @ApiPropertyOptional({ type: DayCountDocDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => DayCountDocDto)
  dayCount?: DayCountDocDto;
}

/** `GET /pos/sync/snapshot?since=`: the version the edge holds (ADR-0067). */
export class SnapshotQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) since?: string;
}

/** ADR-0109: the edge asks before a credit sale (the shape of CreditCheckRequestWire). */
@ApiSchema({ name: 'PosCreditCheckRequest' })
export class CreditCheckDto {
  @ApiProperty() @IsInt() @Min(1) customerId: number;
  @ApiProperty({ example: '30000.00' }) @Matches(MONEY) amount: string;
  @ApiProperty({ example: '0.00', description: 'Credit sold on this edge, not replayed yet' })
  @Matches(MONEY)
  pendingOnEdge: string;
}

@ApiSchema({ name: 'PosSyncBatch' })
export class SyncBatchDto {
  @ApiProperty({ type: [SyncEventDto], description: 'In the order they happened' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(POS_LIMITS.maxEventsPerBatch)
  @ValidateNested({ each: true })
  @Type(() => SyncEventDto)
  events: SyncEventDto[];
}

@ApiSchema({ name: 'PosSyncOutcome' })
export class SyncOutcomeDto {
  @ApiProperty({ format: 'uuid' }) clientId: string;
  @ApiProperty({ enum: POS_EVENT_KINDS }) kind: PosEventKind;
  @ApiProperty({ enum: SYNC_RESULTS }) status: SyncResult;
  @ApiProperty({ type: Number, nullable: true }) id: number | null;
  @ApiProperty({ type: String, nullable: true }) number: string | null;
  @ApiProperty({ type: String, nullable: true }) code: string | null;
  @ApiProperty({ type: Object, nullable: true }) params: Record<string, unknown> | null;
}

@ApiSchema({ name: 'PosSyncResponse' })
export class SyncResponseDto {
  @ApiProperty({ type: [SyncOutcomeDto] }) results: SyncOutcomeDto[];
  @ApiProperty({ type: String, format: 'date-time' }) serverTime: string;
}

@ApiSchema({ name: 'PosHeartbeat' })
export class HeartbeatDto {
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  appVersion?: string | null;
  @ApiProperty({ minimum: 0 }) @IsInt() @Min(0) backlog: number;
  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsInt()
  clockSkewMs?: number | null;
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  snapshotVersion?: string | null;
  @ApiPropertyOptional({ type: () => PosapiInfoDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => PosapiInfoDto)
  posapi?: PosapiInfoDto | null;
}

@ApiSchema({ name: 'PosPosapiInfo' })
export class PosapiInfoDto {
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  version?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, example: '2026-10-26 16:27:07' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  lastSentDate?: string | null;
  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  leftLotteries?: number | null;
  @ApiProperty({ type: String, format: 'date-time' }) @IsISO8601() checkedAt: string;
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  error?: string | null;
}

@ApiSchema({ name: 'PosHeartbeatResponse' })
export class HeartbeatResponseDto {
  @ApiProperty() edgeNodeId: number;
  @ApiProperty() code: string;
  @ApiProperty({ type: String, format: 'date-time' }) serverTime: string;
  @ApiProperty({ type: PosSettingsDto }) settings: PosSettingsDto;
}

// ---------------------------------------------------------------- the test till (development)

@ApiSchema({ name: 'PosDevOpenShiftRequest' })
export class DevOpenShiftDto {
  @ApiProperty() @IsInt() @Min(1) tillId: number;
  @ApiProperty() @IsInt() @Min(1) cashierUserId: number;
  @ApiProperty({ example: '50000' }) @IsString() @Matches(MONEY) openingFloat: string;
}

@ApiSchema({ name: 'PosDevSaleLine' })
export class DevSaleLineDto {
  @ApiProperty() @IsInt() @Min(1) productUnitId: number;
  @ApiProperty({ example: '2' }) @IsString() @Matches(QTY) qty: string;
}

@ApiSchema({ name: 'PosDevTender' })
export class DevTenderDto {
  @ApiProperty({ enum: PAYMENT_TYPE_KINDS }) @IsIn(PAYMENT_TYPE_KINDS) kind: PaymentTypeKind;
  @ApiProperty({ example: '12000' }) @IsString() @Matches(MONEY) amount: string;
  @ApiPropertyOptional({ type: String, nullable: true, example: '20000' })
  @IsOptional()
  @IsString()
  @Matches(MONEY)
  tendered?: string | null;
}

@ApiSchema({ name: 'PosDevSaleRequest' })
export class DevSaleDto {
  @ApiProperty() @IsInt() @Min(1) shiftId: number;
  @ApiProperty() @IsInt() @Min(1) cashierUserId: number;
  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  approvedByUserId?: number | null;
  @ApiProperty({ type: [DevSaleLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(POS_LIMITS.maxLines)
  @ValidateNested({ each: true })
  @Type(() => DevSaleLineDto)
  lines: DevSaleLineDto[];
  @ApiProperty({ type: [DevTenderDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(POS_LIMITS.maxTenders)
  @ValidateNested({ each: true })
  @Type(() => DevTenderDto)
  tenders: DevTenderDto[];
  @ApiPropertyOptional({ enum: RECEIPT_TYPES, default: 'B2C' })
  @IsOptional()
  @IsIn(RECEIPT_TYPES)
  receiptType?: ReceiptType;
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @Matches(TIN)
  customerTin?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(POS_LIMITS.maxName)
  customerName?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: POS_LIMITS.maxNote })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(POS_LIMITS.maxNote)
  note?: string | null;
}

@ApiSchema({ name: 'PosDevCloseShiftRequest' })
export class DevCloseShiftDto {
  @ApiProperty({ example: '364000' }) @IsString() @Matches(MONEY) countedCash: string;
  @ApiProperty({ example: '50000' }) @IsString() @Matches(MONEY) floatKept: string;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: POS_LIMITS.maxNote })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(POS_LIMITS.maxNote)
  note?: string | null;
}

// ---------------------------------------------------------------- quick buttons and voids (ADR-0104)

@ApiSchema({ name: 'PosQuickButton' })
export class QuickButtonDto {
  @ApiProperty() productUnitId: number;
  @ApiProperty() productId: number;
  @ApiProperty() productSku: string;
  @ApiProperty() productName: string;
  @ApiProperty() uomName: string;
  @ApiProperty({ type: String, nullable: true }) label: string | null;
  @ApiProperty({ description: 'False once the till can no longer sell it' }) sellable: boolean;
}

@ApiSchema({ name: 'PosQuickGroup' })
export class QuickGroupDto {
  @ApiProperty() id: number;
  @ApiProperty() name: string;
  @ApiProperty({ type: [QuickButtonDto] }) buttons: QuickButtonDto[];
}

@ApiSchema({ name: 'PosQuickButtonInput' })
export class QuickButtonInputDto {
  @ApiProperty() @IsInt() @Min(1) productUnitId: number;
  @ApiProperty({ type: String, nullable: true, maxLength: POS_LIMITS.maxQuickLabel })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() || null : value,
  )
  @IsString()
  @MaxLength(POS_LIMITS.maxQuickLabel)
  label: string | null;
}

@ApiSchema({ name: 'PosQuickGroupInput' })
export class QuickGroupInputDto {
  @ApiProperty({ maxLength: POS_LIMITS.maxQuickLabel })
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(POS_LIMITS.maxQuickLabel)
  name: string;
  @ApiProperty({ type: [QuickButtonInputDto] })
  @IsArray()
  @ArrayMaxSize(POS_LIMITS.maxQuickButtons)
  @ValidateNested({ each: true })
  @Type(() => QuickButtonInputDto)
  buttons: QuickButtonInputDto[];
}

@ApiSchema({ name: 'PosQuickButtonsRequest' })
export class QuickButtonsRequestDto {
  @ApiProperty({ type: [QuickGroupInputDto], description: 'The whole set, in order' })
  @IsArray()
  @ArrayMaxSize(POS_LIMITS.maxQuickGroups)
  @ValidateNested({ each: true })
  @Type(() => QuickGroupInputDto)
  groups: QuickGroupInputDto[];
}

@ApiSchema({ name: 'PosVoid' })
export class VoidDto {
  @ApiProperty() id: number;
  @ApiProperty({ format: 'uuid' }) clientId: string;
  @ApiProperty() tillId: number;
  @ApiProperty() tillCode: string;
  @ApiProperty({ type: Number, nullable: true }) shiftId: number | null;
  @ApiProperty({ type: String, nullable: true }) shiftNumber: string | null;
  @ApiProperty() cashierUserId: number;
  @ApiProperty({ type: String, nullable: true }) cashierName: string | null;
  @ApiProperty({ type: Number, nullable: true }) approvedBy: number | null;
  @ApiProperty({ type: String, nullable: true }) approvedByName: string | null;
  @ApiProperty({ enum: VOID_REASONS }) reason: VoidReason;
  @ApiProperty({ type: String, format: 'date-time' }) voidedAt: string;
  @ApiProperty({ example: '7000.00' }) total: string;
  @ApiProperty() lineCount: number;
}

@ApiSchema({ name: 'PosVoidLine' })
export class VoidLineDto {
  @ApiProperty() lineNo: number;
  @ApiProperty() productId: number;
  @ApiProperty() productUnitId: number;
  @ApiProperty() productSku: string;
  @ApiProperty() productName: string;
  @ApiProperty() uomName: string;
  @ApiProperty({ example: '2' }) qty: string;
  @ApiProperty({ example: '3500.00' }) unitPrice: string;
  @ApiProperty({ example: '7000.00' }) total: string;
}

@ApiSchema({ name: 'PosVoidDetail' })
export class VoidDetailDto extends VoidDto {
  @ApiProperty({ type: [VoidLineDto] }) lines: VoidLineDto[];
}

@ApiSchema({ name: 'PosVoidListQuery' })
export class VoidListQueryDto extends PageQueryDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) tillId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) cashierUserId?: number;
  @ApiPropertyOptional({ enum: VOID_REASONS })
  @IsOptional()
  @IsIn(VOID_REASONS)
  reason?: VoidReason;
  @ApiPropertyOptional({ example: '2026-10-01' }) @IsOptional() @Matches(DATE) from?: string;
  @ApiPropertyOptional({ example: '2026-10-31' }) @IsOptional() @Matches(DATE) to?: string;
}

@ApiSchema({ name: 'PosVoidPage' })
export class VoidPageDto {
  @ApiProperty({ type: [VoidDto] }) data: VoidDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
  @ApiProperty({ type: Number, nullable: true, description: 'On the first page only' })
  total: number | null;
  @ApiProperty({ type: String, nullable: true, description: 'The voids’ sum, first page only' })
  sum: string | null;
}
