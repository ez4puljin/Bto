import {
  DENOMINATIONS,
  POS_LIMITS,
  RECEIPT_TYPES,
  type ReceiptType,
  TENDER_KINDS,
  type TenderKind,
  VOID_REASONS,
  type VoidReason,
} from '@tugeel/shared/pos';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** Money with at most two decimals, quantities with at most three (strings, never floats). */
const MONEY = /^\d{1,12}(\.\d{1,2})?$/;
const QTY = /^\d{1,11}(\.\d{1,3})?$/;

export class PairDto {
  @IsString() @MaxLength(16) tillCode: string;
  @IsString() @MaxLength(32) pairingCode: string;
}

export class LoginDto {
  @IsInt() @Min(1) userId: number;
  @IsString() @MaxLength(16) pin: string;
}

export class ShiftOpenDto {
  @Matches(MONEY) openingFloat: string;
}

export class ShiftCloseDto {
  @Matches(MONEY) countedCash: string;
  @Matches(MONEY) floatKept: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string | null;
}

export class CartLineDto {
  @IsInt() @Min(1) productUnitId: number;
  @Matches(QTY) qty: string;
}

export class QuoteDto {
  @ArrayMinSize(1)
  @ArrayMaxSize(POS_LIMITS.maxLines)
  @ValidateNested({ each: true })
  @Type(() => CartLineDto)
  lines: CartLineDto[];
}

export class TenderDto {
  @IsIn(TENDER_KINDS) kind: TenderKind;
  /** ADR-0111: the payment type chosen; the edge takes the kind from it. */
  @IsOptional() @IsInt() @Min(1) paymentTypeId?: number | null;
  @Matches(MONEY) amount: string;
  @IsOptional() @Matches(MONEY) tendered?: string | null;
  @IsOptional() @IsString() @MaxLength(32) terminalId?: string | null;
  @IsOptional() @IsString() @MaxLength(32) rrn?: string | null;
}

export class SaleDto {
  @IsUUID() clientId: string;

  @ArrayMinSize(1)
  @ArrayMaxSize(POS_LIMITS.maxLines)
  @ValidateNested({ each: true })
  @Type(() => CartLineDto)
  lines: CartLineDto[];

  @ArrayMinSize(1)
  @ArrayMaxSize(POS_LIMITS.maxTenders)
  @ValidateNested({ each: true })
  @Type(() => TenderDto)
  tenders: TenderDto[];

  /** A company's receipt (ADR-0065): the TIN the lookup answered. */
  @IsOptional() @ValidateNested() @Type(() => BuyerDto) buyer?: BuyerDto | null;

  /** ADR-0109: «Хувь хүн» (B2C) or «Байгууллага» (B2B, with the buyer). */
  @IsOptional() @IsIn(RECEIPT_TYPES) receiptType?: ReceiptType;

  /** The customer a CREDIT tender charges. */
  @IsOptional() @IsInt() @Min(1) customerId?: number | null;

  /** The cashier went on after the offline warning on the customer's limit. */
  @IsOptional() @IsBoolean() acceptOverLimit?: boolean;
}

export class BuyerDto {
  @Matches(/^[0-9]{11,14}$/) tin: string;
}

/** A company by its 7-digit registration number or its 11–14 digit TIN. */
export class TaxpayerQueryDto {
  @Matches(/^ *[0-9][0-9 -]{5,20} *$/) no: string;
}

export class EbarimtResolveDto {
  @IsIn(['ISSUED', 'NOT_ISSUED']) outcome: 'ISSUED' | 'NOT_ISSUED';
  @IsOptional() @IsString() @MaxLength(40) ddtd?: string | null;
  @IsOptional() @IsString() @MaxLength(19) posapiDate?: string | null;
  @IsOptional() @ValidateNested() @Type(() => ApprovalDto) approval: ApprovalDto | null;
}

export class EbarimtSendDataDto {
  @IsOptional() @ValidateNested() @Type(() => ApprovalDto) approval: ApprovalDto | null;
}

/** ADR-0111: a till's day (its history, its summary). */
export class DayQueryDto {
  @Matches(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/) day: string;
  @IsOptional() @IsString() @MaxLength(40) q?: string;
}

export class DayCountRowDto {
  @IsInt() note: number;
  @IsInt() @Min(0) count: number;
}

export class DayCountRequestDto {
  @IsUUID() clientId: string;
  @Matches(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/) day: string;
  @ArrayMaxSize(DENOMINATIONS.length)
  @ValidateNested({ each: true })
  @Type(() => DayCountRowDto)
  counts: DayCountRowDto[];
}

export class SearchQueryDto {
  @IsString() @MaxLength(80) q: string;
}

/** A supervisor's PIN for a void or a return (ADR-0104). */
export class ApprovalDto {
  @IsInt() @Min(1) supervisorUserId: number;
  @IsString() @MaxLength(16) pin: string;
}

export class VoidDto {
  @IsUUID() clientId: string;
  @IsIn(VOID_REASONS) reason: VoidReason;

  @ArrayMinSize(1)
  @ArrayMaxSize(POS_LIMITS.maxLines)
  @ValidateNested({ each: true })
  @Type(() => CartLineDto)
  lines: CartLineDto[];

  @IsOptional() @ValidateNested() @Type(() => ApprovalDto) approval: ApprovalDto | null;
}

export class ParkDto {
  @IsUUID() clientId: string;

  @ArrayMinSize(1)
  @ArrayMaxSize(POS_LIMITS.maxLines)
  @ValidateNested({ each: true })
  @Type(() => CartLineDto)
  lines: CartLineDto[];
}

export class DiscardParkedDto {
  @IsOptional() @ValidateNested() @Type(() => ApprovalDto) approval: ApprovalDto | null;
}

export class ReturnSaleQueryDto {
  @IsString() @MaxLength(40) number: string;
}

export class ReturnLineDto {
  @IsInt() @Min(1) refundsLineNo: number;
  @Matches(QTY) qty: string;
  @IsBoolean() damaged: boolean;
}

export class ReturnDto {
  @IsUUID() clientId: string;
  @IsUUID() refundsSaleClientId: string;

  @ArrayMinSize(1)
  @ArrayMaxSize(POS_LIMITS.maxLines)
  @ValidateNested({ each: true })
  @Type(() => ReturnLineDto)
  lines: ReturnLineDto[];

  @IsOptional() @ValidateNested() @Type(() => ApprovalDto) approval: ApprovalDto | null;
}
