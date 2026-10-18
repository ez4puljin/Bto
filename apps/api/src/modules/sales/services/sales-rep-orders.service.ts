import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from '@tugeel/shared/money';
import {
  type Fulfilment,
  type OrderChannel,
  type OrderStatus,
  type PaymentMethod,
  REP_MAP_FRESH_DAYS,
  REP_ORDER_RANGE_MAX_DAYS,
  type RepOrderState,
  repOrderStatusesOf,
  type StageAction,
  storeIsStale,
} from '@tugeel/shared/sales';
import { addDays, businessDate, businessDateTime, isIsoDate } from '@tugeel/shared/time';
import { and, asc, desc, eq, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import { idIn, onBusinessDays } from '../../../common/db/days';
import type { Db } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { DEFAULT_PAGE_LIMIT, decodeCursor, toPage } from '../../../common/pagination/page';
import { type AuthContext, OrgService, UserNamesService } from '../../identity';
import { CustomersService } from '../../partners';
import { PriceQuoteService, type Quote } from '../../pricing';
import { salesBoards, salesChannelDefaults, salesOrderLines, salesOrders } from '../schema';
import { repMayPlace } from './rep-access';
import { SalesAccessService } from './sales-access.service';
import {
  type OrderDetail,
  type OrderLine,
  SalesOrderQueryService,
} from './sales-order-query.service';
import { type OrderInput, SalesOrdersService } from './sales-orders.service';
import { SalesPipelinesService } from './sales-pipelines.service';

/** A store history page's rows when the app asks for no other number. */
export const REP_STORE_ORDER_PAGE_LIMIT = 20;

/** A rep's new order: the office order's header and lines, on the stage chosen in the app. */
export type RepOrderInput = Omit<OrderInput, 'pipelineId' | 'stageId'> & { stageId: number };

/** What the app loads at start (ADR-0061 #5, ADR-0068). */
export interface RepContext {
  /** The server's business date: the phone never computes it (Hermes has no reliable zones). */
  today: string;
  boards: {
    id: number;
    name: string;
    /** The board's branch, the settings' note under its name. */
    branchName: string | null;
    pipelines: {
      id: number;
      name: string;
      stages: { id: number; name: string; action: StageAction }[];
    }[];
  }[];
  /** The SALES_REP channel's stage when the rep may place on it. */
  defaultStageId: number | null;
  /** Active wholesale warehouses, the shop's homes: the location filter's choices. */
  warehouses: { id: number; name: string; branchId: number; branchName: string }[];
  /** The branches the rep may write for, by name; empty when the rep is not scoped. */
  branchNames: string[];
}

export interface RepOrderSummary {
  id: number;
  number: string | null;
  status: OrderStatus;
  customerId: number;
  customerName: string;
  fulfilment: Fulfilment;
  paymentMethod: PaymentMethod;
  deliveryDate: string;
  /** Null for a draft: prices are frozen at the submit. */
  total: Decimal | null;
  /** A draft's estimate (`DraftEstimate.total`); null for every other order. */
  estimatedTotal: Decimal | null;
  lineCount: number;
  pipelineName: string | null;
  stageName: string | null;
  createdAt: Date;
}

export interface RepOrderPage {
  data: RepOrderSummary[];
  nextCursor: string | null;
  /**
   * On the first page: the range's orders, the total of those not cancelled, the drafts and the
   * sum of the drafts' estimates (a draft without one adds nothing), whole MNT.
   */
  summary: { count: number; total: string; drafts: number; draftsEstimate: string } | null;
}

/**
 * A draft's prices today (ADR-0068 #20), never stored: its lines quoted as one cart, as
 * `POST /pricing/quote` and the submit price them. The submit still freezes its own prices.
 */
export interface DraftEstimate {
  /** Null when a line cannot be priced (no terms, a superseded unit, an inexact quantity). */
  total: Decimal | null;
  /** By line id; null for a line that cannot be priced. */
  lines: Map<number, Decimal | null>;
}

/** A rep's order with a draft's estimate; both kinds of estimate are null for any other order. */
export interface RepOrderDetail extends Omit<OrderDetail, 'lines'> {
  estimatedTotal: Decimal | null;
  lines: (OrderLine & { estimatedTotal: Decimal | null })[];
}

/** The order history's days, search and filters; every one narrows the page and the summary. */
export interface RepOrderListQuery {
  from: string;
  to: string;
  q?: string;
  customerId?: number;
  /** Orders with a line of this product. */
  productId?: number;
  paymentMethod?: PaymentMethod;
  fulfilment?: Fulfilment;
  state?: RepOrderState;
  cursor?: string;
  limit?: number;
}

/** A store on the rep's map: its point and the caller's own last order for it. */
export interface RepMapStore {
  customerId: number;
  code: string;
  name: string;
  phone: string | null;
  /** The address whose point is shown (`CustomersService.located`). */
  addressId: number;
  address: string | null;
  lat: Decimal;
  lng: Decimal;
  lastOrderId: number | null;
  lastOrderAt: Date | null;
  /** The last order's Ulaanbaatar day. */
  lastOrderDate: string | null;
  /** No order within REP_MAP_FRESH_DAYS days, today included (`storeIsStale`). */
  stale: boolean;
}

/**
 * One order in a store's history (ADR-0068): every channel and every creator, with who took it
 * and when (Ulaanbaatar day and time); only `mine` ones open in the app (`get`).
 */
export interface RepStoreOrder {
  id: number;
  number: string | null;
  status: OrderStatus;
  channel: OrderChannel;
  createdAt: Date;
  /** The Ulaanbaatar day, `YYYY-MM-DD`. */
  createdDate: string;
  /** The Ulaanbaatar wall-clock time, `HH:mm`. */
  createdTime: string;
  /** The creator's full name; null when the order has no creator or the user is unknown. */
  takerName: string | null;
  /** The caller's own SALES_REP order: exactly the orders `get` opens. */
  mine: boolean;
  /** Null for a draft: prices are frozen at the submit. */
  total: Decimal | null;
  /** A draft's estimate (`DraftEstimate.total`); null for every other order. */
  estimatedTotal: Decimal | null;
  lineCount: number;
}

export interface RepStoreOrderPage {
  data: RepStoreOrder[];
  nextCursor: string | null;
}

export interface RepMap {
  today: string;
  freshDays: number;
  stores: RepMapStore[];
}

/**
 * The sales-rep app's orders (ADR-0061 #5–#6): the stages a rep may place on, a new order on the
 * chosen stage (a NONE stage leaves a draft, a CONFIRM stage submits it in the same transaction),
 * and the rep's own SALES_REP orders. Reps hold neither `sales.orders.read` nor `manage`, so
 * nothing here goes through `Access.visibleSql()`: a rep reads only rows they created.
 */
@Injectable()
export class SalesRepOrdersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly access: SalesAccessService,
    private readonly pipelines: SalesPipelinesService,
    private readonly orders: SalesOrdersService,
    private readonly queries: SalesOrderQueryService,
    private readonly customers: CustomersService,
    private readonly org: OrgService,
    private readonly quotes: PriceQuoteService,
    private readonly names: UserNamesService,
  ) {}

  async context(ctx: AuthContext): Promise<RepContext> {
    const access = await this.access.load(ctx);
    const boards = await this.db
      .select({ id: salesBoards.id, name: salesBoards.name, branchId: salesBoards.branchId })
      .from(salesBoards)
      .where(isNull(salesBoards.archivedAt))
      .orderBy(asc(salesBoards.position), asc(salesBoards.id));
    const branchNameOf = new Map((await this.org.listBranches()).map((row) => [row.id, row.name]));
    const shaped = boards
      .map((board) => ({
        id: board.id,
        name: board.name,
        branchName: board.branchId === null ? null : (branchNameOf.get(board.branchId) ?? null),
        pipelines: access.pipelines
          .filter((pipeline) => pipeline.boardId === board.id && pipeline.archivedAt === null)
          .map((pipeline) => ({
            id: pipeline.id,
            name: pipeline.name,
            stages: pipeline.stages
              .filter((stage) => repMayPlace(ctx, pipeline, stage))
              .map((stage) => ({ id: stage.id, name: stage.name, action: stage.action })),
          }))
          .filter((pipeline) => pipeline.stages.length > 0),
      }))
      .filter((board) => board.pipelines.length > 0);
    const placeable = new Set(
      shaped.flatMap((board) =>
        board.pipelines.flatMap((pipeline) => pipeline.stages.map((stage) => stage.id)),
      ),
    );
    const [channel] = await this.db
      .select({ stageId: salesChannelDefaults.stageId })
      .from(salesChannelDefaults)
      .where(eq(salesChannelDefaults.channel, 'SALES_REP'));
    const allWarehouses = await this.org.listWarehouses();
    const warehouses = allWarehouses.flatMap((warehouse) =>
      warehouse.kind === 'WHOLESALE' && warehouse.status === 'ACTIVE' && warehouse.branchId !== null
        ? [
            {
              id: warehouse.id,
              name: warehouse.name,
              branchId: warehouse.branchId,
              branchName: branchNameOf.get(warehouse.branchId) ?? '',
            },
          ]
        : [],
    );
    // The write scope always holds the TRANSIT warehouse, which has no branch.
    const writable = ctx.writableWarehouseIds;
    const scopedBranches = new Set(
      writable === null
        ? []
        : allWarehouses.flatMap((warehouse) =>
            writable.has(warehouse.id) && warehouse.branchId !== null ? [warehouse.branchId] : [],
          ),
    );
    return {
      today: businessDate(),
      boards: shaped,
      defaultStageId: channel && placeable.has(channel.stageId) ? channel.stageId : null,
      warehouses,
      branchNames: [...scopedBranches]
        .map((id) => branchNameOf.get(id) ?? '')
        .filter((name) => name !== '')
        .sort((a, b) => a.localeCompare(b)),
    };
  }

  /**
   * The order on the chosen stage, in one transaction (ADR-0061 #6): the pipeline and the stage
   * locked FOR SHARE first, so the rule is checked on settings nobody changes meanwhile; then the
   * draft on the SALES_REP channel; on a CONFIRM stage its submit (prices frozen, stock reserved,
   * the rest backordered), the number drawn last. A refusal leaves nothing behind.
   */
  async create(ctx: AuthContext, input: RepOrderInput): Promise<RepOrderDetail> {
    const id = await inTransaction(this.db, async (tx) => {
      const pipelineId = await this.pipelines.lockStage(tx, input.stageId);
      const access = await this.access.load(ctx, tx);
      const found = access.stage(input.stageId);
      if (!found || !repMayPlace(ctx, found.pipeline, found.stage)) {
        throw invalid('stageId', 'repStage', 'not a stage this rep may place orders on');
      }
      const confirm = found.stage.action === 'CONFIRM';
      const placement = { pipelineId, stageId: input.stageId };
      const orderId = await this.orders.createInTx(
        tx,
        ctx,
        { ...input, ...placement },
        { channel: 'SALES_REP', placement: () => Promise.resolve(placement), numberLater: confirm },
      );
      if (confirm) await this.orders.submitDraftInTx(tx, ctx, orderId);
      return orderId;
    });
    return this.withEstimate(await this.queries.detail(ctx, id));
  }

  /**
   * The rep's own SALES_REP orders created on Ulaanbaatar days `from`…`to` (both included, at most
   * REP_ORDER_RANGE_MAX_DAYS), newest first; `q` finds an order number or a customer as the
   * office list does; a customer, a product (an order with a line of it), the payment method, the
   * fulfilment and the state (`repOrderStatusesOf`) narrow further. The first page's summary
   * covers every order the range, search and filters keep. A draft carries its estimate
   * (ADR-0068 #20); the summary sums every kept draft's, so the first page quotes them all.
   */
  async list(ctx: AuthContext, query: RepOrderListQuery): Promise<RepOrderPage> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const { from, to } = query;
    if (!isIsoDate(from)) throw invalid('from', 'isDate', 'from must be a date');
    if (!isIsoDate(to)) throw invalid('to', 'isDate', 'to must be a date');
    if (to < from) throw invalid('to', 'range', 'to must not be before from');
    if (to > addDays(from, REP_ORDER_RANGE_MAX_DAYS - 1)) {
      throw invalid('to', 'range', `a range spans at most ${REP_ORDER_RANGE_MAX_DAYS} days`);
    }
    const filters = await this.queries.filterSql(ctx, {
      ...(query.q ? { q: query.q } : {}),
      ...(query.customerId === undefined ? {} : { customerId: query.customerId }),
      ...(query.paymentMethod === undefined ? {} : { paymentMethod: query.paymentMethod }),
      ...(query.fulfilment === undefined ? {} : { fulfilment: query.fulfilment }),
    });
    if (query.productId !== undefined) {
      // Spelled out: a single-table select leaves columns unqualified (see lineCount below).
      filters.push(sql`EXISTS (SELECT 1 FROM sales_order_lines l
        WHERE l.order_id = sales_orders.id AND l.product_id = ${query.productId})`);
    }
    if (query.state !== undefined) {
      filters.push(inArray(salesOrders.status, [...repOrderStatusesOf(query.state)]));
    }
    const mine = and(
      eq(salesOrders.createdBy, ctx.userId),
      eq(salesOrders.channel, 'SALES_REP'),
      onBusinessDays(salesOrders.createdAt, { from, to }),
      ...filters,
    );
    const cursor = decodeCursor(query.cursor);
    const after = typeof cursor?.id === 'number' ? cursor.id : null;
    const rows = await this.db
      .select({
        id: salesOrders.id,
        number: salesOrders.number,
        status: salesOrders.status,
        customerId: salesOrders.customerId,
        fulfilment: salesOrders.fulfilment,
        paymentMethod: salesOrders.paymentMethod,
        deliveryDate: salesOrders.deliveryDate,
        total: salesOrders.total,
        pipelineId: salesOrders.pipelineId,
        stageId: salesOrders.stageId,
        createdAt: salesOrders.createdAt,
        // Spelled out: a single-table select leaves columns unqualified, and a bare "id" here
        // would be the line's own.
        lineCount: sql<number>`(SELECT count(*)::int FROM sales_order_lines l WHERE l.order_id = sales_orders.id)`,
      })
      .from(salesOrders)
      .where(and(mine, after === null ? undefined : lt(salesOrders.id, after)))
      .orderBy(desc(salesOrders.id))
      .limit(limit + 1);
    const page = toPage(rows, limit, (row) => ({ id: row.id }));
    const access = await this.access.load(ctx);
    const names = new Map(
      (await this.customers.getMany(page.data.map((row) => row.customerId))).map((customer) => [
        customer.id,
        customer.name,
      ]),
    );
    let summary: RepOrderPage['summary'] = null;
    let estimates: Map<number, DraftEstimate>;
    if (query.cursor === undefined) {
      const [totals] = await this.db
        .select({
          count: sql<number>`count(*)::int`,
          total: sql<string>`coalesce(sum(${salesOrders.total}) FILTER (WHERE ${salesOrders.status} <> 'CANCELLED'), 0)::text`,
          drafts: sql<number>`(count(*) FILTER (WHERE ${salesOrders.status} = 'DRAFT'))::int`,
        })
        .from(salesOrders)
        .where(mine);
      // Every draft the range keeps, the page's among them.
      const drafts = await this.db
        .select({ id: salesOrders.id })
        .from(salesOrders)
        .where(and(mine, eq(salesOrders.status, 'DRAFT')));
      estimates = await this.estimates(drafts.map((row) => row.id));
      const draftsEstimate = [...estimates.values()].reduce(
        (sum, estimate) => (estimate.total ? sum.plus(estimate.total) : sum),
        new Decimal(0),
      );
      summary = {
        count: totals?.count ?? 0,
        total: totals?.total ?? '0',
        drafts: totals?.drafts ?? 0,
        draftsEstimate: draftsEstimate.toFixed(0),
      };
    } else {
      estimates = await this.estimates(
        page.data.flatMap((row) => (row.status === 'DRAFT' ? [row.id] : [])),
      );
    }
    return {
      data: page.data.map((row) => ({
        id: row.id,
        number: row.number,
        status: row.status,
        customerId: row.customerId,
        customerName: names.get(row.customerId) ?? '',
        fulfilment: row.fulfilment,
        paymentMethod: row.paymentMethod,
        deliveryDate: row.deliveryDate,
        total: row.total,
        estimatedTotal: row.status === 'DRAFT' ? (estimates.get(row.id)?.total ?? null) : null,
        lineCount: row.lineCount,
        pipelineName:
          row.pipelineId === null ? null : (access.pipeline(row.pipelineId)?.name ?? null),
        stageName: row.stageId === null ? null : (access.stage(row.stageId)?.stage.name ?? null),
        createdAt: row.createdAt,
      })),
      nextCursor: page.nextCursor,
      summary,
    };
  }

  /**
   * The rep's map: every active customer the caller may see that has a GPS point
   * (`CustomersService.located`), each with the caller's own last SALES_REP order for it (drafts
   * count, cancelled ones do not; another rep's never) and whether it is stale: no such order
   * within REP_MAP_FRESH_DAYS Ulaanbaatar days, today included.
   */
  async map(ctx: AuthContext): Promise<RepMap> {
    const today = businessDate();
    const located = await this.customers.located(ctx);
    // The id rises with created_at: the highest id is the newest order.
    const last = await this.db
      .selectDistinctOn([salesOrders.customerId], {
        customerId: salesOrders.customerId,
        id: salesOrders.id,
        createdAt: salesOrders.createdAt,
      })
      .from(salesOrders)
      .where(
        and(
          eq(salesOrders.createdBy, ctx.userId),
          eq(salesOrders.channel, 'SALES_REP'),
          ne(salesOrders.status, 'CANCELLED'),
        ),
      )
      .orderBy(asc(salesOrders.customerId), desc(salesOrders.id));
    const lastOf = new Map(last.map((row) => [row.customerId, row]));
    return {
      today,
      freshDays: REP_MAP_FRESH_DAYS,
      stores: located.map((store) => {
        const order = lastOf.get(store.id);
        const lastOrderDate = order ? businessDate(order.createdAt) : null;
        return {
          customerId: store.id,
          code: store.code,
          name: store.name,
          phone: store.phone,
          addressId: store.addressId,
          address: store.address,
          lat: store.lat,
          lng: store.lng,
          lastOrderId: order?.id ?? null,
          lastOrderAt: order?.createdAt ?? null,
          lastOrderDate,
          stale: storeIsStale(lastOrderDate, today),
        };
      }),
    };
  }

  /**
   * A store's order history on its map card (ADR-0068): every order of a customer the caller may
   * see (`CustomersService.isVisible`, else 404), every channel, creator and status, drafts and
   * cancelled ones included, newest first. A rep otherwise sees only their own orders; here the
   * others' are rows only (who took it, when, the amount, the status), and `mine` marks the ones
   * `get` opens. A draft carries its estimate (ADR-0068 #20).
   */
  async storeOrders(
    ctx: AuthContext,
    customerId: number,
    query: { cursor?: string; limit?: number } = {},
  ): Promise<RepStoreOrderPage> {
    if (!(await this.customers.isVisible(ctx, customerId))) throw notFound('customer', customerId);
    const limit = query.limit ?? REP_STORE_ORDER_PAGE_LIMIT;
    const cursor = decodeCursor(query.cursor);
    const after = typeof cursor?.id === 'number' ? cursor.id : null;
    const rows = await this.db
      .select({
        id: salesOrders.id,
        number: salesOrders.number,
        status: salesOrders.status,
        channel: salesOrders.channel,
        createdBy: salesOrders.createdBy,
        total: salesOrders.total,
        createdAt: salesOrders.createdAt,
        // Spelled out: a single-table select leaves columns unqualified (see `list`).
        lineCount: sql<number>`(SELECT count(*)::int FROM sales_order_lines l WHERE l.order_id = sales_orders.id)`,
      })
      .from(salesOrders)
      .where(
        and(
          eq(salesOrders.customerId, customerId),
          after === null ? undefined : lt(salesOrders.id, after),
        ),
      )
      .orderBy(desc(salesOrders.id))
      .limit(limit + 1);
    const page = toPage(rows, limit, (row) => ({ id: row.id }));
    const names = await this.names.namesOf(
      page.data.flatMap((row) => (row.createdBy === null ? [] : [row.createdBy])),
    );
    const estimates = await this.estimates(
      page.data.flatMap((row) => (row.status === 'DRAFT' ? [row.id] : [])),
    );
    return {
      data: page.data.map((row) => ({
        id: row.id,
        number: row.number,
        status: row.status,
        channel: row.channel,
        createdAt: row.createdAt,
        createdDate: businessDate(row.createdAt),
        // `YYYY-MM-DD HH:mm` in Ulaanbaatar: the time follows the day.
        createdTime: businessDateTime(row.createdAt).slice(11),
        takerName: row.createdBy === null ? null : (names.get(row.createdBy) ?? null),
        // The condition `get` opens an order on.
        mine: row.createdBy === ctx.userId && row.channel === 'SALES_REP',
        total: row.total,
        estimatedTotal: row.status === 'DRAFT' ? (estimates.get(row.id)?.total ?? null) : null,
        lineCount: row.lineCount,
      })),
      nextCursor: page.nextCursor,
    };
  }

  /** One of the rep's own SALES_REP orders, a draft with its estimate; 404 for every other order. */
  async get(ctx: AuthContext, id: number): Promise<RepOrderDetail> {
    const [row] = await this.db
      .select({ createdBy: salesOrders.createdBy, channel: salesOrders.channel })
      .from(salesOrders)
      .where(eq(salesOrders.id, id));
    if (!row || row.createdBy !== ctx.userId || row.channel !== 'SALES_REP') {
      throw notFound('sales order', id);
    }
    return this.withEstimate(await this.queries.detail(ctx, id));
  }

  private async withEstimate(order: OrderDetail): Promise<RepOrderDetail> {
    const estimate =
      order.status === 'DRAFT' && order.lines.length > 0
        ? await this.estimate(order.lines, businessDate())
        : null;
    return {
      ...order,
      estimatedTotal: estimate?.total ?? null,
      lines: order.lines.map((line) => ({
        ...line,
        estimatedTotal: estimate?.lines.get(line.id) ?? null,
      })),
    };
  }

  /**
   * The drafts' estimates by order id (ADR-0068 #20): their lines load in one query; each draft is
   * then quoted on its own, because a cart's programs (ORDER and CATEGORY ones, a product's
   * quantity steps) count over that one cart. A draft without lines has none.
   */
  private async estimates(orderIds: readonly number[]): Promise<Map<number, DraftEstimate>> {
    const estimates = new Map<number, DraftEstimate>();
    if (orderIds.length === 0) return estimates;
    // A single-table select: the columns stay unqualified, which is unambiguous here.
    const lines = await this.db
      .select({
        orderId: salesOrderLines.orderId,
        id: salesOrderLines.id,
        productUnitId: salesOrderLines.productUnitId,
        qty: salesOrderLines.qty,
      })
      .from(salesOrderLines)
      .where(idIn(salesOrderLines.orderId, orderIds))
      .orderBy(asc(salesOrderLines.orderId), asc(salesOrderLines.lineNo));
    const byOrder = new Map<number, typeof lines>();
    for (const line of lines) {
      const own = byOrder.get(line.orderId);
      if (own) own.push(line);
      else byOrder.set(line.orderId, [line]);
    }
    const today = businessDate();
    // One at a time: the quote runs a handful of queries, and the pool is small (architecture §10.2).
    for (const [orderId, own] of byOrder) {
      estimates.set(orderId, await this.estimate(own, today));
    }
    return estimates;
  }

  /**
   * One draft's lines quoted as one cart on the WHOLESALE list on `date`, the quote the submit
   * and `POST /pricing/quote` run. A refusal of the whole quote (a superseded or unknown unit, an
   * inexact quantity) leaves every line without an estimate; any other error is thrown.
   */
  private async estimate(
    lines: readonly { id: number; productUnitId: number; qty: Decimal }[],
    date: string,
  ): Promise<DraftEstimate> {
    let quote: Quote;
    try {
      quote = await this.quotes.quote({
        list: 'WHOLESALE',
        date,
        lines: lines.map((line) => ({ productUnitId: line.productUnitId, qty: line.qty })),
      });
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      return { total: null, lines: new Map(lines.map((line) => [line.id, null])) };
    }
    const totals = new Map(
      lines.map((line, index): [number, Decimal | null] => {
        const result = quote.lines[index]?.result;
        return [line.id, result?.priced ? result.total : null];
      }),
    );
    const complete = [...totals.values()].every((total) => total !== null);
    return { total: complete ? quote.total : null, lines: totals };
  }
}
