import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import { DEAL_KINDS, DISCOUNT_EFFECTS, DISCOUNT_SCOPES } from '@tugeel/shared/pricing';
import {
  BANNER_LINK_KINDS,
  BANNER_STATES,
  BANNER_TITLE_MAX,
  type BannerLinkKind,
  type BannerState,
  HOME_SECTION_KINDS,
  HOME_SECTION_SORTS,
  type HomeSectionKind,
  type HomeSectionSort,
} from '@tugeel/shared/sales';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { MAX_PAGE_LIMIT, PageQueryDto, queryIds } from '../../../common/pagination/page';

// «Bto300»'s home as a shop window (ADR-0092, ADR-0093): the deal badge on every card, the home,
// a section's full list, a category's page, and the admins' banners.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const queryBoolean = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value;

@ApiSchema({ name: 'CustomerAppDealThreshold' })
export class CustomerAppDealThresholdDto {
  @ApiProperty({ type: String, nullable: true, description: 'A quantity in `unitName`' })
  qty: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'The unit the quantity is in' })
  unitName: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'An amount in MNT (the order’s or a category’s)',
  })
  amount: string | null;
}

@ApiSchema({ name: 'CustomerAppDeal' })
export class CustomerAppDealDto {
  @ApiProperty({
    enum: DEAL_KINDS,
    description: 'PROMOTION: with an end date (orange); DISCOUNT (red)',
  })
  kind: (typeof DEAL_KINDS)[number];
  @ApiProperty({ description: 'The badge: «10+ ш −5%», «−200₮», «−10% · 10/31»' }) label: string;
  @ApiProperty() programId: number;
  @ApiProperty() programName: string;
  @ApiProperty({ enum: DISCOUNT_SCOPES }) scope: (typeof DISCOUNT_SCOPES)[number];
  @ApiProperty({ enum: DISCOUNT_EFFECTS }) effect: (typeof DISCOUNT_EFFECTS)[number];
  @ApiProperty({ description: 'The first step: a percentage, tugriks off, or a new unit price' })
  value: string;
  @ApiProperty({
    type: CustomerAppDealThresholdDto,
    nullable: true,
    description: 'The first step’s condition; null when it always applies',
  })
  threshold: CustomerAppDealThresholdDto | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'A pack unit the price or amount is for',
  })
  perUnitName: string | null;
  @ApiProperty({
    type: String,
    format: 'date',
    nullable: true,
    description: 'A promotion’s last day',
  })
  lastDay: string | null;
}

// ------------------------------------------------------------------------------------- the home

@ApiSchema({ name: 'CustomerAppBannerLink' })
export class CustomerAppBannerLinkDto {
  @ApiProperty({ enum: ['SEGMENT', 'CATEGORY', 'PRODUCT'] }) kind: Exclude<BannerLinkKind, 'NONE'>;
  @ApiProperty({ description: 'A segment (its section `segment-<id>`), a category or a product' })
  id: number;
}

@ApiSchema({ name: 'CustomerAppBanner' })
export class CustomerAppBannerDto {
  @ApiProperty() id: number;
  @ApiProperty({ description: 'Its alt text' }) title: string;
  @ApiProperty({ type: String, nullable: true, description: '2:1 picture' }) imageUrl:
    string | null;
  @ApiProperty({
    type: CustomerAppBannerLinkDto,
    nullable: true,
    description: 'What a tap opens; null without a link or when the target is gone',
  })
  link: CustomerAppBannerLinkDto | null;
}

@ApiSchema({ name: 'CustomerAppHomeCategory' })
export class CustomerAppHomeCategoryDto {
  @ApiProperty() id: number;
  @ApiProperty() name: string;
  @ApiProperty({ type: String, nullable: true, description: 'Its picture, else a product’s' })
  imageUrl: string | null;
  @ApiProperty({ description: 'Products «Бараа» sells in it, subcategories included' })
  productCount: number;
}

@ApiSchema({ name: 'CustomerAppHomeSection' })
export class CustomerAppHomeSectionDto {
  @ApiProperty({ description: '`recent`, `promotions`, `segment-<id>`, … — its full list’s key' })
  key: string;
  @ApiProperty({ enum: HOME_SECTION_KINDS }) kind: HomeSectionKind;
  @ApiProperty({ type: String, nullable: true, description: 'A segment’s name' })
  title: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'A segment’s description' })
  subtitle: string | null;
  @ApiProperty({
    type: String,
    format: 'date',
    nullable: true,
    description: '«Урамшуулал»: the earliest last day of its promotions',
  })
  lastDay: string | null;
  @ApiProperty({ description: 'How many products the full list holds' }) total: number;
}

@ApiSchema({ name: 'CustomerAppSectionQuery' })
export class CustomerAppSectionQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: HOME_SECTION_SORTS, description: 'DEFAULT when left out' })
  @IsOptional()
  @IsIn(HOME_SECTION_SORTS)
  sort?: HomeSectionSort;

  @ApiPropertyOptional({ type: [Number], description: 'Each with its subcategories (repeated)' })
  @IsOptional()
  @Transform(queryIds)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_PAGE_LIMIT)
  @IsInt({ each: true })
  @Min(1, { each: true })
  categoryIds?: number[];

  @ApiPropertyOptional({ description: '«Зөвхөн байгаа бараа»' })
  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean()
  inStock?: boolean;
}

// ------------------------------------------------------------------------- the admins' banners

@ApiSchema({ name: 'Banner' })
export class BannerDto {
  @ApiProperty() id: number;
  @ApiProperty() title: string;
  @ApiProperty({ type: String, nullable: true }) imageUrl: string | null;
  @ApiProperty({ enum: BANNER_LINK_KINDS }) linkKind: BannerLinkKind;
  @ApiProperty({ type: Number, nullable: true }) linkId: number | null;
  @ApiProperty({ type: String, nullable: true, description: 'The target’s name' })
  linkName: string | null;
  @ApiProperty({ description: 'The target is gone: the app shows the banner without its link' })
  linkBroken: boolean;
  @ApiProperty({ format: 'date' }) validFrom: string;
  @ApiProperty({ type: String, format: 'date', nullable: true, description: 'Exclusive' })
  validTo: string | null;
  @ApiProperty() position: number;
  @ApiProperty({ enum: BANNER_STATES }) state: BannerState;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: string;
}

@ApiSchema({ name: 'BannerList' })
export class BannerListDto {
  @ApiProperty({ type: [BannerDto] }) data: BannerDto[];
  @ApiProperty({ type: String, nullable: true, description: 'Always null: every banner' })
  nextCursor: null;
}

@ApiSchema({ name: 'BannerListQuery' })
export class BannerListQueryDto {
  @ApiPropertyOptional({ description: 'The archived banners instead of the live ones' })
  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean()
  archived?: boolean;
}

@ApiSchema({ name: 'BannerCreateRequest' })
export class CreateBannerDto {
  @ApiProperty({ description: 'An uploaded file of kind customer.banner_image' })
  @IsInt()
  @Min(1)
  imageFileId: number;

  @ApiProperty({ maxLength: BANNER_TITLE_MAX })
  @IsString()
  @MaxLength(BANNER_TITLE_MAX)
  title: string;

  @ApiProperty({ enum: BANNER_LINK_KINDS })
  @IsIn(BANNER_LINK_KINDS)
  linkKind: BannerLinkKind;

  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  linkId?: number | null;

  @ApiProperty({ format: 'date', description: 'Today or later' })
  @Matches(ISO_DATE)
  validFrom: string;

  @ApiPropertyOptional({
    type: String,
    format: 'date',
    nullable: true,
    description: 'Exclusive: the day after the last one',
  })
  @IsOptional()
  @Matches(ISO_DATE)
  validTo?: string | null;
}

export const BANNER_MOVES = ['UP', 'DOWN'] as const;

@ApiSchema({ name: 'BannerMoveRequest' })
export class MoveBannerDto {
  @ApiProperty({ enum: BANNER_MOVES })
  @IsIn(BANNER_MOVES)
  direction: (typeof BANNER_MOVES)[number];
}
