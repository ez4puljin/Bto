import { Inject, Injectable } from '@nestjs/common';
import type { TransferStatus } from '@tugeel/shared/inventory';
import { Decimal } from '@tugeel/shared/money';
import { addDays, addMonths, businessDate, businessMonthStart } from '@tugeel/shared/time';
import { and, desc, eq, inArray, isNull, lt, type SQL, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import {
  DEFAULT_PAGE_LIMIT,
  decodeCursor,
  encodeCursor,
  toPage,
} from '../../../common/pagination/page';
import { CatalogService, ProductQueryService, UnitConversionService } from '../../catalog';
import {
  actorUserId,
  type AuthContext,
  AuditService,
  OrgService,
  ScopeService,
} from '../../identity';
import { transferLines, transferRequests, transfers } from '../schema';
import { ProductLocationsService } from './product-locations.service';
import { StockQueryService } from './stock-query.service';
import {
  MAX_TRANSFER_LINES,
  type TransferDetail,
  TransfersService,
  type TransferSummary,
} from './transfers.service';
import { optionalText } from './support';

type TransferRow = typeof transfers.$inferSelect;
type TransferLineRow = typeof transferLines.$inferSelect;

/** Most products a request's grid walks per search; the page size. */
const GRID_CAP = 5_000;
const GRID_PAGE = 200;
/** Cells per save (the PO grid's rule). */
const MAX_CHANGES = 500;
const TRANSFERS = 'inventory.transfers.manage';

export interface RequestRowsQuery {
  /** The store the request is for. */
  warehouseId: number;
  q?: string;
  /** Show the request's own lines in `line`. */
  requestId?: number;
  /** REQUESTED: only products on the request. */
  filter?: 'ALL' | 'REQUESTED';
  cursor?: string;
  limit?: number;
}

export interface RequestRowUnit {
  id: number;
  name: string;
  uomCode: string | null;
  factor: Decimal;
  isBase: boolean;
}

/** One product the store may ask for, with what Bto knows beside it (ADR-0116 #3). */
export interface RequestRow {
  productId: number;
  sku: string;
  name: string;
  thumbUrl: string | null;
  units: RequestRowUnit[];
  homeWarehouseId: number | null;
  homeWarehouseName: string | null;
  /** On hand in the home warehouse and at the store, base units. */
  homeOnHand: Decimal;
  storeOnHand: Decimal;
  /** Last calendar month's outflow at the store: the till's sales less its returns. */
  lastMonthOut: Decimal;
  line: { transferId: number; lineId: number; productUnitId: number; qty: Decimal } | null;
}

export interface RequestRowsPage {
  data: RequestRow[];
  nextCursor: string | null;
  total: number;
  outflowFrom: string;
  outflowTo: string;
}

export interface TransferRequestLineInput {
  productId: number;
  productUnitId: number;
  qty: Decimal;
}

export interface TransferRequestInput {
  destWarehouseId: number;
  note?: string | null;
  lines: readonly TransferRequestLineInput[];
}

/** A cell as the page sends it: the value now and the value it had when the page opened. */
export interface RequestChange {
  productId: number;
  productUnitId: number | null;
  qty: Decimal | null;
  previous: { productUnitId: number; qty: Decimal } | null;
}

export interface RequestSaveResult {
  applied: number;
  conflicts: { productId: number; productUnitId: number | null; qty: Decimal | null }[];
  refused: { productId: number; reason: 'NO_HOME' }[];
}

export interface TransferRequestGroup extends TransferDetail {
  sourceWarehouseName: string;
}

export interface TransferRequestDetail {
  id: number;
  destWarehouseId: number;
  destWarehouseName: string;
  status: TransferStatus;
  note: string | null;
  requestedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  groups: TransferRequestGroup[];
}

export interface TransferRequestSummary {
  id: number;
  destWarehouseId: number;
  status: TransferStatus;
  note: string | null;
  requestedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  groupCount: number;
  lineCount: number;
  /** The groups' numbers, by group (a draft never sent has none). */
  numbers: string[];
}

export interface TransferRequestQuery {
  warehouseId?: number;
  status?: TransferStatus;
  cursor?: string;
  limit?: number;
}

export interface TransferRequestContext {
  /** The STORE warehouses the caller may request for (every one for an unscoped caller). */
  storeWarehouses: { id: number; name: string }[];
  /** The server's business date; the phone never computes it. */
  today: string;
}

/**
 * Transfer requests (ADR-0116): what a store asked for at once, grouped by the products' home
 * warehouses into one transfer per source. The header is created, filled and sent by the store
 * (the destination); each group is then shipped, counted and confirmed on its own
 * (`TransfersService`). Every request-level change locks the header first, then its groups in id
 * order (ADR-0116 #7).
 */
@Injectable()
export class TransferRequestsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly catalog: CatalogService,
    private readonly locations: ProductLocationsService,
    private readonly org: OrgService,
    private readonly productQuery: ProductQueryService,
    private readonly scope: ScopeService,
    private readonly stock: StockQueryService,
    private readonly transfers: TransfersService,
    private readonly units: UnitConversionService,
  ) {}

  /** The stores the caller may request for, and today's business date (ADR-0116 #8). */
  async context(ctx: AuthContext): Promise<TransferRequestContext> {
    const stores = ctx.permissions.has(TRANSFERS)
      ? (await this.org.listWarehouses({ kind: 'STORE' })).filter(
          (warehouse) =>
            warehouse.status === 'ACTIVE' && this.scope.canWriteWarehouse(ctx, warehouse.id),
        )
      : [];
    return {
      storeWarehouses: stores.map((warehouse) => ({ id: warehouse.id, name: warehouse.name })),
      today: businessDate(),
    };
  }

  /**
   * The products a store may ask for, searched like the product list (at most GRID_CAP, offset
   * pages of GRID_PAGE): each with its home warehouse, the stock there and at the store, last
   * month's till sales at the store, its current units and the request's line when one is shown.
   */
  async rows(ctx: AuthContext, query: RequestRowsQuery): Promise<RequestRowsPage> {
    const store = await this.org.getWarehouse(query.warehouseId);
    this.assertStore(store);
    this.scope.assertCanWriteWarehouse(ctx, store.id);
    const lineOf =
      query.requestId === undefined
        ? new Map<number, TransferLineRow>()
        : await this.linesOf(query.requestId);
    const { ids: ordered, total } = await this.productQuery.orderedIds(
      {
        ...(query.q?.trim() ? { q: query.q.trim() } : {}),
        status: 'ACTIVE',
        ...(query.filter === 'REQUESTED' ? { onlyIds: [...lineOf.keys()] } : {}),
      },
      GRID_CAP,
    );
    const ids = query.filter === 'REQUESTED' ? ordered.filter((id) => lineOf.has(id)) : ordered;
    const limit = Math.min(query.limit ?? GRID_PAGE, GRID_PAGE);
    const after = decodeCursor(query.cursor);
    const offset = typeof after?.offset === 'number' ? after.offset : 0;
    const pageIds = ids.slice(offset, offset + limit);
    const outflowFrom = addMonths(businessMonthStart(), -1);
    const outflowTo = addDays(businessMonthStart(), -1);
    return {
      data: await this.describe(pageIds, store.id, lineOf, outflowFrom, outflowTo),
      nextCursor: offset + limit < ids.length ? encodeCursor({ offset: offset + limit }) : null,
      total: query.filter === 'REQUESTED' ? ids.length : total,
      outflowFrom,
      outflowTo,
    };
  }

  /**
   * A draft request with its lines grouped by home warehouse (ADR-0116 #1): one group per home,
   * by the store (destination scope). A product without a home is refused.
   */
  create(ctx: AuthContext, input: TransferRequestInput): Promise<TransferRequestDetail> {
    if (input.lines.length === 0) {
      throw new AppError('TRANSFER_REQUEST_EMPTY', 'a request needs at least one line');
    }
    if (input.lines.length > MAX_TRANSFER_LINES) {
      throw invalid('lines', 'max', `at most ${MAX_TRANSFER_LINES} lines`);
    }
    if (new Set(input.lines.map((line) => line.productId)).size !== input.lines.length) {
      throw invalid('lines', 'unique', 'one line per product');
    }
    return inTransaction(this.db, async (tx) => {
      const store = await this.org.getWarehouse(input.destWarehouseId, tx);
      this.assertStore(store);
      this.scope.assertCanWriteWarehouse(ctx, store.id);
      const byHome = await this.groupByHome(tx, input.lines);
      const [header] = await tx
        .insert(transferRequests)
        .values({
          destWarehouseId: store.id,
          note: optionalText(input.note) ?? null,
          createdBy: actorUserId(ctx),
        })
        .returning();
      if (!header) throw new Error('transfer request insert returned no row');
      await this.audit.record(tx, ctx, {
        action: 'CREATE',
        entity: 'transfer_requests',
        entityId: header.id,
        after: header,
      });
      for (const [homeId, lines] of byHome) {
        await this.transfers.createInTx(tx, ctx, {
          origin: 'REQUEST',
          requestId: header.id,
          sourceWarehouseId: homeId,
          destWarehouseId: store.id,
          lines: lines.map((line) => ({ productUnitId: line.productUnitId, qty: line.qty })),
        });
      }
      return this.get(header.id, tx);
    });
  }

  /**
   * Writes only the changed cells of a draft request, each against the value the page opened with
   * (slice 1's rule): a cell someone else changed meanwhile is skipped and returned. A product new
   * to the request joins the group of its home, created when needed; a zero removes the line, and
   * a group left empty is cancelled (never deleted, ADR-0035).
   */
  saveLines(
    ctx: AuthContext,
    id: number,
    changes: readonly RequestChange[],
  ): Promise<RequestSaveResult> {
    if (changes.length > MAX_CHANGES) {
      throw invalid('changes', 'max', `at most ${MAX_CHANGES} cells per save`);
    }
    if (new Set(changes.map((change) => change.productId)).size !== changes.length) {
      throw invalid('changes', 'unique', 'one change per product');
    }
    return inTransaction(this.db, async (tx) => {
      const header = await this.transfers.lockRequest(tx, id);
      this.scope.assertCanWriteWarehouse(ctx, header.destWarehouseId);
      if (header.status !== 'DRAFT') {
        throw new AppError('DOC_STATE_INVALID', `request ${id} is ${header.status}`, {
          status: header.status,
        });
      }
      const groups = await this.groupsOf(tx, id, true);
      const draftByHome = new Map(
        groups
          .filter((group) => group.status === 'DRAFT')
          .map((group) => [group.sourceWarehouseId, group]),
      );
      const current = await this.linesOf(
        id,
        tx,
        groups.map((group) => group.id),
      );
      const productIds = changes.map((change) => change.productId);
      const homes = await this.locations.homeOf(productIds, tx);
      const result: RequestSaveResult = { applied: 0, conflicts: [], refused: [] };
      const applied: { productId: number; before: unknown; after: unknown }[] = [];
      for (const change of changes) {
        const line = current.get(change.productId);
        const homeId = homes.get(change.productId);
        if (homeId === undefined) {
          result.refused.push({ productId: change.productId, reason: 'NO_HOME' });
          continue;
        }
        if (!sameCell(line, change.previous)) {
          result.conflicts.push({
            productId: change.productId,
            productUnitId: line?.requestUnitId ?? null,
            qty: line?.requestedQty ?? null,
          });
          continue;
        }
        const qty = change.qty;
        if (qty === null || qty.isZero()) {
          if (line) {
            await tx.delete(transferLines).where(eq(transferLines.id, line.id));
            await this.touchGroup(tx, line.transferId);
            applied.push({ productId: change.productId, before: line, after: null });
            result.applied += 1;
          }
          continue;
        }
        if (change.productUnitId === null) {
          throw invalid('changes', 'unit', 'a quantity needs its unit');
        }
        const converted = await this.units.toBase(change.productUnitId, qty, tx);
        if (converted.productId !== change.productId) {
          throw invalid('changes', 'unit', 'the unit belongs to another product');
        }
        if (line) {
          await tx
            .update(transferLines)
            .set({
              requestUnitId: converted.unitId,
              requestFactor: converted.factorSnapshot,
              requestedQty: qty,
              updatedAt: sql`now()`,
            })
            .where(eq(transferLines.id, line.id));
          await this.touchGroup(tx, line.transferId);
        } else {
          let group = draftByHome.get(homeId);
          if (!group) {
            const made = await this.transfers.createInTx(tx, ctx, {
              origin: 'REQUEST',
              requestId: id,
              sourceWarehouseId: homeId,
              destWarehouseId: header.destWarehouseId,
              lines: [{ productUnitId: converted.unitId, qty }],
            });
            const [row] = await tx.select().from(transfers).where(eq(transfers.id, made.id));
            if (!row) throw new Error('transfer group vanished');
            group = row;
            draftByHome.set(homeId, group);
          } else {
            await this.transfers.addLineInTx(tx, group, { productUnitId: converted.unitId, qty });
            await this.touchGroup(tx, group.id);
          }
        }
        applied.push({
          productId: change.productId,
          before: line ?? null,
          after: { productUnitId: converted.unitId, qty: qty.toFixed() },
        });
        result.applied += 1;
      }
      // A draft group left without lines is cancelled; a reopened one keeps its number (ADR-0046).
      for (const group of draftByHome.values()) {
        const [left] = await tx
          .select({ count: sql<string>`count(*)` })
          .from(transferLines)
          .where(eq(transferLines.transferId, group.id));
        if (Number.parseInt(left?.count ?? '0', 10) === 0) {
          await this.transfers.cancelInTx(tx, ctx, group.id);
        }
      }
      if (applied.length > 0) {
        await this.audit.record(tx, ctx, {
          action: 'UPDATE',
          entity: 'transfer_requests',
          entityId: id,
          after: { lines: applied },
        });
        // The header stays a draft even with every group cancelled: it can be filled again.
        await tx
          .update(transferRequests)
          .set({ status: 'DRAFT', updatedAt: sql`now()` })
          .where(eq(transferRequests.id, id));
      }
      return result;
    });
  }

  /** The note of a draft. */
  update(
    ctx: AuthContext,
    id: number,
    patch: { note?: string | null },
  ): Promise<TransferRequestDetail> {
    return inTransaction(this.db, async (tx) => {
      const header = await this.transfers.lockRequest(tx, id);
      this.scope.assertCanWriteWarehouse(ctx, header.destWarehouseId);
      if (header.status !== 'DRAFT') {
        throw new AppError('DOC_STATE_INVALID', `request ${id} is ${header.status}`, {
          status: header.status,
        });
      }
      const note = patch.note === undefined ? header.note : (optionalText(patch.note) ?? null);
      await tx
        .update(transferRequests)
        .set({ note, updatedAt: sql`now()` })
        .where(eq(transferRequests.id, id));
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'transfer_requests',
        entityId: id,
        before: header,
        after: { note },
      });
      return this.get(id, tx);
    });
  }

  /**
   * DRAFT → REQUESTED: every draft group with lines is sent and numbered, in id order; an empty
   * draft group is cancelled (ADR-0116 #2). Sent again on a sent request, it answers as it is.
   */
  request(ctx: AuthContext, id: number): Promise<TransferRequestDetail> {
    return inTransaction(this.db, async (tx) => {
      const header = await this.transfers.lockRequest(tx, id);
      this.scope.assertCanWriteWarehouse(ctx, header.destWarehouseId);
      if (header.status !== 'DRAFT') {
        if (header.status === 'REQUESTED') return this.get(id, tx);
        throw new AppError('DOC_STATE_INVALID', `request ${id} is ${header.status}`, {
          status: header.status,
        });
      }
      let sent = 0;
      for (const group of await this.groupsOf(tx, id, false)) {
        if (group.status !== 'DRAFT') continue;
        const [left] = await tx
          .select({ count: sql<string>`count(*)` })
          .from(transferLines)
          .where(eq(transferLines.transferId, group.id));
        if (Number.parseInt(left?.count ?? '0', 10) === 0) {
          await this.transfers.cancelInTx(tx, ctx, group.id);
          continue;
        }
        await this.transfers.requestInTx(tx, ctx, group.id);
        sent += 1;
      }
      if (sent === 0) {
        throw new AppError('TRANSFER_REQUEST_EMPTY', `request ${id} has nothing to send`);
      }
      await tx
        .update(transferRequests)
        .set({ requestedAt: sql`now()`, requestedBy: actorUserId(ctx), updatedAt: sql`now()` })
        .where(eq(transferRequests.id, id));
      await this.transfers.refreshRequestStatus(tx, id);
      await this.audit.record(tx, ctx, {
        action: 'REQUEST',
        entity: 'transfer_requests',
        entityId: id,
        before: header,
        after: { groups: sent },
      });
      return this.get(id, tx);
    });
  }

  /**
   * Every REQUESTED group back to DRAFT for editing, under its number (ADR-0046, ADR-0116 #10);
   * a group already shipped stays where it is. With no group to take back the request is refused,
   * unless it is a draft already.
   */
  reopen(ctx: AuthContext, id: number): Promise<TransferRequestDetail> {
    return inTransaction(this.db, async (tx) => {
      const header = await this.transfers.lockRequest(tx, id);
      this.scope.assertCanWriteWarehouse(ctx, header.destWarehouseId);
      const groups = await this.groupsOf(tx, id, false);
      const requested = groups.filter((group) => group.status === 'REQUESTED');
      if (requested.length === 0) {
        if (header.status === 'DRAFT') return this.get(id, tx);
        throw new AppError('DOC_STATE_INVALID', `request ${id} is ${header.status}`, {
          status: header.status,
        });
      }
      for (const group of requested) await this.transfers.reopenInTx(tx, ctx, group.id);
      await tx
        .update(transferRequests)
        .set({ requestedAt: null, requestedBy: null, updatedAt: sql`now()` })
        .where(eq(transferRequests.id, id));
      await this.transfers.refreshRequestStatus(tx, id);
      await this.audit.record(tx, ctx, {
        action: 'RETURN',
        entity: 'transfer_requests',
        entityId: id,
        before: header,
        after: { groups: requested.map((group) => group.id) },
      });
      return this.get(id, tx);
    });
  }

  /** The store withdraws the whole request while nothing is shipped; each group is cancelled. */
  cancel(ctx: AuthContext, id: number, reason?: string | null): Promise<TransferRequestDetail> {
    return inTransaction(this.db, async (tx) => {
      const header = await this.transfers.lockRequest(tx, id);
      this.scope.assertCanWriteWarehouse(ctx, header.destWarehouseId);
      if (header.status === 'CANCELLED') return this.get(id, tx);
      const groups = await this.groupsOf(tx, id, false);
      const moving = groups.find(
        (group) =>
          group.status !== 'DRAFT' && group.status !== 'REQUESTED' && group.status !== 'CANCELLED',
      );
      if (moving) {
        throw new AppError('DOC_STATE_INVALID', `group ${moving.id} is ${moving.status}`, {
          status: moving.status,
        });
      }
      for (const group of groups) {
        if (group.status !== 'CANCELLED')
          await this.transfers.cancelInTx(tx, ctx, group.id, reason);
      }
      await this.transfers.refreshRequestStatus(tx, id);
      await this.touch(tx, id);
      await this.audit.record(tx, ctx, {
        action: 'CANCEL',
        entity: 'transfer_requests',
        entityId: id,
        before: header,
        after: { reason: optionalText(reason) ?? null },
      });
      return this.get(id, tx);
    });
  }

  async get(id: number, executor: Db | Tx = this.db): Promise<TransferRequestDetail> {
    const [header] = await executor
      .select()
      .from(transferRequests)
      .where(eq(transferRequests.id, id));
    if (!header) throw notFound('transfer request', id);
    const groups: TransferRequestGroup[] = [];
    for (const group of await this.groupsOf(executor, id, false)) {
      const detail = await this.transfers.get(group.id, executor);
      const source = await this.org.getWarehouse(group.sourceWarehouseId, executor);
      groups.push({ ...detail, sourceWarehouseName: source.name });
    }
    const dest = await this.org.getWarehouse(header.destWarehouseId, executor);
    return {
      id: header.id,
      destWarehouseId: header.destWarehouseId,
      destWarehouseName: dest.name,
      status: header.status,
      note: header.note,
      requestedAt: header.requestedAt,
      createdAt: header.createdAt,
      updatedAt: header.updatedAt,
      groups,
    };
  }

  /** The requests of a store, newest first; without a store, those of the caller's warehouses. */
  async list(
    ctx: AuthContext,
    query: TransferRequestQuery,
  ): Promise<{ data: TransferRequestSummary[]; nextCursor: string | null }> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const filters: SQL[] = [];
    if (query.warehouseId !== undefined) {
      filters.push(eq(transferRequests.destWarehouseId, query.warehouseId));
    } else if (ctx.writableWarehouseIds !== null) {
      const mine = [...ctx.writableWarehouseIds];
      filters.push(mine.length > 0 ? inArray(transferRequests.destWarehouseId, mine) : sql`false`);
    }
    if (query.status) filters.push(eq(transferRequests.status, query.status));
    const after = decodeCursor(query.cursor);
    if (typeof after?.id === 'number') filters.push(lt(transferRequests.id, after.id));
    const rows = await this.db
      .select({
        id: transferRequests.id,
        destWarehouseId: transferRequests.destWarehouseId,
        status: transferRequests.status,
        note: transferRequests.note,
        requestedAt: transferRequests.requestedAt,
        createdAt: transferRequests.createdAt,
        updatedAt: transferRequests.updatedAt,
        // Spelled out: a single-table select leaves columns unqualified (see ReceiptsService.list).
        groupCount: sql<string>`(SELECT count(*) FROM transfers t WHERE t.request_id = transfer_requests.id AND t.status <> 'CANCELLED')`,
        lineCount: sql<string>`(SELECT count(*) FROM transfer_lines l JOIN transfers t ON t.id = l.transfer_id WHERE t.request_id = transfer_requests.id AND t.status <> 'CANCELLED')`,
        numbers: sql<
          string[]
        >`(SELECT coalesce(array_agg(t.number ORDER BY t.id), '{}') FROM transfers t WHERE t.request_id = transfer_requests.id AND t.number IS NOT NULL AND t.status <> 'CANCELLED')`,
      })
      .from(transferRequests)
      .where(and(...filters))
      .orderBy(desc(transferRequests.id))
      .limit(limit + 1);
    const page = toPage(rows, limit, (row) => ({ id: row.id }));
    return {
      data: page.data.map((row) => ({
        ...row,
        groupCount: Number.parseInt(row.groupCount, 10),
        lineCount: Number.parseInt(row.lineCount, 10),
        numbers: row.numbers ?? [],
      })),
      nextCursor: page.nextCursor,
    };
  }

  /** The request's groups as the transfer list shows them (the web's sibling links). */
  async groupSummaries(ctx: AuthContext, id: number): Promise<TransferSummary[]> {
    return (await this.transfers.list(ctx, { requestId: id, limit: 100 })).data;
  }

  // -------------------------------------------------------------------------------------------

  private assertStore(warehouse: { kind: string; id: number }): void {
    if (warehouse.kind !== 'STORE') {
      throw new AppError(
        'WAREHOUSE_KIND_NOT_ALLOWED',
        `a request from the app is for a STORE warehouse, not ${warehouse.kind}`,
        { kind: warehouse.kind },
      );
    }
  }

  /** The request's groups in id order; cancelled ones only when asked. */
  private async groupsOf(
    executor: Db | Tx,
    requestId: number,
    withCancelled: boolean,
  ): Promise<TransferRow[]> {
    const rows = await executor
      .select()
      .from(transfers)
      .where(eq(transfers.requestId, requestId))
      .orderBy(transfers.id);
    return withCancelled ? rows : rows.filter((row) => row.status !== 'CANCELLED');
  }

  /** The request's lines by product, over its live groups (or the given ones). */
  private async linesOf(
    requestId: number,
    executor: Db | Tx = this.db,
    groupIds?: readonly number[],
  ): Promise<Map<number, TransferLineRow>> {
    const ids =
      groupIds ?? (await this.groupsOf(executor, requestId, false)).map((group) => group.id);
    if (ids.length === 0) return new Map();
    const rows = await executor
      .select()
      .from(transferLines)
      .where(and(inArray(transferLines.transferId, ids), isNull(transferLines.lotId)));
    return new Map(rows.map((row) => [row.productId, row]));
  }

  private async groupByHome(
    tx: Tx,
    lines: readonly TransferRequestLineInput[],
  ): Promise<Map<number, TransferRequestLineInput[]>> {
    const homes = await this.locations.homeOf(
      lines.map((line) => line.productId),
      tx,
    );
    const byHome = new Map<number, TransferRequestLineInput[]>();
    for (const line of lines) {
      const homeId = homes.get(line.productId);
      if (homeId === undefined) {
        throw new AppError('PRODUCT_NO_HOME', `product ${line.productId} has no home warehouse`, {
          productId: line.productId,
        });
      }
      byHome.set(homeId, [...(byHome.get(homeId) ?? []), line]);
    }
    return byHome;
  }

  private async describe(
    productIds: readonly number[],
    storeId: number,
    lineOf: Map<number, TransferLineRow>,
    outflowFrom: string,
    outflowTo: string,
  ): Promise<RequestRow[]> {
    if (productIds.length === 0) return [];
    const products = new Map(
      (await this.catalog.getMany(productIds)).map((product) => [product.id, product]),
    );
    const units = await this.units.currentUnits(productIds);
    const homes = await this.locations.homeOf(productIds);
    const balances = await this.stock.balancesOf(productIds);
    const outflow = await this.stock.outflowOf(productIds, outflowFrom, outflowTo);
    const names = new Map<number, string>();
    for (const id of new Set(homes.values())) names.set(id, (await this.org.getWarehouse(id)).name);
    const zero = new Decimal(0);
    return productIds.flatMap((productId) => {
      const product = products.get(productId);
      if (!product) return [];
      const home = homes.get(productId);
      const line = lineOf.get(productId);
      const onHandAt = (warehouseId: number | undefined) =>
        warehouseId === undefined
          ? zero
          : ((balances.get(productId) ?? []).find((row) => row.warehouseId === warehouseId)
              ?.onHand ?? zero);
      return [
        {
          productId,
          sku: product.sku,
          name: product.name,
          thumbUrl: product.thumbUrl,
          units: (units.get(productId) ?? []).map((unit) => ({
            id: unit.unitId,
            name: unit.uomName,
            uomCode: unit.uomCode,
            factor: unit.factorToBase,
            isBase: unit.isBase,
          })),
          homeWarehouseId: home ?? null,
          homeWarehouseName: home === undefined ? null : (names.get(home) ?? null),
          homeOnHand: onHandAt(home),
          storeOnHand: onHandAt(storeId),
          lastMonthOut: outflow.get(productId)?.get(storeId) ?? zero,
          line: line
            ? {
                transferId: line.transferId,
                lineId: line.id,
                productUnitId: line.requestUnitId,
                qty: line.requestedQty,
              }
            : null,
        },
      ];
    });
  }

  private async touch(tx: Tx, id: number): Promise<void> {
    await tx
      .update(transferRequests)
      .set({ updatedAt: sql`now()` })
      .where(eq(transferRequests.id, id));
  }

  private async touchGroup(tx: Tx, id: number): Promise<void> {
    await tx
      .update(transfers)
      .set({ updatedAt: sql`now()` })
      .where(eq(transfers.id, id));
  }
}

/** The cell as stored equals the value the page opened with (both empty counts as equal). */
function sameCell(
  line: { requestUnitId: number; requestedQty: Decimal } | undefined,
  previous: { productUnitId: number; qty: Decimal } | null,
): boolean {
  if (!line || !previous) return !line && !previous;
  return line.requestUnitId === previous.productUnitId && line.requestedQty.equals(previous.qty);
}
