import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from '@tugeel/shared/money';
import {
  CUSTOMER_ORDER_PAGE_MAX,
  type CustomerOrderState,
  customerOrderStateOf,
  customerOrderStatusesOf,
  type Fulfilment,
  type OrderChannel,
  type OrderStatus,
  type PaymentMethod,
} from '@tugeel/shared/sales';
import { businessDate, businessDateTime } from '@tugeel/shared/time';
import { and, asc, desc, eq, inArray, isNotNull, lt, type SQL, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import { onBusinessDays } from '../../../common/db/days';
import type { Db, Tx } from '../../../common/db/db.types';
import { notFound } from '../../../common/errors/app-error';
import { DEFAULT_PAGE_LIMIT, decodeCursor, toPage } from '../../../common/pagination/page';
import { systemActor, UserNamesService } from '../../identity';
import { salesOrderLines, salesOrders } from '../schema';
import { SalesOrderQueryService } from './sales-order-query.service';
import { type RepOrderDetail, SalesRepOrdersService } from './sales-rep-orders.service';

/** An order in the store's history (ADR-0079 #6): every channel, never another store's. */
export interface CustomerOrderRow {
  id: number;
  number: string | null;
  status: OrderStatus;
  state: CustomerOrderState;
  channel: OrderChannel;
  /** The rep's full name for a SALES_REP order; the app says «Апп» or «Оффис» otherwise. */
  takerName: string | null;
  createdAt: Date;
  createdDate: string;
  createdTime: string;
  fulfilment: Fulfilment;
  deliveryDate: string;
  paymentMethod: PaymentMethod;
  /** Frozen at the confirmation; null while pending. */
  total: Decimal | null;
  /** A pending order's lines at today's prices («≈»), never stored. */
  estimatedTotal: Decimal | null;
  lineCount: number;
  backorderedLines: number;
  cancelReason: string | null;
}

export interface CustomerOrderPage {
  data: CustomerOrderRow[];
  nextCursor: string | null;
  /** On the first page: the orders of the days asked, the confirmed total, the pending count. */
  summary: { count: number; confirmedTotal: Decimal; pending: number } | null;
}

/**
 * The store's order filters (the owner 2026-10-20, like the rep app's): who took it — the app,
 * the office (and the till), or the reps, one of them with `repId` —, a product on a line, the
 * payment, delivery or pickup, and the state in the customer's words.
 */
export interface CustomerOrderFilters {
  taker?: CustomerOrderTaker;
  repId?: number;
  productId?: number;
  paymentMethod?: PaymentMethod;
  fulfilment?: Fulfilment;
  state?: CustomerOrderState;
}

export type CustomerOrderTaker = 'APP' | 'OFFICE' | 'REP';

/** Where an order came from, as the store reads it: its number, channel and rep. */
export interface CustomerOrderOrigin {
  id: number;
  number: string | null;
  channel: OrderChannel;
  takerName: string | null;
}

/** A store's own order with its lines, the stage stamps and a pending order's estimate. */
export type CustomerOrderDetail = RepOrderDetail;

/** The statuses whose total counts in the store's confirmed sum and its credit exposure. */
const OPEN_EXPOSURE: readonly OrderStatus[] = ['CONFIRMED', 'PICKING', 'PACKED', 'DELIVERED'];

const ACTOR = systemActor('customer-app');

/** An order with at least one line: an office draft still empty is not the store's yet. */
const HAS_LINES = sql`EXISTS (SELECT 1 FROM sales_order_lines l WHERE l.order_id = sales_orders.id)`;

/**
 * The customer app's reads of sales (ADR-0079 #5, #6): every order of the token's store, from
 * every channel, archived ones included; the caller always passes the store from the token. No
 * staff rights apply here: the store sees its own orders, nothing else.
 */
@Injectable()
export class CustomerOrdersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly queries: SalesOrderQueryService,
    private readonly rep: SalesRepOrdersService,
    private readonly names: UserNamesService,
  ) {}

  /**
   * The store's orders newest first, keyset by id; `from` / `to` are Ulaanbaatar days (both
   * included) of the order's creation, both optional («Нүүр» asks for the last two).
   */
  async page(
    customerId: number,
    query: {
      from?: string;
      to?: string;
      cursor?: string;
      limit?: number;
    } & CustomerOrderFilters = {},
  ): Promise<CustomerOrderPage> {
    const limit = Math.min(query.limit ?? DEFAULT_PAGE_LIMIT, CUSTOMER_ORDER_PAGE_MAX);
    const cursor = decodeCursor(query.cursor);
    const after = typeof cursor?.id === 'number' ? cursor.id : null;
    const scope: SQL[] = [
      eq(salesOrders.customerId, customerId),
      HAS_LINES,
      onBusinessDays(salesOrders.createdAt, { from: query.from, to: query.to }),
      ...filtersOf(query),
    ];
    const rows = await this.db
      .select({
        id: salesOrders.id,
        number: salesOrders.number,
        status: salesOrders.status,
        channel: salesOrders.channel,
        createdBy: salesOrders.createdBy,
        createdAt: salesOrders.createdAt,
        fulfilment: salesOrders.fulfilment,
        deliveryDate: salesOrders.deliveryDate,
        paymentMethod: salesOrders.paymentMethod,
        total: salesOrders.total,
        cancelReason: salesOrders.cancelReason,
        // Spelled out: a single-table select leaves columns unqualified.
        lineCount: sql<number>`(SELECT count(*)::int FROM sales_order_lines l WHERE l.order_id = sales_orders.id)`,
        backorderedLines: sql<number>`(SELECT count(*)::int FROM sales_order_lines l WHERE l.order_id = sales_orders.id AND l.qty_backordered > 0)`,
      })
      .from(salesOrders)
      .where(and(...scope, after === null ? undefined : lt(salesOrders.id, after)))
      .orderBy(desc(salesOrders.id))
      .limit(limit + 1);
    const page = toPage(rows, limit, (row) => ({ id: row.id }));
    const reps = await this.names.namesOf(
      page.data.flatMap((row) =>
        row.channel === 'SALES_REP' && row.createdBy !== null ? [row.createdBy] : [],
      ),
    );
    const estimates = await this.rep.estimates(
      page.data.flatMap((row) => (row.status === 'DRAFT' ? [row.id] : [])),
    );
    return {
      data: page.data.map((row) => ({
        id: row.id,
        number: row.number,
        status: row.status,
        state: customerOrderStateOf(row.status),
        channel: row.channel,
        takerName:
          row.channel === 'SALES_REP' && row.createdBy !== null
            ? (reps.get(row.createdBy) ?? null)
            : null,
        createdAt: row.createdAt,
        createdDate: businessDate(row.createdAt),
        createdTime: businessDateTime(row.createdAt).slice(11),
        fulfilment: row.fulfilment,
        deliveryDate: row.deliveryDate,
        paymentMethod: row.paymentMethod,
        total: row.total,
        estimatedTotal: row.status === 'DRAFT' ? (estimates.get(row.id)?.total ?? null) : null,
        lineCount: row.lineCount,
        backorderedLines: row.backorderedLines,
        cancelReason: row.cancelReason,
      })),
      nextCursor: page.nextCursor,
      summary: after === null ? await this.summary(scope) : null,
    };
  }

  /** The reps who took orders for the store, by name: the order filter's «ХТ» choices. */
  async reps(customerId: number): Promise<{ id: number; name: string }[]> {
    const rows = await this.db
      .selectDistinct({ id: salesOrders.createdBy })
      .from(salesOrders)
      .where(
        and(
          eq(salesOrders.customerId, customerId),
          eq(salesOrders.channel, 'SALES_REP'),
          isNotNull(salesOrders.createdBy),
          HAS_LINES,
        ),
      );
    const ids = rows.flatMap((row) => (row.id === null ? [] : [row.id]));
    const names = await this.names.namesOf(ids);
    return ids
      .map((id) => ({ id, name: names.get(id) ?? '' }))
      .sort((a, b) => a.name.localeCompare(b.name, 'mn'));
  }

  /** Where these orders of the store came from (a statement's purchases, an invoice). */
  async origins(
    customerId: number,
    ids: readonly number[],
  ): Promise<Map<number, CustomerOrderOrigin>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .select({
        id: salesOrders.id,
        number: salesOrders.number,
        channel: salesOrders.channel,
        createdBy: salesOrders.createdBy,
      })
      .from(salesOrders)
      .where(and(eq(salesOrders.customerId, customerId), inArray(salesOrders.id, [...ids])));
    const reps = await this.names.namesOf(
      rows.flatMap((row) =>
        row.channel === 'SALES_REP' && row.createdBy !== null ? [row.createdBy] : [],
      ),
    );
    return new Map(
      rows.map((row) => [
        row.id,
        {
          id: row.id,
          number: row.number,
          channel: row.channel,
          takerName:
            row.channel === 'SALES_REP' && row.createdBy !== null
              ? (reps.get(row.createdBy) ?? null)
              : null,
        },
      ]),
    );
  }

  /** One of the store's orders; 404 for any other order (never "forbidden": it does not exist). */
  async detail(customerId: number, id: number): Promise<CustomerOrderDetail> {
    await this.assertOwn(customerId, id);
    return this.rep.withEstimate(await this.queries.detail(ACTOR, id));
  }

  /** An earlier order's lines for «Дахин захиалах»: the products, units and quantities only. */
  async reorderLines(
    customerId: number,
    id: number,
  ): Promise<{ productId: number; productUnitId: number; qty: Decimal }[]> {
    await this.assertOwn(customerId, id);
    return this.db
      .select({
        productId: salesOrderLines.productId,
        productUnitId: salesOrderLines.productUnitId,
        qty: salesOrderLines.qty,
      })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.orderId, id))
      .orderBy(asc(salesOrderLines.lineNo));
  }

  /**
   * What the credit check counts besides the balance (ADR-0060 #2): the store's confirmed orders
   * not yet invoiced, read without a lock (the checkout's warning, not a decision).
   */
  async openExposureOf(customerId: number, executor: Db | Tx = this.db): Promise<Decimal> {
    const [open] = await executor
      .select({ total: sql<string>`coalesce(sum(${salesOrders.total}), 0)` })
      .from(salesOrders)
      .where(
        and(eq(salesOrders.customerId, customerId), inArray(salesOrders.status, OPEN_EXPOSURE)),
      );
    return new Decimal(open?.total ?? 0);
  }

  private async summary(scope: readonly SQL[]) {
    const [row] = await this.db
      .select({
        count: sql<number>`count(*)::int`,
        confirmedTotal: sql<string>`coalesce(sum(${salesOrders.total}) FILTER (WHERE ${salesOrders.status} <> 'CANCELLED'), 0)`,
        pending: sql<number>`(count(*) FILTER (WHERE ${salesOrders.status} IN ('DRAFT', 'SUBMITTED', 'APPROVAL_PENDING')))::int`,
      })
      .from(salesOrders)
      .where(and(...scope));
    return {
      count: row?.count ?? 0,
      confirmedTotal: new Decimal(row?.confirmedTotal ?? 0),
      pending: row?.pending ?? 0,
    };
  }

  private async assertOwn(customerId: number, id: number): Promise<void> {
    const [row] = await this.db
      .select({ id: salesOrders.id })
      .from(salesOrders)
      .where(and(eq(salesOrders.id, id), eq(salesOrders.customerId, customerId), HAS_LINES));
    if (!row) throw notFound('sales order', id);
  }
}

/** The store's chosen filters as conditions on its orders. */
function filtersOf(filters: CustomerOrderFilters): SQL[] {
  const conditions: SQL[] = [];
  if (filters.taker === 'APP') conditions.push(eq(salesOrders.channel, 'CUSTOMER_APP'));
  if (filters.taker === 'OFFICE') conditions.push(inArray(salesOrders.channel, ['ADMIN', 'POS']));
  if (filters.taker === 'REP') {
    conditions.push(eq(salesOrders.channel, 'SALES_REP'));
    if (filters.repId !== undefined) conditions.push(eq(salesOrders.createdBy, filters.repId));
  }
  if (filters.productId !== undefined) {
    conditions.push(
      sql`EXISTS (SELECT 1 FROM sales_order_lines l WHERE l.order_id = sales_orders.id AND l.product_id = ${filters.productId})`,
    );
  }
  if (filters.paymentMethod) conditions.push(eq(salesOrders.paymentMethod, filters.paymentMethod));
  if (filters.fulfilment) conditions.push(eq(salesOrders.fulfilment, filters.fulfilment));
  if (filters.state) {
    conditions.push(inArray(salesOrders.status, customerOrderStatusesOf(filters.state)));
  }
  return conditions;
}
