import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { HOME_SECTION_KINDS, type HomeSectionKind } from '@tugeel/shared/sales';
import { SalesRepProductDto } from '../../sales';
import { CustomerAppCategoryHeaderDto } from './customer-app.dto';
import {
  CustomerAppBannerDto,
  CustomerAppHomeCategoryDto,
  CustomerAppHomeSectionDto,
} from './customer-home.dto';

// The rep app's home as «Bto300»'s shop window (the owner, 2026-10-23): the same banners, category
// tiles and sections as the customer home, without the store's RECENT and FAVOURITES, and with the
// rep app's own product card (numeric stock, prices, the deal badge).

@ApiSchema({ name: 'SalesRepHomeSection' })
export class SalesRepHomeSectionDto extends CustomerAppHomeSectionDto {
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
  @ApiProperty({ enum: HOME_SECTION_KINDS }) kind: HomeSectionKind;
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
