import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import type { HomeSectionKind } from '@tugeel/shared/sales';
import { SalesRepProductDto } from '../../sales';
import { CustomerAppCategoryHeaderDto } from './customer-app.dto';
import { CustomerAppBannerDto, CustomerAppHomeCategoryDto } from './customer-home.dto';

// The rep app's home as «Bto300»'s shop window (the owner, 2026-10-23): the same banners, category
// tiles and sections as the customer home, without the store's RECENT and FAVOURITES, and with the
// rep app's own product card (numeric stock, prices, the deal badge).

/** The sections a rep's window has: never the store's own RECENT and FAVOURITES. */
export const REP_HOME_SECTION_KINDS = [
  'PROMOTIONS',
  'SEGMENT',
  'DISCOUNTS',
  'NEW',
  'DEALS',
] as const satisfies readonly HomeSectionKind[];
export type RepHomeSectionKind = (typeof REP_HOME_SECTION_KINDS)[number];

export function isRepHomeSectionKind(kind: HomeSectionKind): kind is RepHomeSectionKind {
  return (REP_HOME_SECTION_KINDS as readonly string[]).includes(kind);
}

@ApiSchema({ name: 'SalesRepHomeSection' })
export class SalesRepHomeSectionDto {
  @ApiProperty({
    description: '`promotions`, `segment-<id>`, `discounts`, `new`, `deals` — its full list’s key',
  })
  key: string;
  @ApiProperty({ enum: REP_HOME_SECTION_KINDS }) kind: RepHomeSectionKind;
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
  @ApiProperty({ type: [SalesRepProductDto], description: 'At most 10, «Дууссан» last' })
  products: SalesRepProductDto[];
}

@ApiSchema({ name: 'SalesRepHome' })
export class SalesRepHomeDto {
  @ApiProperty({ format: 'date' }) today: string;
  @ApiProperty({ type: [CustomerAppBannerDto], description: 'Running, in their order' })
  banners: CustomerAppBannerDto[];
  @ApiProperty({
    type: [CustomerAppHomeCategoryDto],
    description: '«Ангиллын жагсаалт»: top categories with products, by name',
  })
  categories: CustomerAppHomeCategoryDto[];
  @ApiProperty({
    type: [SalesRepHomeSectionDto],
    description:
      'PROMOTIONS, the shown segments, DISCOUNTS and NEW in that order; an empty one is left out',
  })
  sections: SalesRepHomeSectionDto[];
}

@ApiSchema({ name: 'SalesRepSectionPage' })
export class SalesRepSectionPageDto {
  @ApiProperty() key: string;
  @ApiProperty({ enum: REP_HOME_SECTION_KINDS }) kind: RepHomeSectionKind;
  @ApiProperty({ type: String, nullable: true }) title: string | null;
  @ApiProperty({ type: String, nullable: true }) subtitle: string | null;
  @ApiProperty({ type: String, format: 'date', nullable: true }) lastDay: string | null;
  @ApiProperty({ type: [SalesRepProductDto] }) data: SalesRepProductDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
  @ApiProperty({ type: Number, nullable: true, description: 'On the first page' })
  total: number | null;
}

@ApiSchema({ name: 'SalesRepCategoryPage' })
export class SalesRepCategoryPageDto {
  @ApiProperty({ type: CustomerAppCategoryHeaderDto }) category: CustomerAppCategoryHeaderDto;
  @ApiProperty({ description: '«… бүх бараа · N»: products «Бараа» sells in its subtree' })
  productCount: number;
  @ApiProperty({ type: [CustomerAppBannerDto], description: 'Running banners linked to it' })
  banners: CustomerAppBannerDto[];
  @ApiProperty({
    type: [CustomerAppHomeCategoryDto],
    description: 'Its subcategories with products',
  })
  subcategories: CustomerAppHomeCategoryDto[];
  @ApiProperty({
    type: [SalesRepHomeSectionDto],
    description: '«Шинээр нэмэгдсэн бараа» (new) and «Хямдралтай бараа» (deals) of its subtree',
  })
  sections: SalesRepHomeSectionDto[];
}
