import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { SELLABLE_BIN_TYPES } from '@tugeel/shared/inventory';
import { Decimal, toWholeMnt } from '@tugeel/shared/money';
import { businessDate } from '@tugeel/shared/time';
import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  type SQL,
  sql,
} from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { DEFAULT_PAGE_LIMIT, decodeCursor, toPage } from '../../../common/pagination/page';
import {
  CatalogService,
  PRODUCT_SET_RESOLVER,
  ProductQueryService,
  type ProductSetResolver,
  UnitConversionService,
} from '../../catalog';
import {
  actorUserId,
  type AuthContext,
  AuditService,
  OrgService,
  ScopeService,
  UserNamesService,
} from '../../identity';
import { CustomersService, ProductSuppliersService, SuppliersService } from '../../partners';
import {
  SALE_PRICE_READER,
  type SalePriceReader,
  STOCK_BOOKS,
  STOCK_COUNT_ACCOUNTS,
  type StockBookParty,
  type StockBooks,
  type StockCountAccount,
  type StockCountAccounts,
} from '../hooks';
import {
  binStock,
  bins,
  COUNT_PARTY_KINDS,
  COUNT_SCOPE_MODES,
  COUNT_UNCOUNTED_MODES,
  productLocations,
  stockCountEntries,
  stockCountLines,
  stockCountSessions,
  stocktakeLines,
  stocktakes,
  warehouseStock,
} from '../schema';
import { BinsService } from './bins.service';
import { ProductLocationsService } from './product-locations.service';
import {
  type CountMovedDocument,
  MAX_MOVEMENTS_PER_POST,
  type Movement,
  StockPostingService,
} from './stock-posting.service';
import { StockQueryService } from './stock-query.service';
import { optionalText } from './support';

type HeaderRow = typeof stocktakes.$inferSelect;
type LineRow = typeof stockCountLines.$inferSelect;

export type CountScopeMode = (typeof COUNT_SCOPE_MODES)[number];
export type CountUncountedMode = (typeof COUNT_UNCOUNTED_MODES)[number];
export type CountPartyKind = (typeof COUNT_PARTY_KINDS)[number];
export type CountLineFilter =
  'ALL' | 'COUNTED' | 'UNCOUNTED' | 'DIFFERENT' | 'MATCHED' | 'UNLISTED' | 'MOVED';

const MANAGE = 'inventory.stocktakes.manage';
const APPROVE = 'inventory.stocktakes.approve';
const COSTS = 'inventory.costs.manage';
/** Warehouses with shelves, as a shelf count (ADR-0038). */
const COUNTED_KINDS = ['WHOLESALE', 'STORE'];
const MAX_SCOPE_IDS = 50;
const MAX_SEARCH_IDS = 500;
/** The most rows the count sheet answers at once (ADR-0177). */
const MAX_SHEET_ROWS = 10_000;
const MAX_REASON = 500;
const CHUNK = 1000;
const ZERO = new Decimal(0);

const chunksOf = <T>(items: readonly T[], size = CHUNK): T[][] => {
  const parts: T[][] = [];
  for (let at = 0; at < items.length; at += size) parts.push(items.slice(at, at + size));
  return parts;
};

export interface CountPartyInput {
  kind: CountPartyKind;
  id?: number | null;
  name?: string | null;
}

/** Where a part of a count's difference goes (ADR-0176 #7). */
export interface CountSettlementInput {
  accountCode?: string | null;
  party?: CountPartyInput | null;
  /** A shortage its party pays for, at the selling price (ADR-0176 #8). */
  charged?: boolean;
}

export interface CountSettlement {
  accountCode: string | null;
  party: StockBookParty | null;
  charged: boolean;
}

export interface StockCountInput {
  warehouseId: number;
  note?: string | null;
  scopeMode: CountScopeMode;
  /** One segment, or the suppliers or categories of the mode. */
  scopeIds?: readonly number[];
  /** What the chosen segment, suppliers or categories are called, for the lists. */
  scopeLabel?: string | null;
  /** Counters see the stock and are told when their count differs. */
  showStock?: boolean;
}

export interface StockCountSession {
  id: number;
  userId: number;
  name: string;
  startedAt: Date;
  sentAt: Date | null;
  sentByName: string | null;
  entries: number;
  products: number;
}

export interface StockCountSummary {
  id: number;
  warehouseId: number;
  warehouseName: string;
  status: HeaderRow['status'];
  number: string | null;
  note: string | null;
  scopeMode: CountScopeMode;
  scopeLabel: string | null;
  showStock: boolean;
  startedAt: Date | null;
  postedAt: Date | null;
  effectiveDate: string | null;
  lines: number;
  counted: number;
}

export interface StockCountDetail extends StockCountSummary {
  scopeIds: number[];
  uncounted: CountUncountedMode | null;
  startedByName: string | null;
  surplus: CountSettlement;
  shortage: CountSettlement;
  different: number;
  uncountedLines: number;
  sessions: StockCountSession[];
}

export interface StockCountCounter {
  userId: number;
  name: string;
  /** Sent to the count window. */
  qty: Decimal;
  /** Counted but not sent yet. */
  pendingQty: Decimal;
}

export interface StockCountLine {
  id: number;
  productId: number;
  sku: string;
  name: string;
  unitName: string;
  listed: boolean;
  expectedQty: Decimal | null;
  countedQty: Decimal | null;
  pendingQty: Decimal;
  /** Counted less expected; after the approval, what was posted. */
  differenceQty: Decimal | null;
  firstCountedAt: Date | null;
  counters: StockCountCounter[];
  /** What other documents moved after the first count: until the approval and after it. */
  movedDuring: Decimal;
  movedAfter: Decimal;
  settleOwn: boolean;
  settlement: CountSettlement;
  unitCost: Decimal | null;
  chargeAmount: Decimal | null;
  reason: string | null;
}

export interface StockCountLineQuery {
  filter?: CountLineFilter;
  q?: string;
  cursor?: string;
  limit?: number;
}

export interface CountSheetQuery {
  filter?: CountLineFilter;
  q?: string;
  supplierId?: number;
  categoryId?: number;
  segmentId?: number;
}

/** One product on the count sheet (ADR-0177): the difference in pieces and at the selling price. */
export interface CountSheetRow {
  lineId: number;
  productId: number;
  sku: string;
  name: string;
  unitName: string;
  listed: boolean;
  supplierId: number | null;
  supplierName: string | null;
  expectedQty: Decimal | null;
  countedQty: Decimal | null;
  pendingQty: Decimal;
  differenceQty: Decimal | null;
  salePrice: Decimal | null;
  differenceAmount: Decimal | null;
  reason: string | null;
  /** The counted quantity was typed in the window (ADR-0181). */
  corrected: boolean;
  movedDuring: Decimal;
  movedAfter: Decimal;
}

/** The whole count, whatever the filter: the sheet's tiles. */
export interface CountSheetTotals {
  lines: number;
  counted: number;
  uncounted: number;
  unlisted: number;
  matched: number;
  different: number;
  surplusLines: number;
  surplusQty: Decimal;
  surplusAmount: Decimal;
  shortageLines: number;
  shortageQty: Decimal;
  shortageAmount: Decimal;
  netQty: Decimal;
  netAmount: Decimal;
  /** Differences whose product has no selling price: left out of the amounts. */
  unpriced: number;
}

export interface CountSheet {
  priceDate: string;
  totals: CountSheetTotals;
  /** The main suppliers of the count's products, by name: the sheet's filter. */
  suppliers: { id: number; name: string }[];
  rows: CountSheetRow[];
  truncated: boolean;
}

export interface StockCountEntry {
  id: number;
  sessionId: number;
  productId: number;
  sku: string;
  name: string;
  userId: number;
  userName: string;
  productUnitId: number;
  unitName: string;
  factor: Decimal;
  enteredQty: Decimal;
  qtyBase: Decimal;
  createdAt: Date;
  voided: boolean;
  sent: boolean;
  correction: boolean;
}

/** A count as a counter's phone lists it. */
export interface OpenStockCount {
  id: number;
  warehouseId: number;
  warehouseName: string;
  note: string | null;
  scopeMode: CountScopeMode;
  scopeLabel: string | null;
  showStock: boolean;
  startedAt: Date | null;
  /** NONE: not started; OPEN: counting, must be sent; SENT: sent at least once. */
  mine: 'NONE' | 'OPEN' | 'SENT';
}

export interface MyStockCount {
  count: OpenStockCount;
  status: HeaderRow['status'];
  session: { id: number; startedAt: Date } | null;
  entries: StockCountEntry[];
}

/** One product as its counter sees it; the stock only when the count shows it. */
export interface StockCountProductInfo {
  productId: number;
  listed: boolean;
  /** This counter's unsent quantity. */
  myQty: Decimal;
  expectedQty: Decimal | null;
  /** Everyone's sent quantity plus this counter's unsent one. */
  countedQty: Decimal | null;
  entryId: number | null;
}

export interface StockCountEntryInput {
  productId: number;
  productUnitId: number;
  qty: Decimal;
}

export interface StockCountQuery {
  status?: HeaderRow['status'];
  warehouseId?: number;
  cursor?: string;
  limit?: number;
}

export interface CountVarianceQuery {
  from: string;
  to: string;
  warehouseId?: number;
  q?: string;
  cursor?: string;
  limit?: number;
}

export interface CountVarianceRow {
  lineId: number;
  stocktakeId: number;
  number: string | null;
  effectiveDate: string | null;
  warehouseId: number;
  warehouseName: string;
  productId: number;
  sku: string;
  name: string;
  unitName: string;
  expectedQty: Decimal | null;
  countedQty: Decimal | null;
  differenceQty: Decimal;
  unitCost: Decimal | null;
  settlement: CountSettlement;
  chargeAmount: Decimal | null;
}

interface HeldRow {
  binId: number;
  lotId: number | null;
  onHand: Decimal;
  sellable: boolean;
  active: boolean;
}

interface Planned {
  line: LineRow;
  delta: Decimal;
  parts: { binId: number; lotId: number | null; expected: Decimal; qty: Decimal }[];
}

const settlementOfColumns = (
  accountCode: string | null,
  kind: CountPartyKind | null,
  id: number | null,
  name: string | null,
  charged: boolean,
): CountSettlement => ({
  accountCode,
  party: kind ? { kind, id, name: name ?? '' } : null,
  charged,
});

const surplusOf = (header: HeaderRow): CountSettlement =>
  settlementOfColumns(
    header.surplusAccountCode,
    header.surplusPartyKind,
    header.surplusPartyId,
    header.surplusPartyName,
    false,
  );

const shortageOf = (header: HeaderRow): CountSettlement =>
  settlementOfColumns(
    header.shortageAccountCode,
    header.shortagePartyKind,
    header.shortagePartyId,
    header.shortagePartyName,
    header.shortageCharged,
  );

const ownOf = (line: LineRow): CountSettlement =>
  settlementOfColumns(line.accountCode, line.partyKind, line.partyId, line.partyName, line.charged);

function assertState(header: HeaderRow, ...statuses: HeaderRow['status'][]): void {
  if (statuses.includes(header.status)) return;
  throw new AppError(
    header.status === 'APPROVED' ? 'DOC_ALREADY_POSTED' : 'DOC_STATE_INVALID',
    `stock count ${header.id} is ${header.status}`,
    { status: header.status },
  );
}

/**
 * Product counts (ADR-0176): a count of a warehouse's products, by many counters on their phones.
 * A count is created straight into COUNTING with its product list; each counter opens a session,
 * adds entries and sends it, which adds the entries to the count window. A line's expected quantity
 * is the warehouse's stock when the product is first counted, so movements go on during the count;
 * the approval applies counted less expected to the stock as it is then, through the shelf count's
 * correction rows (`stocktake_lines`), each part of the difference to its account and party.
 */
@Injectable()
export class StockCountsService implements OnModuleInit {
  private salePrices: SalePriceReader | null = null;
  private books: StockBooks | null = null;
  private accounts: StockCountAccounts | null = null;
  private productSets: ProductSetResolver | null = null;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly binsService: BinsService,
    private readonly catalog: CatalogService,
    private readonly customers: CustomersService,
    private readonly locations: ProductLocationsService,
    private readonly org: OrgService,
    private readonly posting: StockPostingService,
    private readonly productQuery: ProductQueryService,
    private readonly productSuppliers: ProductSuppliersService,
    private readonly scope: ScopeService,
    private readonly stock: StockQueryService,
    private readonly suppliers: SuppliersService,
    private readonly units: UnitConversionService,
    private readonly users: UserNamesService,
    private readonly moduleRef: ModuleRef,
  ) {}

  onModuleInit(): void {
    this.salePrices = this.optional<SalePriceReader>(SALE_PRICE_READER);
    this.books = this.optional<StockBooks>(STOCK_BOOKS);
    this.accounts = this.optional<StockCountAccounts>(STOCK_COUNT_ACCOUNTS);
    this.productSets = this.optional<ProductSetResolver>(PRODUCT_SET_RESOLVER);
  }

  private optional<T>(token: symbol): T | null {
    try {
      return this.moduleRef.get<T>(token, { strict: false });
    } catch {
      return null;
    }
  }

  // ───────────────────────────── the count ─────────────────────────────

  async create(ctx: AuthContext, input: StockCountInput): Promise<StockCountDetail> {
    this.scope.assertCanWriteWarehouse(ctx, input.warehouseId);
    const mode = input.scopeMode;
    const scopeIds = [...new Set(input.scopeIds ?? [])].sort((a, b) => a - b);
    if (mode === 'ALL' || mode === 'SCANNED') {
      if (scopeIds.length > 0) throw invalid('scopeIds', 'empty', `${mode} takes no ids`);
    } else if (mode === 'SEGMENT') {
      if (scopeIds.length !== 1) throw invalid('scopeIds', 'size', 'exactly one segment');
    } else if (scopeIds.length === 0 || scopeIds.length > MAX_SCOPE_IDS) {
      throw invalid('scopeIds', 'size', `1 to ${MAX_SCOPE_IDS} ids`);
    }
    const within = await this.withinScope(mode, scopeIds);
    const id = await inTransaction(this.db, async (tx) => {
      const warehouse = await this.org.getWarehouse(input.warehouseId, tx);
      if (!COUNTED_KINDS.includes(warehouse.kind)) {
        throw new AppError(
          'WAREHOUSE_KIND_NOT_ALLOWED',
          `no stock counts in a ${warehouse.kind} warehouse`,
          { kind: warehouse.kind },
        );
      }
      const productIds =
        mode === 'SCANNED' ? [] : await this.stockedOrHomed(tx, warehouse.id, within);
      if (mode !== 'SCANNED' && productIds.length === 0) {
        throw invalid('scopeMode', 'empty', 'the selection holds no product of this warehouse');
      }
      const [header] = await tx
        .insert(stocktakes)
        .values({
          warehouseId: warehouse.id,
          note: optionalText(input.note) ?? null,
          createdBy: actorUserId(ctx),
          kind: 'PRODUCT',
          status: 'COUNTING',
          startedAt: sql`now()`,
          startedBy: actorUserId(ctx),
          scopeMode: mode,
          scopeIds,
          scopeLabel: optionalText(input.scopeLabel) ?? null,
          showStock: input.showStock ?? false,
        })
        .returning();
      if (!header) throw new Error('stock count insert returned no row');
      for (const part of chunksOf(productIds)) {
        await tx
          .insert(stockCountLines)
          .values(part.map((productId) => ({ stocktakeId: header.id, productId })));
      }
      await this.audit.record(tx, ctx, {
        action: 'CREATE',
        entity: 'stocktakes',
        entityId: header.id,
        after: { ...header, products: productIds.length },
      });
      return header.id;
    });
    return this.get(id);
  }

  /** The products a filtered mode keeps; null: no filter. */
  private async withinScope(
    mode: CountScopeMode,
    scopeIds: readonly number[],
  ): Promise<Set<number> | null> {
    if (mode === 'ALL' || mode === 'SCANNED') return null;
    if (!this.productSets) {
      throw new AppError('SERVICE_UNAVAILABLE', 'no product set resolver is bound', {});
    }
    const ids =
      mode === 'SEGMENT'
        ? await this.productSets.productIds({ segmentId: scopeIds[0] })
        : await this.productSets.productIds({
            where: {
              match: 'ALL',
              groups: [
                {
                  match: 'ALL',
                  conditions: [
                    {
                      field: mode === 'SUPPLIER' ? 'supplier' : 'category',
                      op: 'IN',
                      ids: [...scopeIds],
                    },
                  ],
                },
              ],
            },
          });
    return new Set(ids);
  }

  /** Products that hold stock in the warehouse or have their home there, in id order. */
  private async stockedOrHomed(
    tx: Tx,
    warehouseId: number,
    within: Set<number> | null,
  ): Promise<number[]> {
    const stocked = await tx
      .selectDistinct({ productId: warehouseStock.productId })
      .from(warehouseStock)
      .where(and(eq(warehouseStock.warehouseId, warehouseId), sql`${warehouseStock.onHand} <> 0`));
    const homed = await tx
      .select({ productId: productLocations.productId })
      .from(productLocations)
      .where(and(eq(productLocations.warehouseId, warehouseId), eq(productLocations.isHome, true)));
    const ids = new Set([...stocked, ...homed].map((row) => row.productId));
    return [...ids].filter((id) => within === null || within.has(id)).sort((a, b) => a - b);
  }

  async list(
    query: StockCountQuery,
  ): Promise<{ data: StockCountSummary[]; nextCursor: string | null }> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const filters: SQL[] = [eq(stocktakes.kind, 'PRODUCT')];
    if (query.status) filters.push(eq(stocktakes.status, query.status));
    if (query.warehouseId) filters.push(eq(stocktakes.warehouseId, query.warehouseId));
    const after = decodeCursor(query.cursor);
    if (typeof after?.id === 'number') filters.push(lt(stocktakes.id, after.id));
    const rows = await this.db
      .select()
      .from(stocktakes)
      .where(and(...filters))
      .orderBy(desc(stocktakes.id))
      .limit(limit + 1);
    const page = toPage(rows, limit, (row) => ({ id: row.id }));
    return { data: await this.summaries(page.data, this.db), nextCursor: page.nextCursor };
  }

  private async summaries(
    rows: readonly HeaderRow[],
    executor: Db | Tx,
  ): Promise<StockCountSummary[]> {
    if (rows.length === 0) return [];
    const names = await this.org.warehouseNames(
      [...new Set(rows.map((row) => row.warehouseId))],
      executor,
    );
    const totals = await executor
      .select({
        stocktakeId: stockCountLines.stocktakeId,
        lines: sql<number>`count(*)::int`,
        counted: sql<number>`count(${stockCountLines.countedQty})::int`,
      })
      .from(stockCountLines)
      .where(
        inArray(
          stockCountLines.stocktakeId,
          rows.map((row) => row.id),
        ),
      )
      .groupBy(stockCountLines.stocktakeId);
    const byId = new Map(totals.map((row) => [row.stocktakeId, row]));
    return rows.map((row) => ({
      id: row.id,
      warehouseId: row.warehouseId,
      warehouseName: names.get(row.warehouseId) ?? '',
      status: row.status,
      number: row.number,
      note: row.note,
      scopeMode: row.scopeMode ?? 'ALL',
      scopeLabel: row.scopeLabel,
      showStock: row.showStock,
      startedAt: row.startedAt,
      postedAt: row.postedAt,
      effectiveDate: row.effectiveDate,
      lines: byId.get(row.id)?.lines ?? 0,
      counted: byId.get(row.id)?.counted ?? 0,
    }));
  }

  async get(id: number, executor: Db | Tx = this.db): Promise<StockCountDetail> {
    const header = await this.header(executor, id);
    const [summary] = await this.summaries([header], executor);
    if (!summary) throw notFound('stocktake', id);
    const [totals] = await executor
      .select({
        different: sql<number>`count(*) FILTER (WHERE ${
          header.status === 'APPROVED'
            ? sql`${stockCountLines.differenceQty} <> 0`
            : sql`${stockCountLines.countedQty} <> ${stockCountLines.expectedQty}`
        })::int`,
        uncounted: sql<number>`count(*) FILTER (WHERE ${stockCountLines.countedQty} IS NULL
          AND ${stockCountLines.listed})::int`,
      })
      .from(stockCountLines)
      .where(eq(stockCountLines.stocktakeId, id));
    const sessionRows = await executor
      .select({
        id: stockCountSessions.id,
        userId: stockCountSessions.userId,
        startedAt: stockCountSessions.startedAt,
        sentAt: stockCountSessions.sentAt,
        sentBy: stockCountSessions.sentBy,
        // Spelled out with aliases: a single-table select renders columns without their table.
        entries: sql<number>`(SELECT count(*)::int FROM stock_count_entries e
          WHERE e.session_id = stock_count_sessions.id AND e.voided_at IS NULL)`,
        products: sql<number>`(SELECT count(DISTINCT e.product_id)::int
          FROM stock_count_entries e
          WHERE e.session_id = stock_count_sessions.id AND e.voided_at IS NULL)`,
      })
      .from(stockCountSessions)
      .where(eq(stockCountSessions.stocktakeId, id))
      .orderBy(asc(stockCountSessions.id));
    const people = await this.users.summariesOf([
      ...sessionRows.flatMap((row) => (row.sentBy ? [row.userId, row.sentBy] : [row.userId])),
      ...(header.startedBy ? [header.startedBy] : []),
    ]);
    const nameOf = (userId: number | null) =>
      userId === null ? null : (people.get(userId)?.fullName ?? '');
    return {
      ...summary,
      scopeIds: header.scopeIds ?? [],
      uncounted: header.uncounted,
      startedByName: nameOf(header.startedBy),
      surplus: surplusOf(header),
      shortage: shortageOf(header),
      different: totals?.different ?? 0,
      uncountedLines: totals?.uncounted ?? 0,
      sessions: sessionRows.map((row) => ({
        id: row.id,
        userId: row.userId,
        name: nameOf(row.userId) ?? '',
        startedAt: row.startedAt,
        sentAt: row.sentAt,
        sentByName: nameOf(row.sentBy),
        entries: row.entries,
        products: row.products,
      })),
    };
  }

  async lines(
    ctx: AuthContext,
    id: number,
    query: StockCountLineQuery,
  ): Promise<{ data: StockCountLine[]; nextCursor: string | null }> {
    const header = await this.header(this.db, id);
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const moved = await this.posting.countMovedSince(id);
    const filters: SQL[] = [eq(stockCountLines.stocktakeId, id)];
    const after = decodeCursor(query.cursor);
    if (typeof after?.id === 'number') filters.push(gt(stockCountLines.id, after.id));
    const filter = query.filter ?? 'ALL';
    if (filter === 'COUNTED') filters.push(isNotNull(stockCountLines.countedQty));
    if (filter === 'UNCOUNTED') {
      filters.push(isNull(stockCountLines.countedQty), eq(stockCountLines.listed, true));
    }
    if (filter === 'DIFFERENT') {
      filters.push(
        header.status === 'APPROVED'
          ? sql`${stockCountLines.differenceQty} <> 0`
          : sql`${stockCountLines.countedQty} <> ${stockCountLines.expectedQty}`,
      );
    }
    if (filter === 'MATCHED') filters.push(matchedSql(header));
    if (filter === 'UNLISTED') filters.push(eq(stockCountLines.listed, false));
    if (filter === 'MOVED') {
      if (moved.size === 0) return { data: [], nextCursor: null };
      filters.push(inArray(stockCountLines.productId, [...moved.keys()]));
    }
    const q = query.q?.trim();
    if (q) {
      const found = await this.productQuery.orderedIds({ q }, MAX_SEARCH_IDS);
      if (found.ids.length === 0) return { data: [], nextCursor: null };
      filters.push(inArray(stockCountLines.productId, found.ids));
    }
    const rows = await this.db
      .select()
      .from(stockCountLines)
      .where(and(...filters))
      .orderBy(asc(stockCountLines.id))
      .limit(limit + 1);
    const page = toPage(rows, limit, (row) => ({ id: row.id }));
    const productIds = page.data.map((row) => row.productId);
    const products = new Map(
      (await this.catalog.getMany(productIds)).map((product) => [product.id, product]),
    );
    const counters = await this.countersOf(id, productIds);
    const seesCosts = ctx.permissions.has(COSTS);
    const data = page.data.map((row): StockCountLine => {
      const product = products.get(row.productId);
      const people = counters.get(row.productId) ?? [];
      const difference =
        header.status === 'APPROVED'
          ? row.differenceQty
          : row.countedQty && row.expectedQty
            ? row.countedQty.minus(row.expectedQty)
            : null;
      const fallback = difference && difference.lt(0) ? shortageOf(header) : surplusOf(header);
      return {
        id: row.id,
        productId: row.productId,
        sku: product?.sku ?? '',
        name: product?.name ?? '',
        unitName: product?.baseUnit.uomName ?? '',
        listed: row.listed,
        expectedQty: row.expectedQty,
        countedQty: row.countedQty,
        pendingQty: people.reduce((sum, person) => sum.plus(person.pendingQty), ZERO),
        differenceQty: difference,
        firstCountedAt: row.firstCountedAt,
        counters: people,
        movedDuring: moved.get(row.productId)?.during ?? ZERO,
        movedAfter: moved.get(row.productId)?.after ?? ZERO,
        settleOwn: row.settleOwn,
        settlement:
          row.settleOwn || header.status === 'APPROVED'
            ? ownOf(row)
            : difference && !difference.isZero()
              ? fallback
              : { accountCode: null, party: null, charged: false },
        unitCost: seesCosts ? row.unitCost : null,
        chargeAmount: row.chargeAmount,
        reason: row.reason,
      };
    });
    return { data, nextCursor: page.nextCursor };
  }

  /**
   * The count sheet (ADR-0177): every product with its main supplier, the difference in pieces
   * and at the warehouse selling price (on the approval day, today before it), the tiles over the
   * whole count and the rows the filters keep, by supplier and name.
   */
  async sheet(id: number, query: CountSheetQuery): Promise<CountSheet> {
    const header = await this.header(this.db, id);
    const approved = header.status === 'APPROVED';
    const lineRows = await this.db
      .select()
      .from(stockCountLines)
      .where(eq(stockCountLines.stocktakeId, id))
      .orderBy(asc(stockCountLines.id));
    const productIds = lineRows.map((row) => row.productId);
    const products = new Map<number, Awaited<ReturnType<CatalogService['getMany']>>[number]>();
    const mainSupplier = new Map<number, number>();
    for (const part of chunksOf(productIds)) {
      for (const product of await this.catalog.getMany(part)) products.set(product.id, product);
      for (const [productId, supplierId] of await this.productSuppliers.mainSupplierOf(part)) {
        mainSupplier.set(productId, supplierId);
      }
    }
    const supplierNames = new Map(
      (await this.suppliers.getMany([...new Set(mainSupplier.values())])).map((row) => [
        row.id,
        row.name,
      ]),
    );
    const priceDate = header.effectiveDate ?? businessDate();
    const prices = new Map<number, Decimal>();
    if (this.salePrices && productIds.length > 0) {
      const reader = this.salePrices;
      await inTransaction(this.db, async (tx) => {
        for (const part of chunksOf(productIds)) {
          for (const [productId, price] of await reader.warehousePricesInTx(tx, part, priceDate)) {
            prices.set(productId, price);
          }
        }
      });
    }
    const pending = await this.pendingOf(id);
    const moved = await this.posting.countMovedSince(id);
    const corrected = new Set(
      (
        await this.db
          .selectDistinct({ productId: stockCountEntries.productId })
          .from(stockCountEntries)
          .where(
            and(
              eq(stockCountEntries.stocktakeId, id),
              eq(stockCountEntries.correction, true),
              isNull(stockCountEntries.voidedAt),
            ),
          )
      ).map((row) => row.productId),
    );

    const all = lineRows.map((row): CountSheetRow => {
      const product = products.get(row.productId);
      const supplierId = mainSupplier.get(row.productId) ?? null;
      const difference = approved
        ? row.differenceQty
        : row.countedQty && row.expectedQty
          ? row.countedQty.minus(row.expectedQty)
          : null;
      const price = prices.get(row.productId) ?? null;
      return {
        lineId: row.id,
        productId: row.productId,
        sku: product?.sku ?? '',
        name: product?.name ?? '',
        unitName: product?.baseUnit.uomName ?? '',
        listed: row.listed,
        supplierId,
        supplierName: supplierId === null ? null : (supplierNames.get(supplierId) ?? null),
        expectedQty: row.expectedQty,
        countedQty: row.countedQty,
        pendingQty: pending.get(row.productId) ?? ZERO,
        differenceQty: difference,
        salePrice: price,
        differenceAmount:
          difference === null || price === null ? null : toWholeMnt(price.times(difference)),
        reason: row.reason,
        corrected: corrected.has(row.productId),
        movedDuring: moved.get(row.productId)?.during ?? ZERO,
        movedAfter: moved.get(row.productId)?.after ?? ZERO,
      };
    });
    const totals = sheetTotals(all);

    let kept = all.filter((row) => keepsRow(row, query.filter ?? 'ALL', moved));
    if (query.supplierId !== undefined) {
      kept = kept.filter((row) => row.supplierId === query.supplierId);
    }
    const q = query.q?.trim();
    if (q || query.categoryId !== undefined || query.segmentId !== undefined) {
      const onlyIds = kept.map((row) => row.productId);
      const found =
        onlyIds.length === 0
          ? { ids: [] }
          : await this.productQuery.orderedIds(
              {
                onlyIds,
                ...(q ? { q } : {}),
                ...(query.segmentId === undefined ? {} : { segmentId: query.segmentId }),
                ...(query.categoryId === undefined
                  ? {}
                  : {
                      where: {
                        match: 'ALL' as const,
                        groups: [
                          {
                            match: 'ALL' as const,
                            conditions: [
                              { field: 'category', op: 'IN' as const, ids: [query.categoryId] },
                            ],
                          },
                        ],
                      },
                    }),
              },
              onlyIds.length,
            );
      const keep = new Set(found.ids);
      kept = kept.filter((row) => keep.has(row.productId));
    }
    kept.sort(bySupplierAndName);
    const suppliers = [...supplierNames]
      .map(([supplierId, name]) => ({ id: supplierId, name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'mn'));
    return {
      priceDate,
      totals,
      suppliers,
      rows: kept.slice(0, MAX_SHEET_ROWS),
      truncated: kept.length > MAX_SHEET_ROWS,
    };
  }

  /** Each product's unsent quantity: counted on a phone, not in the window yet. */
  private async pendingOf(stocktakeId: number): Promise<Map<number, Decimal>> {
    const rows = await this.db
      .select({
        productId: stockCountEntries.productId,
        qty: sql<string>`sum(${stockCountEntries.qtyBase})::text`,
      })
      .from(stockCountEntries)
      .innerJoin(stockCountSessions, eq(stockCountSessions.id, stockCountEntries.sessionId))
      .where(
        and(
          eq(stockCountEntries.stocktakeId, stocktakeId),
          isNull(stockCountEntries.voidedAt),
          isNull(stockCountSessions.sentAt),
        ),
      )
      .groupBy(stockCountEntries.productId);
    return new Map(rows.map((row) => [row.productId, new Decimal(row.qty)]));
  }

  /** Why a product differs, written in the window until the count is approved (ADR-0177). */
  async setReason(
    ctx: AuthContext,
    id: number,
    lineId: number,
    reason: string | null,
  ): Promise<void> {
    const text = optionalText(reason ?? undefined) ?? null;
    if (text !== null && text.length > MAX_REASON) {
      throw invalid('reason', 'maxLength', `at most ${MAX_REASON} characters`);
    }
    await inTransaction(this.db, async (tx) => {
      const header = await this.lockCount(tx, id, 'update');
      this.scope.assertCanWriteWarehouse(ctx, header.warehouseId);
      assertState(header, 'COUNTING', 'REVIEW');
      const line = await this.line(tx, id, lineId);
      if (line.reason === text) return;
      await tx
        .update(stockCountLines)
        .set({ reason: text, updatedAt: sql`now()` })
        .where(eq(stockCountLines.id, lineId));
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'stocktakes',
        entityId: id,
        before: { lineId, productId: line.productId, reason: line.reason },
        after: { lineId, productId: line.productId, reason: text },
      });
    });
  }

  /**
   * The counted quantity typed in the window (ADR-0181): the sent entries of the product are struck
   * out, never deleted, and one correcting entry in base units takes their place. What a counter
   * sends afterwards is added to it.
   */
  async correctLine(ctx: AuthContext, id: number, lineId: number, qty: Decimal): Promise<void> {
    if (qty.isNegative()) throw invalid('qty', 'min', 'not below zero');
    await inTransaction(this.db, async (tx) => {
      const header = await this.lockCount(tx, id, 'share');
      this.scope.assertCanWriteWarehouse(ctx, header.warehouseId);
      assertState(header, 'COUNTING', 'REVIEW');
      const found = await this.line(tx, id, lineId);
      const [line] = await tx
        .select()
        .from(stockCountLines)
        .where(eq(stockCountLines.id, found.id))
        .for('update');
      if (!line) throw notFound('stock count line', lineId);
      if (line.countedQty !== null && line.countedQty.eq(qty)) return;
      const unit = (await this.units.baseUnits([line.productId], tx)).get(line.productId);
      if (!unit) throw new Error(`product ${line.productId} has no base unit`);
      const converted = await this.units.toBase(unit.unitId, qty, tx);
      if (line.firstCountedAt === null) {
        await this.stock.lockWarehouseBalances(tx, header.warehouseId, [line.productId]);
        const onHand = await this.onHandOf(tx, header.warehouseId, line.productId);
        await tx
          .update(stockCountLines)
          .set({
            expectedQty: onHand.lt(0) ? ZERO : onHand,
            ledgerMark: await this.posting.ledgerMark(tx),
            firstCountedAt: sql`now()`,
          })
          .where(eq(stockCountLines.id, line.id));
      }
      await tx.execute(sql`
        UPDATE stock_count_entries e
           SET voided_at = now()
          FROM stock_count_sessions s
         WHERE s.id = e.session_id AND s.sent_at IS NOT NULL
           AND e.stocktake_id = ${id} AND e.product_id = ${line.productId}
           AND e.voided_at IS NULL`);
      const [session] = await tx
        .insert(stockCountSessions)
        .values({ stocktakeId: id, userId: ctx.userId, sentAt: sql`now()`, sentBy: ctx.userId })
        .returning({ id: stockCountSessions.id });
      if (!session) throw new Error('stock count session was not created');
      await tx.insert(stockCountEntries).values({
        sessionId: session.id,
        stocktakeId: id,
        productId: line.productId,
        userId: ctx.userId,
        productUnitId: converted.unitId,
        enteredQty: qty,
        factorSnapshot: converted.factorSnapshot,
        qtyBase: converted.qtyBase,
        correction: true,
      });
      await tx
        .update(stockCountLines)
        .set({ countedQty: converted.qtyBase, updatedAt: sql`now()` })
        .where(eq(stockCountLines.id, line.id));
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'stocktakes',
        entityId: id,
        before: {
          lineId,
          productId: line.productId,
          countedQty: line.countedQty?.toFixed() ?? null,
        },
        after: { lineId, productId: line.productId, countedQty: converted.qtyBase.toFixed() },
      });
    });
  }

  /** Who counted each product: sent and unsent quantities by counter. */
  private async countersOf(
    stocktakeId: number,
    productIds: readonly number[],
  ): Promise<Map<number, StockCountCounter[]>> {
    const result = new Map<number, StockCountCounter[]>();
    if (productIds.length === 0) return result;
    const rows = await this.db
      .select({
        productId: stockCountEntries.productId,
        userId: stockCountEntries.userId,
        qty: sql<string>`coalesce(sum(${stockCountEntries.qtyBase})
          FILTER (WHERE ${stockCountSessions.sentAt} IS NOT NULL), 0)::text`,
        pending: sql<string>`coalesce(sum(${stockCountEntries.qtyBase})
          FILTER (WHERE ${stockCountSessions.sentAt} IS NULL), 0)::text`,
      })
      .from(stockCountEntries)
      .innerJoin(stockCountSessions, eq(stockCountSessions.id, stockCountEntries.sessionId))
      .where(
        and(
          eq(stockCountEntries.stocktakeId, stocktakeId),
          isNull(stockCountEntries.voidedAt),
          inArray(stockCountEntries.productId, [...productIds]),
        ),
      )
      .groupBy(stockCountEntries.productId, stockCountEntries.userId)
      .orderBy(asc(stockCountEntries.productId), asc(stockCountEntries.userId));
    const people = await this.users.summariesOf(rows.map((row) => row.userId));
    for (const row of rows) {
      const list = result.get(row.productId) ?? [];
      list.push({
        userId: row.userId,
        name: people.get(row.userId)?.fullName ?? '',
        qty: new Decimal(row.qty),
        pendingQty: new Decimal(row.pending),
      });
      result.set(row.productId, list);
    }
    return result;
  }

  /** Every entry of one product, newest first: who counted what, and what was taken back. */
  async lineEntries(id: number, lineId: number): Promise<StockCountEntry[]> {
    const line = await this.line(this.db, id, lineId);
    return this.entries(
      this.db,
      and(eq(stockCountEntries.stocktakeId, id), eq(stockCountEntries.productId, line.productId)),
    );
  }

  /** The documents that moved a line's product after it was first counted (ADR-0176 #9). */
  async lineMoved(id: number, lineId: number): Promise<CountMovedDocument[]> {
    const line = await this.line(this.db, id, lineId);
    return this.posting.countMovedDocuments(id, line.productId);
  }

  private async entries(executor: Db | Tx, where: SQL | undefined): Promise<StockCountEntry[]> {
    const rows = await executor
      .select({
        entry: stockCountEntries,
        sentAt: stockCountSessions.sentAt,
      })
      .from(stockCountEntries)
      .innerJoin(stockCountSessions, eq(stockCountSessions.id, stockCountEntries.sessionId))
      .where(where)
      .orderBy(desc(stockCountEntries.id))
      .limit(2000);
    const products = new Map(
      (
        await this.catalog.getMany([...new Set(rows.map((row) => row.entry.productId))], executor)
      ).map((product) => [product.id, product]),
    );
    const units = await this.units.describe(
      [...new Set(rows.map((row) => row.entry.productUnitId))],
      executor,
    );
    const people = await this.users.summariesOf(rows.map((row) => row.entry.userId));
    return rows.map(({ entry, sentAt }) => ({
      id: entry.id,
      sessionId: entry.sessionId,
      productId: entry.productId,
      sku: products.get(entry.productId)?.sku ?? '',
      name: products.get(entry.productId)?.name ?? '',
      userId: entry.userId,
      userName: people.get(entry.userId)?.fullName ?? '',
      productUnitId: entry.productUnitId,
      unitName: units.get(entry.productUnitId)?.uomName ?? '',
      factor: entry.factorSnapshot,
      enteredQty: entry.enteredQty,
      qtyBase: entry.qtyBase,
      createdAt: entry.createdAt,
      voided: entry.voidedAt !== null,
      sent: sentAt !== null,
      correction: entry.correction,
    }));
  }

  // ───────────────────────────── counting ─────────────────────────────

  /** The counts a phone may count now, with this counter's own state in each. */
  async open(ctx: AuthContext): Promise<OpenStockCount[]> {
    const rows = await this.db
      .select()
      .from(stocktakes)
      .where(and(eq(stocktakes.kind, 'PRODUCT'), eq(stocktakes.status, 'COUNTING')))
      .orderBy(desc(stocktakes.id))
      .limit(100);
    return this.openRows(ctx, rows);
  }

  private async openRows(ctx: AuthContext, rows: readonly HeaderRow[]): Promise<OpenStockCount[]> {
    if (rows.length === 0) return [];
    const names = await this.org.warehouseNames([...new Set(rows.map((row) => row.warehouseId))]);
    const mine = await this.db
      .select({
        stocktakeId: stockCountSessions.stocktakeId,
        open: sql<number>`count(*) FILTER (WHERE ${stockCountSessions.sentAt} IS NULL)::int`,
      })
      .from(stockCountSessions)
      .where(
        and(
          eq(stockCountSessions.userId, ctx.userId),
          inArray(
            stockCountSessions.stocktakeId,
            rows.map((row) => row.id),
          ),
        ),
      )
      .groupBy(stockCountSessions.stocktakeId);
    const state = new Map(mine.map((row) => [row.stocktakeId, row.open > 0]));
    return rows.map((row) => ({
      id: row.id,
      warehouseId: row.warehouseId,
      warehouseName: names.get(row.warehouseId) ?? '',
      note: row.note,
      scopeMode: row.scopeMode ?? 'ALL',
      scopeLabel: row.scopeLabel,
      showStock: row.showStock,
      startedAt: row.startedAt,
      mine: !state.has(row.id) ? 'NONE' : state.get(row.id) ? 'OPEN' : 'SENT',
    }));
  }

  /** This counter's open session and its entries, newest first. */
  async mine(ctx: AuthContext, id: number): Promise<MyStockCount> {
    const header = await this.header(this.db, id);
    const [count] = await this.openRows(ctx, [header]);
    if (!count) throw notFound('stocktake', id);
    const session = await this.openSession(this.db, id, ctx.userId);
    return {
      count,
      status: header.status,
      session: session ? { id: session.id, startedAt: session.startedAt } : null,
      entries: session
        ? await this.entries(this.db, eq(stockCountEntries.sessionId, session.id))
        : [],
    };
  }

  /** Starts this counter's session; whoever starts must send, even with nothing counted. */
  async start(ctx: AuthContext, id: number): Promise<MyStockCount> {
    await inTransaction(this.db, async (tx) => {
      const header = await this.lockCount(tx, id, 'share');
      assertState(header, 'COUNTING');
      await tx
        .insert(stockCountSessions)
        .values({ stocktakeId: id, userId: ctx.userId })
        .onConflictDoNothing();
    });
    return this.mine(ctx, id);
  }

  async addEntry(
    ctx: AuthContext,
    id: number,
    input: StockCountEntryInput,
  ): Promise<StockCountProductInfo> {
    return inTransaction(this.db, async (tx) => {
      const header = await this.lockCount(tx, id, 'share');
      assertState(header, 'COUNTING');
      const session = await this.openSession(tx, id, ctx.userId);
      if (!session) {
        throw new AppError('COUNT_SESSION_REQUIRED', 'start counting first', { id });
      }
      const converted = await this.units.toBase(input.productUnitId, input.qty, tx);
      if (converted.productId !== input.productId) {
        throw invalid('productUnitId', 'product', 'the unit belongs to another product');
      }
      await tx
        .insert(stockCountLines)
        .values({ stocktakeId: id, productId: input.productId, listed: false })
        .onConflictDoNothing();
      const [line] = await tx
        .select()
        .from(stockCountLines)
        .where(
          and(eq(stockCountLines.stocktakeId, id), eq(stockCountLines.productId, input.productId)),
        )
        .for('update');
      if (!line) throw new Error('stock count line is missing');
      if (line.firstCountedAt === null) {
        // The stock the count is compared with: what the warehouse holds at the first entry.
        await this.stock.lockWarehouseBalances(tx, header.warehouseId, [input.productId]);
        const onHand = await this.onHandOf(tx, header.warehouseId, input.productId);
        await tx
          .update(stockCountLines)
          .set({
            expectedQty: onHand.lt(0) ? ZERO : onHand,
            ledgerMark: await this.posting.ledgerMark(tx),
            firstCountedAt: sql`now()`,
            updatedAt: sql`now()`,
          })
          .where(eq(stockCountLines.id, line.id));
      }
      const [entry] = await tx
        .insert(stockCountEntries)
        .values({
          sessionId: session.id,
          stocktakeId: id,
          productId: input.productId,
          userId: ctx.userId,
          productUnitId: converted.unitId,
          enteredQty: input.qty,
          factorSnapshot: converted.factorSnapshot,
          qtyBase: converted.qtyBase,
        })
        .returning({ id: stockCountEntries.id });
      return {
        ...(await this.infoOf(tx, header, session.id, input.productId)),
        entryId: entry?.id ?? null,
      };
    });
  }

  /** Takes back one of this counter's own unsent entries; the row stays, struck out. */
  async voidEntry(ctx: AuthContext, id: number, entryId: number): Promise<StockCountProductInfo> {
    return inTransaction(this.db, async (tx) => {
      const header = await this.lockCount(tx, id, 'share');
      assertState(header, 'COUNTING');
      const session = await this.openSession(tx, id, ctx.userId);
      const [entry] = await tx
        .select()
        .from(stockCountEntries)
        .where(and(eq(stockCountEntries.id, entryId), eq(stockCountEntries.stocktakeId, id)))
        .for('update');
      if (!entry) throw notFound('stock count entry', entryId);
      if (!session || entry.sessionId !== session.id) {
        throw new AppError('FORBIDDEN', 'only an own unsent entry is taken back', {});
      }
      if (entry.voidedAt === null) {
        const [line] = await tx
          .select({ id: stockCountLines.id })
          .from(stockCountLines)
          .where(
            and(
              eq(stockCountLines.stocktakeId, id),
              eq(stockCountLines.productId, entry.productId),
            ),
          )
          .for('update');
        await tx
          .update(stockCountEntries)
          .set({ voidedAt: sql`now()` })
          .where(eq(stockCountEntries.id, entryId));
        const [left] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(stockCountEntries)
          .where(
            and(
              eq(stockCountEntries.stocktakeId, id),
              eq(stockCountEntries.productId, entry.productId),
              isNull(stockCountEntries.voidedAt),
            ),
          );
        if (line && (left?.n ?? 0) === 0) {
          // Nobody has counted it any more: the next entry freezes the stock anew.
          await tx
            .update(stockCountLines)
            .set({
              expectedQty: null,
              ledgerMark: null,
              firstCountedAt: null,
              updatedAt: sql`now()`,
            })
            .where(eq(stockCountLines.id, line.id));
        }
      }
      return this.infoOf(tx, header, session.id, entry.productId);
    });
  }

  /** One product before it is counted: this counter's quantity, and the stock when shown. */
  async product(ctx: AuthContext, id: number, productId: number): Promise<StockCountProductInfo> {
    const header = await this.header(this.db, id);
    const session = await this.openSession(this.db, id, ctx.userId);
    return this.infoOf(this.db, header, session?.id ?? null, productId);
  }

  private async infoOf(
    executor: Db | Tx,
    header: HeaderRow,
    sessionId: number | null,
    productId: number,
  ): Promise<StockCountProductInfo> {
    const [line] = await executor
      .select()
      .from(stockCountLines)
      .where(
        and(eq(stockCountLines.stocktakeId, header.id), eq(stockCountLines.productId, productId)),
      );
    const [mine] =
      sessionId === null
        ? []
        : await executor
            .select({
              qty: sql<string>`coalesce(sum(${stockCountEntries.qtyBase}), 0)::text`,
            })
            .from(stockCountEntries)
            .where(
              and(
                eq(stockCountEntries.sessionId, sessionId),
                eq(stockCountEntries.productId, productId),
                isNull(stockCountEntries.voidedAt),
              ),
            );
    const myQty = new Decimal(mine?.qty ?? '0');
    const shown = header.showStock;
    return {
      productId,
      listed: line?.listed ?? false,
      myQty,
      expectedQty: !shown
        ? null
        : (line?.expectedQty ?? (await this.onHandOf(executor, header.warehouseId, productId))),
      countedQty: shown ? (line?.countedQty ?? ZERO).plus(myQty) : null,
      entryId: null,
    };
  }

  private async onHandOf(
    executor: Db | Tx,
    warehouseId: number,
    productId: number,
  ): Promise<Decimal> {
    const [row] = await executor
      .select({ qty: sql<string>`coalesce(sum(${warehouseStock.onHand}), 0)::text` })
      .from(warehouseStock)
      .where(
        and(eq(warehouseStock.warehouseId, warehouseId), eq(warehouseStock.productId, productId)),
      );
    return new Decimal(row?.qty ?? '0');
  }

  /** Sends this counter's session: its entries join the count window at once. */
  async send(ctx: AuthContext, id: number): Promise<MyStockCount> {
    await inTransaction(this.db, async (tx) => {
      const header = await this.lockCount(tx, id, 'share');
      assertState(header, 'COUNTING');
      const session = await this.openSession(tx, id, ctx.userId);
      if (!session) {
        throw new AppError('COUNT_SESSION_REQUIRED', 'start counting first', { id });
      }
      await this.sendInTx(tx, ctx, id, session.id);
    });
    return this.mine(ctx, id);
  }

  /** A manager sends a session its counter left open, with what it holds. */
  async sendFor(ctx: AuthContext, id: number, sessionId: number): Promise<StockCountDetail> {
    await inTransaction(this.db, async (tx) => {
      const header = await this.lockCount(tx, id, 'share');
      this.scope.assertCanWriteWarehouse(ctx, header.warehouseId);
      assertState(header, 'COUNTING');
      await this.sendInTx(tx, ctx, id, sessionId);
    });
    return this.get(id);
  }

  private async sendInTx(tx: Tx, ctx: AuthContext, id: number, sessionId: number): Promise<void> {
    const [session] = await tx
      .select()
      .from(stockCountSessions)
      .where(and(eq(stockCountSessions.id, sessionId), eq(stockCountSessions.stocktakeId, id)))
      .for('update');
    if (!session) throw notFound('stock count session', sessionId);
    if (session.sentAt !== null) return;
    await tx
      .update(stockCountSessions)
      .set({ sentAt: sql`now()`, sentBy: ctx.userId })
      .where(eq(stockCountSessions.id, sessionId));
    const touched = await tx
      .selectDistinct({ productId: stockCountEntries.productId })
      .from(stockCountEntries)
      .where(eq(stockCountEntries.sessionId, sessionId));
    const productIds = touched.map((row) => row.productId).sort((a, b) => a - b);
    for (const part of chunksOf(productIds)) {
      // Lines in product order, as every writer of the count takes them.
      await tx
        .select({ id: stockCountLines.id })
        .from(stockCountLines)
        .where(and(eq(stockCountLines.stocktakeId, id), inArray(stockCountLines.productId, part)))
        .orderBy(asc(stockCountLines.productId))
        .for('update');
      await tx.execute(sql`
        UPDATE stock_count_lines l
           SET counted_qty = (
                 SELECT sum(e.qty_base)
                   FROM stock_count_entries e
                   JOIN stock_count_sessions s ON s.id = e.session_id
                  WHERE e.stocktake_id = l.stocktake_id AND e.product_id = l.product_id
                    AND e.voided_at IS NULL AND s.sent_at IS NOT NULL),
               updated_at = now()
         WHERE l.stocktake_id = ${id}
           AND l.product_id IN (${sql.join(
             part.map((productId) => sql`${productId}`),
             sql`, `,
           )})`);
    }
    if (session.userId !== ctx.userId) {
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'stocktakes',
        entityId: id,
        after: { sentSessionOf: session.userId },
      });
    }
  }

  // ───────────────────────────── states ─────────────────────────────

  /** COUNTING → REVIEW, once every started session is sent. */
  async close(ctx: AuthContext, id: number): Promise<StockCountDetail> {
    await inTransaction(this.db, async (tx) => {
      const header = await this.lockState(tx, ctx, id, 'COUNTING');
      const open = await tx
        .select({ userId: stockCountSessions.userId })
        .from(stockCountSessions)
        .where(and(eq(stockCountSessions.stocktakeId, id), isNull(stockCountSessions.sentAt)));
      if (open.length > 0) {
        const people = await this.users.summariesOf(open.map((row) => row.userId));
        throw new AppError('COUNT_SESSIONS_OPEN', 'counters have not sent their counts', {
          names: open.map((row) => people.get(row.userId)?.fullName ?? '').join(', '),
        });
      }
      await this.setStatus(tx, ctx, header, 'REVIEW');
    });
    return this.get(id);
  }

  /** REVIEW → COUNTING: more counting before the approval. */
  async reopen(ctx: AuthContext, id: number): Promise<StockCountDetail> {
    await inTransaction(this.db, async (tx) => {
      const header = await this.lockState(tx, ctx, id, 'REVIEW');
      await this.setStatus(tx, ctx, header, 'COUNTING');
    });
    return this.get(id);
  }

  /** Nothing is posted; a count in review is cancelled by an approver only. */
  async cancel(ctx: AuthContext, id: number): Promise<StockCountDetail> {
    await inTransaction(this.db, async (tx) => {
      const header = await this.lockCount(tx, id, 'update');
      this.scope.assertCanWriteWarehouse(ctx, header.warehouseId);
      assertState(header, 'COUNTING', 'REVIEW');
      if (header.status === 'REVIEW' && !ctx.permissions.has(APPROVE)) {
        throw new AppError('FORBIDDEN', 'a count in review is cancelled by its approver', {
          permission: APPROVE,
        });
      }
      await tx
        .update(stocktakes)
        .set({ status: 'CANCELLED', updatedAt: sql`now()` })
        .where(eq(stocktakes.id, id));
      await this.audit.record(tx, ctx, {
        action: 'CANCEL',
        entity: 'stocktakes',
        entityId: id,
        before: { status: header.status },
        after: { status: 'CANCELLED' },
      });
    });
    return this.get(id);
  }

  private async setStatus(
    tx: Tx,
    ctx: AuthContext,
    header: HeaderRow,
    status: 'COUNTING' | 'REVIEW',
  ): Promise<void> {
    await tx
      .update(stocktakes)
      .set({ status, updatedAt: sql`now()` })
      .where(eq(stocktakes.id, header.id));
    await this.audit.record(tx, ctx, {
      action: 'UPDATE',
      entity: 'stocktakes',
      entityId: header.id,
      before: { status: header.status },
      after: { status },
    });
  }

  // ───────────────────────────── settlement ─────────────────────────────

  /** The accounts a difference may go to; empty until finance lists one. */
  async accountChoices(): Promise<StockCountAccount[]> {
    return (await this.accounts?.active()) ?? [];
  }

  /** The count's default account and party for its surplus and for its shortage. */
  async setDefaults(
    ctx: AuthContext,
    id: number,
    input: { surplus?: CountSettlementInput | null; shortage?: CountSettlementInput | null },
  ): Promise<StockCountDetail> {
    await inTransaction(this.db, async (tx) => {
      const header = await this.lockCount(tx, id, 'update');
      this.scope.assertCanWriteWarehouse(ctx, header.warehouseId);
      assertState(header, 'COUNTING', 'REVIEW');
      const surplus =
        input.surplus === undefined
          ? surplusOf(header)
          : await this.settlementIn(tx, input.surplus, 'surplus', false);
      const shortage =
        input.shortage === undefined
          ? shortageOf(header)
          : await this.settlementIn(tx, input.shortage, 'shortage', true);
      await tx
        .update(stocktakes)
        .set({
          surplusAccountCode: surplus.accountCode,
          surplusPartyKind: surplus.party?.kind ?? null,
          surplusPartyId: surplus.party?.id ?? null,
          surplusPartyName: surplus.party?.name ?? null,
          shortageAccountCode: shortage.accountCode,
          shortagePartyKind: shortage.party?.kind ?? null,
          shortagePartyId: shortage.party?.id ?? null,
          shortagePartyName: shortage.party?.name ?? null,
          shortageCharged: shortage.charged,
          updatedAt: sql`now()`,
        })
        .where(eq(stocktakes.id, id));
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'stocktakes',
        entityId: id,
        before: { surplus: surplusOf(header), shortage: shortageOf(header) },
        after: { surplus, shortage },
      });
    });
    return this.get(id);
  }

  /** One line's own account and party; `null` puts the line back on the count's defaults. */
  async setLine(
    ctx: AuthContext,
    id: number,
    lineId: number,
    input: CountSettlementInput | null,
  ): Promise<void> {
    await inTransaction(this.db, async (tx) => {
      const header = await this.lockCount(tx, id, 'update');
      this.scope.assertCanWriteWarehouse(ctx, header.warehouseId);
      assertState(header, 'COUNTING', 'REVIEW');
      const line = await this.line(tx, id, lineId);
      const own = input === null ? null : await this.settlementIn(tx, input, 'settlement', true);
      await tx
        .update(stockCountLines)
        .set({
          settleOwn: own !== null,
          accountCode: own?.accountCode ?? null,
          partyKind: own?.party?.kind ?? null,
          partyId: own?.party?.id ?? null,
          partyName: own?.party?.name ?? null,
          charged: own?.charged ?? false,
          updatedAt: sql`now()`,
        })
        .where(eq(stockCountLines.id, lineId));
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'stocktakes',
        entityId: id,
        before: {
          lineId,
          productId: line.productId,
          settlement: line.settleOwn ? ownOf(line) : null,
        },
        after: { lineId, productId: line.productId, settlement: own },
      });
    });
  }

  private async settlementIn(
    tx: Tx,
    input: CountSettlementInput | null,
    path: string,
    mayCharge: boolean,
  ): Promise<CountSettlement> {
    const accountCode = optionalText(input?.accountCode) ?? null;
    if (accountCode !== null) await this.assertAccount(tx, accountCode, `${path}.accountCode`);
    const party = input?.party ? await this.partyIn(tx, input.party, `${path}.party`) : null;
    const charged = input?.charged ?? false;
    if (charged && !mayCharge) {
      throw invalid(`${path}.charged`, 'shortage', 'only a shortage is charged');
    }
    if (charged && party === null) {
      throw invalid(`${path}.party`, 'required', 'a charged shortage names who pays');
    }
    return { accountCode, party, charged };
  }

  private async assertAccount(tx: Tx, code: string, path: string): Promise<void> {
    if (!this.accounts) throw invalid(path, 'exists', 'no count difference account is listed');
    await this.accounts.assertUsable(tx, code);
  }

  private async partyIn(tx: Tx, input: CountPartyInput, path: string): Promise<StockBookParty> {
    const id = input.id ?? null;
    if (input.kind === 'OTHER') {
      const name = optionalText(input.name);
      if (!name) throw invalid(`${path}.name`, 'required', 'a name');
      if (name.length > 200) throw invalid(`${path}.name`, 'max', 'at most 200 characters');
      return { kind: 'OTHER', id: null, name };
    }
    if (id === null) throw invalid(`${path}.id`, 'required', 'an id');
    if (input.kind === 'USER') {
      const user = (await this.users.summariesOf([id])).get(id);
      if (user?.status !== 'ACTIVE') throw invalid(`${path}.id`, 'active', 'an active user');
      return { kind: 'USER', id, name: user.fullName };
    }
    if (input.kind === 'CUSTOMER') {
      await this.customers.assertActive(tx, id);
      const [customer] = await this.customers.getMany([id], tx);
      return { kind: 'CUSTOMER', id, name: customer?.name ?? '' };
    }
    await this.suppliers.assertActive(tx, id);
    const [supplier] = await this.suppliers.getMany([id], tx);
    return { kind: 'SUPPLIER', id, name: supplier?.name ?? '' };
  }

  // ───────────────────────────── approval ─────────────────────────────

  /**
   * REVIEW → APPROVED: posts counted less expected for every counted product onto the stock as it
   * is now (never below zero), and for the uncounted listed products either nothing (LEAVE) or
   * their whole stock (ZERO). Each difference carries its account and party into the books; a
   * charged shortage also becomes its party's receivable at the selling price.
   */
  async approve(
    ctx: AuthContext,
    id: number,
    input: { uncounted: CountUncountedMode },
  ): Promise<StockCountDetail> {
    await inTransaction(this.db, async (tx) => {
      const header = await this.lockState(tx, ctx, id, 'REVIEW');
      const open = await tx
        .select({ id: stockCountSessions.id })
        .from(stockCountSessions)
        .where(and(eq(stockCountSessions.stocktakeId, id), isNull(stockCountSessions.sentAt)));
      if (open.length > 0) throw new Error(`stock count ${id} is in review with open sessions`);
      const lines = await tx
        .select()
        .from(stockCountLines)
        .where(eq(stockCountLines.stocktakeId, id))
        .orderBy(asc(stockCountLines.productId))
        .for('update');
      const wanted = lines.filter(
        (line) => line.countedQty !== null || (line.listed && input.uncounted === 'ZERO'),
      );
      const held = await this.heldIn(
        tx,
        header.warehouseId,
        wanted.map((line) => line.productId),
      );
      const plans = await this.plan(tx, header, wanted, held);

      await tx
        .update(stockCountLines)
        .set({ differenceQty: ZERO, updatedAt: sql`now()` })
        .where(and(eq(stockCountLines.stocktakeId, id), isNotNull(stockCountLines.countedQty)));
      const codes = new Set<string>();
      const settled = new Map<number, CountSettlement>();
      for (const plan of plans) {
        const shortage = plan.delta.lt(0);
        const chosen = plan.line.settleOwn
          ? ownOf(plan.line)
          : shortage
            ? shortageOf(header)
            : surplusOf(header);
        const settlement: CountSettlement = {
          ...chosen,
          charged: chosen.charged && shortage && chosen.party !== null,
        };
        if (settlement.accountCode) codes.add(settlement.accountCode);
        settled.set(plan.line.id, settlement);
        await tx
          .update(stockCountLines)
          .set({
            accountCode: settlement.accountCode,
            partyKind: settlement.party?.kind ?? null,
            partyId: settlement.party?.id ?? null,
            partyName: settlement.party?.name ?? null,
            charged: settlement.charged,
            differenceQty: plan.delta,
            updatedAt: sql`now()`,
          })
          .where(eq(stockCountLines.id, plan.line.id));
      }
      for (const code of codes) await this.assertAccount(tx, code, 'accountCode');

      // The correction rows the ledger points at: one per shelf and lot a difference touches.
      const rowIds = new Map<string, number>();
      const rows = plans.flatMap((plan) =>
        plan.parts.map((part) => ({
          stocktakeId: id,
          binId: part.binId,
          productId: plan.line.productId,
          lotId: part.lotId,
          expectedQty: part.expected,
          countedQty: part.expected.plus(part.qty),
          countedAt: sql`now()`,
        })),
      );
      for (const part of chunksOf(rows)) {
        const inserted = await tx.insert(stocktakeLines).values(part).returning({
          id: stocktakeLines.id,
          binId: stocktakeLines.binId,
          productId: stocktakeLines.productId,
          lotId: stocktakeLines.lotId,
        });
        for (const row of inserted) {
          rowIds.set(`${row.binId}:${row.productId}:${row.lotId ?? ''}`, row.id);
        }
      }
      const baseUnits = await this.units.baseUnits(
        plans.map((plan) => plan.line.productId),
        tx,
      );
      const firstRow = new Map<number, number>();
      const movements: Movement[] = plans.flatMap((plan) => {
        const unit = baseUnits.get(plan.line.productId);
        if (!unit) throw new Error(`product ${plan.line.productId} has no base unit`);
        return plan.parts.map((part) => {
          const docLineId = rowIds.get(`${part.binId}:${plan.line.productId}:${part.lotId ?? ''}`);
          if (docLineId === undefined) throw new Error('count correction row is missing');
          if (!firstRow.has(plan.line.id)) firstRow.set(plan.line.id, docLineId);
          return {
            docType: 'ST',
            docId: id,
            docLineId,
            movementType: 'COUNT_CORRECTION',
            leg: 1,
            warehouseId: header.warehouseId,
            binId: part.binId,
            productId: plan.line.productId,
            lotId: part.lotId,
            qtyBase: part.qty,
            enteredQty: part.qty.abs(),
            productUnitId: unit.unitId,
            factorSnapshot: unit.factorToBase,
          };
        });
      });
      if (movements.length > MAX_MOVEMENTS_PER_POST) {
        throw invalid('id', 'max', `at most ${MAX_MOVEMENTS_PER_POST} corrections in one count`);
      }
      await tx
        .update(stocktakes)
        .set({ uncounted: input.uncounted, updatedAt: sql`now()` })
        .where(eq(stocktakes.id, id));
      const result = await this.posting.post(tx, ctx, {
        docs: [{ docType: 'ST', docId: id, expectedStatus: 'REVIEW', nextStatus: 'APPROVED' }],
        movements,
      });

      for (const plan of plans) {
        const row = firstRow.get(plan.line.id);
        const unitCost =
          row === undefined ? undefined : result.unitCosts.get(`${row}:COUNT_CORRECTION:1`);
        if (!unitCost) continue;
        await tx
          .update(stockCountLines)
          .set({ unitCost })
          .where(eq(stockCountLines.id, plan.line.id));
      }
      const charges = await this.charge(tx, ctx, header, plans, settled, {
        number: result.numbers.get(id) ?? '',
        date: result.effectiveDate,
      });
      await this.audit.record(tx, ctx, {
        action: 'POST',
        entity: 'stocktakes',
        entityId: id,
        before: header,
        after: {
          number: result.numbers.get(id),
          corrections: movements.length,
          uncounted: input.uncounted,
          charged: charges.toFixed(2),
        },
      });
    });
    return this.get(id);
  }

  /** What every line's difference does to which shelf. */
  private async plan(
    tx: Tx,
    header: HeaderRow,
    wanted: readonly LineRow[],
    held: Map<number, HeldRow[]>,
  ): Promise<Planned[]> {
    const plans: Planned[] = [];
    const surplus: { line: LineRow; delta: Decimal }[] = [];
    for (const line of wanted) {
      const rows = held.get(line.productId) ?? [];
      const now = rows.reduce((sum, row) => sum.plus(row.onHand), ZERO);
      const raw =
        line.countedQty !== null ? line.countedQty.minus(line.expectedQty ?? ZERO) : now.negated();
      // Stock never goes below zero: what left since the count cannot be taken twice.
      const delta = raw.lt(now.negated()) ? now.negated() : raw;
      if (delta.isZero()) continue;
      if (delta.gt(0)) {
        surplus.push({ line, delta });
        continue;
      }
      let left = delta.abs();
      const parts: Planned['parts'] = [];
      const ordered = [...rows].sort(
        (a, b) =>
          (a.sellable === b.sellable ? 0 : a.sellable ? -1 : 1) ||
          b.onHand.comparedTo(a.onHand) ||
          a.binId - b.binId,
      );
      for (const row of ordered) {
        if (left.isZero()) break;
        const take = Decimal.min(left, row.onHand);
        parts.push({
          binId: row.binId,
          lotId: row.lotId,
          expected: row.onHand,
          qty: take.negated(),
        });
        left = left.minus(take);
      }
      plans.push({ line, delta, parts });
    }
    if (surplus.length > 0) {
      const fixed = await this.locations.defaultBinOf(
        header.warehouseId,
        surplus.map((item) => item.line.productId),
        tx,
      );
      let receiving: number | null = null;
      for (const { line, delta } of surplus) {
        const rows = held.get(line.productId) ?? [];
        const shelf = [...rows]
          .filter((row) => row.sellable && row.active)
          .sort((a, b) => b.onHand.comparedTo(a.onHand) || a.binId - b.binId)[0];
        let binId = fixed.get(line.productId) ?? shelf?.binId ?? null;
        if (binId === null) {
          receiving ??= (await this.binsService.systemBin(header.warehouseId, 'RECEIVING', tx)).id;
          binId = receiving;
        }
        const there = rows.find((row) => row.binId === binId && row.lotId === null);
        plans.push({
          line,
          delta,
          parts: [{ binId, lotId: null, expected: there?.onHand ?? ZERO, qty: delta }],
        });
      }
    }
    return plans.sort((a, b) => a.line.productId - b.line.productId);
  }

  /** The shelves that hold the products now, by product. */
  private async heldIn(
    tx: Tx,
    warehouseId: number,
    productIds: readonly number[],
  ): Promise<Map<number, HeldRow[]>> {
    const held = new Map<number, HeldRow[]>();
    const sellable: readonly string[] = SELLABLE_BIN_TYPES;
    for (const part of chunksOf(productIds, 5000)) {
      const rows = await tx
        .select({
          productId: binStock.productId,
          binId: binStock.binId,
          lotId: binStock.lotId,
          onHand: binStock.onHand,
          type: bins.type,
          status: bins.status,
        })
        .from(binStock)
        .innerJoin(bins, eq(bins.id, binStock.binId))
        .where(
          and(
            eq(binStock.warehouseId, warehouseId),
            inArray(binStock.productId, part),
            sql`${binStock.onHand} > 0`,
            isNull(bins.archivedAt),
          ),
        );
      for (const row of rows) {
        const list = held.get(row.productId) ?? [];
        list.push({
          binId: row.binId,
          lotId: row.lotId,
          onHand: row.onHand,
          sellable: sellable.includes(row.type),
          active: row.status === 'ACTIVE',
        });
        held.set(row.productId, list);
      }
    }
    return held;
  }

  /**
   * A charged shortage as its party's receivable at the selling price (ADR-0176 #8): one document
   * per party, the amounts kept on the lines. Returns the total charged.
   */
  private async charge(
    tx: Tx,
    ctx: AuthContext,
    header: HeaderRow,
    plans: readonly Planned[],
    settled: Map<number, CountSettlement>,
    doc: { number: string; date: string },
  ): Promise<Decimal> {
    const charged = plans.filter((plan) => settled.get(plan.line.id)?.charged);
    if (charged.length === 0) return ZERO;
    if (!this.salePrices) {
      throw new AppError('PRICE_MISSING', 'no price reader is bound', { productId: null });
    }
    const productIds = charged.map((plan) => plan.line.productId);
    const prices = await this.salePrices.warehousePricesInTx(tx, productIds, businessDate());
    const byParty = new Map<string, { party: StockBookParty; amount: Decimal }>();
    let total = ZERO;
    for (const plan of charged) {
      const party = settled.get(plan.line.id)?.party;
      if (!party) continue;
      const price = prices.get(plan.line.productId);
      if (!price) {
        const [product] = await this.catalog.getMany([plan.line.productId], tx);
        throw new AppError('PRICE_MISSING', `product ${plan.line.productId} has no sale price`, {
          productId: plan.line.productId,
          product: product?.name ?? '',
          sku: product?.sku ?? '',
        });
      }
      const amount = toWholeMnt(price.times(plan.delta.abs()));
      await tx
        .update(stockCountLines)
        .set({ chargeAmount: amount })
        .where(eq(stockCountLines.id, plan.line.id));
      const key = `${party.kind}:${party.id ?? ''}:${party.name}`;
      const sum = byParty.get(key);
      byParty.set(key, { party, amount: (sum?.amount ?? ZERO).plus(amount) });
      total = total.plus(amount);
    }
    for (const [key, { party, amount }] of byParty) {
      await this.books?.damageChargedInTx(tx, ctx, {
        issueId: header.id,
        docId: `count:${header.id}:${key}`,
        docNo: doc.number,
        date: doc.date,
        party,
        amount,
        warehouseIds: [header.warehouseId],
      });
    }
    return total;
  }

  // ───────────────────────────── the variance report ─────────────────────────────

  /** The differences approved counts posted between two business dates, newest first. */
  async variance(
    ctx: AuthContext,
    query: CountVarianceQuery,
  ): Promise<{ data: CountVarianceRow[]; nextCursor: string | null }> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const filters: SQL[] = [
      eq(stocktakes.kind, 'PRODUCT'),
      eq(stocktakes.status, 'APPROVED'),
      gte(stocktakes.effectiveDate, query.from),
      lte(stocktakes.effectiveDate, query.to),
      sql`${stockCountLines.differenceQty} <> 0`,
    ];
    if (query.warehouseId) filters.push(eq(stocktakes.warehouseId, query.warehouseId));
    const after = decodeCursor(query.cursor);
    if (typeof after?.id === 'number') filters.push(lt(stockCountLines.id, after.id));
    const q = query.q?.trim();
    if (q) {
      const found = await this.productQuery.orderedIds({ q }, MAX_SEARCH_IDS);
      if (found.ids.length === 0) return { data: [], nextCursor: null };
      filters.push(inArray(stockCountLines.productId, found.ids));
    }
    const rows = await this.db
      .select({ line: stockCountLines, header: stocktakes })
      .from(stockCountLines)
      .innerJoin(stocktakes, eq(stocktakes.id, stockCountLines.stocktakeId))
      .where(and(...filters))
      .orderBy(desc(stockCountLines.id))
      .limit(limit + 1);
    const page = toPage(rows, limit, (row) => ({ id: row.line.id }));
    const products = new Map(
      (await this.catalog.getMany([...new Set(page.data.map((row) => row.line.productId))])).map(
        (product) => [product.id, product],
      ),
    );
    const names = await this.org.warehouseNames([
      ...new Set(page.data.map((row) => row.header.warehouseId)),
    ]);
    const seesCosts = ctx.permissions.has(COSTS);
    return {
      data: page.data.map(({ line, header }) => ({
        lineId: line.id,
        stocktakeId: header.id,
        number: header.number,
        effectiveDate: header.effectiveDate,
        warehouseId: header.warehouseId,
        warehouseName: names.get(header.warehouseId) ?? '',
        productId: line.productId,
        sku: products.get(line.productId)?.sku ?? '',
        name: products.get(line.productId)?.name ?? '',
        unitName: products.get(line.productId)?.baseUnit.uomName ?? '',
        expectedQty: line.expectedQty,
        countedQty: line.countedQty,
        differenceQty: line.differenceQty ?? ZERO,
        unitCost: seesCosts ? line.unitCost : null,
        settlement: ownOf(line),
        chargeAmount: line.chargeAmount,
      })),
      nextCursor: page.nextCursor,
    };
  }

  // ───────────────────────────── helpers ─────────────────────────────

  private async header(executor: Db | Tx, id: number): Promise<HeaderRow> {
    const [row] = await executor.select().from(stocktakes).where(eq(stocktakes.id, id));
    if (row?.kind !== 'PRODUCT') throw notFound('stocktake', id);
    return row;
  }

  private async lockCount(tx: Tx, id: number, strength: 'update' | 'share'): Promise<HeaderRow> {
    const [row] = await tx.select().from(stocktakes).where(eq(stocktakes.id, id)).for(strength);
    if (row?.kind !== 'PRODUCT') throw notFound('stocktake', id);
    return row;
  }

  private async lockState(
    tx: Tx,
    ctx: AuthContext,
    id: number,
    status: HeaderRow['status'],
  ): Promise<HeaderRow> {
    const header = await this.lockCount(tx, id, 'update');
    this.scope.assertCanWriteWarehouse(ctx, header.warehouseId);
    assertState(header, status);
    return header;
  }

  private async line(executor: Db | Tx, id: number, lineId: number): Promise<LineRow> {
    await this.header(executor, id);
    const [row] = await executor
      .select()
      .from(stockCountLines)
      .where(and(eq(stockCountLines.id, lineId), eq(stockCountLines.stocktakeId, id)));
    if (!row) throw notFound('stock count line', lineId);
    return row;
  }

  private async openSession(
    executor: Db | Tx,
    id: number,
    userId: number,
  ): Promise<typeof stockCountSessions.$inferSelect | null> {
    const [row] = await executor
      .select()
      .from(stockCountSessions)
      .where(
        and(
          eq(stockCountSessions.stocktakeId, id),
          eq(stockCountSessions.userId, userId),
          isNull(stockCountSessions.sentAt),
        ),
      );
    return row ?? null;
  }
}

/** A line whose count equals the stock (before the approval) or that posted nothing (after). */
function matchedSql(header: HeaderRow): SQL {
  return header.status === 'APPROVED'
    ? sql`${stockCountLines.differenceQty} = 0`
    : sql`${stockCountLines.countedQty} = ${stockCountLines.expectedQty}`;
}

function keepsRow(
  row: CountSheetRow,
  filter: CountLineFilter,
  moved: ReadonlyMap<number, unknown>,
): boolean {
  switch (filter) {
    case 'ALL':
      return true;
    case 'COUNTED':
      return row.countedQty !== null;
    case 'UNCOUNTED':
      return row.countedQty === null && row.listed;
    case 'DIFFERENT':
      return row.differenceQty !== null && !row.differenceQty.isZero();
    case 'MATCHED':
      return row.differenceQty !== null && row.differenceQty.isZero();
    case 'UNLISTED':
      return !row.listed;
    case 'MOVED':
      return moved.has(row.productId);
  }
}

function sheetTotals(rows: readonly CountSheetRow[]): CountSheetTotals {
  const totals: CountSheetTotals = {
    lines: rows.length,
    counted: 0,
    uncounted: 0,
    unlisted: 0,
    matched: 0,
    different: 0,
    surplusLines: 0,
    surplusQty: ZERO,
    surplusAmount: ZERO,
    shortageLines: 0,
    shortageQty: ZERO,
    shortageAmount: ZERO,
    netQty: ZERO,
    netAmount: ZERO,
    unpriced: 0,
  };
  for (const row of rows) {
    if (row.countedQty !== null) totals.counted += 1;
    else if (row.listed) totals.uncounted += 1;
    if (!row.listed) totals.unlisted += 1;
    const difference = row.differenceQty;
    if (difference === null) continue;
    if (difference.isZero()) {
      totals.matched += 1;
      continue;
    }
    totals.different += 1;
    const amount = row.differenceAmount ?? ZERO;
    if (row.differenceAmount === null) totals.unpriced += 1;
    if (difference.gt(0)) {
      totals.surplusLines += 1;
      totals.surplusQty = totals.surplusQty.plus(difference);
      totals.surplusAmount = totals.surplusAmount.plus(amount);
    } else {
      totals.shortageLines += 1;
      totals.shortageQty = totals.shortageQty.plus(difference);
      totals.shortageAmount = totals.shortageAmount.plus(amount);
    }
    totals.netQty = totals.netQty.plus(difference);
    totals.netAmount = totals.netAmount.plus(amount);
  }
  return totals;
}

/** By main supplier's name (products without one last), then by product name. */
function bySupplierAndName(a: CountSheetRow, b: CountSheetRow): number {
  if (a.supplierName !== b.supplierName) {
    if (a.supplierName === null) return 1;
    if (b.supplierName === null) return -1;
    const bySupplier = a.supplierName.localeCompare(b.supplierName, 'mn');
    if (bySupplier !== 0) return bySupplier;
  }
  return a.name.localeCompare(b.name, 'mn') || a.lineId - b.lineId;
}

export { MANAGE as STOCK_COUNT_MANAGE };
