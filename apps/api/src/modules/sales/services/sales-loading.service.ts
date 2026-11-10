import { Inject, Injectable } from '@nestjs/common';
import type { Decimal } from '@tugeel/shared/money';
import {
  LOADABLE_STATUSES,
  LOADING_MAX_ORDERS,
  LOADING_WINDOW_DAYS,
  type OrderStatus,
  type PaymentMethod,
  SOLD_STATUSES,
  type StageAction,
} from '@tugeel/shared/sales';
import { businessDate } from '@tugeel/shared/time';
import { and, asc, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import { idIn } from '../../../common/db/days';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { AuditService, type AuthContext, UserNamesService } from '../../identity';
import { CustomersService } from '../../partners';
import {
  salesOrderLines,
  salesOrderLoads,
  salesOrders,
  salesPipelines,
  salesStageMoves,
  salesStages,
} from '../schema';

type OrderRow = typeof salesOrders.$inferSelect;
type LoadRow = typeof salesOrderLoads.$inferSelect;

/** Who loaded an order and when (ADR-0179): the live loading, as the board and the order show it. */
export interface OrderLoading {
  loadId: number;
  driverId: number;
  driverName: string | null;
  loadedAt: Date;
}

/** An order on the driver's «Ачилт» list (ADR-0179 #1): what the truck needs, no prices of lines. */
export interface LoadingOrder {
  orderId: number;
  orderNumber: string | null;
  status: OrderStatus;
  customerId: number;
  customerCode: string;
  customerName: string;
  customerPhone: string | null;
  addressText: string | null;
  contactPhone: string | null;
  deliveryDate: string;
  paymentMethod: PaymentMethod;
  total: Decimal | null;
  lineCount: number;
  pickedAt: Date;
  pipelineName: string | null;
  /** Null while waiting; the caller's own loading of today otherwise. */
  loading: OrderLoading | null;
}

/** The stage actions a loading may carry a card past (ADR-0179 #3): none that would do something. */
function passable(action: StageAction, sold: boolean): boolean {
  if (action === 'NONE' || action === 'CONFIRM' || action === 'PICK') return true;
  return action === 'SALE' && sold;
}

/**
 * The driver's loading (ADR-0179): the picked orders of the sales pipelines that wait for a truck,
 * a driver marking those loaded onto theirs (who and when kept on `sales_order_loads`), and a
 * loading taken back the same day. A loading changes no order status and no stock; a sold order's
 * card moves into its pipeline's loaded stage when no stage between would act on it. Lock order:
 * the orders FOR UPDATE by id, then their live loadings.
 */
@Injectable()
export class SalesLoadingService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly customers: CustomersService,
    private readonly names: UserNamesService,
  ) {}

  /** The orders waiting for a truck, then the caller's own loadings of today (UB day). */
  async work(ctx: AuthContext): Promise<LoadingOrder[]> {
    const today = businessDate();
    const live = and(eq(salesOrderLoads.orderId, salesOrders.id), isNull(salesOrderLoads.undoneAt));
    const rows = await this.db
      .select({ order: salesOrders, load: salesOrderLoads, pipelineName: salesPipelines.name })
      .from(salesOrders)
      .leftJoin(salesOrderLoads, live)
      .leftJoin(salesPipelines, eq(salesPipelines.id, salesOrders.pipelineId))
      .where(
        and(
          inArray(salesOrders.status, [...LOADABLE_STATUSES]),
          isNull(salesOrders.archivedAt),
          sql`${salesOrders.pickedAt} IS NOT NULL`,
          or(isNull(salesOrders.pipelineId), eq(salesPipelines.kind, 'SALES')),
          or(
            and(
              isNull(salesOrderLoads.id),
              gte(salesOrders.pickedAt, sql`now() - make_interval(days => ${LOADING_WINDOW_DAYS})`),
            ),
            and(
              eq(salesOrderLoads.driverId, ctx.userId),
              sql`(${salesOrderLoads.loadedAt} AT TIME ZONE 'Asia/Ulaanbaatar')::date = ${today}::date`,
            ),
          ),
        ),
      )
      .orderBy(asc(salesOrders.deliveryDate), asc(salesOrders.customerId), asc(salesOrders.id))
      .limit(500);
    return this.views(
      rows.map((row) => ({ order: row.order, load: row.load, pipelineName: row.pipelineName })),
    );
  }

  /**
   * «Ачсан»: every named order onto the caller's truck now, in one transaction. An order loaded by
   * anyone already is refused (`ORDER_ALREADY_LOADED`), one no longer picked or archived too
   * (`ORDER_NOT_LOADABLE`); nothing is kept then. Returns the caller's list afterwards.
   */
  async load(ctx: AuthContext, orderIds: readonly number[]): Promise<LoadingOrder[]> {
    const ids = [...new Set(orderIds)].sort((a, b) => a - b);
    if (ids.length === 0) throw invalid('orderIds', 'minSize', 'at least one order');
    if (ids.length > LOADING_MAX_ORDERS) {
      throw invalid('orderIds', 'maxSize', `at most ${LOADING_MAX_ORDERS} orders`);
    }
    await inTransaction(this.db, async (tx) => {
      const orders = await tx
        .select()
        .from(salesOrders)
        .where(idIn(salesOrders.id, ids))
        .orderBy(asc(salesOrders.id))
        .for('update');
      const loads = await this.liveLoads(tx, ids);
      for (const id of ids) {
        const order = orders.find((row) => row.id === id);
        if (!order) throw notFound('sales order', id);
        const load = loads.get(id);
        if (load) {
          const names = await this.names.namesOf([load.driverId], tx);
          throw new AppError('ORDER_ALREADY_LOADED', 'the order is loaded already', {
            number: order.number ?? String(id),
            driver: names.get(load.driverId) ?? '',
          });
        }
        await this.assertLoadable(tx, order);
        const move = await this.moveToLoaded(tx, ctx, order);
        const [row] = await tx
          .insert(salesOrderLoads)
          .values({
            orderId: id,
            driverId: ctx.userId,
            fromStageId: move?.fromStageId ?? null,
            toStageId: move?.toStageId ?? null,
          })
          .returning();
        await tx
          .update(salesOrders)
          .set({ updatedAt: sql`now()` })
          .where(eq(salesOrders.id, id));
        await this.audit.record(tx, ctx, {
          action: 'LOAD',
          entity: 'sales_orders',
          entityId: id,
          after: {
            number: order.number,
            loadId: row?.id ?? null,
            stageId: move?.toStageId ?? order.stageId,
          },
        });
      }
    });
    return this.work(ctx);
  }

  /**
   * A loading taken back (a wrong tick): by the driver who loaded it on the same UB day, or by the
   * holder of `sales.boards.manage` at any time. The card goes back to the stage it came from when
   * the loading moved it and it still sits there.
   */
  async undo(ctx: AuthContext, orderId: number): Promise<LoadingOrder[]> {
    await inTransaction(this.db, async (tx) => {
      const [order] = await tx
        .select()
        .from(salesOrders)
        .where(eq(salesOrders.id, orderId))
        .for('update');
      if (!order) throw notFound('sales order', orderId);
      const load = (await this.liveLoads(tx, [orderId])).get(orderId);
      if (!load) {
        throw new AppError('ORDER_NOT_LOADABLE', 'the order is not loaded', {
          number: order.number ?? String(orderId),
        });
      }
      const own =
        load.driverId === ctx.userId &&
        businessDate(load.loadedAt) === businessDate() &&
        ctx.permissions.has('sales.orders.load');
      if (!own && !ctx.permissions.has('sales.boards.manage')) {
        throw new AppError('LOAD_UNDO_FORBIDDEN', 'only the driver the same day, or the admin', {
          number: order.number ?? String(orderId),
        });
      }
      await tx
        .update(salesOrderLoads)
        .set({ undoneAt: sql`now()`, undoneBy: ctx.userId })
        .where(eq(salesOrderLoads.id, load.id));
      const back =
        load.toStageId !== null &&
        load.fromStageId !== null &&
        order.stageId === load.toStageId &&
        order.archivedAt === null;
      if (back && load.fromStageId !== null) {
        await this.place(tx, ctx, order, load.fromStageId);
      } else {
        await tx
          .update(salesOrders)
          .set({ updatedAt: sql`now()` })
          .where(eq(salesOrders.id, orderId));
      }
      await this.audit.record(tx, ctx, {
        action: 'UNLOAD',
        entity: 'sales_orders',
        entityId: orderId,
        before: { number: order.number, loadId: load.id, driverId: load.driverId },
        after: { stageId: back ? load.fromStageId : order.stageId },
      });
    });
    return this.work(ctx);
  }

  /** The live loading of each order (the board's cards and the order's panel). */
  async loadingsOf(
    orderIds: readonly number[],
    executor: Db | Tx = this.db,
  ): Promise<Map<number, OrderLoading>> {
    const loads = await this.liveLoads(executor, orderIds);
    const names = await this.names.namesOf(
      [...loads.values()].map((load) => load.driverId),
      executor,
    );
    return new Map(
      [...loads].map(([orderId, load]) => [
        orderId,
        {
          loadId: load.id,
          driverId: load.driverId,
          driverName: names.get(load.driverId) ?? null,
          loadedAt: load.loadedAt,
        },
      ]),
    );
  }

  private async liveLoads(executor: Db | Tx, orderIds: readonly number[]) {
    if (orderIds.length === 0) return new Map<number, LoadRow>();
    const rows = await executor
      .select()
      .from(salesOrderLoads)
      .where(and(idIn(salesOrderLoads.orderId, orderIds), isNull(salesOrderLoads.undoneAt)));
    return new Map(rows.map((row) => [row.orderId, row]));
  }

  /** Picked, not archived, in no pipeline or a sales one (ADR-0179 #1). */
  private async assertLoadable(tx: Tx, order: OrderRow): Promise<void> {
    let ok =
      LOADABLE_STATUSES.includes(order.status) &&
      order.pickedAt !== null &&
      order.archivedAt === null;
    if (ok && order.pipelineId !== null) {
      const [pipeline] = await tx
        .select({ kind: salesPipelines.kind })
        .from(salesPipelines)
        .where(eq(salesPipelines.id, order.pipelineId));
      ok = pipeline?.kind === 'SALES';
    }
    if (!ok) {
      throw new AppError('ORDER_NOT_LOADABLE', 'the order is not a picked sales order', {
        number: order.number ?? String(order.id),
        status: order.status,
      });
    }
  }

  /**
   * ADR-0179 #3: the card moves forward into the pipeline's loaded stage when the pipeline names
   * one and every stage it would pass over leaves the order as it is (a SALE stage only once the
   * order is sold; never a TRANSFER or a CANCEL). Otherwise the card stays.
   */
  private async moveToLoaded(
    tx: Tx,
    ctx: AuthContext,
    order: OrderRow,
  ): Promise<{ fromStageId: number; toStageId: number } | null> {
    if (order.pipelineId === null || order.stageId === null) return null;
    const [pipeline] = await tx
      .select({ loadedStageId: salesPipelines.loadedStageId })
      .from(salesPipelines)
      .where(eq(salesPipelines.id, order.pipelineId));
    const target = pipeline?.loadedStageId ?? null;
    if (target === null || target === order.stageId) return null;
    const stages = await tx
      .select({ id: salesStages.id, action: salesStages.action })
      .from(salesStages)
      .where(and(eq(salesStages.pipelineId, order.pipelineId), isNull(salesStages.archivedAt)))
      .orderBy(asc(salesStages.position), asc(salesStages.id));
    const from = stages.findIndex((stage) => stage.id === order.stageId);
    const to = stages.findIndex((stage) => stage.id === target);
    if (from < 0 || to < 0 || to < from) return null;
    const sold = SOLD_STATUSES.includes(order.status);
    const between = stages.slice(from + 1, to);
    if (!between.every((stage) => passable(stage.action, sold))) return null;
    if (stages[to]?.action !== 'NONE') return null;
    await this.place(tx, ctx, order, target);
    return { fromStageId: order.stageId, toStageId: target };
  }

  /** The card into a stage of its own pipeline, recorded as a move by the caller. */
  private async place(tx: Tx, ctx: AuthContext, order: OrderRow, stageId: number): Promise<void> {
    await tx
      .update(salesOrders)
      .set({ stageId, stageEnteredAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(salesOrders.id, order.id));
    await tx.insert(salesStageMoves).values({
      orderId: order.id,
      fromStageId: order.stageId,
      toStageId: stageId,
      actorId: ctx.userId,
    });
  }

  private async views(
    rows: readonly { order: OrderRow; load: LoadRow | null; pipelineName: string | null }[],
  ): Promise<LoadingOrder[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.order.id);
    const customers = new Map(
      (await this.customers.getMany([...new Set(rows.map((row) => row.order.customerId))])).map(
        (customer) => [customer.id, customer],
      ),
    );
    const counts = await this.db
      .select({ orderId: salesOrderLines.orderId, count: sql<string>`count(*)` })
      .from(salesOrderLines)
      .where(idIn(salesOrderLines.orderId, ids))
      .groupBy(salesOrderLines.orderId);
    const countOf = new Map(counts.map((row) => [row.orderId, Number.parseInt(row.count, 10)]));
    const names = await this.names.namesOf(
      rows.flatMap((row) => (row.load ? [row.load.driverId] : [])),
    );
    return rows.map(({ order, load, pipelineName }) => {
      const customer = customers.get(order.customerId);
      return {
        orderId: order.id,
        orderNumber: order.number,
        status: order.status,
        customerId: order.customerId,
        customerCode: customer?.code ?? '',
        customerName: customer?.name ?? '',
        customerPhone: customer?.phone ?? null,
        addressText: order.addressText ?? customer?.address ?? null,
        contactPhone: order.contactPhone,
        deliveryDate: order.deliveryDate,
        paymentMethod: order.paymentMethod,
        total: order.total,
        lineCount: countOf.get(order.id) ?? 0,
        pickedAt: order.pickedAt ?? order.updatedAt,
        pipelineName,
        loading: load
          ? {
              loadId: load.id,
              driverId: load.driverId,
              driverName: names.get(load.driverId) ?? null,
              loadedAt: load.loadedAt,
            }
          : null,
      };
    });
  }
}
