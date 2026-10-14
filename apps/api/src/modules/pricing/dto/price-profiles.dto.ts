import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import {
  MAX_PRICE_PROFILE_NAME,
  PRICE_ROUNDINGS,
  type PriceRounding,
} from '@tugeel/shared/pricing';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { PageQueryDto } from '../../../common/pagination/page';

const PERCENT = /^\d{1,3}(\.\d{1,2})?$/;
const QTY = /^\d{1,11}(\.\d{1,3})?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const queryBoolean = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value;

/** A profile's values as typed (ADR-0048 #1); the shared rules check them together. */
@ApiSchema({ name: 'PriceProfileValuesRequest' })
export class PriceProfileValuesInputDto {
  @ApiProperty({ example: '15', description: 'Loose pieces: % added to the warehouse price' })
  @Matches(PERCENT)
  looseMarkupPct: string;
  @ApiProperty({ example: '30', description: 'Supermarket: % added to the warehouse price' })
  @Matches(PERCENT)
  retailMarkupPct: string;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: '24',
    description: 'Supermarket bulk price from this many base units of a product in the cart',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Matches(QTY)
  retailBulkMinQty?: string | null;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: '20',
    description: 'Supermarket bulk: % added to the warehouse price; below the supermarket %',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Matches(PERCENT)
  retailBulkMarkupPct?: string | null;
  @ApiProperty({ enum: PRICE_ROUNDINGS }) @IsIn(PRICE_ROUNDINGS) rounding: PriceRounding;
}

@ApiSchema({ name: 'PriceProfileRequest' })
export class CreatePriceProfileDto extends PriceProfileValuesInputDto {
  @ApiProperty({ maxLength: MAX_PRICE_PROFILE_NAME })
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_PRICE_PROFILE_NAME)
  name: string;
  @ApiProperty({ example: '2026-10-14', description: 'The first values start this day' })
  @Matches(ISO_DATE)
  validFrom: string;
}

@ApiSchema({ name: 'PriceProfileVersionRequest' })
export class PriceProfileVersionInputDto extends PriceProfileValuesInputDto {
  @ApiProperty({ example: '2026-10-15', description: 'Today or later (Ulaanbaatar)' })
  @Matches(ISO_DATE)
  validFrom: string;
}

@ApiSchema({ name: 'RenamePriceProfileRequest' })
export class RenamePriceProfileDto {
  @ApiProperty({ maxLength: MAX_PRICE_PROFILE_NAME })
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_PRICE_PROFILE_NAME)
  name: string;
}

@ApiSchema({ name: 'PriceProfileValues' })
export class PriceProfileValuesDto {
  @ApiProperty({ example: '15.00' }) looseMarkupPct: string;
  @ApiProperty({ example: '30.00' }) retailMarkupPct: string;
  @ApiProperty({ type: String, nullable: true, example: '24' }) retailBulkMinQty: string | null;
  @ApiProperty({ type: String, nullable: true, example: '20.00' })
  retailBulkMarkupPct: string | null;
  @ApiProperty({ enum: PRICE_ROUNDINGS }) rounding: PriceRounding;
}

@ApiSchema({ name: 'PriceProfileVersion' })
export class PriceProfileVersionDto extends PriceProfileValuesDto {
  @ApiProperty() id: number;
  @ApiProperty({ example: '2026-10-14' }) validFrom: string;
  @ApiProperty({ type: String, nullable: true, description: 'Up to, not including' })
  validTo: string | null;
}

@ApiSchema({ name: 'PriceProfile' })
export class PriceProfileDto {
  @ApiProperty() id: number;
  @ApiProperty() name: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) archivedAt: string | null;
  @ApiProperty({
    type: PriceProfileVersionDto,
    nullable: true,
    description: 'In force today; null when the first values start later',
  })
  current: PriceProfileVersionDto | null;
  @ApiProperty({
    type: [PriceProfileVersionDto],
    description: 'Starting after today, earliest first',
  })
  scheduled: PriceProfileVersionDto[];
  @ApiProperty({ type: [PriceProfileVersionDto], description: 'Ended, latest first' })
  history: PriceProfileVersionDto[];
  @ApiProperty({ description: 'Products whose price terms in force today use the profile' })
  productsToday: number;
  @ApiProperty() createdAt: string;
  @ApiProperty() updatedAt: string;
}

@ApiSchema({ name: 'PriceProfilePage' })
export class PriceProfilePageDto {
  @ApiProperty({ type: [PriceProfileDto] }) data: PriceProfileDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
}

export class PriceProfileQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ type: Boolean, description: 'true: archived profiles; default live ones' })
  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean()
  archived?: boolean;
}
