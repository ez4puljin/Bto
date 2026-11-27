import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  LOCATION_PRICE_TYPES,
  type LocationPriceType,
  PRICE_ROUNDINGS,
  type PriceRounding,
} from '@tugeel/shared/pricing';

export class SupplierPriceRuleInputDto {
  @ApiProperty() @IsInt() @Min(0) expectedVersion: number;
  @ApiProperty() @IsBoolean() enabled: boolean;
  @ApiProperty() @Matches(/^\d{1,3}(\.\d{1,2})?$/) markupPct: string;
  @ApiProperty() @Matches(/^\d{1,12}$/) markupAmount: string;
  @ApiProperty({ enum: PRICE_ROUNDINGS }) @IsIn(PRICE_ROUNDINGS) rounding: PriceRounding;
}

export class LocationPriceRuleInputDto extends SupplierPriceRuleInputDto {
  @ApiProperty({ enum: LOCATION_PRICE_TYPES })
  @IsIn(LOCATION_PRICE_TYPES)
  priceType: LocationPriceType;
}

@ApiSchema({ name: 'SupplierPriceRule' })
export class SupplierPriceRuleDto {
  @ApiProperty() supplierId: number;
  @ApiProperty() supplierName: string;
  @ApiProperty() enabled: boolean;
  @ApiProperty() markupPct: string;
  @ApiProperty() markupAmount: string;
  @ApiProperty({ enum: PRICE_ROUNDINGS }) rounding: PriceRounding;
  @ApiProperty() version: number;
  @ApiProperty() updatedAt: string;
}

@ApiSchema({ name: 'LocationPriceRule' })
export class LocationPriceRuleDto {
  @ApiProperty() warehouseId: number;
  @ApiProperty() warehouseName: string;
  @ApiProperty() enabled: boolean;
  @ApiProperty({ enum: LOCATION_PRICE_TYPES }) priceType: LocationPriceType;
  @ApiProperty() markupPct: string;
  @ApiProperty() markupAmount: string;
  @ApiProperty({ enum: PRICE_ROUNDINGS }) rounding: PriceRounding;
  @ApiProperty() version: number;
  @ApiProperty() updatedAt: string;
}

@ApiSchema({ name: 'BasePriceEvent' })
export class BasePriceEventDto {
  @ApiPropertyOptional() validFrom?: string;
  @ApiProperty() id: number;
  @ApiProperty() productId: number;
  @ApiProperty() sku: string;
  @ApiProperty() name: string;
  @ApiProperty({ enum: ['RECEIPT', 'MANUAL', 'SKIPPED'] }) kind: 'RECEIPT' | 'MANUAL' | 'SKIPPED';
  @ApiProperty({ type: String, nullable: true }) reason: string | null;
  @ApiProperty({ type: String, nullable: true }) oldBasePrice: string | null;
  @ApiProperty({ type: String, nullable: true }) newBasePrice: string | null;
  @ApiProperty() overrodeManual: boolean;
  @ApiProperty({ type: Number, nullable: true }) receiptId: number | null;
  @ApiProperty({ type: String, nullable: true }) receiptNumber: string | null;
  @ApiProperty() createdAt: string;
  @ApiProperty({ type: Number, nullable: true }) createdBy: number | null;
  @ApiPropertyOptional({ type: String, nullable: true }) printedUnitPriceBase?: string | null;
}

@ApiSchema({ name: 'BasePriceView' })
export class BasePriceViewDto {
  @ApiProperty() productId: number;
  @ApiProperty() sku: string;
  @ApiProperty() name: string;
  @ApiProperty() baseUomName: string;
  @ApiProperty({ type: String, nullable: true }) basePrice: string | null;
  @ApiProperty({ enum: ['RECEIPT', 'MANUAL', 'LEGACY'], nullable: true }) source:
    'RECEIPT' | 'MANUAL' | 'LEGACY' | null;
  @ApiProperty({ type: Number, nullable: true }) lastEventId: number | null;
  @ApiProperty({ type: Number, nullable: true }) receiptId: number | null;
  @ApiProperty({ type: String, nullable: true }) receiptNumber: string | null;
  @ApiProperty({ type: [BasePriceEventDto] }) history: BasePriceEventDto[];
}

export class ManualBasePriceInputDto {
  @ApiProperty({ type: String, nullable: true })
  @ValidateIf((_, v) => v !== null)
  @Matches(/^[1-9]\d{0,11}$/)
  expectedPrice: string | null;
  @ApiProperty({ type: Number, nullable: true })
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(1)
  expectedEventId: number | null;
  @ApiProperty() @Matches(/^[1-9]\d{0,11}$/) price: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(500) reason: string;
}
