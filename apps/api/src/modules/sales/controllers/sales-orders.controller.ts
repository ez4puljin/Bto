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
import { PRINT_KINDS, type PrintKind } from '@tugeel/shared/sales';
import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { type AuthContext, CurrentUser, Idempotent, RequirePermission } from '../../identity';
import {
  SalesOrderBatchQueryDto,
  SalesOrderCancelDto,
  SalesOrderDetailDto,
  SalesOrderListQueryDto,
  SalesOrderMoveRequestDto,
  SalesOrderPageDto,
  SalesOrderPickLineInfoDto,
  SalesOrderPickRequestDto,
  SalesOrderProductInfoDto,
  SalesOrderProductInfoQueryDto,
  SalesOrderRequestDto,
} from '../dto/sales-orders.dto';
import { type OrderDetail, SalesOrderQueryService } from '../services/sales-order-query.service';
import { type OrderInput, SalesOrdersService } from '../services/sales-orders.service';

const READ = 'sales.orders.read';
const MANAGE = 'sales.orders.manage';
const PICK = 'sales.orders.pick';

@ApiSchema({ name: 'SalesOrderMoveResult' })
class SalesOrderMoveResultDto {
  @ApiProperty({ type: SalesOrderDetailDto }) order: SalesOrderDetailDto;
  @ApiProperty({ enum: PRINT_KINDS, isArray: true, description: 'Documents the stage prints' })
  print: PrintKind[];
}

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);
const money = (value: Decimal | null): string | null => (value ? value.toFixed(0) : null);

const inputOf = (body: SalesOrderRequestDto): OrderInput => ({
  customerId: body.customerId,
  pipelineId: body.pipelineId ?? null,
  stageId: body.stageId ?? null,
  fulfilment: body.fulfilment,
  deliveryDate: body.deliveryDate,
  addressId: body.addressId ?? null,
  contactName: body.contactName ?? null,
  contactPhone: body.contactPhone ?? null,
  paymentMethod: body.paymentMethod,
  note: body.note ?? null,
  lines: body.lines.map((line) => ({
    productUnitId: line.productUnitId,
    qty: new Decimal(line.qty),
  })),
});

function toDetail(order: OrderDetail): SalesOrderDetailDto {
  return {
    id: order.id,
    number: order.number,
    channel: order.channel,
    status: order.status,
    customerId: order.customerId,
    customerCode: order.customerCode,
    customerName: order.customerName,
    fulfilment: order.fulfilment,
    deliveryDate: order.deliveryDate,
    addressId: order.addressId,
    addressText: order.addressText,
    addressLat: order.addressLat?.toFixed(6) ?? null,
    addressLng: order.addressLng?.toFixed(6) ?? null,
    contactName: order.contactName,
    contactPhone: order.contactPhone,
    paymentMethod: order.paymentMethod,
    note: order.note,
    priceDate: order.priceDate,
    subtotal: money(order.subtotal),
    discountTotal: money(order.discountTotal),
    total: money(order.total),
    submittedAt: iso(order.submittedAt),
    confirmedAt: iso(order.confirmedAt),
    cancelledAt: iso(order.cancelledAt),
    cancelReason: order.cancelReason,
    boardId: order.boardId,
    boardName: order.boardName,
    pipelineId: order.pipelineId,
    pipelineName: order.pipelineName,
    stageId: order.stageId,
    stageName: order.stageName,
    stageEnteredAt: iso(order.stageEnteredAt),
    pickedAt: iso(order.pickedAt),
    deliveredAt: iso(order.deliveredAt),
    archivedAt: iso(order.archivedAt),
    createdByName: order.createdByName,
    canEdit: order.canEdit,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    lines: order.lines.map((line) => ({
      id: line.id,
      lineNo: line.lineNo,
      productId: line.productId,
      productSku: line.productSku,
      productName: line.productName,
      productUnitId: line.productUnitId,
      unitName: line.unitName,
      qty: line.qty.toString(),
      factorSnapshot: line.factorSnapshot.toString(),
      qtyBase: line.qtyBase.toString(),
      baseUnitName: line.baseUnitName,
      warehouseId: line.warehouseId,
      qtyApproved: line.qtyApproved.toString(),
      qtyBackordered: line.qtyBackordered.toString(),
      qtyPicked: line.qtyPicked?.toString() ?? null,
      pickBinId: line.pickBinId,
      pickBinCode: line.pickBinCode,
      qtyDelivered: line.qtyDelivered?.toString() ?? null,
      subtotal: money(line.subtotal),
      discountAmount: money(line.discountAmount),
      total: money(line.total),
      parts: line.parts.map((part) => ({
        productUnitId: part.productUnitId,
        uomName: part.uomName,
        basis: part.basis,
        qty: part.qty.toString(),
        factorSnapshot: part.factorSnapshot.toString(),
        qtyBase: part.qtyBase.toString(),
        listPrice: part.listPrice.toFixed(0),
        unitPrice: part.unitPrice.toFixed(0),
        subtotal: part.subtotal.toFixed(0),
        discountAmount: part.discountAmount.toFixed(0),
        total: part.total.toFixed(0),
        applied: Array.isArray(part.applied)
          ? (part.applied as SalesOrderDetailDto['lines'][number]['parts'][number]['applied'])
          : [],
      })),
    })),
    moves: order.moves.map((move) => ({
      fromStageId: move.fromStageId,
      toStageId: move.toStageId,
      fromStageName: move.fromStageName,
      toStageName: move.toStageName,
      actorId: move.actorId,
      actorName: move.actorName,
      createdAt: move.createdAt.toISOString(),
    })),
    events: order.events.map((event) => ({
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      reason: event.reason,
      actorId: event.actorId,
      actorName: event.actorName,
      createdAt: event.createdAt.toISOString(),
    })),
  };
}

/**
 * Customer orders (ADR-0055, ADR-0057): `sales.orders.read` lists and opens those the caller sees;
 * `sales.orders.manage` enters drafts, submits (which confirms and reserves) and cancels.
 */
@ApiTags('sales')
@Controller('sales-orders')
export class SalesOrdersController {
  constructor(
    private readonly orders: SalesOrdersService,
    private readonly queries: SalesOrderQueryService,
  ) {}

  @Get()
  @RequirePermission(READ)
  @ApiOkResponse({ type: SalesOrderPageDto })
  async list(
    @CurrentUser() ctx: AuthContext,
    @Query() query: SalesOrderListQueryDto,
  ): Promise<SalesOrderPageDto> {
    const page = await this.queries.list(ctx, {
      ...query,
      pipeline:
        query.pipeline === undefined
          ? undefined
          : query.pipeline === 'none'
            ? 'none'
            : Number.parseInt(query.pipeline, 10),
    });
    return {
      data: page.data.map((row) => ({
        ...row,
        total: money(row.total),
        archivedAt: iso(row.archivedAt),
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor: page.nextCursor,
      total: page.total,
    };
  }

  /** Up to 100 orders the caller sees, whole, for one printed page (ADR-0057 #7). */
  @Get('batch')
  @RequirePermission(READ)
  @ApiOkResponse({ type: [SalesOrderDetailDto] })
  async batch(
    @CurrentUser() ctx: AuthContext,
    @Query() query: SalesOrderBatchQueryDto,
  ): Promise<SalesOrderDetailDto[]> {
    const ids = query.ids.split(',').map((id) => Number.parseInt(id, 10));
    return (await this.queries.batch(ctx, ids)).map(toDetail);
  }

  /** What the order screen shows for products it adds: home warehouse, sellable, available. */
  @Get('product-info')
  @RequirePermission(READ)
  @ApiOkResponse({ type: [SalesOrderProductInfoDto] })
  async productInfo(
    @Query() query: SalesOrderProductInfoQueryDto,
  ): Promise<SalesOrderProductInfoDto[]> {
    const ids = query.productIds.split(',').map((id) => Number.parseInt(id, 10));
    return (await this.orders.productInfo(ids)).map((info) => ({
      ...info,
      available: info.available.toString(),
    }));
  }

  @Get(':id')
  @RequirePermission(READ)
  @ApiOkResponse({ type: SalesOrderDetailDto })
  async get(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<SalesOrderDetailDto> {
    return toDetail(await this.orders.get(ctx, id));
  }

  @Post()
  @RequirePermission(MANAGE)
  @Idempotent()
  @ApiCreatedResponse({ type: SalesOrderDetailDto })
  async create(
    @CurrentUser() ctx: AuthContext,
    @Body() body: SalesOrderRequestDto,
  ): Promise<SalesOrderDetailDto> {
    return toDetail(await this.orders.create(ctx, inputOf(body)));
  }

  /**
   * Replaces the header and lines of a draft or a reserved order; the stage's EDIT right decides
   * on a board, `sales.orders.manage` off it.
   */
  @Put(':id')
  @RequirePermission(READ)
  @ApiOkResponse({ type: SalesOrderDetailDto })
  async update(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: SalesOrderRequestDto,
  ): Promise<SalesOrderDetailDto> {
    return toDetail(await this.orders.update(ctx, id, inputOf(body)));
  }

  /** Moves the card to a stage of its board and runs the stage's action (ADR-0056 #3). */
  @Post(':id/move')
  @HttpCode(200)
  @RequirePermission(READ)
  @Idempotent()
  @ApiOkResponse({ type: SalesOrderMoveResultDto })
  async move(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: SalesOrderMoveRequestDto,
  ): Promise<SalesOrderMoveResultDto> {
    const result = await this.orders.move(ctx, id, {
      stageId: body.stageId,
      reason: body.reason ?? null,
    });
    return { order: toDetail(result.order), print: result.print };
  }

  /** What the pick form proposes per line (ADR-0056 #5). */
  @Get(':id/pick-info')
  @RequirePermission(PICK)
  @ApiOkResponse({ type: [SalesOrderPickLineInfoDto] })
  async pickInfo(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<SalesOrderPickLineInfoDto[]> {
    return (await this.orders.pickInfo(ctx, id)).map((line) => ({
      ...line,
      bins: line.bins.map((bin) => ({ ...bin, onHand: bin.onHand.toString() })),
    }));
  }

  /** The picked counts confirmed: stock to STAGING, reservations consumed, PACKED. */
  @Post(':id/pick')
  @HttpCode(200)
  @RequirePermission(PICK)
  @Idempotent()
  @ApiOkResponse({ type: SalesOrderDetailDto })
  async pick(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: SalesOrderPickRequestDto,
  ): Promise<SalesOrderDetailDto> {
    return toDetail(
      await this.orders.pick(
        ctx,
        id,
        body.lines.map((line) => ({
          lineId: line.lineId,
          qty: new Decimal(line.qty),
          binId: line.binId,
        })),
      ),
    );
  }

  /** DRAFT → CONFIRMED: prices frozen, stock reserved (the rest backordered). */
  @Post(':id/submit')
  @HttpCode(200)
  @RequirePermission(MANAGE)
  @Idempotent()
  @ApiOkResponse({ type: SalesOrderDetailDto })
  async submit(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<SalesOrderDetailDto> {
    return toDetail(await this.orders.submit(ctx, id));
  }

  /** Takes a finished order off the board; it stays in the list (ADR-0057 #5). */
  @Post(':id/archive')
  @HttpCode(200)
  @RequirePermission(READ)
  @ApiOkResponse({ type: SalesOrderDetailDto })
  async archive(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<SalesOrderDetailDto> {
    return toDetail(await this.orders.archive(ctx, id));
  }

  @Post(':id/unarchive')
  @HttpCode(200)
  @RequirePermission(READ)
  @ApiOkResponse({ type: SalesOrderDetailDto })
  async unarchive(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<SalesOrderDetailDto> {
    return toDetail(await this.orders.unarchive(ctx, id));
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermission(MANAGE)
  @Idempotent()
  @ApiOkResponse({ type: SalesOrderDetailDto })
  async cancel(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: SalesOrderCancelDto,
  ): Promise<SalesOrderDetailDto> {
    return toDetail(await this.orders.cancel(ctx, id, body.reason));
  }
}
