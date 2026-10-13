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
  PRICE_LISTS,
  type PriceList,
  type PriceSource,
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
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { MAX_PAGE_LIMIT, PageQueryDto, queryIds } from '../../../common/pagination/page';
import { PROGRAM_STATUSES, type ProgramStatus } from '../services/discount-programs.service';
import { MAX_SALE_READY } from '../services/sale-readiness.service';
import { MAX_PRICE_ENTRIES } from '../services/unit-prices.service';

const WHOLE_MNT = /^[1-9]\d{0,11}$/;
const QTY = /^\d{1,11}(\.\d{1,3})?$/;
const DECIMAL_2 = /^\d{1,12}(\.\d{1,2})?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PRICE_SOURCES = ['UNIT', 'DERIVED'] as const;

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// ---------------------------------------------------------------------------------------------
// Unit prices

@ApiSchema({ name: 'PricePeriod' })
export class PricePeriodDto {
  @ApiProperty() id: number;
  @ApiProperty({ example: '22800', description: 'Whole MNT, VAT included' }) price: string;
  @ApiProperty({ example: '2026-10-13' }) validFrom: string;
  @ApiProperty({ type: String, nullable: true, description: 'Up to, not including' })
  validTo: string | null;
}

@ApiSchema({ name: 'CurrentUnitPrice' })
export class CurrentUnitPriceDto {
  @ApiProperty({ example: '22800' }) price: string;
  @ApiProperty({
    enum: PRICE_SOURCES,
    description: "UNIT: the unit's own price; DERIVED: the base unit's price × factor",
  })
  source: PriceSource;
  @ApiProperty({ type: PricePeriodDto, nullable: true }) period: PricePeriodDto | null;
}

@ApiSchema({ name: 'UnitPriceView' })
export class UnitPriceViewDto {
  @ApiProperty() productUnitId: number;
  @ApiProperty() uomName: string;
  @ApiProperty({ example: '24' }) factorToBase: string;
  @ApiProperty() isBase: boolean;
  @ApiProperty({ type: CurrentUnitPriceDto, nullable: true }) current: CurrentUnitPriceDto | null;
  @ApiProperty({ type: [PricePeriodDto], description: 'Starting after today, earliest first' })
  scheduled: PricePeriodDto[];
  @ApiProperty({ type: [PricePeriodDto], description: 'Ended, latest first' })
  history: PricePeriodDto[];
}

@ApiSchema({ name: 'ProductPrices' })
export class ProductPricesDto {
  @ApiProperty() productId: number;
  @ApiProperty({ description: 'The Ulaanbaatar business date the view is for' }) today: string;
  @ApiProperty({ type: [UnitPriceViewDto], description: 'Every channel but the supermarket' })
  wholesale: UnitPriceViewDto[];
  @ApiProperty({ type: [UnitPriceViewDto], description: 'The supermarket' })
  retail: UnitPriceViewDto[];
}

export class ProductPricesQueryDto {
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) productId: number;
}

export class CurrentPricesQueryDto {
  @ApiProperty({
    type: [Number],
    maxItems: MAX_PAGE_LIMIT,
    description: 'Repeated: productIds=1&productIds=2',
  })
  @Transform(queryIds)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_PAGE_LIMIT)
  @IsInt({ each: true })
  @Min(1, { each: true })
  productIds: number[];
}

@ApiSchema({ name: 'CurrentPrice' })
export class CurrentPriceDto {
  @ApiProperty() productId: number;
  @ApiProperty({ enum: PRICE_LISTS }) list: PriceList;
  @ApiProperty({ description: 'The base unit' }) productUnitId: number;
  @ApiProperty({ example: '1000' }) price: string;
}

@ApiSchema({ name: 'PriceEntryRequest' })
export class PriceEntryDto {
  @ApiProperty({ enum: PRICE_LISTS }) @IsIn(PRICE_LISTS) list: PriceList;
  @ApiProperty() @IsInt() @Min(1) productUnitId: number;
  @ApiProperty({
    type: String,
    nullable: true,
    example: '22800',
    description: "Whole MNT; null takes the unit back to its base unit's price × factor",
  })
  @ValidateIf((_, value) => value !== null)
  @Matches(WHOLE_MNT)
  price: string | null;
}

@ApiSchema({ name: 'SetPricesRequest' })
export class SetPricesDto {
  @ApiProperty() @IsInt() @Min(1) productId: number;
  @ApiProperty({ example: '2026-10-13', description: 'Today or later (Ulaanbaatar)' })
  @Matches(ISO_DATE)
  validFrom: string;
  @ApiProperty({ type: [PriceEntryDto], maxItems: MAX_PRICE_ENTRIES })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_PRICE_ENTRIES)
  @ValidateNested({ each: true })
  @Type(() => PriceEntryDto)
  entries: PriceEntryDto[];
}

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
    description: 'Tugriks a category or order program took off the line',
  })
  amount: string | null;
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
  @ApiProperty({ type: String, nullable: true }) listPrice: string | null;
  @ApiProperty({ type: String, enum: PRICE_SOURCES, nullable: true })
  priceSource: PriceSource | null;
  @ApiProperty({ type: String, nullable: true, description: 'After the product’s own discounts' })
  unitPrice: string | null;
  @ApiProperty({ type: String, nullable: true }) subtotal: string | null;
  @ApiProperty({ type: String, nullable: true }) discountAmount: string | null;
  @ApiProperty({ type: String, nullable: true }) total: string | null;
  @ApiProperty({ type: [AppliedDiscountDto] }) applied: AppliedDiscountDto[];
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
