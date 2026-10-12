import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Decimal } from '@tugeel/shared/money';
import {
  type AuthContext,
  Authenticated,
  CurrentUser,
  Idempotent,
  RequirePermission,
} from '../../identity';
import {
  ApproveStocktakeDto,
  CreateStocktakeDto,
  StocktakeBinDto,
  StocktakeBinPreviewDto,
  StocktakeBinPreviewQueryDto,
  StocktakeCountResultDto,
  StocktakeCountsDto,
  StocktakeDetailDto,
  StocktakeLinePageDto,
  StocktakeLinesQueryDto,
  StocktakeListQueryDto,
  StocktakePageDto,
  StocktakeRecountDto,
  StocktakeScanDto,
  StocktakeScanResultDto,
} from '../dto/stocktakes.dto';
import { StocktakesService } from '../services/stocktakes.service';
import {
  type StocktakeView,
  toStocktakeBinDto,
  toStocktakeDetailDto,
  toStocktakeLineDto,
  toStocktakeScanResultDto,
  toStocktakeSummaryDto,
} from './mappers';

const MANAGE = 'inventory.stocktakes.manage';
const APPROVE = 'inventory.stocktakes.approve';
const COSTS = 'inventory.costs.manage';

/** Counters see their own counts only; approvers the frozen quantities; cost holders the values. */
const viewOf = (ctx: AuthContext): StocktakeView => ({
  withExpected: ctx.permissions.has(APPROVE),
  withCosts: ctx.permissions.has(COSTS),
});

/**
 * Stocktakes (ST-, ADR-0038): warehouse staff plan, start and count bin by bin without seeing the
 * frozen quantities; approvers review the differences, send bins back for a recount or approve.
 */
@ApiTags('inventory')
@Controller('stocktakes')
export class StocktakesController {
  constructor(private readonly stocktakes: StocktakesService) {}

  @Get()
  @Authenticated()
  @ApiOkResponse({ type: StocktakePageDto })
  async list(@Query() query: StocktakeListQueryDto): Promise<StocktakePageDto> {
    const page = await this.stocktakes.list(query);
    return { data: page.data.map(toStocktakeSummaryDto), nextCursor: page.nextCursor };
  }

  /** What a code prefix or «every bin» would count, before the stocktake is created. */
  @Get('bin-preview')
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: StocktakeBinPreviewDto })
  binPreview(
    @CurrentUser() ctx: AuthContext,
    @Query() query: StocktakeBinPreviewQueryDto,
  ): Promise<StocktakeBinPreviewDto> {
    return this.stocktakes.binPreview(ctx, query.warehouseId, {
      ...(query.prefix === undefined ? {} : { prefix: query.prefix }),
      ...(query.all === undefined ? {} : { all: query.all }),
    });
  }

  @Get(':id')
  @Authenticated()
  @ApiOkResponse({ type: StocktakeDetailDto })
  async get(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<StocktakeDetailDto> {
    return toStocktakeDetailDto(await this.stocktakes.get(id), viewOf(ctx));
  }

  /** Lines in bin order. Counters receive only the lines a person counted (ADR-0038). */
  @Get(':id/lines')
  @Authenticated()
  @ApiOkResponse({ type: StocktakeLinePageDto })
  async lines(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: StocktakeLinesQueryDto,
  ): Promise<StocktakeLinePageDto> {
    const view = viewOf(ctx);
    const page = await this.stocktakes.lines(id, {
      ...(query.binId === undefined ? {} : { binId: query.binId }),
      // A counter asking for the differences would learn which lines are off: ignored.
      ...(view.withExpected ? { differences: query.differences === true } : { countedOnly: true }),
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      ...(query.limit === undefined ? {} : { limit: query.limit }),
    });
    return {
      data: page.data.map((line) => toStocktakeLineDto(line, view)),
      nextCursor: page.nextCursor,
    };
  }

  @Post()
  @RequirePermission(MANAGE)
  @Idempotent()
  @ApiCreatedResponse({ type: StocktakeDetailDto })
  async create(
    @CurrentUser() ctx: AuthContext,
    @Body() body: CreateStocktakeDto,
  ): Promise<StocktakeDetailDto> {
    const detail = await this.stocktakes.create(ctx, {
      warehouseId: body.warehouseId,
      ...(body.binIds === undefined ? {} : { binIds: body.binIds }),
      ...(body.prefix === undefined ? {} : { prefix: body.prefix }),
      ...(body.all === undefined ? {} : { all: body.all }),
      ...(body.note === undefined ? {} : { note: body.note }),
    });
    return toStocktakeDetailDto(detail, viewOf(ctx));
  }

  /** DRAFT → COUNTING: the bins are locked and their stock frozen. */
  @Post(':id/start')
  @HttpCode(200)
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: StocktakeDetailDto })
  async start(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<StocktakeDetailDto> {
    return toStocktakeDetailDto(await this.stocktakes.start(ctx, id), viewOf(ctx));
  }

  /** One scan, added to its line; idempotent so a retried request never counts twice. */
  @Post(':id/scan')
  @HttpCode(200)
  @RequirePermission(MANAGE)
  @Idempotent()
  @ApiOkResponse({ type: StocktakeScanResultDto })
  async scan(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: StocktakeScanDto,
  ): Promise<StocktakeScanResultDto> {
    const result = await this.stocktakes.scan(ctx, id, {
      binId: body.binId,
      productUnitId: body.productUnitId,
      qty: new Decimal(body.qty),
    });
    return toStocktakeScanResultDto(result, viewOf(ctx));
  }

  /** Counts typed in base units; each replaces the last count of its bin and product. */
  @Post(':id/counts')
  @HttpCode(200)
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: StocktakeCountResultDto })
  async counts(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: StocktakeCountsDto,
  ): Promise<StocktakeCountResultDto> {
    const lines = await this.stocktakes.count(
      ctx,
      id,
      body.entries.map((entry) => ({
        binId: entry.binId,
        productId: entry.productId,
        countedQty: new Decimal(entry.countedQty),
        ...(entry.previousQty === undefined
          ? {}
          : { previousQty: entry.previousQty === null ? null : new Decimal(entry.previousQty) }),
      })),
    );
    const view = viewOf(ctx);
    return { lines: lines.map((line) => toStocktakeLineDto(line, view)) };
  }

  /** A counter is done with a bin: what nobody counted there is 0. */
  @Post(':id/bins/:binId/finish')
  @HttpCode(200)
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: StocktakeBinDto })
  async finishBin(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Param('binId', ParseIntPipe) binId: number,
  ): Promise<StocktakeBinDto> {
    return toStocktakeBinDto(await this.stocktakes.finishBin(ctx, id, binId), viewOf(ctx));
  }

  /** COUNTING → REVIEW once every bin is finished. */
  @Post(':id/review')
  @HttpCode(200)
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: StocktakeDetailDto })
  async review(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<StocktakeDetailDto> {
    return toStocktakeDetailDto(await this.stocktakes.review(ctx, id), viewOf(ctx));
  }

  /** REVIEW → COUNTING: the chosen bins are counted again from nothing. */
  @Post(':id/recount')
  @HttpCode(200)
  @RequirePermission(APPROVE)
  @ApiOkResponse({ type: StocktakeDetailDto })
  async recount(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: StocktakeRecountDto,
  ): Promise<StocktakeDetailDto> {
    return toStocktakeDetailDto(await this.stocktakes.recount(ctx, id, body.binIds), viewOf(ctx));
  }

  /** REVIEW → APPROVED: posts the differences; idempotent so a retried click never posts twice. */
  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermission(APPROVE)
  @Idempotent()
  @ApiOkResponse({ type: StocktakeDetailDto })
  async approve(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: ApproveStocktakeDto,
  ): Promise<StocktakeDetailDto> {
    const detail = await this.stocktakes.approve(
      ctx,
      id,
      (body.costs ?? []).map((cost) => ({
        lineId: cost.lineId,
        unitCost: new Decimal(cost.unitCost),
      })),
    );
    return toStocktakeDetailDto(detail, viewOf(ctx));
  }

  /** Frees the bins without postings; a stocktake in review is cancelled by an approver. */
  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: StocktakeDetailDto })
  async cancel(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<StocktakeDetailDto> {
    return toStocktakeDetailDto(await this.stocktakes.cancel(ctx, id), viewOf(ctx));
  }
}
