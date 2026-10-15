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
import { type AuthContext, CurrentUser, Idempotent, RequirePermission } from '../../identity';
import {
  SalesOrderCancelDto,
  SalesOrderDetailDto,
  SalesOrderListQueryDto,
  SalesOrderPageDto,
  SalesOrderProductInfoDto,
  SalesOrderProductInfoQueryDto,
  SalesOrderRequestDto,
} from '../dto/sales-orders.dto';
import {
  type OrderDetail,
  type OrderInput,
  SalesOrdersService,
} from '../services/sales-orders.service';

const READ = 'sales.orders.read';
const MANAGE = 'sales.orders.manage';

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);
const money = (value: Decimal | null): string | null => (value ? value.toFixed(0) : null);

const inputOf = (body: SalesOrderRequestDto): OrderInput => ({
  customerId: body.customerId,
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
    events: order.events.map((event) => ({
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      reason: event.reason,
      actorId: event.actorId,
      createdAt: event.createdAt.toISOString(),
    })),
  };
}

/**
 * Customer orders (SO-, ADR-0055): `sales.orders.read` lists and opens them; `sales.orders.manage`
 * enters drafts, submits (which confirms and reserves) and cancels.
 */
@ApiTags('sales')
@Controller('sales-orders')
export class SalesOrdersController {
  constructor(private readonly orders: SalesOrdersService) {}

  @Get()
  @RequirePermission(READ)
  @ApiOkResponse({ type: SalesOrderPageDto })
  async list(@Query() query: SalesOrderListQueryDto): Promise<SalesOrderPageDto> {
    const page = await this.orders.list(query);
    return {
      data: page.data.map((row) => ({
        ...row,
        total: money(row.total),
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor: page.nextCursor,
    };
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
  async get(@Param('id', ParseIntPipe) id: number): Promise<SalesOrderDetailDto> {
    return toDetail(await this.orders.get(id));
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

  /** Replaces a draft's header and lines. */
  @Put(':id')
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: SalesOrderDetailDto })
  async update(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: SalesOrderRequestDto,
  ): Promise<SalesOrderDetailDto> {
    return toDetail(await this.orders.update(ctx, id, inputOf(body)));
  }

  /** DRAFT → CONFIRMED: number, prices frozen, stock reserved (the rest backordered). */
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
