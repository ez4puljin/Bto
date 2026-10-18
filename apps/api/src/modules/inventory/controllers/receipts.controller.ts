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
  CostReceiptDto,
  CreateReceiptDto,
  ReceiptCostingDto,
  ReceiptDetailDto,
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
  ...(line.binId === undefined ? {} : { binId: line.binId }),
  ...(line.docUnitPrice === undefined ? {} : { docUnitPrice: money(line.docUnitPrice) }),
  ...(line.docAmount === undefined ? {} : { docAmount: money(line.docAmount) }),
  ...(line.freeGoods === undefined ? {} : { freeGoods: line.freeGoods }),
});

/** Prices and totals only for cost holders (ADR-0033 #8, ADR-0078 #2). */
const detail = (ctx: AuthContext) => (receipt: Parameters<typeof toReceiptDetailDto>[0]) =>
  toReceiptDetailDto(receipt, ctx.permissions.has(COSTS));

/**
 * Goods receipts (ADR-0033): warehouse staff count and post them; every user reads them without
 * costs; the costs live behind inventory.costs.manage.
 */
@ApiTags('inventory')
@Controller('receipts')
export class ReceiptsController {
  constructor(private readonly receipts: ReceiptsService) {}

  @Get()
  @Authenticated()
  @ApiOkResponse({ type: ReceiptPageDto })
  async list(@Query() query: ReceiptListQueryDto): Promise<ReceiptPageDto> {
    const page = await this.receipts.list(query);
    return { data: page.data.map(toReceiptSummaryDto), nextCursor: page.nextCursor };
  }

  /** The cash boxes and bank accounts a receipt may name (ADR-0078 #5). */
  @Get('payment-accounts')
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: [ReceiptPaymentAccountDto] })
  async paymentAccounts(): Promise<ReceiptPaymentAccountDto[]> {
    return this.receipts.paymentAccounts();
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
        warehouseId: body.warehouseId,
        supplierId: body.supplierId,
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
    return detail(ctx)(await this.receipts.update(ctx, id, body));
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

  /** DRAFT → POSTED; idempotent so a retried click never posts twice. */
  @Post(':id/post')
  @HttpCode(200)
  @RequirePermission(MANAGE)
  @Idempotent()
  @ApiOkResponse({ type: ReceiptDetailDto })
  async post(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ReceiptDetailDto> {
    return detail(ctx)(await this.receipts.post(ctx, id));
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
        ...(body.binId === undefined ? {} : { binId: body.binId }),
        ...(body.docUnitPrice === undefined ? {} : { docUnitPrice: money(body.docUnitPrice) }),
        ...(body.docAmount === undefined ? {} : { docAmount: money(body.docAmount) }),
        ...(body.freeGoods === undefined ? {} : { freeGoods: body.freeGoods }),
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
