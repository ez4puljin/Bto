import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Decimal } from '@tugeel/shared/money';
import { normalizeMnPhone } from '@tugeel/shared/phone';
import {
  FINISHED_STATUSES,
  type Fulfilment,
  isCancellable,
  isEditable,
  isFinished,
  MANAGER_EDITABLE_STATUSES,
  ORDER_LIMITS,
  type OrderChannel,
  orderHeaderIssues,
  type OrderStatus,
  type PaymentMethod,
  type PrintKind,
} from '@tugeel/shared/sales';
import { NOTIFIED_BACKORDER_LINES } from '@tugeel/shared/notifications';
import { businessDate } from '@tugeel/shared/time';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import { idIn } from '../../../common/db/days';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { databaseErrorOf } from '../../../common/errors/problem-details';
import { CatalogService, type ProductSummary, UnitConversionService } from '../../catalog';
import {
  type Actor,
  actorUserId,
  type AuditActor,
  type AuditEntry,
  AuditService,
  type AuthContext,
  type CustomerActor,
  OrgService,
  ScopeService,
} from '../../identity';
import {
  BinsService,
  type Movement,
  ProductLocationsService,
  ReservationService,
  StockPostingService,
  StockQueryService,
  TransfersService,
} from '../../inventory';
import { CustomerAddressesService, CustomersService, type LockedCustomer } from '../../partners';
import { PriceQuoteService } from '../../pricing';
import {
  type BackorderedLine,
  CREDIT_CHECKER,
  type CreditChecker,
  ORDER_LISTENER,
  type OrderListener,
  SALE_LISTENER,
  SALE_SINK,
  type SaleListener,
  type SaleSink,
  type SaleSnapshot,
} from '../hooks';
import {
  orderStatusEvents,
  salesBoards,
  salesOrderLineParts,
  salesOrderLines,
  salesOrders,
  salesPipelines,
  salesStageMoves,
} from '../schema';
import { type Access, isContext, SalesAccessService } from './sales-access.service';
import { type OrderDetail, SalesOrderQueryService } from './sales-order-query.service';
import { SalesPicksService } from './sales-picks.service';
import { type Placement, SalesPipelinesService } from './sales-pipelines.service';
import { SalesSettingsService } from './sales-settings.service';

type OrderRow = typeof salesOrders.$inferSelect;
type LineRow = typeof salesOrderLines.$inferSelect;

export interface OrderLineInput {
  productUnitId: number;
  /** In the unit. */
  qty: Decimal;
}

export interface OrderInput {
  customerId: number;
  /** The pipeline a new order goes in (ADR-0057 #4); null = the channel's default. */
  pipelineId?: number | null;
  /** A stage without an action of that pipeline («+»); null = the pipeline's landing stage. */
  stageId?: number | null;
  fulfilment: Fulfilment;
  deliveryDate: string;
  addressId: number | null;
  contactName: string | null;
  contactPhone: string | null;
  paymentMethod: PaymentMethod;
  note: string | null;
  lines: readonly OrderLineInput[];
}

/** One line of the pick form (ADR-0056 #5): the quantity to pick and where from. */
export interface PickLineInput {
  lineId: number;
  qty: Decimal;
  binId: number;
}

/** What the pick form proposes for a line: the fixed shelf, else the shelves holding stock. */
export interface PickLineInfo {
  lineId: number;
  warehouseId: number;
  proposedBinId: number | null;
  bins: { id: number; code: string; onHand: Decimal }[];
}

export interface MoveResult {
  order: OrderDetail;
  /** The documents the stage prints on arrival. */
  print: PrintKind[];
}

/** What the order screen shows for a product it may add (ADR-0055 #3). */
export interface ProductOrderInfo {
  productId: number;
  homeWarehouseId: number | null;
  /** Active and complete (ADR-0044). */
  sellable: boolean;
  /** Base units available in the home warehouse. */
  available: Decimal;
}

/** The events of an order the store sent itself (ADR-0079 #5) are labelled with the app. */
export const CUSTOMER_APP_LABEL = 'customer-app';

const text = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
};

/**
 * Customer orders (architecture §5.6, ADR-0055, ADR-0056, ADR-0057). An order is numbered when
 * created, in the company format; a draft holds the header and its lines; the submit confirms it
 * in one transaction: the order row, then the customer row (credit check), then the quote, then
 * the stock rows of every line's home warehouse in key order. Every action first locks the order
 * and asks `SalesAccessService` whether the caller sees it (404 otherwise); the answer to a
 * write is not filtered. Finance joins through two hooks (ADR-0060 #1): the credit checker at the
 * submit and the sale sink at the sale; without them every order passes and a sale ends DELIVERED.
 * A third hook tells notifications of every sale (ADR-0062 #4).
 */
@Injectable()
export class SalesOrdersService implements OnModuleInit {
  private creditChecker: CreditChecker | null = null;
  private saleSink: SaleSink | null = null;
  private saleListener: SaleListener | null = null;
  private orderListener: OrderListener | null = null;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly catalog: CatalogService,
    private readonly units: UnitConversionService,
    private readonly customers: CustomersService,
    private readonly addresses: CustomerAddressesService,
    private readonly locations: ProductLocationsService,
    private readonly reservations: ReservationService,
    private readonly quotes: PriceQuoteService,
    private readonly access: SalesAccessService,
    private readonly pipelines: SalesPipelinesService,
    private readonly queries: SalesOrderQueryService,
    private readonly settings: SalesSettingsService,
    private readonly posting: StockPostingService,
    private readonly bins: BinsService,
    private readonly stock: StockQueryService,
    private readonly scope: ScopeService,
    private readonly org: OrgService,
    private readonly transfers: TransfersService,
    private readonly picks: SalesPicksService,
    private readonly moduleRef: ModuleRef,
  ) {}

  onModuleInit(): void {
    this.creditChecker = this.hook<CreditChecker>(CREDIT_CHECKER);
    this.saleSink = this.hook<SaleSink>(SALE_SINK);
    this.saleListener = this.hook<SaleListener>(SALE_LISTENER);
    this.orderListener = this.hook<OrderListener>(ORDER_LISTENER);
  }

  /** A bound hook, or null when its module is not loaded (the worker, sales-only tests). */
  private hook<T>(token: symbol): T | null {
    try {
      return this.moduleRef.get<T>(token, { strict: false });
    } catch {
      return null;
    }
  }

  /**
   * A draft, placed in its pipeline's stage when one is configured (ADR-0057 #4), numbered last
   * in the same transaction (ADR-0057 #3).
   */
  async create(ctx: AuthContext, input: OrderInput): Promise<OrderDetail> {
    const id = await inTransaction(this.db, (tx) =>
      this.createInTx(tx, ctx, input, {
        channel: 'ADMIN',
        placement: () =>
          this.pipelines.placementFor(
            ctx,
            'ADMIN',
            input.pipelineId ?? null,
            input.stageId ?? null,
            tx,
          ),
      }),
    );
    return this.queries.detail(ctx, id);
  }

  /**
   * A draft on its channel inside the caller's transaction: the header checked, then placed where
   * `placement` says (the office: `create`; the rep app: ADR-0061 #6), numbered last unless
   * `numberLater` (a submit in the same transaction draws the number after the stock's locks).
   */
  async createInTx(
    tx: Tx,
    ctx: AuthContext | CustomerActor,
    input: OrderInput,
    options: {
      channel: OrderChannel;
      placement: () => Promise<Placement | null>;
      numberLater?: boolean;
    },
  ): Promise<number> {
    const header = await this.checkedHeader(tx, input);
    const placement = await options.placement();
    const [row] = await tx
      .insert(salesOrders)
      .values({
        ...header,
        channel: options.channel,
        createdBy: actorUserId(ctx),
        // An app order names the store's account instead of a staff author (ADR-0079 #5).
        customerUserId: ctx.kind === 'CUSTOMER' ? ctx.customerUserId : null,
        ...(placement
          ? {
              pipelineId: placement.pipelineId,
              stageId: placement.stageId,
              stageEnteredAt: sql`now()`,
            }
          : {}),
      })
      .returning({ id: salesOrders.id });
    if (!row) throw new Error('sales order insert returned no row');
    await this.writeLines(tx, row.id, input.lines);
    await this.event(tx, ctx, row.id, null, 'DRAFT', null);
    if (placement) {
      await tx.insert(salesStageMoves).values({
        orderId: row.id,
        fromStageId: null,
        toStageId: placement.stageId,
        actorId: actorUserId(ctx),
      });
    }
    const number = options.numberLater ? null : await this.numberInTx(tx, row.id);
    await this.audit.record(tx, ctx, {
      action: 'CREATE',
      entity: 'sales_orders',
      entityId: row.id,
      after: {
        ...header,
        number,
        ...(options.channel === 'ADMIN' ? {} : { channel: options.channel }),
        lines: input.lines.length,
        pipelineId: placement?.pipelineId ?? null,
        stageId: placement?.stageId ?? null,
      },
    });
    return row.id;
  }

  /**
   * Replaces the header and lines of a draft, or of a confirmed order before picking (ADR-0056 #4):
   * the latter is priced again today and its reservations replaced in one lock pass; the number,
   * pipeline and stage stay. In a pipeline, the stage's EDIT right is needed.
   */
  async update(ctx: AuthContext, id: number, input: OrderInput): Promise<OrderDetail> {
    await inTransaction(this.db, async (tx) => {
      const { order, access } = await this.lockSeen(ctx, tx, id);
      // Only an admin (who configures the boards) changes a picking or packed order (ADR-0126 #4).
      const manager = ctx.permissions.has('sales.boards.manage');
      if (
        !isEditable(order.status) &&
        !(manager && MANAGER_EDITABLE_STATUSES.includes(order.status))
      ) {
        throw stateError(order, 'EDITABLE');
      }
      if (input.customerId !== order.customerId) {
        throw invalid('customerId', 'fixed', 'the customer of an order does not change');
      }
      // An admin changes an order in any stage (ADR-0126 #4); others need the stage's EDIT right.
      if (!ctx.permissions.has('sales.boards.manage')) assertCanEdit(access, order);
      const header = await this.checkedHeader(tx, input);
      // A picking or packed order: the warehouses whose lines change are opened again (their goods
      // back on the shelves); the other warehouses keep their picked counts (ADR-0126 #4).
      const picking = order.status === 'PICKING' || order.status === 'PACKED';
      const kept: LineRow[] = [];
      if (picking) {
        const before = await this.linesOf(tx, id);
        const after = await this.placedLines(tx, input.lines);
        const changed = changedWarehouses(before, after);
        await this.picks.unpickInTx(tx, ctx, order, [...changed]);
        kept.push(...before.filter((line) => !changed.has(line.warehouseId)));
      }
      await tx
        .update(salesOrders)
        .set({ ...header, updatedAt: sql`now()` })
        .where(eq(salesOrders.id, id));
      await tx.delete(salesOrderLineParts).where(
        idIn(
          salesOrderLineParts.lineId,
          (
            await tx
              .select({ id: salesOrderLines.id })
              .from(salesOrderLines)
              .where(eq(salesOrderLines.orderId, id))
          ).map((line) => line.id),
        ),
      );
      await tx.delete(salesOrderLines).where(eq(salesOrderLines.orderId, id));
      await this.writeLines(tx, id, input.lines);
      if (kept.length > 0) await this.keepPicked(tx, id, kept);
      let repriced: { total: string; backordered: number } | null = null;
      if (order.status === 'CONFIRMED' || picking) {
        const done = picking ? await this.picks.doneWarehousesInTx(tx, id) : new Set<number>();
        const { quote, reserved } = await this.priceAndReserve(tx, ctx, order, true, done);
        await tx
          .update(salesOrders)
          .set({
            priceDate: businessDate(),
            subtotal: quote.subtotal,
            discountTotal: quote.discountTotal,
            total: quote.total,
            updatedAt: sql`now()`,
          })
          .where(eq(salesOrders.id, id));
        repriced = {
          total: quote.total.toFixed(0),
          backordered: reserved.filter((entry) => entry.backordered.gt(0)).length,
        };
        await this.picks.syncInTx(tx, id);
      }
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'sales_orders',
        entityId: id,
        after: { ...header, lines: input.lines.length, ...(repriced ?? {}) },
      });
    });
    return this.queries.detail(ctx, id);
  }

  /**
   * Moves a card to a stage of its pipeline (ADR-0056 #3) and runs the stage's action in the same
   * transaction: CONFIRM submits a draft, PICK starts picking, SALE issues a picked order's stock,
   * TRANSFER moves it into the pipeline's store (ADR-0125), CANCEL cancels with the reason. The order, then the pipeline and the stage FOR SHARE (ADR-0057
   * #4). Returns the documents the stage prints.
   */
  async move(
    ctx: AuthContext,
    id: number,
    input: { stageId: number; reason?: string | null },
  ): Promise<MoveResult> {
    const print = await inTransaction(this.db, async (tx) => {
      const { order } = await this.lockSeen(ctx, tx, id);
      if (order.pipelineId === null || order.stageId === null) {
        throw new AppError('ORDER_STATE_INVALID', 'the order is in no pipeline', {
          status: order.status,
          expected: 'ON_BOARD',
        });
      }
      if (order.archivedAt) {
        throw new AppError('ORDER_STATE_INVALID', 'the order is archived', {
          status: order.status,
          expected: 'NOT_ARCHIVED',
        });
      }
      const { pipeline, stage, rights } = await this.pipelines.stageFor(ctx, tx, input.stageId);
      if (stage.pipelineId !== order.pipelineId) {
        throw invalid('stageId', 'ofPipeline', "a stage of the order's pipeline");
      }
      if (!rights.move) {
        throw new AppError('FORBIDDEN', 'the stage does not let this role move cards into it', {
          stageId: stage.id,
        });
      }
      if (stage.id === order.stageId) return [];
      switch (stage.action) {
        case 'CONFIRM':
          if (order.status === 'DRAFT') await this.submitInTx(tx, ctx, order);
          break;
        case 'PICK':
          if (order.status === 'CONFIRMED') {
            await tx
              .update(salesOrders)
              .set({ status: 'PICKING', updatedAt: sql`now()` })
              .where(eq(salesOrders.id, id));
            await this.event(tx, ctx, id, 'CONFIRMED', 'PICKING', null);
          }
          break;
        case 'SALE':
          await this.assertPacked(tx, order);
          await this.saleInTx(tx, ctx, order);
          break;
        case 'TRANSFER':
          await this.assertPacked(tx, order);
          if (pipeline.transferWarehouseId === null) {
            throw new AppError(
              'PIPELINE_NO_TRANSFER_WAREHOUSE',
              'the pipeline names no store to transfer into',
              { pipelineId: pipeline.id },
            );
          }
          await this.transferInTx(tx, ctx, order, pipeline.transferWarehouseId);
          break;
        case 'CANCEL':
          if (order.status !== 'CANCELLED') await this.cancelInTx(tx, ctx, order, input.reason);
          break;
        case 'NONE':
          break;
      }
      await tx
        .update(salesOrders)
        .set({ stageId: stage.id, stageEnteredAt: sql`now()`, updatedAt: sql`now()` })
        .where(eq(salesOrders.id, id));
      await tx.insert(salesStageMoves).values({
        orderId: id,
        fromStageId: order.stageId,
        toStageId: stage.id,
        actorId: actorUserId(ctx),
      });
      await this.audit.record(tx, ctx, {
        action: 'MOVE',
        entity: 'sales_orders',
        entityId: id,
        before: { stageId: order.stageId },
        after: { stageId: stage.id, action: stage.action },
      });
      return this.pipelines.printsOf(stage);
    });
    return { order: await this.queries.detail(ctx, id), print };
  }

  /** What the pick form proposes per line: the fixed shelf, else the shelves holding the product. */
  async pickInfo(ctx: AuthContext, id: number): Promise<PickLineInfo[]> {
    const order = await this.queries.get(ctx, id);
    const byWarehouse = new Map<number, number[]>();
    for (const line of order.lines) {
      byWarehouse.set(line.warehouseId, [
        ...(byWarehouse.get(line.warehouseId) ?? []),
        line.productId,
      ]);
    }
    const fixed = new Map<string, number>();
    for (const [warehouseId, productIds] of byWarehouse) {
      for (const [productId, binId] of await this.locations.defaultBinOf(warehouseId, productIds)) {
        fixed.set(`${warehouseId}:${productId}`, binId);
      }
    }
    const stocks = new Map(
      await Promise.all(
        [...new Set(order.lines.map((line) => line.productId))].map(
          async (productId) => [productId, await this.stock.ofProduct(productId)] as const,
        ),
      ),
    );
    return order.lines.map((line) => {
      const bins = (stocks.get(line.productId)?.bins ?? [])
        .filter((bin) => bin.warehouseId === line.warehouseId && bin.sellable && bin.onHand.gt(0))
        .map((bin) => ({ id: bin.binId, code: bin.binCode, onHand: bin.onHand }));
      const proposed =
        fixed.get(`${line.warehouseId}:${line.productId}`) ??
        [...bins].sort((a, b) => b.onHand.comparedTo(a.onHand))[0]?.id ??
        null;
      return { lineId: line.id, warehouseId: line.warehouseId, proposedBinId: proposed, bins };
    });
  }

  /**
   * The picked counts confirmed (ADR-0056 #5): CONFIRMED or PICKING → PACKED. Every line is
   * named once; each moves its quantity from the chosen shelf into STAGING under the order's own
   * document, and the order's reservations are consumed in the same posting. One pick per order.
   */
  async pick(ctx: AuthContext, id: number, input: readonly PickLineInput[]): Promise<OrderDetail> {
    await inTransaction(this.db, async (tx) => {
      const { order } = await this.lockSeen(ctx, tx, id);
      if (order.status !== 'CONFIRMED' && order.status !== 'PICKING') {
        throw stateError(order, 'CONFIRMED');
      }
      const lines = await this.linesOf(tx, id);
      const byLine = new Map(lines.map((line) => [line.id, line]));
      const seen = new Set<number>();
      for (const [index, entry] of input.entries()) {
        if (!byLine.has(entry.lineId)) {
          throw invalid(`lines.${index}.lineId`, 'ofOrder', 'a line of the order');
        }
        if (seen.has(entry.lineId)) throw invalid(`lines.${index}.lineId`, 'unique', 'once');
        seen.add(entry.lineId);
      }
      const done = await this.picks.doneWarehousesInTx(tx, id);
      const open = lines.filter((line) => !done.has(line.warehouseId));
      if (open.some((line) => !seen.has(line.id))) {
        throw invalid('lines', 'complete', 'every line of the warehouses not picked yet');
      }
      const warehouses = [...new Set(open.map((line) => line.warehouseId))].sort((a, b) => a - b);
      for (const warehouseId of warehouses) this.scope.assertCanWriteWarehouse(ctx, warehouseId);
      for (const warehouseId of warehouses) {
        await this.picks.pickInTx(
          tx,
          ctx,
          order,
          warehouseId,
          input.filter((entry) => byLine.get(entry.lineId)?.warehouseId === warehouseId),
          { implicit: true },
        );
      }
    });
    return this.queries.detail(ctx, id);
  }

  /**
   * One warehouse's part of the order picked (ADR-0126 #2): the part's picker (or a lead) names
   * every line of that warehouse once; the order is PACKED when it was the last part.
   */
  async pickPart(
    ctx: AuthContext,
    id: number,
    warehouseId: number,
    input: readonly PickLineInput[],
  ): Promise<OrderDetail> {
    await inTransaction(this.db, async (tx) => {
      const { order } = await this.lockSeen(ctx, tx, id);
      await this.picks.pickInTx(tx, ctx, order, warehouseId, input);
    });
    return this.queries.detail(ctx, id);
  }

  /**
   * DRAFT → CONFIRMED in one transaction (ADR-0055 #1): the products checked again, the prices of
   * today frozen per part, the stock reserved per line in its product's home warehouse (the rest
   * backordered); a draft from before ADR-0057 takes its number last.
   */
  async submit(actor: Actor | AuthContext, id: number): Promise<OrderDetail> {
    await inTransaction(this.db, async (tx) => {
      const { order } = await this.lockSeen(actor, tx, id);
      if (order.status !== 'DRAFT') throw stateError(order, 'DRAFT');
      await this.submitInTx(tx, actor, order);
    });
    return this.queries.detail(actor, id);
  }

  /**
   * Submits a draft made in the caller's transaction (the rep app's CONFIRM stage, ADR-0061 #6):
   * the row locked, then the submit as `submit` does it; no visibility check, the caller placed it.
   */
  async submitDraftInTx(tx: Tx, actor: Actor, id: number): Promise<void> {
    const [order] = await tx.select().from(salesOrders).where(eq(salesOrders.id, id)).for('update');
    if (!order) throw notFound('sales order', id);
    if (order.status !== 'DRAFT') throw stateError(order, 'DRAFT');
    await this.submitInTx(tx, actor, order);
  }

  /** Prices the order's lines today and reserves them (replacing earlier reservations when asked). */
  private async priceAndReserve(
    tx: Tx,
    actor: Actor,
    order: OrderRow,
    replace: boolean,
    picked: ReadonlySet<number> = new Set(),
  ) {
    const today = businessDate();
    const id = order.id;
    {
      for (const issue of orderHeaderIssues(
        {
          fulfilment: order.fulfilment,
          deliveryDate: order.deliveryDate,
          addressId: order.addressId,
          contactPhone: order.contactPhone,
        },
        today,
      )) {
        throw invalid(issue.path, issue.code, `${issue.path}: ${issue.code}`);
      }
      const customer = await this.customers.lockForUpdate(tx, order.customerId);
      if (customer.status !== 'ACTIVE') {
        throw new AppError('CUSTOMER_INACTIVE', `customer ${customer.id} is inactive`, {
          id: customer.id,
        });
      }
      const lines = await tx
        .select()
        .from(salesOrderLines)
        .where(eq(salesOrderLines.orderId, id))
        .orderBy(asc(salesOrderLines.lineNo));
      if (lines.length === 0) throw invalid('lines', 'min', 'an order needs a line');
      const homes = await this.assertOrderable(
        tx,
        lines.map((line) => line.productId),
      );
      const quote = await this.quotes.quote(
        {
          list: 'WHOLESALE',
          date: today,
          lines: lines.map((line) => ({ productUnitId: line.productUnitId, qty: line.qty })),
        },
        tx,
      );
      const unpriced = quote.lines.flatMap((quoted, index) =>
        quoted.result.priced ? [] : [index],
      );
      if (unpriced.length > 0) {
        const products = await this.catalog.getMany(
          unpriced.map((index) => lines[index]?.productId ?? 0),
          tx,
        );
        const sku = new Map(products.map((product) => [product.id, product.sku]));
        throw new AppError(
          'PRICE_MISSING',
          'a line has no price today',
          { count: unpriced.length },
          unpriced.map((index) => ({
            path: `lines.${index}`,
            constraint: 'priced',
            message: sku.get(lines[index]?.productId ?? 0) ?? '',
          })),
        );
      }
      await this.assertCredit(tx, customer, id, quote.total);

      const parts: (typeof salesOrderLineParts.$inferInsert)[] = [];
      for (const [index, line] of lines.entries()) {
        const quoted = quote.lines[index];
        if (!quoted?.result.priced) continue;
        const result = quoted.result;
        const warehouseId = homes.get(line.productId) ?? line.warehouseId;
        await tx
          .update(salesOrderLines)
          .set({
            warehouseId,
            subtotal: result.subtotal,
            discountAmount: result.discountAmount,
            total: result.total,
          })
          .where(eq(salesOrderLines.id, line.id));
        line.warehouseId = warehouseId;
        result.parts.forEach((part, partIndex) => {
          parts.push({
            lineId: line.id,
            partNo: partIndex + 1,
            productUnitId: part.unitId,
            uomName: part.uomName,
            basis: part.basis,
            qty: part.qty,
            factorSnapshot: part.factorSnapshot,
            qtyBase: part.qtyBase,
            listPrice: part.listPrice,
            unitPrice: part.unitPrice,
            subtotal: part.subtotal,
            discountAmount: part.discountAmount,
            total: part.total,
            applied: part.applied.map((applied) => ({
              programId: applied.programId,
              name: applied.name,
              scope: applied.scope,
              effect: applied.effect,
              threshold: applied.threshold.toFixed(),
              value: applied.value.toFixed(),
              amount: applied.amount?.toFixed(0) ?? null,
            })),
          });
        });
      }
      if (parts.length > 0) await tx.insert(salesOrderLineParts).values(parts);

      const request = {
        docType: 'SO' as const,
        docId: id,
        // A picked warehouse's goods are in its STAGING already (ADR-0126 #4).
        lines: lines
          .filter((line) => !picked.has(line.warehouseId))
          .map((line) => ({
            lineId: line.id,
            warehouseId: line.warehouseId,
            productId: line.productId,
            qtyBase: line.qtyBase,
          })),
      };
      const reserved = replace
        ? await this.reservations.replaceInTx(tx, request)
        : await this.reservations.reserveInTx(tx, request);
      for (const entry of reserved) {
        await tx
          .update(salesOrderLines)
          .set({ qtyApproved: entry.reserved, qtyBackordered: entry.backordered })
          .where(eq(salesOrderLines.id, entry.lineId));
      }
      return { quote, reserved };
    }
  }

  /**
   * The credit check (ADR-0060 #2): the customer's other confirmed orders not yet invoiced are
   * summed under the customer lock and handed to finance's checker with this order's total; a
   * refusal says why, with the amounts. Without a checker every order passes.
   */
  private async assertCredit(
    tx: Tx,
    customer: LockedCustomer,
    orderId: number,
    amount: Decimal,
  ): Promise<void> {
    if (!this.creditChecker) return;
    const decision = await this.creditChecker.check(tx, {
      customer,
      orderId,
      amount,
      openOrders: await this.queries.openExposureInTx(tx, customer.id, orderId),
    });
    if (decision.ok) return;
    throw new AppError('CREDIT_BLOCKED', `the credit check refused: ${decision.reason}`, {
      reason: decision.reason,
      exposure: decision.exposure.toFixed(0),
      limit: decision.limit?.toFixed(0) ?? null,
      excess: decision.excess.toFixed(0),
      overdueAmount: decision.overdueAmount.toFixed(0),
      oldestDueDate: decision.oldestDueDate,
    });
  }

  private async submitInTx(tx: Tx, actor: Actor, order: OrderRow): Promise<void> {
    const id = order.id;
    const today = businessDate();
    {
      const { quote, reserved } = await this.priceAndReserve(tx, actor, order, false);
      // An unnumbered draft (from before ADR-0057, or the rep app's, ADR-0061 #6) takes its number
      // here: the counter's lock after the stock's, and before the CONFIRMED row that needs it.
      const number = order.number ?? (await this.numberInTx(tx, id));
      await tx
        .update(salesOrders)
        .set({
          status: 'CONFIRMED',
          priceDate: today,
          subtotal: quote.subtotal,
          discountTotal: quote.discountTotal,
          total: quote.total,
          submittedAt: sql`now()`,
          submittedBy: actorUserId(actor),
          confirmedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(eq(salesOrders.id, id));
      await this.event(tx, actor, id, 'DRAFT', 'SUBMITTED', null);
      await this.event(tx, actor, id, 'SUBMITTED', 'CONFIRMED', null);
      await this.picks.syncInTx(tx, id);
      const waiting = reserved.filter((entry) => entry.backordered.gt(0));
      await this.audit.record(tx, actor, {
        action: 'CONFIRM',
        entity: 'sales_orders',
        entityId: id,
        after: {
          number,
          total: quote.total.toFixed(0),
          backordered: waiting.length,
        },
      });
      if (this.orderListener) {
        await this.orderListener.onConfirmed(tx, {
          orderId: id,
          orderNumber: number,
          channel: order.channel,
          createdBy: order.createdBy,
          customerId: order.customerId,
          orderTotal: quote.total.toFixed(0),
          backorderedLines: waiting.length,
          backordered: await this.backorderedLines(
            tx,
            waiting.slice(0, NOTIFIED_BACKORDER_LINES).map((entry) => entry.lineId),
          ),
        });
      }
    }
  }

  /** The backordered lines named in a confirmation: product, quantity and unit (ADR-0079 #8). */
  private async backorderedLines(tx: Tx, lineIds: readonly number[]): Promise<BackorderedLine[]> {
    if (lineIds.length === 0) return [];
    const lines = await tx
      .select({
        id: salesOrderLines.id,
        productId: salesOrderLines.productId,
        productUnitId: salesOrderLines.productUnitId,
        factorSnapshot: salesOrderLines.factorSnapshot,
        qtyBackordered: salesOrderLines.qtyBackordered,
      })
      .from(salesOrderLines)
      .where(idIn(salesOrderLines.id, lineIds))
      .orderBy(asc(salesOrderLines.lineNo));
    const products = new Map(
      (await this.catalog.getMany([...new Set(lines.map((line) => line.productId))], tx)).map(
        (product) => [product.id, product],
      ),
    );
    const units = await this.units.describe(
      [...new Set(lines.map((line) => line.productUnitId))],
      tx,
    );
    return lines.map((line) => {
      const product = products.get(line.productId);
      const inUnit = line.qtyBackordered.div(line.factorSnapshot);
      const whole = inUnit.isInteger() && !line.factorSnapshot.eq(1);
      return {
        productId: line.productId,
        name: product?.name ?? '',
        qty: (whole ? inUnit : line.qtyBackordered).toString(),
        unitName: whole
          ? (units.get(line.productUnitId)?.uomName ?? '')
          : (product?.baseUnit.uomName ?? ''),
      };
    });
  }

  /**
   * The main sale (ADR-0056 #3): the picked quantity of every line leaves STAGING under the order's
   * document; DELIVERED. Finance's sale sink then invoices the delivered quantities (ADR-0060 #3)
   * and the order ends INVOICED in the same transaction; the sale listener hears of it last
   * (ADR-0062 #4).
   */
  private async saleInTx(tx: Tx, actor: Actor, order: OrderRow): Promise<void> {
    const id = order.id;
    const lines = await this.linesOf(tx, id);
    const products = new Map(
      (
        await this.catalog.getMany(
          lines.map((line) => line.productId),
          tx,
        )
      ).map((p) => [p.id, p]),
    );
    const staging = new Map<number, number>();
    for (const warehouseId of new Set(lines.map((line) => line.warehouseId))) {
      staging.set(warehouseId, (await this.bins.systemBin(warehouseId, 'STAGING', tx)).id);
    }
    const movements: Movement[] = lines.flatMap((line) => {
      const picked = line.qtyPicked ?? new Decimal(0);
      const base = products.get(line.productId)?.baseUnit;
      if (picked.isZero() || !base) return [];
      return [
        {
          docType: 'SO' as const,
          docId: id,
          docLineId: line.id,
          movementType: 'DELIVERY_ISSUE' as const,
          leg: 1,
          warehouseId: line.warehouseId,
          binId: staging.get(line.warehouseId) ?? 0,
          productId: line.productId,
          qtyBase: picked.negated(),
          enteredQty: picked,
          productUnitId: base.id,
          factorSnapshot: new Decimal(1),
        },
      ];
    });
    await this.posting.post(tx, actor, {
      docs: [{ docType: 'SO', docId: id, external: true }],
      movements,
    });
    await tx
      .update(salesOrderLines)
      .set({ qtyDelivered: sql`coalesce(qty_picked, 0)` })
      .where(eq(salesOrderLines.orderId, id));
    await tx
      .update(salesOrders)
      .set({
        status: 'DELIVERED',
        deliveredAt: sql`now()`,
        deliveredBy: actorUserId(actor),
        updatedAt: sql`now()`,
      })
      .where(eq(salesOrders.id, id));
    await this.event(tx, actor, id, 'PACKED', 'DELIVERED', null);
    const invoice = this.saleSink
      ? await this.saleSink.onSold(tx, actor, await this.snapshotOf(tx, order, lines, products))
      : null;
    if (invoice) {
      await tx
        .update(salesOrders)
        .set({ status: 'INVOICED', updatedAt: sql`now()` })
        .where(eq(salesOrders.id, id));
      await this.event(tx, actor, id, 'DELIVERED', 'INVOICED', invoice.number);
    }
    await this.saleListener?.onSale(tx, {
      orderId: id,
      orderNumber: order.number ?? String(id),
      channel: order.channel,
      createdBy: order.createdBy,
      customerId: order.customerId,
      orderTotal: order.total?.toFixed(0) ?? null,
      invoiceId: invoice?.invoiceId ?? null,
      invoiceNumber: invoice?.number ?? null,
      invoiceTotal: invoice?.total.toFixed(0) ?? null,
    });
    await this.audit.record(tx, actor, {
      action: 'SALE',
      entity: 'sales_orders',
      entityId: id,
      after: {
        number: order.number,
        total: order.total?.toFixed(0) ?? null,
        lines: movements.length,
        invoice: invoice?.number ?? null,
      },
    });
  }

  /**
   * The pipeline's TRANSFER stage (ADR-0125): the picked goods leave STAGING for the pipeline's
   * store as one received push transfer per source warehouse, noted with the order's number; the
   * order is DELIVERED, with no invoice and no receivable. The stage's MOVE right is the
   * authorisation, as for a sale.
   */
  private async transferInTx(
    tx: Tx,
    ctx: AuthContext,
    order: OrderRow,
    destWarehouseId: number,
  ): Promise<void> {
    const id = order.id;
    const lines = await this.linesOf(tx, id);
    const products = new Map(
      (
        await this.catalog.getMany(
          lines.map((line) => line.productId),
          tx,
        )
      ).map((p) => [p.id, p]),
    );
    const byWarehouse = new Map<number, Map<number, Decimal>>();
    for (const line of lines) {
      const picked = line.qtyPicked ?? new Decimal(0);
      if (picked.isZero()) continue;
      const perProduct = byWarehouse.get(line.warehouseId) ?? new Map<number, Decimal>();
      perProduct.set(
        line.productId,
        (perProduct.get(line.productId) ?? new Decimal(0)).plus(picked),
      );
      byWarehouse.set(line.warehouseId, perProduct);
    }
    const numbers: string[] = [];
    for (const [warehouseId, perProduct] of [...byWarehouse].sort((a, b) => a[0] - b[0])) {
      const staging = await this.bins.systemBin(warehouseId, 'STAGING', tx);
      const transfer = await this.transfers.pushInTx(tx, ctx, {
        sourceWarehouseId: warehouseId,
        destWarehouseId,
        note: order.number,
        lines: [...perProduct].map(([productId, qty]) => {
          const base = products.get(productId)?.baseUnit;
          if (!base) throw new Error(`product ${productId} has no base unit`);
          return { productUnitId: base.id, qty, binId: staging.id };
        }),
      });
      if (transfer.number) numbers.push(transfer.number);
    }
    await tx
      .update(salesOrderLines)
      .set({ qtyDelivered: sql`coalesce(qty_picked, 0)` })
      .where(eq(salesOrderLines.orderId, id));
    await tx
      .update(salesOrders)
      .set({
        status: 'DELIVERED',
        deliveredAt: sql`now()`,
        deliveredBy: actorUserId(ctx),
        updatedAt: sql`now()`,
      })
      .where(eq(salesOrders.id, id));
    await this.event(
      tx,
      ctx,
      id,
      'PACKED',
      'DELIVERED',
      numbers.length ? numbers.join(', ') : null,
    );
    await this.audit.record(tx, ctx, {
      action: 'TRANSFER',
      entity: 'sales_orders',
      entityId: id,
      after: { number: order.number, warehouseId: destWarehouseId, transfers: numbers },
    });
  }

  /** The sold order by value for finance (ADR-0060 #1): header, branch, lines with their parts. */
  private async snapshotOf(
    tx: Tx,
    order: OrderRow,
    lines: readonly LineRow[],
    products: ReadonlyMap<number, ProductSummary>,
  ): Promise<SaleSnapshot> {
    const parts =
      lines.length === 0
        ? []
        : await tx
            .select()
            .from(salesOrderLineParts)
            .where(
              idIn(
                salesOrderLineParts.lineId,
                lines.map((line) => line.id),
              ),
            )
            .orderBy(asc(salesOrderLineParts.lineId), asc(salesOrderLineParts.partNo));
    let branchId: number | null = null;
    if (order.pipelineId !== null) {
      const [board] = await tx
        .select({ branchId: salesBoards.branchId })
        .from(salesPipelines)
        .innerJoin(salesBoards, eq(salesBoards.id, salesPipelines.boardId))
        .where(eq(salesPipelines.id, order.pipelineId));
      branchId = board?.branchId ?? null;
    }
    const first = lines[0];
    if (branchId === null && first) {
      branchId = (await this.org.getWarehouse(first.warehouseId, tx)).branchId;
    }
    return {
      orderId: order.id,
      orderNumber: order.number ?? String(order.id),
      customerId: order.customerId,
      branchId,
      channel: order.channel,
      fulfilment: order.fulfilment,
      deliveryDate: order.deliveryDate,
      paymentMethod: order.paymentMethod,
      note: order.note,
      lines: lines.map((line) => {
        const product = products.get(line.productId);
        return {
          orderLineId: line.id,
          lineNo: line.lineNo,
          productId: line.productId,
          sku: product?.sku ?? '',
          name: product?.name ?? '',
          baseUnit: {
            productUnitId: product?.baseUnit.id ?? line.productUnitId,
            uomName: product?.baseUnit.uomName ?? '',
          },
          vatType: product?.vatType ?? 'VAT_ABLE',
          cityTax: product?.cityTax ?? null,
          warehouseId: line.warehouseId,
          qtyBase: line.qtyBase,
          qtyDelivered: line.qtyPicked ?? new Decimal(0),
          parts: parts
            .filter((part) => part.lineId === line.id)
            .map((part) => ({
              productUnitId: part.productUnitId,
              uomName: part.uomName,
              basis: part.basis,
              qty: part.qty,
              factorSnapshot: part.factorSnapshot,
              qtyBase: part.qtyBase,
              listPrice: part.listPrice,
              unitPrice: part.unitPrice,
              discountAmount: part.discountAmount,
            })),
        };
      }),
    };
  }

  /** Cancels a draft or a confirmed order with a reason; a confirmed one releases its stock. */
  async cancel(actor: Actor | AuthContext, id: number, reason: string): Promise<OrderDetail> {
    await inTransaction(this.db, async (tx) => {
      const { order } = await this.lockSeen(actor, tx, id);
      await this.cancelInTx(tx, actor, order, reason);
    });
    return this.queries.detail(actor, id);
  }

  /** Takes a finished order off the board (ADR-0057 #5); the stage's EDIT right. */
  async archive(ctx: AuthContext, id: number): Promise<OrderDetail> {
    await inTransaction(this.db, async (tx) => {
      const { order, access } = await this.lockSeen(ctx, tx, id);
      if (!isFinished(order.status)) throw stateError(order, 'FINISHED');
      assertCanEdit(access, order);
      if (order.archivedAt) return;
      await tx
        .update(salesOrders)
        .set({ archivedAt: sql`now()`, archivedBy: actorUserId(ctx), updatedAt: sql`now()` })
        .where(eq(salesOrders.id, id));
      await this.audit.record(tx, ctx, { action: 'ARCHIVE', entity: 'sales_orders', entityId: id });
    });
    return this.queries.detail(ctx, id);
  }

  /** Puts an archived order back on the board. */
  async unarchive(ctx: AuthContext, id: number): Promise<OrderDetail> {
    await inTransaction(this.db, async (tx) => {
      const { order, access } = await this.lockSeen(ctx, tx, id);
      assertCanEdit(access, order);
      if (!order.archivedAt) return;
      await tx
        .update(salesOrders)
        .set({ archivedAt: null, archivedBy: null, updatedAt: sql`now()` })
        .where(eq(salesOrders.id, id));
      await this.audit.record(tx, ctx, {
        action: 'UNARCHIVE',
        entity: 'sales_orders',
        entityId: id,
      });
    });
    return this.queries.detail(ctx, id);
  }

  /**
   * Archives every finished order of a stage the caller sees (a stage's «⋯», ADR-0057 #5); the
   * stage's EDIT right. Returns how many were archived.
   */
  async archiveFinished(ctx: AuthContext, stageId: number): Promise<number> {
    return inTransaction(this.db, async (tx) => {
      const { rights, access } = await this.pipelines.stageFor(ctx, tx, stageId);
      if (!rights.edit) {
        throw new AppError('FORBIDDEN', 'the stage does not let this role edit orders', {
          stageId,
        });
      }
      const archived = await tx
        .update(salesOrders)
        .set({ archivedAt: sql`now()`, archivedBy: actorUserId(ctx), updatedAt: sql`now()` })
        .where(
          and(
            eq(salesOrders.stageId, stageId),
            isNull(salesOrders.archivedAt),
            inArray(salesOrders.status, [...FINISHED_STATUSES]),
            access.visibleSql(),
          ),
        )
        .returning({ id: salesOrders.id });
      if (archived.length > 0) {
        await this.audit.recordMany(
          tx,
          ctx,
          archived.map((row): AuditEntry => ({
            action: 'ARCHIVE',
            entity: 'sales_orders',
            entityId: row.id,
            after: { stageId },
          })),
        );
      }
      return archived.length;
    });
  }

  /** One order the caller sees (404 otherwise). */
  get(actor: Actor | AuthContext, id: number): Promise<OrderDetail> {
    return this.queries.get(actor, id);
  }

  private async cancelInTx(
    tx: Tx,
    actor: Actor,
    order: OrderRow,
    reason: string | null | undefined,
  ): Promise<void> {
    const id = order.id;
    const why = text(reason);
    if (why === null) throw invalid('reason', 'required', 'a reason');
    if (why.length > ORDER_LIMITS.maxCancelReason) throw invalid('reason', 'maxLength', 'too long');
    {
      if (!isCancellable(order.status)) throw stateError(order, 'CANCELLABLE');
      const released = await this.reservations.releaseInTx(tx, 'SO', id);
      await tx
        .update(salesOrders)
        .set({
          status: 'CANCELLED',
          cancelledAt: sql`now()`,
          cancelledBy: actorUserId(actor),
          cancelReason: why,
          updatedAt: sql`now()`,
        })
        .where(eq(salesOrders.id, id));
      await this.event(tx, actor, id, order.status, 'CANCELLED', why);
      await this.audit.record(tx, actor, {
        action: 'CANCEL',
        entity: 'sales_orders',
        entityId: id,
        before: { status: order.status },
        after: { status: 'CANCELLED', reason: why, released },
      });
      await this.orderListener?.onCancelled(tx, {
        orderId: id,
        orderNumber: order.number ?? String(id),
        channel: order.channel,
        createdBy: order.createdBy,
        customerId: order.customerId,
        reason: why,
      });
    }
  }

  /** Each product's home warehouse, whether it may be sold and what is available there. */
  async productInfo(productIds: readonly number[]): Promise<ProductOrderInfo[]> {
    const ids = [...new Set(productIds)];
    const products = await this.catalog.getMany(ids);
    const homes = await this.locations.homeOf(ids);
    const available = await this.reservations.availableOf(ids);
    return products.map((product) => {
      const home = homes.get(product.id) ?? null;
      return {
        productId: product.id,
        homeWarehouseId: home,
        sellable: sellable(product),
        available:
          available.get(product.id)?.find((entry) => entry.warehouseId === home)?.available ??
          new Decimal(0),
      };
    });
  }

  // -------------------------------------------------------------------------------------------

  private linesOf(tx: Tx, id: number): Promise<LineRow[]> {
    return tx
      .select()
      .from(salesOrderLines)
      .where(eq(salesOrderLines.orderId, id))
      .orderBy(asc(salesOrderLines.lineNo));
  }

  /** The order row FOR UPDATE, if the caller sees it (a trusted actor always does). */
  private async lockSeen(
    actor: Actor | AuthContext,
    tx: Tx,
    id: number,
  ): Promise<{ order: OrderRow; access: Access }> {
    const [order] = await tx.select().from(salesOrders).where(eq(salesOrders.id, id)).for('update');
    if (!order) throw notFound('sales order', id);
    const access = await this.access.load(actor, tx);
    if (isContext(actor) && !access.canSee(order)) throw notFound('sales order', id);
    return { order, access };
  }

  /** The order's number, drawn last in its transaction; a number met before answers 409. */
  private async numberInTx(tx: Tx, id: number): Promise<string> {
    const number = await this.settings.allocateNumber(tx);
    try {
      await tx.update(salesOrders).set({ number }).where(eq(salesOrders.id, id));
    } catch (error) {
      if (databaseErrorOf(error)?.code === '23505') {
        throw new AppError('ORDER_NUMBER_TAKEN', `${number} was given before`, { number });
      }
      throw error;
    }
    return number;
  }

  /** The header as stored: checked, trimmed, the address copied from the customer's. */
  private async checkedHeader(tx: Tx, input: OrderInput) {
    const contactPhone = text(input.contactPhone);
    for (const issue of orderHeaderIssues({
      fulfilment: input.fulfilment,
      deliveryDate: input.deliveryDate,
      addressId: input.addressId,
      contactPhone,
    })) {
      throw invalid(issue.path, issue.code, `${issue.path}: ${issue.code}`);
    }
    await this.customers.assertActive(tx, input.customerId);
    let address: { id: number; text: string | null; lat: Decimal | null; lng: Decimal | null } = {
      id: 0,
      text: null,
      lat: null,
      lng: null,
    };
    if (input.addressId !== null) {
      const found = (await this.addresses.ofCustomer(input.customerId, tx)).find(
        (row) => row.id === input.addressId,
      );
      if (!found)
        throw invalid('addressId', 'customerAddress', "not one of the customer's addresses");
      address = { id: found.id, text: found.address, lat: found.lat, lng: found.lng };
    }
    const contactName = text(input.contactName);
    if (contactName !== null && contactName.length > ORDER_LIMITS.maxContactName) {
      throw invalid('contactName', 'maxLength', 'too long');
    }
    const note = text(input.note);
    if (note !== null && note.length > ORDER_LIMITS.maxNote) {
      throw invalid('note', 'maxLength', 'too long');
    }
    if (input.lines.length > ORDER_LIMITS.maxLines) {
      throw invalid('lines', 'maxLines', `at most ${ORDER_LIMITS.maxLines} lines`);
    }
    return {
      customerId: input.customerId,
      fulfilment: input.fulfilment,
      deliveryDate: input.deliveryDate,
      addressId: input.addressId,
      addressText: input.addressId === null ? null : address.text,
      addressLat: input.addressId === null ? null : address.lat,
      addressLng: input.addressId === null ? null : address.lng,
      contactName,
      contactPhone: contactPhone === null ? null : normalizeMnPhone(contactPhone),
      paymentMethod: input.paymentMethod,
      note,
    };
  }

  /** A sale or a transfer needs a packed order; while picking, the missing warehouses are named. */
  private async assertPacked(tx: Tx, order: OrderRow): Promise<void> {
    if (order.status === 'PACKED') return;
    if (order.status === 'CONFIRMED' || order.status === 'PICKING') {
      await this.picks.assertCompleteInTx(tx, order.id);
    }
    throw stateError(order, 'PACKED');
  }

  /** The lines an edit asks for, each with its product's home warehouse (where it would ship). */
  private async placedLines(
    tx: Tx,
    lines: readonly OrderLineInput[],
  ): Promise<{ warehouseId: number; productUnitId: number; qty: Decimal }[]> {
    const converted = [];
    for (const [index, line] of lines.entries()) {
      if (!line.qty.gt(0)) throw invalid(`lines.${index}.qty`, 'min', 'a positive quantity');
      converted.push(await this.units.toBase(line.productUnitId, line.qty, tx));
    }
    const homes = await this.assertOrderable(
      tx,
      converted.map((line) => line.productId),
    );
    return converted.map((line, index) => ({
      warehouseId: homes.get(line.productId) ?? 0,
      productUnitId: line.unitId,
      qty: lines[index]?.qty ?? line.qtyBase,
    }));
  }

  /** The picked counts of unchanged warehouses carried onto the rewritten lines, line by line. */
  private async keepPicked(tx: Tx, orderId: number, kept: readonly LineRow[]): Promise<void> {
    const fresh = await this.linesOf(tx, orderId);
    const pool = [...kept];
    for (const line of fresh) {
      const index = pool.findIndex(
        (old) =>
          old.warehouseId === line.warehouseId &&
          old.productUnitId === line.productUnitId &&
          old.qty.equals(line.qty),
      );
      if (index < 0) continue;
      const [old] = pool.splice(index, 1);
      if (!old) continue;
      await tx
        .update(salesOrderLines)
        .set({
          qtyPicked: old.qtyPicked,
          pickBinId: old.pickBinId,
          qtyApproved: old.qtyApproved,
          qtyBackordered: old.qtyBackordered,
        })
        .where(eq(salesOrderLines.id, line.id));
    }
  }

  /** Lines in base units, each in its product's home warehouse. */
  private async writeLines(
    tx: Tx,
    orderId: number,
    lines: readonly OrderLineInput[],
  ): Promise<void> {
    if (lines.length === 0) return;
    const converted = [];
    for (const [index, line] of lines.entries()) {
      if (!line.qty.gt(0)) throw invalid(`lines.${index}.qty`, 'min', 'a positive quantity');
      converted.push(await this.units.toBase(line.productUnitId, line.qty, tx));
    }
    const homes = await this.assertOrderable(
      tx,
      converted.map((line) => line.productId),
    );
    await tx.insert(salesOrderLines).values(
      converted.map((line, index) => ({
        orderId,
        lineNo: index + 1,
        productId: line.productId,
        productUnitId: line.unitId,
        qty: lines[index]?.qty ?? line.qtyBase,
        factorSnapshot: line.factorSnapshot,
        qtyBase: line.qtyBase,
        warehouseId: homes.get(line.productId) ?? 0,
      })),
    );
  }

  /**
   * Every product active, complete and with a home warehouse (ADR-0055 #3); returns the homes.
   * The first product that fails names its line.
   */
  private async assertOrderable(
    tx: Tx,
    productIds: readonly number[],
  ): Promise<Map<number, number>> {
    const products = new Map(
      (await this.catalog.getMany(productIds, tx)).map((product) => [product.id, product]),
    );
    const homes = await this.locations.homeOf(productIds, tx);
    for (const [index, productId] of productIds.entries()) {
      const product = products.get(productId);
      if (!product) throw notFound('product', productId);
      if (!sellable(product)) {
        throw new AppError(
          'PRODUCT_NOT_SELLABLE',
          `${product.sku} cannot be sold`,
          { sku: product.sku },
          [{ path: `lines.${index}`, constraint: 'sellable', message: product.sku }],
        );
      }
      if (!homes.has(productId)) {
        throw new AppError(
          'PRODUCT_NO_HOME',
          `${product.sku} has no home warehouse`,
          { sku: product.sku },
          [{ path: `lines.${index}`, constraint: 'home', message: product.sku }],
        );
      }
    }
    return homes;
  }

  private async event(
    tx: Tx,
    actor: AuditActor,
    orderId: number,
    fromStatus: OrderStatus | null,
    toStatus: OrderStatus,
    reason: string | null,
  ): Promise<void> {
    await tx.insert(orderStatusEvents).values({
      orderId,
      fromStatus,
      toStatus,
      reason,
      actorId: actorUserId(actor),
      actorLabel:
        actor.kind === 'SYSTEM'
          ? actor.label
          : actor.kind === 'CUSTOMER'
            ? CUSTOMER_APP_LABEL
            : null,
    });
  }
}

const sellable = (product: ProductSummary): boolean =>
  product.status === 'ACTIVE' && product.saleReadyAt !== null;

/** The caller's EDIT right on the order's stage (or `sales.orders.manage` off any pipeline). */
function assertCanEdit(access: Access, order: OrderRow): void {
  if (access.canEdit(order)) return;
  throw new AppError(
    'FORBIDDEN',
    'the stage does not let this role edit orders',
    order.stageId === null ? { permission: 'sales.orders.manage' } : { stageId: order.stageId },
  );
}

/** The warehouses whose lines an edit changes: their products, units or quantities differ. */
function changedWarehouses(
  before: readonly LineRow[],
  after: readonly { warehouseId: number; productUnitId: number; qty: Decimal }[],
): Set<number> {
  const keys = (rows: readonly { warehouseId: number; productUnitId: number; qty: Decimal }[]) => {
    const byWarehouse = new Map<number, string[]>();
    for (const row of rows) {
      byWarehouse.set(row.warehouseId, [
        ...(byWarehouse.get(row.warehouseId) ?? []),
        `${row.productUnitId}:${row.qty.toFixed()}`,
      ]);
    }
    return new Map([...byWarehouse].map(([id, list]) => [id, list.sort().join('|')]));
  };
  const was = keys(before);
  const will = keys(after);
  const changed = new Set<number>();
  for (const id of new Set([...was.keys(), ...will.keys()])) {
    if (was.get(id) !== will.get(id)) changed.add(id);
  }
  return changed;
}

function stateError(order: OrderRow, expected: string): AppError {
  return new AppError('ORDER_STATE_INVALID', `the order is ${order.status}`, {
    status: order.status,
    expected,
  });
}
