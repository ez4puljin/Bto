import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { APP_SETTINGS_LIMITS } from '@tugeel/shared/sales';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** Whole MNT or two decimals, as the partners' credit limit. */
const MONEY = /^\d{1,12}(\.\d{1,2})?$/;

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

@ApiSchema({ name: 'AppHomeSections' })
export class AppHomeSectionsDto {
  @ApiProperty({ description: '«Урамшуулал»' }) @IsBoolean() PROMOTIONS: boolean;
  @ApiProperty({ description: '«Хямдралтай бараа»' }) @IsBoolean() DISCOUNTS: boolean;
  @ApiProperty({ description: '«Шинээр нэмэгдсэн бараа»' }) @IsBoolean() NEW: boolean;
}

@ApiSchema({ name: 'AppAssortment' })
export class AppAssortmentDto {
  @ApiProperty({ type: Number, nullable: true, description: 'The live segment the apps sell from' })
  segmentId: number | null;
  @ApiProperty({ type: String, nullable: true }) segmentName: string | null;
  @ApiProperty({
    description: 'The setting names a segment that is archived or gone: every product shows',
  })
  broken: boolean;
}

@ApiSchema({ name: 'AppSettings' })
export class AppSettingsDto {
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'The PRODUCT segment both apps show; null = every sale-ready product',
  })
  assortmentSegmentId: number | null;
  @ApiProperty({ type: AppAssortmentDto }) assortment: AppAssortmentDto;
  @ApiProperty({ description: 'How many products the customer app lists now' })
  shopProductCount: number;
  @ApiProperty({ type: AppHomeSectionsDto }) homeSections: AppHomeSectionsDto;
  @ApiProperty({ type: String, nullable: true, description: 'Whole MNT; null = no minimum' })
  minOrderAmount: string | null;
  @ApiProperty({ type: String, nullable: true }) appName: string | null;
  @ApiProperty({ type: String, nullable: true, description: '#RRGGBB' }) appColor: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) updatedAt: string | null;
}

@ApiSchema({ name: 'AppSettingsRequest' })
export class AppSettingsRequestDto {
  @ApiProperty({ type: Number, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  assortmentSegmentId: number | null;
  @ApiProperty({ type: AppHomeSectionsDto })
  @ValidateNested()
  @Type(() => AppHomeSectionsDto)
  homeSections: AppHomeSectionsDto;
  @ApiProperty({ type: String, nullable: true, description: 'Whole MNT; null = no minimum' })
  @IsOptional()
  @IsString()
  @Matches(MONEY)
  minOrderAmount: string | null;
  @ApiProperty({ type: String, nullable: true })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(APP_SETTINGS_LIMITS.maxAppName)
  appName: string | null;
  @ApiProperty({ type: String, nullable: true, description: '#RRGGBB' })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @Matches(APP_SETTINGS_LIMITS.colorPattern)
  appColor: string | null;
}

/** What the apps read before a sign-in (ADR-0127 #4): the name and colour the office set. */
@ApiSchema({ name: 'AppBranding' })
export class AppBrandingDto {
  @ApiProperty({ type: String, nullable: true }) appName: string | null;
  @ApiProperty({ type: String, nullable: true }) appColor: string | null;
}
