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
import type { ProductSummary } from '../../catalog';
import { type AuthContext, CurrentUser, Idempotent, RequirePermission } from '../../identity';
import {
  ApproveSheetDto,
  BuildSheetsDto,
  CountSheetLineDto,
  MarkLegitimateDto,
  StockProblemDto,
  StockProblemListDto,
  StockProblemListQueryDto,
  StockProblemProductDto,
  StockProblemResolutionDto,
  StockProblemSettingsDto,
  StockProblemSettingsRequestDto,
  StockProblemSheetDetailDto,
  StockProblemSheetDto,
  StockProblemSheetLineDto,
  StockProblemSheetListQueryDto,
  StockProblemSheetPageDto,
  StockProblemWarehouseDto,
  ZeroOutDto,
} from '../dto/stock-problems.dto';
import {
  type SheetDetail,
  type SheetLine,
  type SheetSummary,
  StockProblemSheetsService,
} from '../services/stock-problem-sheets.service';
import {
  type ProblemProduct,
  type ResolutionView,
  StockProblemsService,
  type WarehouseSettings,
} from '../services/stock-problems.service';

const READ = 'problems.read';
const COUNT = 'problems.count';
const MANAGE = 'problems.manage';

const toProductDto = (product: ProductSummary): StockProblemProductDto => ({
  id: product.id,
  sku: product.sku,
  name: product.name,
  baseUomName: product.baseUnit.uomName,
});

const toProblemDto = (problem: ProblemProduct): StockProblemDto => ({
  warehouseId: problem.warehouseId,
  product: toProductDto(problem.product),
  onHand: problem.onHand.toFixed(),
  redQty: problem.redQty.toFixed(),
  cutQty: problem.cutQty.toFixed(),
  lastEventAt: problem.lastEventAt.toISOString(),
  events: problem.events.map((event) => ({
    kind: event.kind,
    qtyBase: event.qtyBase.toFixed(),
    at: event.at.toISOString(),
    shortfallId: event.shortfallId,
    saleId: event.saleId,
    saleNumber: event.saleNumber,
    orderId: event.orderId,
    orderNumber: event.orderNumber,
    orderLineId: event.orderLineId,
    customerId: event.customerId,
    customerName: event.customerName,
    repName: event.repName,
    orderedQtyBase: event.orderedQtyBase?.toFixed() ?? null,
  })),
  pending: problem.pending && {
    id: problem.pending.id,
    kind: problem.pending.kind,
    qtyBase: problem.pending.qtyBase?.toFixed() ?? null,
    issueId: problem.pending.issueId,
    adjustmentId: problem.pending.adjustmentId,
    sheetId: problem.pending.sheetId,
    createdAt: problem.pending.createdAt.toISOString(),
  },
});

const toResolutionDto = (view: ResolutionView): StockProblemResolutionDto => ({
  ...view,
  qtyBase: view.qtyBase?.toFixed() ?? null,
  onHand: view.onHand?.toFixed() ?? null,
  createdAt: view.createdAt.toISOString(),
});

const toSettingsDto = (view: WarehouseSettings): StockProblemSettingsDto => ({
  ...view,
  updatedAt: view.updatedAt?.toISOString() ?? null,
});

const toSheetDto = (sheet: SheetSummary): StockProblemSheetDto => ({
  id: sheet.id,
  warehouseId: sheet.warehouseId,
  warehouseCode: sheet.warehouseCode,
  warehouseName: sheet.warehouseName,
  sheetDate: sheet.sheetDate,
  status: sheet.status,
  lineCount: sheet.lineCount,
  countedCount: sheet.countedCount,
  builtAt: sheet.builtAt.toISOString(),
  builtByName: sheet.builtByName,
  approvedAt: sheet.approvedAt?.toISOString() ?? null,
  approvedByName: sheet.approvedByName,
  issueId: sheet.issueId,
  adjustmentId: sheet.adjustmentId,
});

const toLineDto = (line: SheetLine): StockProblemSheetLineDto => ({
  id: line.id,
  sheetId: line.sheetId,
  product: toProductDto(line.product),
  binCode: line.binCode,
  systemQty: line.systemQty.toFixed(),
  redQty: line.redQty.toFixed(),
  cutQty: line.cutQty.toFixed(),
  countedQty: line.countedQty?.toFixed() ?? null,
  onHandAtCount: line.onHandAtCount?.toFixed() ?? null,
  difference: line.difference?.toFixed() ?? null,
  countedAt: line.countedAt?.toISOString() ?? null,
  countedByName: line.countedByName,
  outcome: line.outcome,
  resolutionId: line.resolutionId,
});

const toSheetDetailDto = (sheet: SheetDetail): StockProblemSheetDetailDto => ({
  ...toSheetDto(sheet),
  lines: sheet.lines.map(toLineDto),
});

/**
 * «Асуудалтай бараа» (ADR-0230): the problem list per warehouse, its two decisions, the warehouses'
 * defaults and the morning sheets. Every route answers only for the warehouses of the caller's
 * scope (403 `WAREHOUSE_SCOPE` on another one).
 */
@ApiTags('stock-problems')
@Controller('stock-problems')
export class StockProblemsController {
  constructor(
    private readonly problems: StockProblemsService,
    private readonly sheets: StockProblemSheetsService,
  ) {}

  /** The caller's warehouses with how many products each has on its list. */
  @Get('warehouses')
  @RequirePermission(READ)
  @ApiOkResponse({ type: [StockProblemWarehouseDto] })
  warehouses(@CurrentUser() ctx: AuthContext): Promise<StockProblemWarehouseDto[]> {
    return this.problems.summary(ctx);
  }

  /** One warehouse's problem products, newest first, each with its events and on-hand. */
  @Get()
  @RequirePermission(READ)
  @ApiOkResponse({ type: StockProblemListDto })
  async list(
    @CurrentUser() ctx: AuthContext,
    @Query() query: StockProblemListQueryDto,
  ): Promise<StockProblemListDto> {
    return { data: (await this.problems.list(ctx, query.warehouseId)).map(toProblemDto) };
  }

  /** «Зүй ёсны»: the product leaves this warehouse's list at once. */
  @Post('legitimate')
  @HttpCode(200)
  @RequirePermission(MANAGE)
  @Idempotent()
  @ApiOkResponse({ type: StockProblemResolutionDto })
  async legitimate(
    @CurrentUser() ctx: AuthContext,
    @Body() dto: MarkLegitimateDto,
  ): Promise<StockProblemResolutionDto> {
    return toResolutionDto(
      await this.problems.markLegitimate(ctx, {
        warehouseId: dto.warehouseId,
        productId: dto.productId,
        note: dto.note ?? null,
      }),
    );
  }

  /** «Үлдэгдэл тэглэх»: a goods issue for the balance, sent to the keeper. */
  @Post('zero-out')
  @RequirePermission(MANAGE)
  @Idempotent()
  @ApiCreatedResponse({ type: StockProblemResolutionDto })
  async zeroOut(
    @CurrentUser() ctx: AuthContext,
    @Body() dto: ZeroOutDto,
  ): Promise<StockProblemResolutionDto> {
    return toResolutionDto(
      await this.problems.zeroOut(ctx, {
        warehouseId: dto.warehouseId,
        productId: dto.productId,
        qty: dto.qty == null ? null : new Decimal(dto.qty),
      }),
    );
  }

  /** Each warehouse's fixed customer and expense type. */
  @Get('settings')
  @RequirePermission(READ)
  @ApiOkResponse({ type: [StockProblemSettingsDto] })
  async settings(@CurrentUser() ctx: AuthContext): Promise<StockProblemSettingsDto[]> {
    return (await this.problems.settings(ctx)).map(toSettingsDto);
  }

  @Put('settings/:warehouseId')
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: StockProblemSettingsDto })
  async setSettings(
    @CurrentUser() ctx: AuthContext,
    @Param('warehouseId', ParseIntPipe) warehouseId: number,
    @Body() dto: StockProblemSettingsRequestDto,
  ): Promise<StockProblemSettingsDto> {
    return toSettingsDto(
      await this.problems.setSettings(ctx, warehouseId, {
        customerId: dto.customerId,
        expenseTypeId: dto.expenseTypeId,
      }),
    );
  }

  /** Builds (or tops up) today's sheets now, as the 07:00 job does. */
  @Post('sheets/build')
  @HttpCode(200)
  @RequirePermission(MANAGE)
  @Idempotent()
  @ApiOkResponse({ type: [StockProblemSheetDto] })
  async build(
    @CurrentUser() ctx: AuthContext,
    @Body() dto: BuildSheetsDto,
  ): Promise<StockProblemSheetDto[]> {
    return (await this.sheets.build(ctx, dto.warehouseId)).map(toSheetDto);
  }

  /** The staff app: today's open sheets of my warehouses, with their lines. */
  @Get('sheets/mine')
  @RequirePermission(COUNT)
  @ApiOkResponse({ type: [StockProblemSheetDetailDto] })
  async mine(@CurrentUser() ctx: AuthContext): Promise<StockProblemSheetDetailDto[]> {
    return (await this.sheets.mine(ctx)).map(toSheetDetailDto);
  }

  @Get('sheets')
  @RequirePermission(READ)
  @ApiOkResponse({ type: StockProblemSheetPageDto })
  async listSheets(
    @CurrentUser() ctx: AuthContext,
    @Query() query: StockProblemSheetListQueryDto,
  ): Promise<StockProblemSheetPageDto> {
    const page = await this.sheets.list(ctx, query);
    return { data: page.data.map(toSheetDto), nextCursor: page.nextCursor };
  }

  /** A sheet with its lines in shelf order: what the web prints per warehouse. */
  @Get('sheets/:id')
  @RequirePermission(READ)
  @ApiOkResponse({ type: StockProblemSheetDetailDto })
  async sheet(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<StockProblemSheetDetailDto> {
    return toSheetDetailDto(await this.sheets.get(ctx, id));
  }

  /** The counter's quantity of a line; may be sent again until the sheet is approved. */
  @Post('sheet-lines/:id/count')
  @HttpCode(200)
  @RequirePermission(COUNT)
  @Idempotent()
  @ApiOkResponse({ type: StockProblemSheetLineDto })
  async count(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CountSheetLineDto,
  ): Promise<StockProblemSheetLineDto> {
    return toLineDto(await this.sheets.count(ctx, id, new Decimal(dto.countedQty)));
  }

  /** Approves a counted sheet: shortages to one goods issue, surpluses to one adjustment. */
  @Post('sheets/:id/approve')
  @HttpCode(200)
  @RequirePermission(MANAGE)
  @Idempotent()
  @ApiOkResponse({ type: StockProblemSheetDetailDto })
  async approve(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ApproveSheetDto,
  ): Promise<StockProblemSheetDetailDto> {
    return toSheetDetailDto(
      await this.sheets.approve(ctx, id, { countedOnly: dto.countedOnly === true }),
    );
  }
}
