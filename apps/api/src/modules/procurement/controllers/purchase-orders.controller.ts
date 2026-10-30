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
  StreamableFile,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiProduces, ApiTags } from '@nestjs/swagger';
import { XLSX_CONTENT_TYPE } from '@tugeel/shared/files';
import mn from '@tugeel/shared/i18n/mn.json';
import { Decimal } from '@tugeel/shared/money';
import { type ExcelColumn, tableWorkbook } from '../../../common/excel/table-workbook';
import { xlsxFile } from '../../../common/excel/xlsx-file';
import { type AuthContext, CurrentUser, Idempotent, RequirePermission } from '../../identity';
import {
  AddSuppliersDto,
  ArrivalSaveResultDto,
  CreatePurchaseOrderDto,
  GridFacetsDto,
  GridFacetsQueryDto,
  GridPageDto,
  GridQueryDto,
  GridRowDto,
  GridSaveResultDto,
  HistoryPageDto,
  HistoryQueryDto,
  MoveSupplierDto,
  OrdererCandidateDto,
  PrintDto,
  PrintQueryDto,
  PurchaseOrderDetailDto,
  PurchaseOrderListQueryDto,
  PurchaseOrderPageDto,
  PurchaseOrderVersionDto,
  SaveArrivalsDto,
  SaveGridDto,
  SetOrdererDto,
  SupplierCandidatePageDto,
  SupplierOrdererDto,
  UpdatePurchaseOrderDto,
} from '../dto/purchase-orders.dto';
import { OrderHistoryService } from '../services/order-history.service';
import { type GridRow, PurchaseOrderGridService } from '../services/purchase-order-grid.service';
import {
  type PurchaseOrderDetail,
  PurchaseOrdersService,
} from '../services/purchase-orders.service';
import { SupplierOrderersService } from '../services/supplier-orderers.service';
import { COSTS, EDIT, MANAGE, PRICES, READ } from '../services/support';

const decimal = (value: string | null) => (value === null ? null : new Decimal(value));
const fixed = (value: Decimal | null) => (value === null ? null : value.toFixed());
const money = (value: Decimal | null) => (value === null ? null : value.toFixed(2));

const X = mn.procurement.excel;

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
    archivedAt: order.archivedAt?.toISOString() ?? null,
    archivedBy: order.archivedBy,
    canArchive: order.canArchive,
    suppliers: order.suppliers.map((supplier) => ({
      ...supplier,
      statusChangedAt: supplier.statusChangedAt.toISOString(),
      boxes: supplier.boxes.toFixed(),
      qtyBase: supplier.qtyBase.toFixed(),
      weightKg: supplier.weightKg.toFixed(),
      shippedBase: supplier.shippedBase.toFixed(),
      arrivedBase: fixed(supplier.arrivedBase),
      estimatedCost: money(supplier.estimatedCost),
      finalAmount: money(supplier.finalAmount),
      noteTotalQty: fixed(supplier.noteTotalQty),
      noteTotalAmount: money(supplier.noteTotalAmount),
    })),
  };
}

function toRowDto(row: GridRow, withPrices: boolean, withCosts: boolean): GridRowDto {
  return {
    productId: row.productId,
    sku: row.sku,
    name: row.name,
    weightKg: fixed(row.weightKg),
    units: row.units.map((unit) => ({ ...unit, factor: unit.factor.toFixed() })),
    homeWarehouseId: row.homeWarehouseId,
    homeWarehouseName: row.homeWarehouseName,
    onHand: row.onHand.toFixed(),
    minQty: fixed(row.minQty),
    lastMonthOut: row.lastMonthOut.toFixed(),
    sales: {
      avg12: row.sales.avg12.toFixed(),
      avg3: row.sales.avg3.toFixed(),
      lastMonth: row.sales.lastMonth.toFixed(),
      sameMonthLastYear: row.sales.sameMonthLastYear.toFixed(),
    },
    ...(withPrices
      ? { lastBasePrice: money(row.lastBasePrice), lastPriceDate: row.lastPriceDate }
      : {}),
    line: row.line
      ? {
          productUnitId: row.line.productUnitId,
          qty: row.line.qty.toFixed(),
          qtyBase: row.line.qtyBase.toFixed(),
          shippedQty: fixed(row.line.shippedQty),
        }
      : null,
    editable: row.editable,
    canShip: row.canShip,
    receipt: row.receipt
      ? {
          lineId: row.receipt.lineId,
          warehouseId: row.receipt.warehouseId,
          unitName: row.receipt.unitName,
          factor: row.receipt.factor.toFixed(),
          expectedBase: fixed(row.receipt.expectedBase),
          arrivedBase: fixed(row.receipt.arrivedBase),
          checkedAt: row.receipt.checkedAt?.toISOString() ?? null,
          note: row.receipt.note,
          confirmed: row.receipt.confirmed,
          canCount: row.receipt.canCount,
          ...(withCosts
            ? {
                docUnitPrice: money(row.receipt.docUnitPrice),
                docAmount: money(row.receipt.docAmount),
                previousUnitPrice: money(row.receipt.previousUnitPrice),
                previousDate: row.receipt.previousDate,
              }
            : {}),
        }
      : null,
    extra: row.extra,
  };
}

/**
 * Purchase orders by supplier (ADR-0115, ADR-0118): readers see them; editors type quantities
 * where the supplier's status and their role allow (the service checks each cell); managers create
 * orders, add suppliers, move every supplier and archive finished orders; the last prices and
 * estimated costs are for price readers; the counts and prices on the order page go through
 * inventory's receipt services.
 */
@ApiTags('procurement')
@Controller('purchase-orders')
export class PurchaseOrdersController {
  constructor(
    private readonly orders: PurchaseOrdersService,
    private readonly grid: PurchaseOrderGridService,
    private readonly orderHistory: OrderHistoryService,
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
      data: page.data.map((order) => ({
        ...order,
        archivedAt: order.archivedAt?.toISOString() ?? null,
        createdAt: order.createdAt.toISOString(),
      })),
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

  /** The stamps the page polls to show «Өөр хэрэглэгч энэ захиалгыг шинэчиллээ» (ADR-0118 #3). */
  @Get(':id/version')
  @RequirePermission(READ)
  @ApiOkResponse({ type: PurchaseOrderVersionDto })
  async version(@Param('id', ParseIntPipe) id: number): Promise<PurchaseOrderVersionDto> {
    const version = await this.orders.version(id);
    return {
      updatedAt: version.updatedAt.toISOString(),
      receiptsUpdatedAt: version.receiptsUpdatedAt?.toISOString() ?? null,
    };
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

  /** Takes a finished order out of the list (ADR-0118 #7); a repeated click changes nothing. */
  @Post(':id/archive')
  @HttpCode(200)
  @RequirePermission(MANAGE)
  @Idempotent()
  @ApiOkResponse({ type: PurchaseOrderDetailDto })
  async archive(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<PurchaseOrderDetailDto> {
    return toDetailDto(await this.orders.archive(ctx, id));
  }

  @Post(':id/unarchive')
  @HttpCode(200)
  @RequirePermission(MANAGE)
  @Idempotent()
  @ApiOkResponse({ type: PurchaseOrderDetailDto })
  async unarchive(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<PurchaseOrderDetailDto> {
    return toDetailDto(await this.orders.unarchive(ctx, id));
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
    const withCosts = ctx.permissions.has(COSTS);
    return {
      ...page,
      data: page.data.map((row) => toRowDto(row, withPrices, withCosts)),
      extra: page.extra.map((row) => toRowDto(row, withPrices, withCosts)),
      receipt: page.receipt
        ? {
            ...page.receipt,
            noteTotalQty: fixed(page.receipt.noteTotalQty),
            noteTotalAmount: money(page.receipt.noteTotalAmount),
          }
        : null,
    };
  }

  /** How many rows the filters keep per supplier: the filter bar's counts and its supplier list. */
  @Get(':id/facets')
  @RequirePermission(READ)
  @ApiOkResponse({ type: GridFacetsDto })
  facets(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: GridFacetsQueryDto,
  ): Promise<GridFacetsDto> {
    return this.grid.facets(id, query);
  }

  /**
   * Writes only the changed cells, each against the value the page opened with (ADR-0115): the
   * ordered quantities, and the shipped ones in «Ачигдаж байна» (ADR-0118 #1).
   */
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
      body.changes.map((change) => {
        const field = change.field ?? 'ORDERED';
        const previousQty = change.previousQty ?? null;
        return {
          productId: change.productId,
          field,
          productUnitId: change.productUnitId ?? null,
          qty: decimal(change.qty ?? null),
          previous:
            previousQty === null ||
            (field === 'ORDERED' &&
              (change.previousUnitId === null || change.previousUnitId === undefined))
              ? null
              : { productUnitId: change.previousUnitId ?? null, qty: new Decimal(previousQty) },
        };
      }),
    );
    return {
      applied: result.applied,
      conflicts: result.conflicts.map((conflict) => ({ ...conflict, qty: fixed(conflict.qty) })),
      refused: result.refused,
    };
  }

  /**
   * The keepers' counts typed on the order page in «Ирсэн» (ADR-0118 #5): boxes × pieces as a base
   * quantity and a note on a difference, each line against the count the page opened with. The
   * service checks the caller's warehouse per line (a manager counts every line).
   */
  @Put(':id/suppliers/:supplierId/arrivals')
  @RequirePermission(READ)
  @ApiOkResponse({ type: ArrivalSaveResultDto })
  async saveArrivals(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Param('supplierId', ParseIntPipe) supplierId: number,
    @Body() body: SaveArrivalsDto,
  ): Promise<ArrivalSaveResultDto> {
    const result = await this.grid.saveArrivals(
      ctx,
      id,
      supplierId,
      body.changes.map((change) => ({
        lineId: change.lineId,
        ...(change.arrivedQtyBase === undefined
          ? {}
          : { arrivedQtyBase: new Decimal(change.arrivedQtyBase) }),
        ...(change.note === undefined ? {} : { note: change.note }),
        previousArrivedQtyBase: decimal(change.previousArrivedQtyBase ?? null),
      })),
    );
    return {
      applied: result.applied,
      conflicts: result.conflicts.map((conflict) => ({
        ...conflict,
        arrivedQtyBase: fixed(conflict.arrivedQtyBase),
      })),
      refused: result.refused,
    };
  }

  /** The order's history (ADR-0118 #6): who changed what, newest first. */
  @Get(':id/history')
  @RequirePermission(READ)
  @ApiOkResponse({ type: HistoryPageDto })
  async history(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: HistoryQueryDto,
  ): Promise<HistoryPageDto> {
    const page = await this.orderHistory.list(id, query);
    return {
      data: page.data.map((row) => ({ ...row, at: row.at.toISOString() })),
      nextCursor: page.nextCursor,
    };
  }

  @Get(':id/history.xlsx')
  @RequirePermission(READ)
  @ApiProduces(XLSX_CONTENT_TYPE)
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  async historyExcel(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: HistoryQueryDto,
  ): Promise<StreamableFile> {
    const order = await this.orders.get(ctx, id);
    const buffer = await this.orderHistory.workbook(id, query);
    return xlsxFile(
      buffer,
      `${order.number}-history`,
      `${order.number} ${mn.procurement.history.title}`,
    );
  }

  /** The order as one sheet (ADR-0118 #7): every supplier's lines with what was ordered, shipped and arrived. */
  @Get(':id/export.xlsx')
  @RequirePermission(READ)
  @ApiProduces(XLSX_CONTENT_TYPE)
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  async exportExcel(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<StreamableFile> {
    const order = await this.orders.get(ctx, id);
    const lines = await this.grid.exportLines(ctx, id);
    const withPrices = ctx.permissions.has(PRICES);
    const columns: ExcelColumn[] = [
      { name: X.supplier, kind: 'text' },
      { name: X.sku, kind: 'text' },
      { name: X.name, kind: 'text' },
      { name: X.warehouse, kind: 'text' },
      { name: X.ordered, kind: 'number' },
      { name: X.unit, kind: 'text' },
      { name: X.orderedBase, kind: 'number' },
      { name: X.shipped, kind: 'number' },
      { name: X.arrived, kind: 'number' },
      { name: X.difference, kind: 'number' },
      ...(withPrices
        ? [
            { name: X.unitPrice, kind: 'number' as const },
            { name: X.amount, kind: 'number' as const },
          ]
        : []),
    ];
    const buffer = await tableWorkbook(order.number, { yes: '', no: '' }, (sheet) => {
      sheet.addRows(
        columns,
        lines.map((line) => [
          line.supplierName,
          line.sku,
          line.name,
          line.warehouseName,
          fixed(line.orderedQty),
          line.unitName,
          fixed(line.orderedBase),
          fixed(line.shippedQty),
          fixed(line.arrivedBase),
          fixed(line.difference),
          ...(withPrices ? [money(line.unitPrice), money(line.amount)] : []),
        ]),
      );
      return Promise.resolve();
    });
    return xlsxFile(buffer, order.number, `${order.number} ${mn.procurement.orders.title}`);
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
  constructor(
    private readonly orderers: SupplierOrderersService,
    private readonly orders: PurchaseOrdersService,
  ) {}

  /** Every active supplier with its main-product count: the new-order dialog's list (one page). */
  @Get('supplier-candidates')
  @RequirePermission(READ)
  @ApiOkResponse({ type: SupplierCandidatePageDto })
  async supplierCandidates(): Promise<SupplierCandidatePageDto> {
    return { data: await this.orders.supplierCandidates(), nextCursor: null };
  }

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
