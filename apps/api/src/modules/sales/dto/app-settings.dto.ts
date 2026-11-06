import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { APP_SETTINGS_LIMITS, STAFF_ASSORTMENT_LIMITS } from '@tugeel/shared/sales';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsNotEmpty,
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

/** A setting of which products the staff app shows whom (ADR-0164), whole on every save. */
@ApiSchema({ name: 'StaffAppAssortmentRequest' })
export class StaffAppAssortmentRequestDto {
  @ApiProperty({ maxLength: STAFF_ASSORTMENT_LIMITS.maxTitle })
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(STAFF_ASSORTMENT_LIMITS.maxTitle)
  title: string;

  @ApiProperty({ type: [Number], description: 'Live product segments, at least one' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(STAFF_ASSORTMENT_LIMITS.maxSegments)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  segmentIds: number[];

  @ApiProperty({ type: [Number], description: 'Staff members, at least one' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(STAFF_ASSORTMENT_LIMITS.maxUsers)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  userIds: number[];
}

@ApiSchema({ name: 'StaffAppAssortmentSegment' })
export class StaffAppAssortmentSegmentDto {
  @ApiProperty() id: number;
  @ApiProperty() name: string;
}

@ApiSchema({ name: 'StaffAppAssortmentUser' })
export class StaffAppAssortmentUserDto {
  @ApiProperty() id: number;
  @ApiProperty() fullName: string;
  @ApiProperty({ description: 'False for a disabled account' }) active: boolean;
}

@ApiSchema({ name: 'StaffAppAssortment' })
export class StaffAppAssortmentDto {
  @ApiProperty() id: number;
  @ApiProperty() title: string;
  @ApiProperty({ type: [StaffAppAssortmentSegmentDto], description: 'The live segments it names' })
  segments: StaffAppAssortmentSegmentDto[];
  @ApiProperty({ description: 'Segments archived since: they narrow nothing, a save drops them' })
  goneSegmentCount: number;
  @ApiProperty({ type: [StaffAppAssortmentUserDto] }) users: StaffAppAssortmentUserDto[];
  @ApiProperty({ format: 'date-time' }) updatedAt: string;
}

@ApiSchema({ name: 'StaffAppAssortmentList' })
export class StaffAppAssortmentListDto {
  @ApiProperty({ type: [StaffAppAssortmentDto] }) data: StaffAppAssortmentDto[];
  @ApiProperty({ type: String, nullable: true, description: 'Always null: the whole list' })
  nextCursor: null;
}

/** What the apps read before a sign-in (ADR-0127 #4): the name and colour the office set. */
@ApiSchema({ name: 'AppBranding' })
export class AppBrandingDto {
  @ApiProperty({ type: String, nullable: true }) appName: string | null;
  @ApiProperty({ type: String, nullable: true }) appColor: string | null;
}
