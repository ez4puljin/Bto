import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from '@tugeel/shared/money';
import type { OrderStatus, PickStatus } from '@tugeel/shared/sales';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import { idIn } from '../../../common/db/days';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { CatalogService } from '../../catalog';
import {
  type Actor,
  actorUserId,
  type AuditActor,
  AuditService,
  type AuthContext,
  OrgService,
  ScopeService,
  UserNamesService,
} from '../../identity';
import {
  BinsService,
  type Movement,
  ReservationService,
  StockPostingService,
} from '../../inventory';
import { CustomersService } from '../../partners';
import {
  orderStatusEvents,
  salesOrderLineParts,
  salesOrderLines,
  salesOrderPicks,
  salesOrders,
} from '../schema';
import { type Access, isContext, SalesAccessService } from './sales-access.service';

type OrderRow = typeof salesOrders.$inferSelect;
type LineRow = typeof salesOrderLines.$inferSelect;
type PickRow = typeof salesOrderPicks.$inferSelect;

const LEAD = 'sales.orders.pickLead';
const PICK = 'sales.orders.pick';

/** A warehouse's part of an order (ADR-0126 #2), as the order panel and the board's cards show it. */
export interface PickPart {
  orderId: number;
  warehouseId: number;
  warehouseName: string;
  status: PickStatus;
  pickerId: number | null;
  pickerName: string | null;
  startedAt: Date | null;
  doneAt: Date | null;
}

/** One line of a part's pick: the quantity picked (base units) and the shelf it left. */
export interface PartPickInput {
  lineId: number;
  qty: Decimal;
  binId: number;
}

/**
 * The warehouses' parts of an order (ADR-0126 #2). A part is made for every warehouse the order's
 * lines ship from when the order is confirmed or changed; a keeper takes their warehouse's part,
 * picks its lines into that warehouse's STAGING (the reservations consumed), and the order is
 * PACKED when every part is done. A lead sees every part with its picker, hands one to another
 * picker and opens a done part again (its goods back on their shelves, reserved again). Lock order:
 * the order row FOR UPDATE, then its parts.
 */
@Injectable()
export class SalesPicksService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly access: SalesAccessService,
    private readonly catalog: CatalogService,
    private readonly customers: CustomersService,
    private readonly bins: BinsService,
    private readonly posting: StockPostingService,
    private readonly reservations: ReservationService,
    private readonly scope: ScopeService,
    private readonly org: OrgService,
    private readonly names: UserNamesService,
  ) {}

  /**
   * One part per warehouse the order's lines ship from: new warehouses get an OPEN part, parts of
   * warehouses that left the order go (they are OPEN: a changed warehouse was opened first).
   */
  async syncInTx(tx: Tx, orderId: number): Promise<void> {
    const lines = await this.linesOf(tx, orderId);
    const wanted = new Set(lines.map((line) => line.warehouseId));
    const parts = await this.partsOf(tx, orderId);
    const have = new Set(parts.map((part) => part.warehouseId));
    const gone = parts.filter((part) => !wanted.has(part.warehouseId));
    for (const part of gone) {
      if (part.status === 'DONE') {
        throw new Error(`a done part of order ${orderId} lost its lines`);
      }
    }
    if (gone.length > 0) {
      await tx.delete(salesOrderPicks).where(
        and(
          eq(salesOrderPicks.orderId, orderId),
          inArray(
            salesOrderPicks.warehouseId,
            gone.map((part) => part.warehouseId),
          ),
        ),
      );
    }
    const fresh = [...wanted].filter((warehouseId) => !have.has(warehouseId));
    if (fresh.length > 0) {
      await tx
        .insert(salesOrderPicks)
        .values(fresh.map((warehouseId) => ({ orderId, warehouseId })));
    }
  }

  /** The warehouses whose part is not done, with their names (the gate of a sale or a transfer). */
  async missingInTx(tx: Tx, orderId: number): Promise<{ id: number; name: string }[]> {
    const parts = (await this.partsOf(tx, orderId)).filter((part) => part.status !== 'DONE');
    if (parts.length === 0) return [];
    const names = await this.org.warehouseNames(
      parts.map((part) => part.warehouseId),
      tx,
    );
    return parts.map((part) => ({
      id: part.warehouseId,
      name: names.get(part.warehouseId) ?? String(part.warehouseId),
    }));
  }

  /** Refuses a sale or a transfer while a part is not done, naming the warehouses (ADR-0126 #2). */
  async assertCompleteInTx(tx: Tx, orderId: number): Promise<void> {
    const missing = await this.missingInTx(tx, orderId);
    if (missing.length === 0) return;
    throw new AppError('PICK_INCOMPLETE', 'a warehouse has not finished picking', {
      warehouses: missing.map((entry) => entry.name).join(', '),
      count: missing.length,
    });
  }

  /** The parts of these orders, for the order panel. */
  async partsOfOrders(
    orderIds: readonly number[],
    executor: Db | Tx = this.db,
  ): Promise<Map<number, PickPart[]>> {
    if (orderIds.length === 0) return new Map();
    const rows = await executor
      .select()
      .from(salesOrderPicks)
      .where(idIn(salesOrderPicks.orderId, orderIds))
      .orderBy(asc(salesOrderPicks.orderId), asc(salesOrderPicks.warehouseId));
    const views = await this.views(rows, executor);
    const byOrder = new Map<number, PickPart[]>();
    for (const view of views)
      byOrder.set(view.orderId, [...(byOrder.get(view.orderId) ?? []), view]);
    return byOrder;
  }

  /** Who may pick in a warehouse: active users with the pick right and it in their write scope. */
  pickersOf(warehouseId: number): Promise<{ id: number; fullName: string }[]> {
    return this.names.holdersInWarehouse(PICK, warehouseId);
  }

  /**
   * A keeper takes their warehouse's part (OPEN → PICKING); the order starts picking. Taking a part
   * the caller already holds answers it as it is; another picker's part is refused (PICK_TAKEN).
   */
  async claim(ctx: AuthContext, orderId: number, warehouseId: number): Promise<void> {
    await inTransaction(this.db, async (tx) => {
      const order = await this.lockOrder(ctx, tx, orderId);
      this.assertPicking(order);
      this.scope.assertCanWriteWarehouse(ctx, warehouseId);
      const part = await this.lockPart(tx, orderId, warehouseId);
      if (part.status === 'PICKING' && part.pickerId === ctx.userId) return;
      if (part.status !== 'OPEN') throw takenOrState(part);
      await this.takeInTx(tx, ctx, order, part, ctx.userId);
    });
  }

  /** A lead hands a part to another picker (OPEN or PICKING; a done part is opened first). */
  async assign(
    ctx: AuthContext,
    orderId: number,
    warehouseId: number,
    pickerId: number,
  ): Promise<void> {
    await inTransaction(this.db, async (tx) => {
      const order = await this.lockOrder(ctx, tx, orderId);
      this.assertPicking(order);
      const part = await this.lockPart(tx, orderId, warehouseId);
      if (part.status === 'DONE') {
        throw new AppError('PICK_STATE_INVALID', 'the part is picked; open it first', {
          status: part.status,
        });
      }
      const allowed = await this.pickersOf(warehouseId);
      if (!allowed.some((user) => user.id === pickerId)) {
        throw new AppError('PICKER_INVALID', `user ${pickerId} cannot pick in this warehouse`, {
          userId: pickerId,
        });
      }
      await this.takeInTx(tx, ctx, order, part, pickerId);
    });
  }

  /**
   * A lead opens a done part again (ADR-0126 #2): its goods go back from STAGING to the shelves
   * they left and are reserved again; a PACKED order is picking again.
   */
  async reopen(ctx: AuthContext, orderId: number, warehouseId: number): Promise<void> {
    await inTransaction(this.db, async (tx) => {
      const order = await this.lockOrder(ctx, tx, orderId);
      this.assertPicking(order);
      const part = await this.lockPart(tx, orderId, warehouseId);
      if (part.status !== 'DONE') {
        throw new AppError('PICK_STATE_INVALID', 'only a picked part is opened again', {
          status: part.status,
        });
      }
      await this.unpickInTx(tx, ctx, order, [warehouseId]);
      const lines = await this.renewLinesInTx(tx, orderId, [warehouseId]);
      await this.reservations.reserveInTx(tx, {
        docType: 'SO',
        docId: orderId,
        lines: lines.map((line) => ({
          lineId: line.id,
          warehouseId: line.warehouseId,
          productId: line.productId,
          qtyBase: line.qtyBase,
        })),
      });
      await this.audit.record(tx, ctx, {
        action: 'PICK_REOPEN',
        entity: 'sales_orders',
        entityId: orderId,
        after: { warehouseId },
      });
    });
  }

  /**
   * The picked counts of one warehouse's part (ADR-0126 #2): every line of that warehouse named
   * once, each moved from its shelf into the warehouse's STAGING under the order's own document,
   * its reservation consumed. The part's picker, a lead or `implicit` (the whole-order pick of a
   * keeper who writes every warehouse) may confirm it. Returns whether the order is now packed.
   */
  async pickInTx(
    tx: Tx,
    ctx: AuthContext,
    order: OrderRow,
    warehouseId: number,
    input: readonly PartPickInput[],
    options: { implicit?: boolean } = {},
  ): Promise<boolean> {
    this.assertPicking(order);
    this.scope.assertCanWriteWarehouse(ctx, warehouseId);
    const part = await this.lockPart(tx, order.id, warehouseId);
    if (part.status === 'DONE') {
      throw new AppError('PICK_STATE_INVALID', 'the part is picked already', {
        status: part.status,
      });
    }
    const lead = ctx.permissions.has(LEAD);
    if (part.status === 'PICKING' && part.pickerId !== ctx.userId && !lead) {
      throw takenOrState(part);
    }
    if (part.status === 'OPEN' && !options.implicit && !lead) {
      throw new AppError('PICK_STATE_INVALID', 'take the part before picking it', {
        status: part.status,
      });
    }
    const lines = (await this.linesOf(tx, order.id)).filter(
      (line) => line.warehouseId === warehouseId,
    );
    const byLine = new Map(lines.map((line) => [line.id, line]));
    const seen = new Set<number>();
    for (const [index, entry] of input.entries()) {
      const line = byLine.get(entry.lineId);
      if (!line) throw invalid(`lines.${index}.lineId`, 'ofPart', "a line of the warehouse's part");
      if (seen.has(entry.lineId)) throw invalid(`lines.${index}.lineId`, 'unique', 'once');
      seen.add(entry.lineId);
      if (entry.qty.isNegative() || entry.qty.gt(line.qtyBase)) {
        throw invalid(`lines.${index}.qty`, 'range', 'between 0 and the ordered quantity');
      }
    }
    if (seen.size !== lines.length) throw invalid('lines', 'complete', 'every line once');
    const bins = new Map(
      (await this.bins.getMany([...new Set(input.map((entry) => entry.binId))], tx)).map((bin) => [
        bin.id,
        bin,
      ]),
    );
    const products = new Map(
      (
        await this.catalog.getMany(
          lines.map((line) => line.productId),
          tx,
        )
      ).map((p) => [p.id, p]),
    );
    const staging = (await this.bins.systemBin(warehouseId, 'STAGING', tx)).id;
    const movements: Movement[] = [];
    for (const [index, entry] of input.entries()) {
      const line = byLine.get(entry.lineId);
      if (!line) continue;
      const bin = bins.get(entry.binId);
      if (!bin || bin.warehouseId !== warehouseId) {
        throw invalid(`lines.${index}.binId`, 'ofWarehouse', "a shelf of the line's warehouse");
      }
      if (entry.qty.isZero()) continue;
      const base = products.get(line.productId)?.baseUnit;
      if (!base) throw notFound('product', line.productId);
      movements.push(...pickLegs(order.id, line, base.id, entry.qty, bin.id, staging));
    }
    await this.posting.post(tx, ctx, {
      docs: [{ docType: 'SO', docId: order.id, external: true }],
      movements,
      reservationConsume: { docType: 'SO', docLineIds: lines.map((line) => line.id) },
    });
    for (const entry of input) {
      await tx
        .update(salesOrderLines)
        .set({ qtyPicked: entry.qty, pickBinId: entry.binId })
        .where(eq(salesOrderLines.id, entry.lineId));
    }
    await tx
      .update(salesOrderPicks)
      .set({
        status: 'DONE',
        pickerId: part.pickerId ?? ctx.userId,
        startedAt: part.startedAt ?? sql`now()`,
        doneAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(
        and(eq(salesOrderPicks.orderId, order.id), eq(salesOrderPicks.warehouseId, warehouseId)),
      );
    await this.audit.record(tx, ctx, {
      action: 'PICK',
      entity: 'sales_orders',
      entityId: order.id,
      after: {
        warehouseId,
        lines: input.map((entry) => ({
          lineId: entry.lineId,
          qty: entry.qty.toFixed(),
          binId: entry.binId,
        })),
        short: input.filter((entry) => entry.qty.lt(byLine.get(entry.lineId)?.qtyBase ?? 0)).length,
      },
    });
    await this.touchOrder(tx, order.id);
    const packed = (await this.missingInTx(tx, order.id)).length === 0;
    const status: OrderStatus = packed ? 'PACKED' : 'PICKING';
    if (status !== order.status) {
      await tx
        .update(salesOrders)
        .set({
          status,
          ...(packed ? { pickedAt: sql`now()`, pickedBy: actorUserId(ctx) } : {}),
          updatedAt: sql`now()`,
        })
        .where(eq(salesOrders.id, order.id));
      await this.event(tx, ctx, order.id, order.status, status);
      order.status = status;
    }
    return packed;
  }

  /**
   * The picked goods of these warehouses' parts back from STAGING onto the shelves they left; the
   * lines lose their counts, the parts are OPEN again and a PACKED order is picking again. The
   * caller re-reserves the lines (a reopen) or prices and reserves the changed order (an edit).
   */
  async unpickInTx(
    tx: Tx,
    actor: Actor | AuthContext,
    order: OrderRow,
    warehouseIds: readonly number[],
  ): Promise<void> {
    if (warehouseIds.length === 0) return;
    const wanted = new Set(warehouseIds);
    const lines = (await this.linesOf(tx, order.id)).filter((line) => wanted.has(line.warehouseId));
    const products = new Map(
      (
        await this.catalog.getMany(
          lines.map((line) => line.productId),
          tx,
        )
      ).map((p) => [p.id, p]),
    );
    const movements: Movement[] = [];
    for (const warehouseId of wanted) {
      const picked = lines.filter(
        (line) => line.warehouseId === warehouseId && line.qtyPicked?.gt(0) && line.pickBinId,
      );
      if (picked.length === 0) continue;
      const staging = (await this.bins.systemBin(warehouseId, 'STAGING', tx)).id;
      for (const line of picked) {
        const base = products.get(line.productId)?.baseUnit;
        if (!base || !line.qtyPicked || line.pickBinId === null) continue;
        // Back the way they came, as a shelf move: out of STAGING, onto the shelf they left.
        movements.push(
          ...pickLegs(order.id, line, base.id, line.qtyPicked, staging, line.pickBinId, 'BACK'),
        );
      }
    }
    if (movements.length > 0) {
      await this.posting.post(tx, actor, {
        docs: [{ docType: 'SO', docId: order.id, external: true }],
        movements,
      });
    }
    if (lines.length > 0) {
      await tx
        .update(salesOrderLines)
        .set({ qtyPicked: null, pickBinId: null })
        .where(
          idIn(
            salesOrderLines.id,
            lines.map((line) => line.id),
          ),
        );
    }
    await tx
      .update(salesOrderPicks)
      .set({ status: 'OPEN', pickerId: null, startedAt: null, doneAt: null, updatedAt: sql`now()` })
      .where(
        and(
          eq(salesOrderPicks.orderId, order.id),
          inArray(salesOrderPicks.warehouseId, [...wanted]),
        ),
      );
    await this.touchOrder(tx, order.id);
    if (order.status === 'PACKED') {
      await tx
        .update(salesOrders)
        .set({ status: 'PICKING', pickedAt: null, pickedBy: null, updatedAt: sql`now()` })
        .where(eq(salesOrders.id, order.id));
      await this.event(tx, actor, order.id, 'PACKED', 'PICKING');
      order.status = 'PICKING';
    }
  }

  /**
   * The lines of these warehouses written again under new ids (their parts with them), unpicked:
   * a line's pick and its way back are each posted once in the ledger (keyed per line), so a line
   * picked again after a reopen is a new line. Returns the new lines.
   */
  async renewLinesInTx(
    tx: Tx,
    orderId: number,
    warehouseIds: readonly number[],
  ): Promise<LineRow[]> {
    const wanted = new Set(warehouseIds);
    const old = (await this.linesOf(tx, orderId)).filter((line) => wanted.has(line.warehouseId));
    if (old.length === 0) return [];
    const parts = await tx
      .select()
      .from(salesOrderLineParts)
      .where(
        idIn(
          salesOrderLineParts.lineId,
          old.map((line) => line.id),
        ),
      );
    await tx.delete(salesOrderLineParts).where(
      idIn(
        salesOrderLineParts.lineId,
        old.map((line) => line.id),
      ),
    );
    await tx.delete(salesOrderLines).where(
      idIn(
        salesOrderLines.id,
        old.map((line) => line.id),
      ),
    );
    const fresh: LineRow[] = [];
    for (const line of old) {
      const { id: oldId, ...values } = line;
      const [row] = await tx
        .insert(salesOrderLines)
        .values({ ...values, qtyPicked: null, pickBinId: null, qtyDelivered: null })
        .returning();
      if (!row) throw new Error('order line insert returned no row');
      fresh.push(row);
      const own = parts.filter((part) => part.lineId === oldId);
      if (own.length > 0) {
        await tx
          .insert(salesOrderLineParts)
          .values(own.map(({ id: _id, ...part }) => ({ ...part, lineId: row.id })));
      }
    }
    return fresh;
  }

  /** The warehouses whose part holds picked goods (DONE). */
  async doneWarehousesInTx(tx: Tx, orderId: number): Promise<Set<number>> {
    return new Set(
      (await this.partsOf(tx, orderId))
        .filter((part) => part.status === 'DONE')
        .map((part) => part.warehouseId),
    );
  }

  private async takeInTx(
    tx: Tx,
    ctx: AuthContext,
    order: OrderRow,
    part: PickRow,
    pickerId: number,
  ): Promise<void> {
    await tx
      .update(salesOrderPicks)
      .set({
        status: 'PICKING',
        pickerId,
        startedAt: part.startedAt ?? sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(salesOrderPicks.orderId, order.id),
          eq(salesOrderPicks.warehouseId, part.warehouseId),
        ),
      );
    if (order.status === 'CONFIRMED') {
      await tx
        .update(salesOrders)
        .set({ status: 'PICKING', updatedAt: sql`now()` })
        .where(eq(salesOrders.id, order.id));
      await this.event(tx, ctx, order.id, 'CONFIRMED', 'PICKING');
      order.status = 'PICKING';
    }
    await this.touchOrder(tx, order.id);
    await this.audit.record(tx, ctx, {
      action: pickerId === ctx.userId ? 'PICK_TAKE' : 'PICK_ASSIGN',
      entity: 'sales_orders',
      entityId: order.id,
      before: { warehouseId: part.warehouseId, pickerId: part.pickerId },
      after: { warehouseId: part.warehouseId, pickerId },
    });
  }

  /**
   * Every change of a part moves the order's updatedAt, so an office save from before it is
   * refused as stale (ADR-0130): nobody's change is overwritten by another's.
   */
  private async touchOrder(tx: Tx, orderId: number): Promise<void> {
    await tx
      .update(salesOrders)
      .set({ updatedAt: sql`now()` })
      .where(eq(salesOrders.id, orderId));
  }

  private assertPicking(order: OrderRow): void {
    if (order.status === 'CONFIRMED' || order.status === 'PICKING' || order.status === 'PACKED') {
      return;
    }
    throw new AppError('ORDER_STATE_INVALID', `the order is ${order.status}`, {
      status: order.status,
      expected: 'CONFIRMED',
    });
  }

  /** The order FOR UPDATE, if the caller sees it. */
  private async lockOrder(ctx: AuthContext, tx: Tx, orderId: number): Promise<OrderRow> {
    const [order] = await tx
      .select()
      .from(salesOrders)
      .where(eq(salesOrders.id, orderId))
      .for('update');
    if (!order) throw notFound('sales order', orderId);
    const access: Access = await this.access.load(ctx, tx);
    if (isContext(ctx) && !access.canSee(order)) throw notFound('sales order', orderId);
    return order;
  }

  private async lockPart(tx: Tx, orderId: number, warehouseId: number): Promise<PickRow> {
    const [part] = await tx
      .select()
      .from(salesOrderPicks)
      .where(
        and(eq(salesOrderPicks.orderId, orderId), eq(salesOrderPicks.warehouseId, warehouseId)),
      )
      .for('update');
    if (!part) throw notFound('pick part', warehouseId);
    return part;
  }

  private partsOf(executor: Db | Tx, orderId: number): Promise<PickRow[]> {
    return executor
      .select()
      .from(salesOrderPicks)
      .where(eq(salesOrderPicks.orderId, orderId))
      .orderBy(asc(salesOrderPicks.warehouseId));
  }

  private linesOf(executor: Db | Tx, orderId: number): Promise<LineRow[]> {
    return executor
      .select()
      .from(salesOrderLines)
      .where(eq(salesOrderLines.orderId, orderId))
      .orderBy(asc(salesOrderLines.lineNo));
  }

  private async views(rows: readonly PickRow[], executor: Db | Tx): Promise<PickPart[]> {
    const warehouses = await this.org.warehouseNames(
      rows.map((row) => row.warehouseId),
      executor,
    );
    const pickers = await this.names.namesOf(
      rows.flatMap((row) => (row.pickerId === null ? [] : [row.pickerId])),
      executor,
    );
    return rows.map((row) => ({
      orderId: row.orderId,
      warehouseId: row.warehouseId,
      warehouseName: warehouses.get(row.warehouseId) ?? String(row.warehouseId),
      status: row.status,
      pickerId: row.pickerId,
      pickerName: row.pickerId === null ? null : (pickers.get(row.pickerId) ?? null),
      startedAt: row.startedAt,
      doneAt: row.doneAt,
    }));
  }

  private async event(
    tx: Tx,
    actor: AuditActor,
    orderId: number,
    fromStatus: OrderStatus,
    toStatus: OrderStatus,
  ): Promise<void> {
    await tx.insert(orderStatusEvents).values({
      orderId,
      fromStatus,
      toStatus,
      reason: null,
      actorId: actorUserId(actor),
      actorLabel: actor.kind === 'SYSTEM' ? actor.label : null,
    });
  }
}

/** The two legs of moving a line's goods from one shelf to another under the order's document. */
function pickLegs(
  orderId: number,
  line: LineRow,
  baseUnitId: number,
  qty: Decimal,
  fromBinId: number,
  toBinId: number,
  way: 'PICK' | 'BACK' = 'PICK',
): Movement[] {
  const common = {
    docType: 'SO' as const,
    docId: orderId,
    docLineId: line.id,
    warehouseId: line.warehouseId,
    productId: line.productId,
    enteredQty: qty,
    productUnitId: baseUnitId,
    factorSnapshot: new Decimal(1),
  };
  const [out, into] =
    way === 'PICK'
      ? (['PICK_OUT', 'PICK_IN'] as const)
      : (['BIN_MOVE_OUT', 'BIN_MOVE_IN'] as const);
  return [
    { ...common, movementType: out, leg: 1, binId: fromBinId, qtyBase: qty.negated() },
    { ...common, movementType: into, leg: 2, binId: toBinId, qtyBase: qty },
  ];
}

function takenOrState(part: PickRow): AppError {
  if (part.status === 'PICKING') {
    return new AppError('PICK_TAKEN', 'another picker holds the part', {
      pickerId: part.pickerId,
    });
  }
  return new AppError('PICK_STATE_INVALID', `the part is ${part.status}`, { status: part.status });
}
