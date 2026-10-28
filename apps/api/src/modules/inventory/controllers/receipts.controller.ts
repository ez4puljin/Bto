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
  Res,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiProduces, ApiTags } from '@nestjs/swagger';
import { pipeline } from 'node:stream/promises';
import type { Response } from 'express';
import { AppError } from '../../../common/errors/app-error';
import { Decimal } from '@tugeel/shared/money';
import {
  type AuthContext,
  Authenticated,
  CurrentUser,
  Idempotent,
  RequirePermission,
} from '../../identity';
import {
  CostReceiptDto,
  CreateReceiptDto,
  LastReceiptPriceDto,
  LastReceiptPricesQueryDto,
  ReceiptCostingDto,
  ReceiptDetailDto,
  ReceiptDiscountRequestDto,
  ReceiptDiscountsDto,
  ReceiptLineRequestDto,
  ReceiptListQueryDto,
  ReceiptPageDto,
  ReceiptPaymentAccountDto,
  UpdateReceiptDto,
  UpdateReceiptLineDto,
} from '../dto/receipts.dto';
import { ReceiptsService } from '../services/receipts.service';
import { toReceiptCostingDto, toReceiptDetailDto, toReceiptSummaryDto } from './mappers';

const MANAGE = 'inventory.receipts.manage';
const COSTS = 'inventory.costs.manage';

const money = (value: string | null | undefined) =>
  value === undefined ? undefined : value === null ? null : new Decimal(value);

const lineInput = (line: ReceiptLineRequestDto) => ({
  productUnitId: line.productUnitId,
  enteredQty: new Decimal(line.enteredQty),
  ...(line.warehouseId === undefined ? {} : { warehouseId: line.warehouseId }),
  ...(line.docUnitPrice === undefined ? {} : { docUnitPrice: money(line.docUnitPrice) }),
  ...(line.docAmount === undefined ? {} : { docAmount: money(line.docAmount) }),
  ...(line.freeGoods === undefined ? {} : { freeGoods: line.freeGoods }),
  ...(line.salePrice === undefined ? {} : { salePrice: money(line.salePrice) }),
});

/** The delivery note's totals as decimals (ADR-0115); absent fields stay absent. */
const noteTotals = (body: { noteTotalQty?: string | null; noteTotalAmount?: string | null }) => ({
  ...(body.noteTotalQty === undefined ? {} : { noteTotalQty: money(body.noteTotalQty) }),
  ...(body.noteTotalAmount === undefined ? {} : { noteTotalAmount: money(body.noteTotalAmount) }),
});

/** Discounts as typed, as decimals (ADR-0103). */
const discountsInput = (discounts: readonly ReceiptDiscountRequestDto[]) =>
  discounts.map((discount) => ({
    kind: discount.kind,
    pct: money(discount.pct) ?? null,
    amount: money(discount.amount) ?? null,
    lineIds: discount.lineIds ?? [],
  }));

/** Prices and totals only for cost holders (ADR-0033 #8, ADR-0078 #2). */
const detail = (ctx: AuthContext) => (receipt: Parameters<typeof toReceiptDetailDto>[0]) =>
  toReceiptDetailDto(receipt, ctx.permissions.has(COSTS));

/**
 * Goods receipts (ADR-0033, ADR-0099, ADR-0115): holders of the receipt right count them whatever
 * their warehouse scope and confirm the lines in their own warehouses; every user reads them without costs; the costs and the discount live
 * behind inventory.costs.manage, a line's new sale price behind pricing.prices.manage.
 */
@ApiTags('inventory')
@Controller('receipts')
export class ReceiptsController {
  constructor(private readonly receipts: ReceiptsService) {}

  @Get()
  @Authenticated()
  @ApiOkResponse({ type: ReceiptPageDto })
  async list(
    @CurrentUser() ctx: AuthContext,
    @Query() query: ReceiptListQueryDto,
  ): Promise<ReceiptPageDto> {
    const page = await this.receipts.list(query);
    const withCosts = ctx.permissions.has(COSTS);
    return {
      data: page.data.map((summary) => toReceiptSummaryDto(summary, withCosts)),
      nextCursor: page.nextCursor,
    };
  }

  /** The cash boxes and bank accounts a receipt may name (ADR-0078 #5). */
  @Get('payment-accounts')
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: [ReceiptPaymentAccountDto] })
  async paymentAccounts(): Promise<ReceiptPaymentAccountDto[]> {
    return this.receipts.paymentAccounts();
  }

  /** Each product's latest delivery-note price, from any supplier (ADR-0099 #3). */
  @Get('last-prices')
  @RequirePermission(COSTS)
  @ApiOkResponse({ type: [LastReceiptPriceDto] })
  async lastPrices(@Query() query: LastReceiptPricesQueryDto): Promise<LastReceiptPriceDto[]> {
    return (await this.receipts.lastPrices(query.productIds)).map((price) => ({
      ...price,
      unitPrice: price.unitPrice.toFixed(2),
      basePrice: price.basePrice.toFixed(2),
    }));
  }

  @Get(':id')
  @Authenticated()
  @ApiOkResponse({ type: ReceiptDetailDto })
  async get(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ReceiptDetailDto> {
    return detail(ctx)(await this.receipts.get(id));
  }

  @Post()
  @RequirePermission(MANAGE)
  @Idempotent()
  @ApiCreatedResponse({ type: ReceiptDetailDto })
  async create(
    @CurrentUser() ctx: AuthContext,
    @Body() body: CreateReceiptDto,
  ): Promise<ReceiptDetailDto> {
    return detail(ctx)(
      await this.receipts.create(ctx, {
        supplierId: body.supplierId,
        ...noteTotals(body),
        ...(body.supplierDocNo === undefined ? {} : { supplierDocNo: body.supplierDocNo }),
        ...(body.supplierDocDate === undefined ? {} : { supplierDocDate: body.supplierDocDate }),
        ...(body.note === undefined ? {} : { note: body.note }),
        ...(body.paymentMethod === undefined ? {} : { paymentMethod: body.paymentMethod }),
        ...(body.moneyAccountId === undefined ? {} : { moneyAccountId: body.moneyAccountId }),
        lines: (body.lines ?? []).map(lineInput),
      }),
    );
  }

  @Patch(':id')
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: ReceiptDetailDto })
  async update(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateReceiptDto,
  ): Promise<ReceiptDetailDto> {
    const { noteTotalQty, noteTotalAmount, ...rest } = body;
    return detail(ctx)(
      await this.receipts.update(ctx, id, { ...rest, ...noteTotals({ noteTotalQty, noteTotalAmount }) }),
    );
  }

  /** The delivery note's photo (ADR-0115), streamed to receipt and cost holders. */
  @Get(':id/note-photo')
  @Authenticated()
  @ApiProduces('image/jpeg', 'image/png', 'image/webp')
  @ApiOkResponse({ description: 'The photo' })
  async notePhoto(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Res() response: Response,
  ): Promise<void> {
    if (!ctx.permissions.has(MANAGE) && !ctx.permissions.has(COSTS)) {
      throw new AppError('FORBIDDEN', 'the delivery note is for receipt and cost holders', {
        permission: MANAGE,
      });
    }
    const { file, body } = await this.receipts.notePhoto(id);
    response.status(200);
    response.setHeader('Content-Type', file.contentType);
    response.setHeader('Content-Length', String(file.sizeBytes));
    response.setHeader('Cache-Control', 'private, no-store');
    await pipeline(body, response);
  }

  /** A draft's discounts, replaced as a whole (ADR-0103). */
  @Put(':id/discounts')
  @RequirePermission(COSTS)
  @ApiOkResponse({ type: ReceiptDetailDto })
  async setDiscounts(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: ReceiptDiscountsDto,
  ): Promise<ReceiptDetailDto> {
    return detail(ctx)(await this.receipts.setDiscounts(ctx, id, discountsInput(body.discounts)));
  }

  @Post(':id/lines')
  @RequirePermission(MANAGE)
  @ApiCreatedResponse({ type: ReceiptDetailDto })
  async addLine(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: ReceiptLineRequestDto,
  ): Promise<ReceiptDetailDto> {
    return detail(ctx)(await this.receipts.addLine(ctx, id, lineInput(body)));
  }

  /**
   * The keeper's confirmation (ADR-0115): confirms the caller's warehouses of the receipt; the last
   * one posts it (DRAFT → POSTED). Idempotent so a retried click never confirms twice.
   */
  @Post(':id/post')
  @HttpCode(200)
  @RequirePermission(MANAGE)
  @Idempotent()
  @ApiOkResponse({ type: ReceiptDetailDto })
  async post(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ReceiptDetailDto> {
    return detail(ctx)(await this.receipts.confirm(ctx, id));
  }

  /** Withdraws a warehouse's confirmation while the receipt is a draft (that warehouse's scope). */
  @Delete(':id/confirmations/:warehouseId')
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: ReceiptDetailDto })
  async withdraw(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Param('warehouseId', ParseIntPipe) warehouseId: number,
  ): Promise<ReceiptDetailDto> {
    return detail(ctx)(await this.receipts.withdraw(ctx, id, warehouseId));
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: ReceiptDetailDto })
  async cancel(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ReceiptDetailDto> {
    return detail(ctx)(await this.receipts.cancel(ctx, id));
  }

  @Get(':id/costing')
  @RequirePermission(COSTS)
  @ApiOkResponse({ type: ReceiptCostingDto })
  async costing(@Param('id', ParseIntPipe) id: number): Promise<ReceiptCostingDto> {
    return toReceiptCostingDto(await this.receipts.costing(id));
  }

  @Put(':id/costs')
  @RequirePermission(COSTS)
  @Idempotent()
  @ApiOkResponse({ type: ReceiptCostingDto })
  async cost(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: CostReceiptDto,
  ): Promise<ReceiptCostingDto> {
    return toReceiptCostingDto(
      await this.receipts.cost(ctx, id, {
        costingVersion: body.costingVersion,
        ...(body.noteTotalAmount === undefined
          ? {}
          : { noteTotalAmount: new Decimal(body.noteTotalAmount) }),
        ...(body.discounts === undefined ? {} : { discounts: discountsInput(body.discounts) }),
        lines: body.lines.map((line) => ({
          lineId: line.lineId,
          ...(line.amount === undefined ? {} : { amount: new Decimal(line.amount) }),
          ...(line.unitPrice === undefined ? {} : { unitPrice: new Decimal(line.unitPrice) }),
          ...(line.freeGoods === undefined ? {} : { freeGoods: line.freeGoods }),
        })),
      }),
    );
  }
}

@ApiTags('inventory')
@Controller('receipt-lines')
export class ReceiptLinesController {
  constructor(private readonly receipts: ReceiptsService) {}

  @Patch(':id')
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: ReceiptDetailDto })
  async update(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateReceiptLineDto,
  ): Promise<ReceiptDetailDto> {
    return detail(ctx)(
      await this.receipts.updateLine(ctx, id, {
        ...(body.enteredQty === undefined ? {} : { enteredQty: new Decimal(body.enteredQty) }),
        ...(body.docUnitPrice === undefined ? {} : { docUnitPrice: money(body.docUnitPrice) }),
        ...(body.docAmount === undefined ? {} : { docAmount: money(body.docAmount) }),
        ...(body.freeGoods === undefined ? {} : { freeGoods: body.freeGoods }),
        ...(body.salePrice === undefined ? {} : { salePrice: money(body.salePrice) }),
      }),
    );
  }

  @Delete(':id')
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: ReceiptDetailDto })
  async remove(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ReceiptDetailDto> {
    return detail(ctx)(await this.receipts.removeLine(ctx, id));
  }
}
