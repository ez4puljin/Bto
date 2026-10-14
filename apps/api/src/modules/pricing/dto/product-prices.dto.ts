import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  Matches,
  Min,
} from 'class-validator';
import { MAX_PAGE_LIMIT, queryIds } from '../../../common/pagination/page';
import type { PriceProblem } from '../services/product-prices.service';
import { PriceProfileValuesDto } from './price-profiles.dto';

const WHOLE_MNT = /^[1-9]\d{0,11}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PRICE_PROBLEMS = ['NO_TERMS', 'NO_PROFILE_VERSION', 'NOT_CHOSEN', 'GONE'] as const;
const WHOLESALE_BASES = ['WAREHOUSE', 'LOOSE', 'MIXED'] as const;

@ApiSchema({ name: 'PriceTerms' })
export class PriceTermsDto {
  @ApiProperty() id: number;
  @ApiProperty({ example: '1000', description: 'Per base unit, whole MNT, VAT included' })
  warehousePrice: string;
  @ApiProperty() profileId: number;
  @ApiProperty() profileName: string;
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'The unit of measure counted as a whole pack; null without packs',
  })
  wholeUomId: number | null;
  @ApiProperty({ example: '2026-10-14' }) validFrom: string;
  @ApiProperty({ type: String, nullable: true, description: 'Up to, not including' })
  validTo: string | null;
}

@ApiSchema({ name: 'PricedUnit' })
export class PricedUnitDto {
  @ApiProperty() productUnitId: number;
  @ApiProperty() uomId: number;
  @ApiProperty({ type: String, nullable: true, example: 'BOX' }) uomCode: string | null;
  @ApiProperty() uomName: string;
  @ApiProperty({ example: '20' }) factorToBase: string;
  @ApiProperty() isBase: boolean;
}

@ApiSchema({ name: 'ProductPriceProfile' })
export class ProductPriceProfileDto {
  @ApiProperty() id: number;
  @ApiProperty() name: string;
  @ApiProperty() archived: boolean;
  @ApiProperty({ type: PriceProfileValuesDto, nullable: true, description: 'In force today' })
  values: PriceProfileValuesDto | null;
}

@ApiSchema({ name: 'UnitPriceRow' })
export class UnitPriceRowDto {
  @ApiProperty() productUnitId: number;
  @ApiProperty({ example: '20000', description: 'One unit, wholesale, split as a quote splits it' })
  wholesale: string;
  @ApiProperty({ enum: WHOLESALE_BASES }) wholesaleBasis: (typeof WHOLESALE_BASES)[number];
  @ApiProperty({ example: '26000' }) retail: string;
  @ApiProperty({ type: String, nullable: true, example: '24000' }) retailBulk: string | null;
}

@ApiSchema({ name: 'ProductPriceView' })
export class ProductPriceViewDto {
  @ApiProperty() productId: number;
  @ApiProperty({ description: 'The Ulaanbaatar business date the view is for' }) today: string;
  @ApiProperty({ type: [PricedUnitDto] }) units: PricedUnitDto[];
  @ApiProperty({ type: PriceTermsDto, nullable: true }) current: PriceTermsDto | null;
  @ApiProperty({ type: ProductPriceProfileDto, nullable: true })
  profile: ProductPriceProfileDto | null;
  @ApiProperty({ type: Number, nullable: true, description: 'The current unit counted as whole' })
  wholeUnitId: number | null;
  @ApiProperty({ enum: PRICE_PROBLEMS, isArray: true }) problems: PriceProblem[];
  @ApiProperty({ type: [UnitPriceRowDto], description: 'Empty when the product cannot be priced' })
  table: UnitPriceRowDto[];
  @ApiProperty({ type: [PriceTermsDto], description: 'Starting after today, earliest first' })
  scheduled: PriceTermsDto[];
  @ApiProperty({ type: [PriceTermsDto], description: 'Ended, latest first' })
  history: PriceTermsDto[];
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

@ApiSchema({ name: 'CurrentTerms' })
export class CurrentTermsDto {
  @ApiProperty() productId: number;
  @ApiProperty({ example: '1000' }) warehousePrice: string;
  @ApiProperty() profileId: number;
  @ApiProperty() profileName: string;
  @ApiProperty({ type: Number, nullable: true }) wholeUomId: number | null;
}

@ApiSchema({ name: 'SetPriceTermsRequest' })
export class SetPriceTermsDto {
  @ApiProperty() @IsInt() @Min(1) productId: number;
  @ApiProperty({ example: '2026-10-14', description: 'Today or later (Ulaanbaatar)' })
  @Matches(ISO_DATE)
  validFrom: string;
  @ApiProperty({ example: '1000', description: 'Per base unit, whole MNT, VAT included' })
  @Matches(WHOLE_MNT)
  warehousePrice: string;
  @ApiProperty() @IsInt() @Min(1) profileId: number;
  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description: 'The unit of measure counted as whole; required when the product has packs',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  wholeUomId?: number | null;
}
