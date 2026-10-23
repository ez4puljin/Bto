import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { parseHomeSectionKey } from '@tugeel/shared/sales';
import { AppError } from '../../../common/errors/app-error';
import { RequirePermission } from '../../identity';
import { type RepShopProduct, toRepProductDto } from '../../sales';
import { CustomerAppSectionQueryDto } from '../dto/customer-home.dto';
import {
  SalesRepCategoryPageDto,
  SalesRepHomeDto,
  SalesRepHomeSectionDto,
  SalesRepSectionPageDto,
} from '../dto/sales-rep-home.dto';
import { CustomerHomeService, type HomeSection } from '../services/customer-home.service';

/** The rep app's right (sales' REP, not exported from sales; packages/shared/src/auth). */
const REP = 'sales.orders.rep';

const sectionDto = (section: HomeSection<RepShopProduct>): SalesRepHomeSectionDto => ({
  key: section.key,
  kind: section.kind,
  title: section.title,
  subtitle: section.subtitle,
  lastDay: section.lastDay,
  total: section.total,
  products: section.products.map(toRepProductDto),
});

/**
 * The rep app's home as «Bto300»'s shop window (the owner, 2026-10-23): the customer home's
 * banners, category tiles and sections over the same universe, with the rep's product card. Staff
 * routes under `sales-rep` that need `sales.orders.rep`; this module owns the window, so they live
 * here (sales cannot import customer). No store's RECENT or FAVOURITES: their keys answer 404.
 */
@ApiTags('sales-rep')
@Controller('sales-rep')
export class SalesRepHomeController {
  constructor(private readonly home: CustomerHomeService) {}

  /** «Нүүр»: running banners, the category grid and PROMOTIONS, segments, DISCOUNTS, NEW. */
  @Get('home')
  @RequirePermission(REP)
  @ApiOkResponse({ type: SalesRepHomeDto })
  async homePage(): Promise<SalesRepHomeDto> {
    const home = await this.home.repHome();
    return {
      today: home.today,
      banners: home.banners,
      categories: home.categories,
      sections: home.sections.map(sectionDto),
    };
  }

  /** A section's full list (`promotions`, `segment-<id>`, `discounts`, `new`, `deals`). */
  @Get('sections/:key/products')
  @RequirePermission(REP)
  @ApiOkResponse({ type: SalesRepSectionPageDto })
  async section(
    @Param('key') key: string,
    @Query() query: CustomerAppSectionQueryDto,
  ): Promise<SalesRepSectionPageDto> {
    const parsed = parseHomeSectionKey(key.slice(0, 40));
    if (!parsed) throw new AppError('NOT_FOUND', 'no such section', { key: key.slice(0, 40) });
    const page = await this.home.repSectionPage(parsed, query);
    return { ...page, data: page.data.map(toRepProductDto) };
  }

  /** A category's page: its banners, subcategories, new products and deals of its subtree. */
  @Get('categories/:id/page')
  @RequirePermission(REP)
  @ApiOkResponse({ type: SalesRepCategoryPageDto })
  async categoryPage(@Param('id', ParseIntPipe) id: number): Promise<SalesRepCategoryPageDto> {
    const page = await this.home.repCategoryPage(id);
    return { ...page, sections: page.sections.map(sectionDto) };
  }
}
