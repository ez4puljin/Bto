import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Decimal } from '@tugeel/shared/money';
import { type AuthContext, CurrentUser, Idempotent, RequirePermission } from '../../identity';
import {
  SalesRepContextDto,
  SalesRepCustomerDetailDto,
  SalesRepCustomerPageDto,
  SalesRepCustomerQueryDto,
  SalesRepOrderDto,
  SalesRepOrderListQueryDto,
  SalesRepOrderPageDto,
  SalesRepOrderRequestDto,
  SalesRepProductBatchQueryDto,
  SalesRepProductDto,
  SalesRepProductPageDto,
  SalesRepProductQueryDto,
} from '../dto/sales-rep.dto';
import { REP } from '../services/rep-access';
import type { OrderDetail } from '../services/sales-order-query.service';
import { SalesRepOrdersService } from '../services/sales-rep-orders.service';
import { type RepProduct, SalesRepShopService } from '../services/sales-rep-shop.service';

const money = (value: Decimal | null): string | null => (value ? value.toFixed(0) : null);

function toRepOrder(order: OrderDetail): SalesRepOrderDto {
  return {
    id: order.id,
    number: order.number,
    status: order.status,
    customerId: order.customerId,
    customerCode: order.customerCode,
    customerName: order.customerName,
    fulfilment: order.fulfilment,
    deliveryDate: order.deliveryDate,
    addressText: order.addressText,
    contactName: order.contactName,
    contactPhone: order.contactPhone,
    paymentMethod: order.paymentMethod,
    note: order.note,
    subtotal: money(order.subtotal),
    discountTotal: money(order.discountTotal),
    total: money(order.total),
    boardName: order.boardName,
    pipelineName: order.pipelineName,
    stageName: order.stageName,
    cancelReason: order.cancelReason,
    createdAt: order.createdAt.toISOString(),
    lines: order.lines.map((line) => ({
      lineNo: line.lineNo,
      productId: line.productId,
      productSku: line.productSku,
      productName: line.productName,
      productUnitId: line.productUnitId,
      unitName: line.unitName,
      qty: line.qty.toString(),
      qtyBase: line.qtyBase.toString(),
      baseUnitName: line.baseUnitName,
      qtyApproved: line.qtyApproved.toString(),
      qtyBackordered: line.qtyBackordered.toString(),
      total: money(line.total),
      parts: line.parts.map((part) => ({
        uomName: part.uomName,
        basis: part.basis,
        qty: part.qty.toString(),
        unitPrice: part.unitPrice.toFixed(0),
        total: part.total.toFixed(0),
      })),
    })),
    events: order.events.map((event) => ({
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      reason: event.reason,
      createdAt: event.createdAt.toISOString(),
    })),
  };
}

function toRepProduct(product: RepProduct): SalesRepProductDto {
  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    categoryId: product.categoryId,
    thumbUrl: product.thumbUrl,
    sellable: product.sellable,
    available: product.available.toString(),
    units: product.units.map((unit) => ({
      id: unit.id,
      uomName: unit.uomName,
      factorToBase: unit.factorToBase.toString(),
      isBase: unit.isBase,
      barcodes: unit.barcodes,
      wholesale: money(unit.wholesale),
      basis: unit.basis,
    })),
  };
}

/**
 * The sales-rep app (ADR-0061 #5): the stages a rep may place on, new orders on the chosen stage,
 * the rep's own orders by month, the shop's products with prices and stock, and the customers an
 * order needs. Every route needs `sales.orders.rep` and answers for the caller's own data only.
 */
@ApiTags('sales-rep')
@Controller('sales-rep')
export class SalesRepController {
  constructor(
    private readonly orders: SalesRepOrdersService,
    private readonly shop: SalesRepShopService,
  ) {}

  @Get('context')
  @RequirePermission(REP)
  @ApiOkResponse({ type: SalesRepContextDto })
  context(@CurrentUser() ctx: AuthContext): Promise<SalesRepContextDto> {
    return this.orders.context(ctx);
  }

  @Post('orders')
  @RequirePermission(REP)
  @Idempotent()
  @ApiCreatedResponse({ type: SalesRepOrderDto })
  async create(
    @CurrentUser() ctx: AuthContext,
    @Body() body: SalesRepOrderRequestDto,
  ): Promise<SalesRepOrderDto> {
    const order = await this.orders.create(ctx, {
      stageId: body.stageId,
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
    return toRepOrder(order);
  }

  @Get('orders')
  @RequirePermission(REP)
  @ApiOkResponse({ type: SalesRepOrderPageDto })
  async list(
    @CurrentUser() ctx: AuthContext,
    @Query() query: SalesRepOrderListQueryDto,
  ): Promise<SalesRepOrderPageDto> {
    const page = await this.orders.list(ctx, query);
    return {
      data: page.data.map((row) => ({
        ...row,
        total: money(row.total),
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor: page.nextCursor,
      summary: page.summary,
    };
  }

  @Get('orders/:id')
  @RequirePermission(REP)
  @ApiOkResponse({ type: SalesRepOrderDto })
  async get(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<SalesRepOrderDto> {
    return toRepOrder(await this.orders.get(ctx, id));
  }

  @Get('products')
  @RequirePermission(REP)
  @ApiOkResponse({ type: SalesRepProductPageDto })
  async products(@Query() query: SalesRepProductQueryDto): Promise<SalesRepProductPageDto> {
    const page = await this.shop.productPage(query);
    return { data: page.data.map(toRepProduct), nextCursor: page.nextCursor };
  }

  @Get('products/batch')
  @RequirePermission(REP)
  @ApiOkResponse({ type: [SalesRepProductDto] })
  async productBatch(@Query() query: SalesRepProductBatchQueryDto): Promise<SalesRepProductDto[]> {
    const ids = query.productIds.split(',').map((id) => Number.parseInt(id, 10));
    return (await this.shop.productsOf(ids)).map(toRepProduct);
  }

  @Get('customers')
  @RequirePermission(REP)
  @ApiOkResponse({ type: SalesRepCustomerPageDto })
  customers(
    @CurrentUser() ctx: AuthContext,
    @Query() query: SalesRepCustomerQueryDto,
  ): Promise<SalesRepCustomerPageDto> {
    return this.shop.customerPage(ctx, query);
  }

  @Get('customers/:id')
  @RequirePermission(REP)
  @ApiOkResponse({ type: SalesRepCustomerDetailDto })
  customer(@Param('id', ParseIntPipe) id: number): Promise<SalesRepCustomerDetailDto> {
    return this.shop.customer(id);
  }
}
