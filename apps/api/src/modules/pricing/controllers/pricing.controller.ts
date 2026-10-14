import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
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
  CurrentPriceDto,
  CurrentPricesQueryDto,
  DiscountProgramDto,
  DiscountProgramInputDto,
  DiscountProgramPageDto,
  DiscountProgramQueryDto,
  PricingAttentionDto,
  ProductPricesDto,
  ProductPricesQueryDto,
  QuoteDto,
  QuoteRequestDto,
  SaleReadyRequestDto,
  SaleReadyResultDto,
  SetPricesDto,
} from '../dto/pricing.dto';
import { DiscountProgramsService } from '../services/discount-programs.service';
import { PriceQuoteService } from '../services/price-quote.service';
import { SaleReadinessService } from '../services/sale-readiness.service';
import { UnitPricesService } from '../services/unit-prices.service';
import { toProductPricesDto, toProgramDto, toProgramInput, toQuoteDto } from './mappers';

const MANAGE = 'pricing.manage';
/** The price clerk (ADR-0044): unit prices and completing registered products. */
const PRICES = 'pricing.prices.manage';

/** Unit prices (ADR-0041 #1): every signed-in user reads them; pricing.prices.manage sets them. */
@ApiTags('pricing')
@Controller('unit-prices')
export class UnitPricesController {
  constructor(private readonly prices: UnitPricesService) {}

  @Get()
  @Authenticated()
  @ApiOkResponse({ type: ProductPricesDto })
  async view(@Query() query: ProductPricesQueryDto): Promise<ProductPricesDto> {
    return toProductPricesDto(await this.prices.view(query.productId));
  }

  /** Base unit prices of many products, for list columns (ADR-0037). */
  @Get('current')
  @Authenticated()
  @ApiOkResponse({ type: [CurrentPriceDto] })
  async current(@Query() query: CurrentPricesQueryDto): Promise<CurrentPriceDto[]> {
    return (await this.prices.currentOf(query.productIds)).map((row) => ({
      productId: row.productId,
      list: row.list,
      productUnitId: row.productUnitId,
      price: row.price.toFixed(0),
    }));
  }

  /** Idempotent: a retried change must not close the price it just inserted. */
  @Post()
  @RequirePermission(PRICES)
  @Idempotent()
  @HttpCode(200)
  @ApiOkResponse({ type: ProductPricesDto })
  async set(
    @CurrentUser() ctx: AuthContext,
    @Body() body: SetPricesDto,
  ): Promise<ProductPricesDto> {
    const prices = await this.prices.set(ctx, {
      productId: body.productId,
      validFrom: body.validFrom,
      entries: body.entries.map((entry) => ({
        list: entry.list,
        productUnitId: entry.productUnitId,
        price: entry.price === null ? null : new Decimal(entry.price),
      })),
    });
    return toProductPricesDto(prices);
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

/** Quotes (ADR-0041 #3): prices a cart as an order would be priced, for every signed-in user. */
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

  /** Completes registered products whose base unit has both prices today (ADR-0044 #3). */
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
