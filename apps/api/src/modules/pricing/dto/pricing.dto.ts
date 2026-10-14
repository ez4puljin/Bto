import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import {
  DISCOUNT_EFFECTS,
  DISCOUNT_MEASURES,
  DISCOUNT_SCOPES,
  type DiscountEffect,
  type DiscountMeasure,
  type DiscountScope,
  MAX_DISCOUNT_STEPS,
  MAX_QUOTE_LINES,
  PRICE_BASES,
  PRICE_LISTS,
  type PriceBasis,
  type PriceList,
} from '@tugeel/shared/pricing';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PageQueryDto } from '../../../common/pagination/page';
import { PROGRAM_STATUSES, type ProgramStatus } from '../services/discount-programs.service';
import { MAX_SALE_READY } from '../services/sale-readiness.service';

const QTY = /^\d{1,11}(\.\d{1,3})?$/;
const DECIMAL_2 = /^\d{1,12}(\.\d{1,2})?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// ---------------------------------------------------------------------------------------------
// Completing registered products (ADR-0044 #3)

@ApiSchema({ name: 'SaleReadyRequest' })
export class SaleReadyRequestDto {
  @ApiProperty({ type: [Number], minItems: 1, maxItems: MAX_SALE_READY })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_SALE_READY)
  @IsInt({ each: true })
  @Min(1, { each: true })
  productIds: number[];
}

/** The price clerk's tile (ADR-0047 #7): products waiting for their prices, up to `cap`. */
@ApiSchema({ name: 'PricingAttention' })
export class PricingAttentionDto {
  @ApiProperty() productsWaitingForPrices: number;
  @ApiProperty({ example: 100, description: 'Counts stop here; show «99+» at the cap' })
  cap: number;
}

@ApiSchema({ name: 'SaleReadyResult' })
export class SaleReadyResultDto {
  @ApiProperty({ type: [Number], description: 'Completed by this call' }) completed: number[];
  @ApiProperty({ type: [Number], description: 'Complete already' }) alreadyComplete: number[];
}

// ---------------------------------------------------------------------------------------------
// Discount programs

@ApiSchema({ name: 'DiscountStep' })
export class DiscountStepDto {
  @ApiProperty({
    example: '240',
    description: 'PRODUCT QTY: base units; CATEGORY QTY: counted units; AMOUNT: MNT',
  })
  @Matches(QTY)
  threshold: string;
  @ApiProperty({ example: '22800', description: 'PRICE, AMOUNT: whole MNT; PERCENT: a percentage' })
  @Matches(DECIMAL_2)
  value: string;
}

@ApiSchema({ name: 'DiscountProgramRequest' })
export class DiscountProgramInputDto {
  @ApiProperty({ maxLength: 120 })
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;
  @ApiProperty({ enum: PRICE_LISTS }) @IsIn(PRICE_LISTS) list: PriceList;
  @ApiProperty({ enum: DISCOUNT_SCOPES }) @IsIn(DISCOUNT_SCOPES) scope: DiscountScope;
  @ApiProperty({ enum: DISCOUNT_MEASURES }) @IsIn(DISCOUNT_MEASURES) measure: DiscountMeasure;
  @ApiProperty({ enum: DISCOUNT_EFFECTS }) @IsIn(DISCOUNT_EFFECTS) effect: DiscountEffect;
  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  productId?: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  productUnitId?: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  thresholdUnitId?: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  categoryId?: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  countUomId?: number | null;
  @ApiProperty({ example: '2026-11-01' }) @Matches(ISO_DATE) validFrom: string;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Up to, not including' })
  @IsOptional()
  @Matches(ISO_DATE)
  validTo?: string | null;
  @ApiProperty({ type: [DiscountStepDto], maxItems: MAX_DISCOUNT_STEPS })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_DISCOUNT_STEPS)
  @ValidateNested({ each: true })
  @Type(() => DiscountStepDto)
  steps: DiscountStepDto[];
}

@ApiSchema({ name: 'ProgramProduct' })
export class ProgramProductDto {
  @ApiProperty() id: number;
  @ApiProperty() sku: string;
  @ApiProperty() name: string;
}

@ApiSchema({ name: 'ProgramUnit' })
export class ProgramUnitDto {
  @ApiProperty() id: number;
  @ApiProperty() uomName: string;
  @ApiProperty({ example: '24' }) factorToBase: string;
}

@ApiSchema({ name: 'DiscountProgram' })
export class DiscountProgramDto {
  @ApiProperty() id: number;
  @ApiProperty() name: string;
  @ApiProperty({ enum: PRICE_LISTS }) list: PriceList;
  @ApiProperty({ enum: DISCOUNT_SCOPES }) scope: DiscountScope;
  @ApiProperty({ enum: DISCOUNT_MEASURES }) measure: DiscountMeasure;
  @ApiProperty({ enum: DISCOUNT_EFFECTS }) effect: DiscountEffect;
  @ApiProperty({ type: ProgramProductDto, nullable: true }) product: ProgramProductDto | null;
  @ApiProperty({ type: ProgramUnitDto, nullable: true }) productUnit: ProgramUnitDto | null;
  @ApiProperty({ type: ProgramUnitDto, nullable: true }) thresholdUnit: ProgramUnitDto | null;
  @ApiProperty({ type: Number, nullable: true }) categoryId: number | null;
  @ApiProperty({ type: Number, nullable: true }) countUomId: number | null;
  @ApiProperty() validFrom: string;
  @ApiProperty({ type: String, nullable: true }) validTo: string | null;
  @ApiProperty({ enum: PROGRAM_STATUSES }) status: ProgramStatus;
  @ApiProperty({ type: [DiscountStepDto] }) steps: DiscountStepDto[];
  @ApiProperty() createdAt: string;
  @ApiProperty() updatedAt: string;
}

@ApiSchema({ name: 'DiscountProgramPage' })
export class DiscountProgramPageDto {
  @ApiProperty({ type: [DiscountProgramDto] }) data: DiscountProgramDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
}

export class DiscountProgramQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: PRICE_LISTS }) @IsOptional() @IsIn(PRICE_LISTS) list?: PriceList;
  @ApiPropertyOptional({ enum: DISCOUNT_SCOPES })
  @IsOptional()
  @IsIn(DISCOUNT_SCOPES)
  scope?: DiscountScope;
  @ApiPropertyOptional({ enum: PROGRAM_STATUSES })
  @IsOptional()
  @IsIn(PROGRAM_STATUSES)
  status?: ProgramStatus;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) productId?: number;
}

// ---------------------------------------------------------------------------------------------
// Quotes

@ApiSchema({ name: 'QuoteLineRequest' })
export class QuoteLineRequestDto {
  @ApiProperty() @IsInt() @Min(1) productUnitId: number;
  @ApiProperty({ example: '10', description: 'In the unit' }) @Matches(QTY) qty: string;
}

@ApiSchema({ name: 'QuoteRequest' })
export class QuoteRequestDto {
  @ApiPropertyOptional({ enum: PRICE_LISTS, default: 'WHOLESALE' })
  @IsOptional()
  @IsIn(PRICE_LISTS)
  list?: PriceList;
  @ApiPropertyOptional({ description: 'Ulaanbaatar business date; default today' })
  @IsOptional()
  @Matches(ISO_DATE)
  date?: string;
  @ApiProperty({ type: [QuoteLineRequestDto], maxItems: MAX_QUOTE_LINES })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_QUOTE_LINES)
  @ValidateNested({ each: true })
  @Type(() => QuoteLineRequestDto)
  lines: QuoteLineRequestDto[];
}

@ApiSchema({ name: 'AppliedDiscount' })
export class AppliedDiscountDto {
  @ApiProperty() programId: number;
  @ApiProperty() name: string;
  @ApiProperty({ enum: DISCOUNT_SCOPES }) scope: DiscountScope;
  @ApiProperty({ enum: DISCOUNT_EFFECTS }) effect: DiscountEffect;
  @ApiProperty({ description: 'The step reached' }) threshold: string;
  @ApiProperty() value: string;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Tugriks a category or order program took off the part',
  })
  amount: string | null;
}

/** A part of a quoted line (ADR-0048 #4): whole packs, loose pieces or a supermarket price. */
@ApiSchema({ name: 'QuotePart' })
export class QuotePartDto {
  @ApiProperty({ description: 'The unit the part is counted in' }) productUnitId: number;
  @ApiProperty() uomName: string;
  @ApiProperty({ example: '20' }) factorSnapshot: string;
  @ApiProperty() qty: string;
  @ApiProperty() qtyBase: string;
  @ApiProperty({ enum: PRICE_BASES }) basis: PriceBasis;
  @ApiProperty({ description: "The basis' price of one unit" }) listPrice: string;
  @ApiProperty({ description: 'After the product’s own discounts' }) unitPrice: string;
  @ApiProperty() subtotal: string;
  @ApiProperty() discountAmount: string;
  @ApiProperty() total: string;
  @ApiProperty({ type: [AppliedDiscountDto] }) applied: AppliedDiscountDto[];
}

@ApiSchema({ name: 'QuoteLine' })
export class QuoteLineDto {
  @ApiProperty() productId: number;
  @ApiProperty() productUnitId: number;
  @ApiProperty() qty: string;
  @ApiProperty() qtyBase: string;
  @ApiProperty() priced: boolean;
  @ApiProperty({ type: String, enum: ['PRICE_MISSING'], nullable: true })
  problem: 'PRICE_MISSING' | null;
  @ApiProperty({ type: [QuotePartDto], description: 'Empty when the line is not priced' })
  parts: QuotePartDto[];
  @ApiProperty({ type: String, nullable: true, description: 'Sums of the parts' })
  subtotal: string | null;
  @ApiProperty({ type: String, nullable: true }) discountAmount: string | null;
  @ApiProperty({ type: String, nullable: true }) total: string | null;
}

@ApiSchema({ name: 'Quote' })
export class QuoteDto {
  @ApiProperty({ enum: PRICE_LISTS }) list: PriceList;
  @ApiProperty() date: string;
  @ApiProperty({ type: [QuoteLineDto] }) lines: QuoteLineDto[];
  @ApiProperty() subtotal: string;
  @ApiProperty() discountTotal: string;
  @ApiProperty() total: string;
}
