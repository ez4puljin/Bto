import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from '@tugeel/shared/money';
import type { PriceBasis } from '@tugeel/shared/pricing';
import {
  BOARD_LIMITS,
  type Fulfilment,
  type OrderChannel,
  type OrderStatus,
  type PaymentMethod,
} from '@tugeel/shared/sales';
import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import { idIn } from '../../../common/db/days';
import type { Db, Tx } from '../../../common/db/db.types';
import { notFound } from '../../../common/errors/app-error';
import { DEFAULT_PAGE_LIMIT, decodeCursor, toPage } from '../../../common/pagination/page';
import { CatalogService, type ProductSummary, UnitConversionService } from '../../catalog';
import { type Actor, type AuthContext, UserNamesService } from '../../identity';
import { BinsService } from '../../inventory';
import { type CustomerOverdue, CustomersService } from '../../partners';
import {
  orderStatusEvents,
  salesBoards,
  salesOrderLineParts,
  salesOrderLines,
  salesOrders,
  salesStageMoves,
  salesStages,
} from '../schema';
import { type Access, SalesAccessService } from './sales-access.service';

type OrderRow = typeof salesOrders.$inferSelect;
type LineRow = typeof salesOrderLines.$inferSelect;

export interface OrderPart {
  productUnitId: number;
  uomName: string;
  basis: PriceBasis;
  qty: Decimal;
  factorSnapshot: Decimal;
  qtyBase: Decimal;
  listPrice: Decimal;
  unitPrice: Decimal;
  subtotal: Decimal;
  discountAmount: Decimal;
  total: Decimal;
  applied: unknown;
}

export interface OrderLine {
  id: number;
  lineNo: number;
  productId: number;
  productSku: string;
  productName: string;
  productUnitId: number;
  unitName: string;
  qty: Decimal;
  factorSnapshot: Decimal;
  qtyBase: Decimal;
  baseUnitName: string;
  warehouseId: number;
  qtyApproved: Decimal;
  qtyBackordered: Decimal;
  /** The picked counts (ADR-0056 #5); null until picked. */
  qtyPicked: Decimal | null;
  pickBinId: number | null;
  pickBinCode: string | null;
  qtyDelivered: Decimal | null;
  subtotal: Decimal | null;
  discountAmount: Decimal | null;
  total: Decimal | null;
  parts: OrderPart[];
}

export interface OrderEvent {
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  reason: string | null;
  actorId: number | null;
  /** Who did it, for the order's activity (ADR-0059). */
  actorName: string | null;
  createdAt: Date;
}

export interface StageMove {
  fromStageId: number | null;
  toStageId: number;
  /** The stages' names, archived ones too, for the order's activity (ADR-0059). */
  fromStageName: string | null;
  toStageName: string | null;
  actorId: number | null;
  actorName: string | null;
  createdAt: Date;
}

export interface OrderDetail extends Omit<
  OrderRow,
  'createdBy' | 'submittedBy' | 'cancelledBy' | 'pickedBy' | 'deliveredBy' | 'archivedBy'
> {
  customerCode: string;
  customerName: string;
  /** The customer's overdue receivable (ADR-0101: a red reminder, never a block); null when none. */
  customerOverdue: CustomerOverdue | null;
  boardId: number | null;
  boardName: string | null;
  pipelineName: string | null;
  stageName: string | null;
  createdByName: string | null;
  /** The caller may edit (and archive) the order: the stage's EDIT right. */
  canEdit: boolean;
  lines: OrderLine[];
  events: OrderEvent[];
  moves: StageMove[];
}

/** The narrowing the board, the list and printing share (ADR-0057 #7). */
export interface OrderFilters {
  /** Part of the number, or of a customer's name, code or phone. */
  q?: string;
  customerId?: number;
  /** Only the orders the caller entered. */
  mine?: boolean;
  channel?: OrderChannel;
  fulfilment?: Fulfilment;
  paymentMethod?: PaymentMethod;
  deliveryFrom?: string;
  deliveryTo?: string;
}

export interface OrderQuery extends OrderFilters {
  /** One pipeline, or 'none' for the orders without one; absent = all the caller sees. */
  pipeline?: number | 'none';
  stageId?: number;
  status?: OrderStatus;
  /** Archived orders: left out (default), included, or only them. */
  archived?: 'exclude' | 'include' | 'only';
  cursor?: string;
  limit?: number;
}

export interface OrderSummary {
  id: number;
  number: string | null;
  status: OrderStatus;
  channel: OrderChannel;
  customerId: number;
  customerCode: string;
  customerName: string;
  /** The customer's overdue receivable (ADR-0101: a red reminder, never a block); null when none. */
  customerOverdue: CustomerOverdue | null;
  fulfilment: Fulfilment;
  paymentMethod: PaymentMethod;
  deliveryDate: string;
  total: Decimal | null;
  lineCount: number;
  pipelineId: number | null;
  pipelineName: string | null;
  stageId: number | null;
  stageName: string | null;
  archivedAt: Date | null;
  createdByName: string | null;
  createdAt: Date;
}

/** A card of the board: an order as its column shows it. */
export interface OrderCard {
  id: number;
  number: string | null;
  status: OrderStatus;
  channel: OrderChannel;
  customerId: number;
  customerCode: string;
  customerName: string;
  /** The customer's overdue receivable (ADR-0101: a red reminder, never a block); null when none. */
  customerOverdue: CustomerOverdue | null;
  fulfilment: Fulfilment;
  paymentMethod: PaymentMethod;
  deliveryDate: string;
  total: Decimal | null;
  lineCount: number;
  createdByName: string | null;
  stageEnteredAt: Date;
}

export interface StageCards {
  stageId: number;
  /** In the stage's sort, the first `BOARD_LIMITS.cardsPerStage`. */
  cards: OrderCard[];
  /** Cards in the stage, also those beyond the first page. */
  count: number;
  total: Decimal;
}

const text = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
};

const like = (value: string) => `%${value.replace(/[\\%_]/g, '\\$&')}%`;

/** A bigint from a raw query: node-postgres returns int8 as text. */
const int = (value: string | number): number =>
  typeof value === 'number' ? value : Number.parseInt(value, 10);

/**
 * The reads of the sales screens (ADR-0057): a pipeline's cards per stage, the order list, one
 * order or a batch for printing — always narrowed by `SalesAccessService`'s predicate.
 */
@Injectable()
export class SalesOrderQueryService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly access: SalesAccessService,
    private readonly catalog: CatalogService,
    private readonly units: UnitConversionService,
    private readonly customers: CustomersService,
    private readonly bins: BinsService,
    private readonly names: UserNamesService,
  ) {}

  /** One order the caller sees; 404 otherwise. */
  async get(ctx: Actor | AuthContext, id: number): Promise<OrderDetail> {
    const access = await this.access.load(ctx);
    const [order] = await this.db.select().from(salesOrders).where(eq(salesOrders.id, id));
    if (!order || !access.canSee(order)) throw notFound('sales order', id);
    const [detail] = await this.details([order], access);
    if (!detail) throw notFound('sales order', id);
    return detail;
  }

  /** An order whatever the caller's rights: the answer to a write the caller just made. */
  async detail(
    ctx: Actor | AuthContext,
    id: number,
    executor: Db | Tx = this.db,
  ): Promise<OrderDetail> {
    const access = await this.access.load(ctx, executor);
    const [order] = await executor.select().from(salesOrders).where(eq(salesOrders.id, id));
    if (!order) throw notFound('sales order', id);
    const [detail] = await this.details([order], access, executor);
    if (!detail) throw notFound('sales order', id);
    return detail;
  }

  /** Up to `BOARD_LIMITS.maxPrint` orders for printing, in the order asked; unseen ones left out. */
  async batch(ctx: AuthContext, ids: readonly number[]): Promise<OrderDetail[]> {
    const wanted = [...new Set(ids)].slice(0, BOARD_LIMITS.maxPrint);
    if (wanted.length === 0) return [];
    const access = await this.access.load(ctx);
    const rows = await this.db
      .select()
      .from(salesOrders)
      .where(and(idIn(salesOrders.id, wanted), access.visibleSql()));
    const byId = new Map(rows.map((row) => [row.id, row]));
    return this.details(
      wanted.flatMap((id) => {
        const row = byId.get(id);
        return row ? [row] : [];
      }),
      access,
    );
  }

  /**
   * A pipeline's cards per visible live stage, each stage in its own sort, at most
   * `BOARD_LIMITS.cardsPerStage` each, archived orders left out; counts and totals over every
   * card the filters keep.
   */
  async cards(ctx: AuthContext, pipelineId: number, filters: OrderFilters): Promise<StageCards[]> {
    const access = await this.access.load(ctx);
    const pipeline = access.pipeline(pipelineId);
    if (!pipeline || !access.pipelineRights(pipeline).view) throw notFound('pipeline', pipelineId);
    const stages = pipeline.stages.filter(
      (stage) => stage.archivedAt === null && access.stageRights(pipeline, stage).view,
    );
    if (stages.length === 0) return [];
    const where =
      and(
        isNull(salesOrders.archivedAt),
        access.visibleSql(),
        ...(await this.filterSql(ctx, filters)),
      ) ?? sql`true`;
    const stageIds = stages.map((stage) => stage.id);
    const sorts = stages.map((stage) => stage.cardSort);
    const { rows } = await this.db.execute<{
      id: string | number;
      number: string | null;
      status: OrderStatus;
      channel: OrderChannel;
      customer_id: string | number;
      fulfilment: Fulfilment;
      payment_method: PaymentMethod;
      delivery_date: string;
      total: string | null;
      stage_id: string | number;
      stage_entered_at: string | Date | null;
      created_by: string | number | null;
      line_count: string | number;
    }>(sql`
      SELECT c.*
        FROM unnest(${sql.param(stageIds)}::bigint[], ${sql.param(sorts)}::text[]) AS s(id, sort)
        CROSS JOIN LATERAL (
          SELECT ${salesOrders.id} AS id, ${salesOrders.number} AS number,
                 ${salesOrders.status} AS status, ${salesOrders.channel} AS channel,
                 ${salesOrders.customerId} AS customer_id, ${salesOrders.fulfilment} AS fulfilment,
                 ${salesOrders.paymentMethod} AS payment_method,
                 ${salesOrders.deliveryDate}::text AS delivery_date, ${salesOrders.total}::text AS total,
                 ${salesOrders.stageId} AS stage_id, ${salesOrders.stageEnteredAt} AS stage_entered_at,
                 ${salesOrders.createdBy} AS created_by,
                 (SELECT count(*) FROM ${salesOrderLines} l WHERE l.order_id = ${salesOrders.id}) AS line_count
            FROM ${salesOrders}
           WHERE ${salesOrders.stageId} = s.id AND ${where}
           ORDER BY CASE WHEN s.sort = 'OLDEST' THEN ${salesOrders.id} END ASC,
                    CASE WHEN s.sort = 'DELIVERY' THEN ${salesOrders.deliveryDate} END ASC,
                    CASE WHEN s.sort = 'TOTAL' THEN ${salesOrders.total} END DESC NULLS LAST,
                    CASE WHEN s.sort = 'WAITING' THEN ${salesOrders.stageEnteredAt} END ASC,
                    ${salesOrders.id} DESC
           LIMIT ${BOARD_LIMITS.cardsPerStage}
        ) c`);
    const totals = await this.db
      .select({
        stageId: salesOrders.stageId,
        count: sql<string>`count(*)`,
        total: sql<string>`coalesce(sum(${salesOrders.total}), 0)`,
      })
      .from(salesOrders)
      .where(and(idIn(salesOrders.stageId, stageIds), where))
      .groupBy(salesOrders.stageId);
    const customers = new Map(
      (await this.customers.getMany(rows.map((row) => int(row.customer_id)))).map((c) => [c.id, c]),
    );
    const overdue = await this.customers.overdueOf([...customers.keys()]);
    const names = await this.names.namesOf(
      rows.flatMap((row) => (row.created_by === null ? [] : [int(row.created_by)])),
    );
    return stages.map((stage) => {
      const sums = totals.find((entry) => entry.stageId === stage.id);
      return {
        stageId: stage.id,
        count: Number.parseInt(sums?.count ?? '0', 10),
        total: new Decimal(sums?.total ?? 0),
        cards: rows
          .filter((row) => int(row.stage_id) === stage.id)
          .map((row) => {
            const customerId = int(row.customer_id);
            const createdBy = row.created_by === null ? null : int(row.created_by);
            return {
              id: int(row.id),
              number: row.number,
              status: row.status,
              channel: row.channel,
              customerId,
              customerCode: customers.get(customerId)?.code ?? '',
              customerName: customers.get(customerId)?.name ?? '',
              customerOverdue: overdue.get(customerId) ?? null,
              fulfilment: row.fulfilment,
              paymentMethod: row.payment_method,
              deliveryDate: row.delivery_date,
              total: row.total === null ? null : new Decimal(row.total),
              lineCount: int(row.line_count),
              createdByName: createdBy === null ? null : (names.get(createdBy) ?? null),
              stageEnteredAt:
                row.stage_entered_at instanceof Date
                  ? row.stage_entered_at
                  : new Date(row.stage_entered_at ?? 0),
            };
          }),
      };
    });
  }

  /** The order list (keyset, newest first) of what the caller sees; the total on the first page. */
  async list(
    ctx: AuthContext,
    query: OrderQuery,
  ): Promise<{ data: OrderSummary[]; nextCursor: string | null; total: number | null }> {
    const access = await this.access.load(ctx);
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const filters: SQL[] = [access.visibleSql(), ...(await this.filterSql(ctx, query))];
    if (query.pipeline === 'none') filters.push(isNull(salesOrders.pipelineId));
    else if (query.pipeline !== undefined) filters.push(eq(salesOrders.pipelineId, query.pipeline));
    if (query.stageId) filters.push(eq(salesOrders.stageId, query.stageId));
    if (query.status) filters.push(eq(salesOrders.status, query.status));
    const archived = query.archived ?? 'exclude';
    if (archived === 'exclude') filters.push(isNull(salesOrders.archivedAt));
    if (archived === 'only') filters.push(isNotNull(salesOrders.archivedAt));
    const after = decodeCursor(query.cursor);
    const paged = typeof after?.id === 'number' ? [lt(salesOrders.id, after.id)] : [];
    const rows = await this.db
      .select({
        id: salesOrders.id,
        number: salesOrders.number,
        status: salesOrders.status,
        channel: salesOrders.channel,
        customerId: salesOrders.customerId,
        fulfilment: salesOrders.fulfilment,
        paymentMethod: salesOrders.paymentMethod,
        deliveryDate: salesOrders.deliveryDate,
        total: salesOrders.total,
        pipelineId: salesOrders.pipelineId,
        stageId: salesOrders.stageId,
        archivedAt: salesOrders.archivedAt,
        createdBy: salesOrders.createdBy,
        createdAt: salesOrders.createdAt,
        // Spelled out: a single-table select leaves columns unqualified.
        lineCount: sql<string>`(SELECT count(*) FROM sales_order_lines l WHERE l.order_id = sales_orders.id)`,
      })
      .from(salesOrders)
      .where(and(...filters, ...paged))
      .orderBy(desc(salesOrders.id))
      .limit(limit + 1);
    const page = toPage(rows, limit, (row) => ({ id: row.id }));
    let total: number | null = null;
    if (!query.cursor) {
      const [counted] = await this.db
        .select({ count: sql<string>`count(*)` })
        .from(salesOrders)
        .where(and(...filters));
      total = Number.parseInt(counted?.count ?? '0', 10);
    }
    const customers = new Map(
      (await this.customers.getMany(page.data.map((row) => row.customerId))).map((customer) => [
        customer.id,
        customer,
      ]),
    );
    const names = await this.names.namesOf(
      page.data.flatMap((row) => (row.createdBy === null ? [] : [row.createdBy])),
    );
    const overdue = await this.customers.overdueOf([...customers.keys()]);
    return {
      data: page.data.map(({ createdBy, lineCount, ...row }) => ({
        ...row,
        customerCode: customers.get(row.customerId)?.code ?? '',
        customerName: customers.get(row.customerId)?.name ?? '',
        customerOverdue: overdue.get(row.customerId) ?? null,
        lineCount: Number.parseInt(lineCount, 10),
        pipelineName:
          row.pipelineId === null ? null : (access.pipeline(row.pipelineId)?.name ?? null),
        stageName: row.stageId === null ? null : (access.stage(row.stageId)?.stage.name ?? null),
        createdByName: createdBy === null ? null : (names.get(createdBy) ?? null),
      })),
      nextCursor: page.nextCursor,
      total,
    };
  }

  /** The filters as conditions on `sales_orders`; a customer search goes through partners. */
  async filterSql(ctx: AuthContext, filters: OrderFilters): Promise<SQL[]> {
    const where: SQL[] = [];
    const q = text(filters.q);
    if (q) {
      const customerIds = await this.customers.idsWhere(ctx, {
        field: 'search',
        op: 'CONTAINS',
        text: q,
      });
      const byNumber = ilike(salesOrders.number, like(q));
      where.push(
        customerIds.length > 0
          ? (or(byNumber, idIn(salesOrders.customerId, customerIds)) ?? byNumber)
          : byNumber,
      );
    }
    if (filters.customerId) where.push(eq(salesOrders.customerId, filters.customerId));
    if (filters.mine) where.push(eq(salesOrders.createdBy, ctx.userId));
    if (filters.channel) where.push(eq(salesOrders.channel, filters.channel));
    if (filters.fulfilment) where.push(eq(salesOrders.fulfilment, filters.fulfilment));
    if (filters.paymentMethod) where.push(eq(salesOrders.paymentMethod, filters.paymentMethod));
    if (filters.deliveryFrom) where.push(gte(salesOrders.deliveryDate, filters.deliveryFrom));
    if (filters.deliveryTo) where.push(lte(salesOrders.deliveryDate, filters.deliveryTo));
    return where;
  }

  /** Full orders, batched: lines, parts, products, units, customers, events, moves, names. */
  async details(
    orders: readonly OrderRow[],
    access: Access,
    executor: Db | Tx = this.db,
  ): Promise<OrderDetail[]> {
    if (orders.length === 0) return [];
    const ids = orders.map((order) => order.id);
    const lines = await executor
      .select()
      .from(salesOrderLines)
      .where(idIn(salesOrderLines.orderId, ids))
      .orderBy(asc(salesOrderLines.orderId), asc(salesOrderLines.lineNo));
    const parts =
      lines.length === 0
        ? []
        : await executor
            .select()
            .from(salesOrderLineParts)
            .where(
              idIn(
                salesOrderLineParts.lineId,
                lines.map((line) => line.id),
              ),
            )
            .orderBy(asc(salesOrderLineParts.lineId), asc(salesOrderLineParts.partNo));
    const products = new Map(
      (await this.catalog.getMany([...new Set(lines.map((line) => line.productId))], executor)).map(
        (product) => [product.id, product],
      ),
    );
    const units = await this.units.describe(
      [...new Set(lines.map((line) => line.productUnitId))],
      executor,
    );
    const customers = new Map(
      (
        await this.customers.getMany(
          [...new Set(orders.map((order) => order.customerId))],
          executor,
        )
      ).map((customer) => [customer.id, customer]),
    );
    const events = await executor
      .select()
      .from(orderStatusEvents)
      .where(idIn(orderStatusEvents.orderId, ids))
      .orderBy(asc(orderStatusEvents.id));
    const moves = await executor
      .select()
      .from(salesStageMoves)
      .where(idIn(salesStageMoves.orderId, ids))
      .orderBy(asc(salesStageMoves.id));
    const pickBins = new Map(
      (
        await this.bins.getMany(
          [...new Set(lines.flatMap((line) => (line.pickBinId === null ? [] : [line.pickBinId])))],
          executor,
        )
      ).map((bin) => [bin.id, bin.code]),
    );
    const boardIds = [
      ...new Set(
        orders.flatMap((order) => {
          const boardId =
            order.pipelineId === null ? undefined : access.pipeline(order.pipelineId)?.boardId;
          return boardId === undefined ? [] : [boardId];
        }),
      ),
    ];
    const boards = new Map(
      boardIds.length === 0
        ? []
        : (
            await executor
              .select({ id: salesBoards.id, name: salesBoards.name })
              .from(salesBoards)
              .where(idIn(salesBoards.id, boardIds))
          ).map((board) => [board.id, board.name]),
    );
    const stageIds = [
      ...new Set(
        moves.flatMap((move) =>
          move.fromStageId === null ? [move.toStageId] : [move.fromStageId, move.toStageId],
        ),
      ),
    ];
    const stageNames = new Map(
      stageIds.length === 0
        ? []
        : (
            await executor
              .select({ id: salesStages.id, name: salesStages.name })
              .from(salesStages)
              .where(idIn(salesStages.id, stageIds))
          ).map((stage) => [stage.id, stage.name]),
    );
    const names = await this.names.namesOf([
      ...orders.flatMap((order) => (order.createdBy === null ? [] : [order.createdBy])),
      ...events.flatMap((event) => (event.actorId === null ? [] : [event.actorId])),
      ...moves.flatMap((move) => (move.actorId === null ? [] : [move.actorId])),
    ]);
    const nameOf = (id: number | null) => (id === null ? null : (names.get(id) ?? null));
    const overdue = await this.customers.overdueOf(orders.map((order) => order.customerId));
    return orders.map((order) => {
      const {
        createdBy,
        submittedBy: _submitted,
        cancelledBy: _cancelled,
        pickedBy: _picked,
        deliveredBy: _delivered,
        archivedBy: _archived,
        ...rest
      } = order;
      const pipeline = order.pipelineId === null ? undefined : access.pipeline(order.pipelineId);
      const customer = customers.get(order.customerId);
      return {
        ...rest,
        customerCode: customer?.code ?? '',
        customerName: customer?.name ?? '',
        customerOverdue: overdue.get(order.customerId) ?? null,
        boardId: pipeline?.boardId ?? null,
        boardName: pipeline ? (boards.get(pipeline.boardId) ?? null) : null,
        pipelineName: pipeline?.name ?? null,
        stageName:
          order.stageId === null ? null : (access.stage(order.stageId)?.stage.name ?? null),
        createdByName: nameOf(createdBy),
        canEdit: access.canEdit(order),
        lines: lines
          .filter((line) => line.orderId === order.id)
          .map((line) => lineView(line, products, units, parts, pickBins)),
        moves: moves
          .filter((move) => move.orderId === order.id)
          .map((move) => ({
            fromStageId: move.fromStageId,
            toStageId: move.toStageId,
            fromStageName:
              move.fromStageId === null ? null : (stageNames.get(move.fromStageId) ?? null),
            toStageName: stageNames.get(move.toStageId) ?? null,
            actorId: move.actorId,
            actorName: nameOf(move.actorId),
            createdAt: move.createdAt,
          })),
        events: events
          .filter((event) => event.orderId === order.id)
          .map((event) => ({
            fromStatus: event.fromStatus,
            toStatus: event.toStatus,
            reason: event.reason,
            actorId: event.actorId,
            actorName: nameOf(event.actorId),
            createdAt: event.createdAt,
          })),
      };
    });
  }
}

function lineView(
  line: LineRow,
  products: ReadonlyMap<number, ProductSummary>,
  units: ReadonlyMap<number, { uomName: string }>,
  parts: readonly (typeof salesOrderLineParts.$inferSelect)[],
  pickBins: ReadonlyMap<number, string>,
): OrderLine {
  const product = products.get(line.productId);
  return {
    id: line.id,
    lineNo: line.lineNo,
    productId: line.productId,
    productSku: product?.sku ?? '',
    productName: product?.name ?? '',
    productUnitId: line.productUnitId,
    unitName: units.get(line.productUnitId)?.uomName ?? '',
    qty: line.qty,
    factorSnapshot: line.factorSnapshot,
    qtyBase: line.qtyBase,
    baseUnitName: product?.baseUnit.uomName ?? '',
    warehouseId: line.warehouseId,
    qtyApproved: line.qtyApproved,
    qtyBackordered: line.qtyBackordered,
    qtyPicked: line.qtyPicked,
    pickBinId: line.pickBinId,
    pickBinCode: line.pickBinId === null ? null : (pickBins.get(line.pickBinId) ?? null),
    qtyDelivered: line.qtyDelivered,
    subtotal: line.subtotal,
    discountAmount: line.discountAmount,
    total: line.total,
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
        subtotal: part.subtotal,
        discountAmount: part.discountAmount,
        total: part.total,
        applied: part.applied,
      })),
  };
}
