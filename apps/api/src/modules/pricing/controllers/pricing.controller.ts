import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Decimal } from '@tugeel/shared/money';
import { businessDate, isIsoDate } from '@tugeel/shared/time';
import { ATTENTION_CAP } from '../../../common/attention';
import { invalid } from '../../../common/errors/app-error';
import {
  type AuthContext,
  Authenticated,
  CurrentUser,
  Idempotent,
  RequirePermission,
} from '../../identity';
import {
  CreatePriceProfileDto,
  PriceProfileDto,
  PriceProfilePageDto,
  PriceProfileQueryDto,
  PriceProfileVersionInputDto,
  RenamePriceProfileDto,
} from '../dto/price-profiles.dto';
import {
  DiscountProgramDto,
  DiscountProgramInputDto,
  DiscountProgramPageDto,
  DiscountProgramQueryDto,
  PricingAttentionDto,
  QuoteDto,
  QuoteRequestDto,
  SaleReadyRequestDto,
  SaleReadyResultDto,
} from '../dto/pricing.dto';
import {
  CurrentPricesQueryDto,
  CurrentTermsDto,
  ProductPricesQueryDto,
  BulkProfileDto,
  BulkProfileResultDto,
  ProductPriceViewDto,
  SetPriceTermsDto,
} from '../dto/product-prices.dto';
import { DiscountProgramsService } from '../services/discount-programs.service';
import { PriceProfilesService } from '../services/price-profiles.service';
import { PriceQuoteService } from '../services/price-quote.service';
import { ProductPricesService } from '../services/product-prices.service';
import { SaleReadinessService } from '../services/sale-readiness.service';
import {
  toPriceProfileDto,
  toProductPriceViewDto,
  toProgramDto,
  toProgramInput,
  toQuoteDto,
  toValuesInput,
} from './mappers';

const MANAGE = 'pricing.manage';
/** The price clerk (ADR-0044, ADR-0048): price terms and completing registered products. */
const PRICES = 'pricing.prices.manage';

/**
 * A product's price terms (ADR-0048 #2): every signed-in user reads them; the price clerk
 * (pricing.prices.manage) sets the warehouse price, the profile and the whole unit.
 */
@ApiTags('pricing')
@Controller('product-prices')
export class ProductPricesController {
  constructor(private readonly prices: ProductPricesService) {}

  @Get()
  @Authenticated()
  @ApiOkResponse({ type: ProductPriceViewDto })
  async view(@Query() query: ProductPricesQueryDto): Promise<ProductPriceViewDto> {
    return toProductPriceViewDto(await this.prices.view(query.productId));
  }

  /** Today's terms of many products, for list columns (ADR-0037). */
  @Get('current')
  @Authenticated()
  @ApiOkResponse({ type: [CurrentTermsDto] })
  async current(@Query() query: CurrentPricesQueryDto): Promise<CurrentTermsDto[]> {
    return (await this.prices.currentOf(query.productIds)).map((row) => ({
      productId: row.productId,
      warehousePrice: row.warehousePrice.toFixed(0),
      profileId: row.profileId,
      profileName: row.profileName,
      wholeUomId: row.wholeUomId,
    }));
  }

  /** Changes the price profile of ticked products from a day on (ADR-0051 #1). */
  @Post('bulk/profile')
  @RequirePermission(PRICES)
  @Idempotent()
  @HttpCode(200)
  @ApiOkResponse({ type: BulkProfileResultDto })
  bulkProfile(
    @CurrentUser() ctx: AuthContext,
    @Body() body: BulkProfileDto,
  ): Promise<BulkProfileResultDto> {
    return this.prices.setProfileMany(ctx, body);
  }

  /** Idempotent: a retried change must not close the terms it just inserted. */
  @Post()
  @RequirePermission(PRICES)
  @Idempotent()
  @HttpCode(200)
  @ApiOkResponse({ type: ProductPriceViewDto })
  async set(
    @CurrentUser() ctx: AuthContext,
    @Body() body: SetPriceTermsDto,
  ): Promise<ProductPriceViewDto> {
    const view = await this.prices.set(ctx, {
      productId: body.productId,
      validFrom: body.validFrom,
      warehousePrice: new Decimal(body.warehousePrice),
      profileId: body.profileId,
      wholeUomId: body.wholeUomId ?? null,
    });
    return toProductPriceViewDto(view);
  }
}

/**
 * Price profiles (ADR-0048 #1): every signed-in user reads them (the price dialog chooses one);
 * pricing.manage creates, changes, renames and archives them.
 */
@ApiTags('pricing')
@Controller('price-profiles')
export class PriceProfilesController {
  constructor(private readonly profiles: PriceProfilesService) {}

  @Get()
  @Authenticated()
  @ApiOkResponse({ type: PriceProfilePageDto })
  async list(@Query() query: PriceProfileQueryDto): Promise<PriceProfilePageDto> {
    const page = await this.profiles.list(query);
    return { data: page.data.map(toPriceProfileDto), nextCursor: page.nextCursor };
  }

  @Get(':id')
  @Authenticated()
  @ApiOkResponse({ type: PriceProfileDto })
  async get(@Param('id', ParseIntPipe) id: number): Promise<PriceProfileDto> {
    return toPriceProfileDto(await this.profiles.get(id));
  }

  @Post()
  @RequirePermission(MANAGE)
  @Idempotent()
  @ApiCreatedResponse({ type: PriceProfileDto })
  async create(
    @CurrentUser() ctx: AuthContext,
    @Body() body: CreatePriceProfileDto,
  ): Promise<PriceProfileDto> {
    const profile = await this.profiles.create(ctx, {
      name: body.name,
      validFrom: body.validFrom,
      values: toValuesInput(body),
    });
    return toPriceProfileDto(profile);
  }

  /** New values from a day on (today or later); idempotent like every dated change. */
  @Post(':id/versions')
  @RequirePermission(MANAGE)
  @Idempotent()
  @HttpCode(200)
  @ApiOkResponse({ type: PriceProfileDto })
  async setVersion(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: PriceProfileVersionInputDto,
  ): Promise<PriceProfileDto> {
    const profile = await this.profiles.setVersion(ctx, id, {
      validFrom: body.validFrom,
      values: toValuesInput(body),
    });
    return toPriceProfileDto(profile);
  }

  @Patch(':id')
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: PriceProfileDto })
  async rename(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: RenamePriceProfileDto,
  ): Promise<PriceProfileDto> {
    return toPriceProfileDto(await this.profiles.rename(ctx, id, body.name));
  }

  /** Refused while products use the profile today or later (PRICE_PROFILE_IN_USE). */
  @Post(':id/archive')
  @RequirePermission(MANAGE)
  @HttpCode(200)
  @ApiOkResponse({ type: PriceProfileDto })
  async archive(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<PriceProfileDto> {
    return toPriceProfileDto(await this.profiles.archive(ctx, id));
  }
}

/** Discount programs (ADR-0041 #2): every signed-in user reads them; pricing.manage edits them. */
@ApiTags('pricing')
@Controller('discount-programs')
export class DiscountProgramsController {
  constructor(private readonly programs: DiscountProgramsService) {}

  @Get()
  @Authenticated()
  @ApiOkResponse({ type: DiscountProgramPageDto })
  async list(@Query() query: DiscountProgramQueryDto): Promise<DiscountProgramPageDto> {
    const page = await this.programs.list(query);
    return { data: page.data.map(toProgramDto), nextCursor: page.nextCursor };
  }

  @Get(':id')
  @Authenticated()
  @ApiOkResponse({ type: DiscountProgramDto })
  async get(@Param('id', ParseIntPipe) id: number): Promise<DiscountProgramDto> {
    return toProgramDto(await this.programs.get(id));
  }

  @Post()
  @RequirePermission(MANAGE)
  @Idempotent()
  @ApiCreatedResponse({ type: DiscountProgramDto })
  async create(
    @CurrentUser() ctx: AuthContext,
    @Body() body: DiscountProgramInputDto,
  ): Promise<DiscountProgramDto> {
    return toProgramDto(await this.programs.create(ctx, toProgramInput(body)));
  }

  /** Only before the program starts. */
  @Put(':id')
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: DiscountProgramDto })
  async update(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: DiscountProgramInputDto,
  ): Promise<DiscountProgramDto> {
    return toProgramDto(await this.programs.update(ctx, id, toProgramInput(body)));
  }

  @Post(':id/stop')
  @RequirePermission(MANAGE)
  @HttpCode(200)
  @ApiOkResponse({ type: DiscountProgramDto })
  async stop(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<DiscountProgramDto> {
    return toProgramDto(await this.programs.stop(ctx, id));
  }

  /** Only before the program starts. */
  @Delete(':id')
  @RequirePermission(MANAGE)
  @HttpCode(204)
  @ApiNoContentResponse()
  async remove(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    await this.programs.remove(ctx, id);
  }
}

/** Quotes (ADR-0041 #3, ADR-0048 #4): prices a cart as an order would be, for every user. */
@ApiTags('pricing')
@Controller('pricing')
export class PricingController {
  constructor(
    private readonly quotes: PriceQuoteService,
    private readonly saleReadiness: SaleReadinessService,
  ) {}

  /** The home page's tile for the price clerk (ADR-0047 #7). */
  @Get('attention')
  @RequirePermission(PRICES)
  @ApiOkResponse({ type: PricingAttentionDto })
  async attention(): Promise<PricingAttentionDto> {
    return {
      productsWaitingForPrices: await this.saleReadiness.waitingCount(ATTENTION_CAP),
      cap: ATTENTION_CAP,
    };
  }

  /** Completes registered products priced today (ADR-0044 #3, ADR-0048 #5). */
  @Post('sale-ready')
  @RequirePermission(PRICES)
  @Idempotent()
  @HttpCode(200)
  @ApiOkResponse({ type: SaleReadyResultDto })
  async saleReady(
    @CurrentUser() ctx: AuthContext,
    @Body() body: SaleReadyRequestDto,
  ): Promise<SaleReadyResultDto> {
    return this.saleReadiness.complete(ctx, body.productIds);
  }

  @Post('quote')
  @Authenticated()
  @HttpCode(200)
  @ApiOkResponse({ type: QuoteDto })
  async quote(@Body() body: QuoteRequestDto): Promise<QuoteDto> {
    const date = body.date ?? businessDate();
    if (!isIsoDate(date)) throw invalid('date', 'isDate', 'date must be a calendar date');
    const quote = await this.quotes.quote({
      list: body.list ?? 'WHOLESALE',
      date,
      lines: body.lines.map((line) => ({
        productUnitId: line.productUnitId,
        qty: new Decimal(line.qty),
      })),
    });
    return toQuoteDto(quote);
  }
}
