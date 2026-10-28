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
  CurrentUser,
  Idempotent,
  RequirePermission,
} from '../../identity';
import {
  AddSuppliersDto,
  CreatePurchaseOrderDto,
  GridPageDto,
  GridQueryDto,
  GridSaveResultDto,
  MoveSupplierDto,
  OrdererCandidateDto,
  PrintDto,
  PrintQueryDto,
  PurchaseOrderDetailDto,
  PurchaseOrderListQueryDto,
  PurchaseOrderPageDto,
  SaveGridDto,
  SetOrdererDto,
  SupplierOrdererDto,
  UpdatePurchaseOrderDto,
} from '../dto/purchase-orders.dto';
import { PurchaseOrderGridService } from '../services/purchase-order-grid.service';
import {
  type PurchaseOrderDetail,
  PurchaseOrdersService,
} from '../services/purchase-orders.service';
import { SupplierOrderersService } from '../services/supplier-orderers.service';
import { EDIT, MANAGE, PRICES, READ } from '../services/support';

const decimal = (value: string | null) => (value === null ? null : new Decimal(value));

function toDetailDto(order: PurchaseOrderDetail): PurchaseOrderDetailDto {
  return {
    id: order.id,
    number: order.number,
    orderDate: order.orderDate,
    note: order.note,
    status: order.status,
    createdBy: order.createdBy,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    suppliers: order.suppliers.map((supplier) => ({
      ...supplier,
      statusChangedAt: supplier.statusChangedAt.toISOString(),
      qtyBase: supplier.qtyBase.toFixed(),
      weightKg: supplier.weightKg.toFixed(),
      estimatedCost: supplier.estimatedCost?.toFixed(2) ?? null,
    })),
  };
}

/**
 * Purchase orders by supplier (ADR-0115): readers see them; editors type quantities where the
 * supplier's status and their role allow (the service checks each cell); managers create orders,
 * add suppliers and move every supplier; the last prices and estimated costs are for price readers.
 */
@ApiTags('procurement')
@Controller('purchase-orders')
export class PurchaseOrdersController {
  constructor(
    private readonly orders: PurchaseOrdersService,
    private readonly grid: PurchaseOrderGridService,
  ) {}

  @Get()
  @RequirePermission(READ)
  @ApiOkResponse({ type: PurchaseOrderPageDto })
  async list(
    @CurrentUser() ctx: AuthContext,
    @Query() query: PurchaseOrderListQueryDto,
  ): Promise<PurchaseOrderPageDto> {
    const page = await this.orders.list(ctx, query);
    return {
      data: page.data.map((order) => ({ ...order, createdAt: order.createdAt.toISOString() })),
      nextCursor: page.nextCursor,
    };
  }

  @Post()
  @RequirePermission(MANAGE)
  @Idempotent()
  @ApiCreatedResponse({ type: PurchaseOrderDetailDto })
  async create(
    @CurrentUser() ctx: AuthContext,
    @Body() body: CreatePurchaseOrderDto,
  ): Promise<PurchaseOrderDetailDto> {
    return toDetailDto(
      await this.orders.create(ctx, {
        supplierIds: body.supplierIds,
        ...(body.orderDate === undefined ? {} : { orderDate: body.orderDate }),
        ...(body.note === undefined ? {} : { note: body.note }),
      }),
    );
  }

  @Get(':id')
  @RequirePermission(READ)
  @ApiOkResponse({ type: PurchaseOrderDetailDto })
  async get(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<PurchaseOrderDetailDto> {
    return toDetailDto(await this.orders.get(ctx, id));
  }

  @Patch(':id')
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: PurchaseOrderDetailDto })
  async update(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdatePurchaseOrderDto,
  ): Promise<PurchaseOrderDetailDto> {
    return toDetailDto(
      await this.orders.update(ctx, id, body.note === undefined ? {} : { note: body.note }),
    );
  }

  @Post(':id/suppliers')
  @HttpCode(200)
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: PurchaseOrderDetailDto })
  async addSuppliers(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: AddSuppliersDto,
  ): Promise<PurchaseOrderDetailDto> {
    return toDetailDto(await this.orders.addSuppliers(ctx, id, body.supplierIds));
  }

  @Delete(':id/suppliers/:supplierId')
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: PurchaseOrderDetailDto })
  async removeSupplier(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Param('supplierId', ParseIntPipe) supplierId: number,
  ): Promise<PurchaseOrderDetailDto> {
    return toDetailDto(await this.orders.removeSupplier(ctx, id, supplierId));
  }

  /** One status forward or back; «Ирсэн» makes the draft receipt. Idempotent: never twice. */
  @Post(':id/suppliers/:supplierId/status')
  @HttpCode(200)
  @RequirePermission(READ)
  @Idempotent()
  @ApiOkResponse({ type: PurchaseOrderDetailDto })
  async move(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Param('supplierId', ParseIntPipe) supplierId: number,
    @Body() body: MoveSupplierDto,
  ): Promise<PurchaseOrderDetailDto> {
    return toDetailDto(await this.orders.move(ctx, id, supplierId, body.to));
  }

  @Get(':id/suppliers/:supplierId/rows')
  @RequirePermission(READ)
  @ApiOkResponse({ type: GridPageDto })
  async rows(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Param('supplierId', ParseIntPipe) supplierId: number,
    @Query() query: GridQueryDto,
  ): Promise<GridPageDto> {
    const page = await this.grid.rows(ctx, id, supplierId, query);
    const withPrices = ctx.permissions.has(PRICES);
    return {
      ...page,
      data: page.data.map((row) => ({
        productId: row.productId,
        sku: row.sku,
        name: row.name,
        weightKg: row.weightKg?.toFixed() ?? null,
        units: row.units.map((unit) => ({ ...unit, factor: unit.factor.toFixed() })),
        homeWarehouseId: row.homeWarehouseId,
        homeWarehouseName: row.homeWarehouseName,
        onHand: row.onHand.toFixed(),
        minQty: row.minQty?.toFixed() ?? null,
        lastMonthOut: row.lastMonthOut.toFixed(),
        ...(withPrices
          ? {
              lastBasePrice: row.lastBasePrice?.toFixed(2) ?? null,
              lastPriceDate: row.lastPriceDate,
            }
          : {}),
        line: row.line
          ? {
              productUnitId: row.line.productUnitId,
              qty: row.line.qty.toFixed(),
              qtyBase: row.line.qtyBase.toFixed(),
            }
          : null,
        editable: row.editable,
      })),
    };
  }

  /** Writes only the changed cells, each against the value the page opened with (ADR-0115). */
  @Put(':id/suppliers/:supplierId/lines')
  @RequirePermission(EDIT)
  @ApiOkResponse({ type: GridSaveResultDto })
  async saveLines(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Param('supplierId', ParseIntPipe) supplierId: number,
    @Body() body: SaveGridDto,
  ): Promise<GridSaveResultDto> {
    const result = await this.grid.saveLines(
      ctx,
      id,
      supplierId,
      body.changes.map((change) => ({
        productId: change.productId,
        productUnitId: change.productUnitId ?? null,
        qty: decimal(change.qty ?? null),
        previous:
          change.previousUnitId === null ||
          change.previousUnitId === undefined ||
          change.previousQty === null ||
          change.previousQty === undefined
            ? null
            : { productUnitId: change.previousUnitId, qty: new Decimal(change.previousQty) },
      })),
    );
    return {
      applied: result.applied,
      conflicts: result.conflicts.map((conflict) => ({
        ...conflict,
        qty: conflict.qty?.toFixed() ?? null,
      })),
      refused: result.refused,
    };
  }

  /** The order sheets for the browser print (no PDF, ADR-0058). */
  @Get(':id/print')
  @RequirePermission(READ)
  @ApiOkResponse({ type: PrintDto })
  async print(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: PrintQueryDto,
  ): Promise<PrintDto> {
    const order = await this.orders.get(ctx, id);
    const sheets = await this.grid.sheets(id, query.supplierId);
    return {
      number: order.number,
      orderDate: order.orderDate,
      note: order.note,
      sheets: sheets.map((sheet) => {
        const supplier = order.suppliers.find((row) => row.supplierId === sheet.supplierId);
        return {
          supplierId: sheet.supplierId,
          supplierName: supplier?.supplierName ?? '',
          status: supplier?.status ?? 'PREPARING',
          ordererName: supplier?.ordererName ?? null,
          lines: sheet.lines.map((line) => ({
            ...line,
            qty: line.qty.toFixed(),
            qtyBase: line.qtyBase.toFixed(),
            weightKg: line.weightKg?.toFixed(3) ?? null,
          })),
        };
      }),
    };
  }
}

/** Each supplier's orderer (ADR-0115): read by order readers, set by managers. */
@ApiTags('procurement')
@Controller('procurement')
export class SupplierOrderersController {
  constructor(private readonly orderers: SupplierOrderersService) {}

  @Get('orderer-candidates')
  @RequirePermission(READ)
  @ApiOkResponse({ type: [OrdererCandidateDto] })
  candidates(): Promise<OrdererCandidateDto[]> {
    return this.orderers.candidates();
  }

  @Get('supplier-orderers/:supplierId')
  @RequirePermission(READ)
  @ApiOkResponse({ type: SupplierOrdererDto })
  get(@Param('supplierId', ParseIntPipe) supplierId: number): Promise<SupplierOrdererDto> {
    return this.orderers.get(supplierId);
  }

  @Put('supplier-orderers/:supplierId')
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: SupplierOrdererDto })
  set(
    @CurrentUser() ctx: AuthContext,
    @Param('supplierId', ParseIntPipe) supplierId: number,
    @Body() body: SetOrdererDto,
  ): Promise<SupplierOrdererDto> {
    return this.orderers.set(ctx, supplierId, body.userId ?? null);
  }
}
