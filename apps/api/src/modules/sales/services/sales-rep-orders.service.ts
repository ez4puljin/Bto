import { Inject, Injectable } from '@nestjs/common';
import type { Decimal } from '@tugeel/shared/money';
import {
  type Fulfilment,
  type OrderStatus,
  type PaymentMethod,
  REP_ORDER_RANGE_MAX_DAYS,
  type StageAction,
} from '@tugeel/shared/sales';
import { addDays, businessDate, isIsoDate } from '@tugeel/shared/time';
import { and, asc, desc, eq, isNull, lt, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import { onBusinessDays } from '../../../common/db/days';
import type { Db } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { invalid, notFound } from '../../../common/errors/app-error';
import { DEFAULT_PAGE_LIMIT, decodeCursor, toPage } from '../../../common/pagination/page';
import { type AuthContext, OrgService } from '../../identity';
import { CustomersService } from '../../partners';
import { salesBoards, salesChannelDefaults, salesOrders } from '../schema';
import { repMayPlace } from './rep-access';
import { SalesAccessService } from './sales-access.service';
import { type OrderDetail, SalesOrderQueryService } from './sales-order-query.service';
import { type OrderInput, SalesOrdersService } from './sales-orders.service';
import { SalesPipelinesService } from './sales-pipelines.service';

/** A rep's new order: the office order's header and lines, on the stage chosen in the app. */
export type RepOrderInput = Omit<OrderInput, 'pipelineId' | 'stageId'> & { stageId: number };

/** What the app loads at start (ADR-0061 #5, ADR-0066). */
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
  lineCount: number;
  pipelineName: string | null;
  stageName: string | null;
  createdAt: Date;
}

export interface RepOrderPage {
  data: RepOrderSummary[];
  nextCursor: string | null;
  /** On the first page: the range's orders, the total of those not cancelled and the drafts. */
  summary: { count: number; total: string; drafts: number } | null;
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
  async create(ctx: AuthContext, input: RepOrderInput): Promise<OrderDetail> {
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
    return this.queries.detail(ctx, id);
  }

  /**
   * The rep's own SALES_REP orders created on Ulaanbaatar days `from`…`to` (both included, at most
   * REP_ORDER_RANGE_MAX_DAYS), newest first; `q` finds an order number or a customer as the
   * office list does. The first page's summary covers every order the range and search keep.
   */
  async list(
    ctx: AuthContext,
    query: { from: string; to: string; q?: string; cursor?: string; limit?: number },
  ): Promise<RepOrderPage> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const { from, to } = query;
    if (!isIsoDate(from)) throw invalid('from', 'isDate', 'from must be a date');
    if (!isIsoDate(to)) throw invalid('to', 'isDate', 'to must be a date');
    if (to < from) throw invalid('to', 'range', 'to must not be before from');
    if (to > addDays(from, REP_ORDER_RANGE_MAX_DAYS - 1)) {
      throw invalid('to', 'range', `a range spans at most ${REP_ORDER_RANGE_MAX_DAYS} days`);
    }
    const search = query.q ? await this.queries.filterSql(ctx, { q: query.q }) : [];
    const mine = and(
      eq(salesOrders.createdBy, ctx.userId),
      eq(salesOrders.channel, 'SALES_REP'),
      onBusinessDays(salesOrders.createdAt, { from, to }),
      ...search,
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
    if (query.cursor === undefined) {
      const [totals] = await this.db
        .select({
          count: sql<number>`count(*)::int`,
          total: sql<string>`coalesce(sum(${salesOrders.total}) FILTER (WHERE ${salesOrders.status} <> 'CANCELLED'), 0)::text`,
          drafts: sql<number>`(count(*) FILTER (WHERE ${salesOrders.status} = 'DRAFT'))::int`,
        })
        .from(salesOrders)
        .where(mine);
      summary = {
        count: totals?.count ?? 0,
        total: totals?.total ?? '0',
        drafts: totals?.drafts ?? 0,
      };
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

  /** One of the rep's own SALES_REP orders; 404 for every other order. */
  async get(ctx: AuthContext, id: number): Promise<OrderDetail> {
    const [row] = await this.db
      .select({ createdBy: salesOrders.createdBy, channel: salesOrders.channel })
      .from(salesOrders)
      .where(eq(salesOrders.id, id));
    if (!row || row.createdBy !== ctx.userId || row.channel !== 'SALES_REP') {
      throw notFound('sales order', id);
    }
    return this.queries.detail(ctx, id);
  }
}
