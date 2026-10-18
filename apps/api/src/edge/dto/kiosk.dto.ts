import { POS_LIMITS, TENDER_KINDS, type TenderKind } from '@tugeel/shared/pos';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
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
}

export class SearchQueryDto {
  @IsString() @MaxLength(80) q: string;
}
