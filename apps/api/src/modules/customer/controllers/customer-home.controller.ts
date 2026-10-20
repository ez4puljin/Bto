import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { parseHomeSectionKey } from '@tugeel/shared/sales';
import { AppError } from '../../../common/errors/app-error';
import {
  type AuthContext,
  type CustomerContext,
  CurrentCustomer,
  CurrentUser,
  CustomerRoute,
  Idempotent,
  RequirePermission,
} from '../../identity';
import {
  CustomerAppCategoryPageDto,
  CustomerAppHomeDto,
  CustomerAppSectionPageDto,
} from '../dto/customer-app.dto';
import {
  BannerDto,
  BannerListDto,
  BannerListQueryDto,
  CreateBannerDto,
  CustomerAppSectionQueryDto,
  MoveBannerDto,
} from '../dto/customer-home.dto';
import { AppBannersService, type BannerView } from '../services/app-banners.service';
import { CustomerHomeService, type HomeSection } from '../services/customer-home.service';
import { productDto } from './mappers';

/** The right that manages «Bto300»'s home (ADR-0092 #9). */
const HOME = 'customer_app.home.manage';

const sectionDto = (section: HomeSection) => ({
  key: section.key,
  kind: section.kind,
  title: section.title,
  subtitle: section.subtitle,
  lastDay: section.lastDay,
  total: section.total,
  products: section.products.map(productDto),
});

/**
 * «Bto300»'s home as a shop window (ADR-0092, ADR-0093): every route is @CustomerRoute() and reads
 * the token's own store only (its ♡ and its orders); no route takes a customer id from the client.
 */
@ApiTags('customer-app')
@Controller('customer-app')
export class CustomerAppHomeController {
  constructor(private readonly home: CustomerHomeService) {}

  /** «Нүүр»: running banners, the category grid and the sections in their fixed order. */
  @Get('home')
  @CustomerRoute()
  @ApiOkResponse({ type: CustomerAppHomeDto })
  async homePage(@CurrentCustomer() ctx: CustomerContext): Promise<CustomerAppHomeDto> {
    const home = await this.home.home(ctx);
    return {
      today: home.today,
      banners: home.banners,
      categories: home.categories,
      sections: home.sections.map(sectionDto),
    };
  }

  /** A section's full list (`recent`, `promotions`, `segment-<id>`, …), with sorts and filters. */
  @Get('sections/:key/products')
  @CustomerRoute()
  @ApiOkResponse({ type: CustomerAppSectionPageDto })
  async section(
    @CurrentCustomer() ctx: CustomerContext,
    @Param('key') key: string,
    @Query() query: CustomerAppSectionQueryDto,
  ): Promise<CustomerAppSectionPageDto> {
    const parsed = parseHomeSectionKey(key.slice(0, 40));
    if (!parsed) throw new AppError('NOT_FOUND', 'no such section', { key: key.slice(0, 40) });
    const page = await this.home.sectionPage(ctx, parsed, query);
    return { ...page, data: page.data.map(productDto) };
  }

  /** A category's page: its banners, subcategories, new products and deals of its subtree. */
  @Get('categories/:id/page')
  @CustomerRoute()
  @ApiOkResponse({ type: CustomerAppCategoryPageDto })
  async categoryPage(
    @CurrentCustomer() ctx: CustomerContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<CustomerAppCategoryPageDto> {
    const page = await this.home.categoryPage(ctx, id);
    return { ...page, sections: page.sections.map(sectionDto) };
  }
}

const bannerDto = (banner: BannerView): BannerDto => ({
  ...banner,
  createdAt: banner.createdAt.toISOString(),
});

/**
 * «Систем» → «Харилцагчийн апп» → «Баннер» (ADR-0092 #5): the admins' banners. Added, moved and
 * archived; never edited or deleted.
 */
@ApiTags('customer')
@Controller('customer/banners')
export class CustomerBannersController {
  constructor(private readonly banners: AppBannersService) {}

  @Get()
  @RequirePermission(HOME)
  @ApiOkResponse({ type: BannerListDto })
  async list(@Query() query: BannerListQueryDto): Promise<BannerListDto> {
    return {
      data: (await this.banners.list({ archived: query.archived === true })).map(bannerDto),
      nextCursor: null,
    };
  }

  @Post()
  @RequirePermission(HOME)
  @Idempotent()
  @ApiCreatedResponse({ type: BannerDto })
  async create(@CurrentUser() ctx: AuthContext, @Body() body: CreateBannerDto): Promise<BannerDto> {
    return bannerDto(await this.banners.create(ctx, body));
  }

  /** One place up or down among the live banners. */
  @Post(':id/move')
  @RequirePermission(HOME)
  @HttpCode(200)
  @ApiOkResponse({ type: BannerDto })
  async move(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: MoveBannerDto,
  ): Promise<BannerDto> {
    return bannerDto(await this.banners.move(ctx, id, body.direction));
  }

  /** The app stops showing it at once. */
  @Post(':id/archive')
  @RequirePermission(HOME)
  @HttpCode(204)
  @ApiNoContentResponse()
  async archive(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    await this.banners.archive(ctx, id);
  }
}
