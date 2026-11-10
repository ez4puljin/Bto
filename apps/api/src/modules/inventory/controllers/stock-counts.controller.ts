import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Decimal } from '@tugeel/shared/money';
import { AppError } from '../../../common/errors/app-error';
import {
  type AuthContext,
  Authenticated,
  CurrentUser,
  Idempotent,
  RequirePermission,
} from '../../identity';
import {
  ApproveStockCountDto,
  CreateStockCountDto,
  CreateStockCountEntryDto,
  MyStockCountDto,
  OpenStockCountDto,
  StockCountAccountChoiceDto,
  StockCountDefaultsDto,
  StockCountDetailDto,
  StockCountEntryDto,
  StockCountLinePageDto,
  StockCountLineReasonDto,
  StockCountLineSettlementDto,
  StockCountLinesQueryDto,
  StockCountSheetDto,
  StockCountSheetQueryDto,
  StockCountListQueryDto,
  StockCountMovedDocumentDto,
  StockCountPageDto,
  StockCountProductInfoDto,
  StockCountVariancePageDto,
  StockCountVarianceQueryDto,
} from '../dto/stock-counts.dto';
import { StockCountsService } from '../services/stock-counts.service';
import {
  toMyStockCountDto,
  toOpenStockCountDto,
  toStockCountDetailDto,
  toStockCountEntryDto,
  toStockCountLineDto,
  toStockCountMovedDto,
  toStockCountProductInfoDto,
  toStockCountSheetDto,
  toStockCountSummaryDto,
  toStockCountVarianceRowDto,
} from './mappers';

const MANAGE = 'inventory.stocktakes.manage';
const APPROVE = 'inventory.stocktakes.approve';

/**
 * The count window is its managers' and approvers': a counter, who may be anyone on the staff,
 * reads only the open counts and their own session, so a blind count stays blind (ADR-0176 #3).
 */
function assertWindow(ctx: AuthContext): void {
  if (ctx.permissions.has(MANAGE) || ctx.permissions.has(APPROVE)) return;
  throw new AppError('FORBIDDEN', 'the count window is its managers and approvers only', {
    permission: MANAGE,
  });
}

/**
 * Product counts (ADR-0176): a count is opened on a warehouse for a set of products, every staff
 * member counts on a phone and sends, the window shows who counted what, and the approver books
 * the differences to the accounts and parties chosen.
 */
@ApiTags('inventory')
@Controller('stock-counts')
export class StockCountsController {
  constructor(private readonly counts: StockCountsService) {}

  @Get()
  @Authenticated()
  @ApiOkResponse({ type: StockCountPageDto })
  async list(
    @CurrentUser() ctx: AuthContext,
    @Query() query: StockCountListQueryDto,
  ): Promise<StockCountPageDto> {
    assertWindow(ctx);
    const page = await this.counts.list({
      ...(query.warehouseId === undefined ? {} : { warehouseId: query.warehouseId }),
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      ...(query.limit === undefined ? {} : { limit: query.limit }),
    });
    return { data: page.data.map(toStockCountSummaryDto), nextCursor: page.nextCursor };
  }

  @Post()
  @RequirePermission(MANAGE)
  @Idempotent()
  @ApiCreatedResponse({ type: StockCountDetailDto })
  async create(
    @CurrentUser() ctx: AuthContext,
    @Body() dto: CreateStockCountDto,
  ): Promise<StockCountDetailDto> {
    return toStockCountDetailDto(
      await this.counts.create(ctx, {
        warehouseId: dto.warehouseId,
        scopeMode: dto.scopeMode,
        ...(dto.scopeIds === undefined ? {} : { scopeIds: dto.scopeIds }),
        ...(dto.scopeLabel === undefined ? {} : { scopeLabel: dto.scopeLabel }),
        ...(dto.showStock === undefined ? {} : { showStock: dto.showStock }),
        ...(dto.note === undefined ? {} : { note: dto.note }),
      }),
    );
  }

  /** The counts a staff member may count now, with their own state on each. */
  @Get('open')
  @Authenticated()
  @ApiOkResponse({ type: [OpenStockCountDto] })
  async open(@CurrentUser() ctx: AuthContext): Promise<OpenStockCountDto[]> {
    return (await this.counts.open(ctx)).map(toOpenStockCountDto);
  }

  /** The accounts a difference may be booked to (set up under finance). */
  @Get('accounts')
  @Authenticated()
  @ApiOkResponse({ type: [StockCountAccountChoiceDto] })
  async accounts(@CurrentUser() ctx: AuthContext): Promise<StockCountAccountChoiceDto[]> {
    assertWindow(ctx);
    return (await this.counts.accountChoices()).map(({ code, name }) => ({ code, name }));
  }

  /** The differences the approved counts posted, by approval day. */
  @Get('variance')
  @Authenticated()
  @ApiOkResponse({ type: StockCountVariancePageDto })
  async variance(
    @CurrentUser() ctx: AuthContext,
    @Query() query: StockCountVarianceQueryDto,
  ): Promise<StockCountVariancePageDto> {
    assertWindow(ctx);
    const page = await this.counts.variance(ctx, {
      from: query.from,
      to: query.to,
      ...(query.warehouseId === undefined ? {} : { warehouseId: query.warehouseId }),
      ...(query.q === undefined ? {} : { q: query.q }),
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      ...(query.limit === undefined ? {} : { limit: query.limit }),
    });
    return { data: page.data.map(toStockCountVarianceRowDto), nextCursor: page.nextCursor };
  }

  @Get(':id')
  @Authenticated()
  @ApiOkResponse({ type: StockCountDetailDto })
  async get(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<StockCountDetailDto> {
    assertWindow(ctx);
    return toStockCountDetailDto(await this.counts.get(id));
  }

  @Get(':id/lines')
  @Authenticated()
  @ApiOkResponse({ type: StockCountLinePageDto })
  async lines(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: StockCountLinesQueryDto,
  ): Promise<StockCountLinePageDto> {
    assertWindow(ctx);
    const page = await this.counts.lines(ctx, id, {
      ...(query.filter === undefined ? {} : { filter: query.filter }),
      ...(query.q === undefined ? {} : { q: query.q }),
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      ...(query.limit === undefined ? {} : { limit: query.limit }),
    });
    return { data: page.data.map(toStockCountLineDto), nextCursor: page.nextCursor };
  }

  /** Every product of the count with its supplier and its difference at the selling price. */
  @Get(':id/sheet')
  @Authenticated()
  @ApiOkResponse({ type: StockCountSheetDto })
  async sheet(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: StockCountSheetQueryDto,
  ): Promise<StockCountSheetDto> {
    assertWindow(ctx);
    return toStockCountSheetDto(
      await this.counts.sheet(id, {
        ...(query.filter === undefined ? {} : { filter: query.filter }),
        ...(query.q === undefined ? {} : { q: query.q }),
        ...(query.supplierId === undefined ? {} : { supplierId: query.supplierId }),
        ...(query.categoryId === undefined ? {} : { categoryId: query.categoryId }),
        ...(query.segmentId === undefined ? {} : { segmentId: query.segmentId }),
      }),
    );
  }

  /** Why a product differs; empty clears it. */
  @Put(':id/lines/:lineId/reason')
  @HttpCode(204)
  @RequirePermission(APPROVE)
  async setReason(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Param('lineId', ParseIntPipe) lineId: number,
    @Body() dto: StockCountLineReasonDto,
  ): Promise<void> {
    await this.counts.setReason(ctx, id, lineId, dto.reason ?? null);
  }

  /** Who counted a product, entry by entry. */
  @Get(':id/lines/:lineId/entries')
  @Authenticated()
  @ApiOkResponse({ type: [StockCountEntryDto] })
  async lineEntries(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Param('lineId', ParseIntPipe) lineId: number,
  ): Promise<StockCountEntryDto[]> {
    assertWindow(ctx);
    return (await this.counts.lineEntries(id, lineId)).map(toStockCountEntryDto);
  }

  /** The documents that moved a product after it was counted. */
  @Get(':id/lines/:lineId/moved')
  @Authenticated()
  @ApiOkResponse({ type: [StockCountMovedDocumentDto] })
  async lineMoved(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Param('lineId', ParseIntPipe) lineId: number,
  ): Promise<StockCountMovedDocumentDto[]> {
    assertWindow(ctx);
    return (await this.counts.lineMoved(id, lineId)).map(toStockCountMovedDto);
  }

  /** A line's own account and party; a null settlement returns it to the count's default. */
  @Put(':id/lines/:lineId/settlement')
  @RequirePermission(APPROVE)
  @ApiOkResponse({ type: StockCountDetailDto })
  async setLine(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Param('lineId', ParseIntPipe) lineId: number,
    @Body() dto: StockCountLineSettlementDto,
  ): Promise<StockCountDetailDto> {
    await this.counts.setLine(ctx, id, lineId, dto.settlement ?? null);
    return toStockCountDetailDto(await this.counts.get(id));
  }

  @Put(':id/defaults')
  @RequirePermission(APPROVE)
  @ApiOkResponse({ type: StockCountDetailDto })
  async setDefaults(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: StockCountDefaultsDto,
  ): Promise<StockCountDetailDto> {
    return toStockCountDetailDto(
      await this.counts.setDefaults(ctx, id, {
        ...(dto.surplus === undefined ? {} : { surplus: dto.surplus }),
        ...(dto.shortage === undefined ? {} : { shortage: dto.shortage }),
      }),
    );
  }

  // A counter's own session

  @Get(':id/session')
  @Authenticated()
  @ApiOkResponse({ type: MyStockCountDto })
  async mine(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<MyStockCountDto> {
    return toMyStockCountDto(await this.counts.mine(ctx, id));
  }

  /** Starts counting; whoever starts has to send, even with nothing counted. */
  @Post(':id/session')
  @Authenticated()
  @HttpCode(200)
  @ApiOkResponse({ type: MyStockCountDto })
  async start(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<MyStockCountDto> {
    return toMyStockCountDto(await this.counts.start(ctx, id));
  }

  /** One count of a product; a repeat adds up and stays its own entry. */
  @Post(':id/session/entries')
  @Authenticated()
  @Idempotent()
  @ApiCreatedResponse({ type: StockCountProductInfoDto })
  async addEntry(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateStockCountEntryDto,
  ): Promise<StockCountProductInfoDto> {
    return toStockCountProductInfoDto(
      await this.counts.addEntry(ctx, id, {
        productId: dto.productId,
        productUnitId: dto.productUnitId,
        qty: new Decimal(dto.qty),
      }),
    );
  }

  @Post(':id/session/entries/:entryId/void')
  @Authenticated()
  @HttpCode(200)
  @ApiOkResponse({ type: StockCountProductInfoDto })
  async voidEntry(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Param('entryId', ParseIntPipe) entryId: number,
  ): Promise<StockCountProductInfoDto> {
    return toStockCountProductInfoDto(await this.counts.voidEntry(ctx, id, entryId));
  }

  @Post(':id/session/send')
  @Authenticated()
  @HttpCode(200)
  @ApiOkResponse({ type: MyStockCountDto })
  async send(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<MyStockCountDto> {
    return toMyStockCountDto(await this.counts.send(ctx, id));
  }

  /** What the counter has on a product, and the stock when the count shows it. */
  @Get(':id/products/:productId')
  @Authenticated()
  @ApiOkResponse({ type: StockCountProductInfoDto })
  async product(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Param('productId', ParseIntPipe) productId: number,
  ): Promise<StockCountProductInfoDto> {
    return toStockCountProductInfoDto(await this.counts.product(ctx, id, productId));
  }

  // The count's manager

  /** Sends a session for a counter who left without sending. */
  @Post(':id/sessions/:sessionId/send')
  @RequirePermission(MANAGE)
  @HttpCode(200)
  @ApiOkResponse({ type: StockCountDetailDto })
  async sendFor(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Param('sessionId', ParseIntPipe) sessionId: number,
  ): Promise<StockCountDetailDto> {
    return toStockCountDetailDto(await this.counts.sendFor(ctx, id, sessionId));
  }

  /** Counting is over: the count goes to review; refused while a session is not sent. */
  @Post(':id/close')
  @RequirePermission(MANAGE)
  @HttpCode(200)
  @ApiOkResponse({ type: StockCountDetailDto })
  async close(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<StockCountDetailDto> {
    return toStockCountDetailDto(await this.counts.close(ctx, id));
  }

  @Post(':id/reopen')
  @RequirePermission(MANAGE)
  @HttpCode(200)
  @ApiOkResponse({ type: StockCountDetailDto })
  async reopen(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<StockCountDetailDto> {
    return toStockCountDetailDto(await this.counts.reopen(ctx, id));
  }

  @Post(':id/cancel')
  @RequirePermission(MANAGE)
  @HttpCode(200)
  @ApiOkResponse({ type: StockCountDetailDto })
  async cancel(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<StockCountDetailDto> {
    return toStockCountDetailDto(await this.counts.cancel(ctx, id));
  }

  /** Books the differences and makes the warehouse's stock the counted quantity. */
  @Post(':id/approve')
  @RequirePermission(APPROVE)
  @HttpCode(200)
  @ApiOkResponse({ type: StockCountDetailDto })
  async approve(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ApproveStockCountDto,
  ): Promise<StockCountDetailDto> {
    return toStockCountDetailDto(await this.counts.approve(ctx, id, { uncounted: dto.uncounted }));
  }
}
