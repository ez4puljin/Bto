import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from '@tugeel/shared/money';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { invalid } from '../../../common/errors/app-error';
import { AppError } from '../../../common/errors/app-error';
import { JobsService } from '../../../common/jobs/jobs.service';
import { decodeCursor, encodeCursor } from '../../../common/pagination/page';
import { CatalogService } from '../../catalog';
import { AuditService, type AuthContext, OrgService, UserNamesService } from '../../identity';
import { StockQueryService } from '../../inventory';
import {
  type BtoSide,
  compareStock,
  type ErkhetSide,
  type MatchedRow,
  type NotInBtoRow,
  type NotInErkhetRow,
} from '../erxes-stock-compare';
import { ERKHET_LOCATION_NAMES } from '../erxes-wire';
import {
  type ErxesStockFailure,
  type ErxesStockMatchReason,
  type ErxesStockRunStatus,
  erxesStockBalances,
  erxesStockLocations,
  erxesStockProducts,
  erxesStockRuns,
} from '../schema';
import { ErxesSettingsFlowService } from './erxes-settings-flow.service';

type RunRow = typeof erxesStockRuns.$inferSelect;

/** A run whose heartbeat stopped this long ago was interrupted (a restart of the worker). */
export const STOCK_RUN_STALE_MINUTES = 10;
/** Bto's stock read a page at a time for the comparison. */
const BTO_PAGE = 1_000;

export const STOCK_GROUPS = ['MATCHED', 'NOT_IN_BTO', 'NOT_IN_ERKHET'] as const;
export type StockGroup = (typeof STOCK_GROUPS)[number];

export interface ErxesStockRunView {
  id: number;
  status: ErxesStockRunStatus;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  startedBy: string | null;
  products: number;
  batchesTotal: number;
  batchesDone: number;
  batchesFailed: number;
  /** Products whose Erkhet quantity is unknown: a call for them was refused. */
  productsUnread: number;
  /** While it runs: when it should end at the pace so far. */
  estimatedFinishAt: Date | null;
  failure: ErxesStockFailure | null;
  failureDetail: string | null;
}

export interface ErxesStockOverview {
  /** erxes's sign-in is saved and opens. */
  configured: boolean;
  active: ErxesStockRunView | null;
  /** The newest finished run: the one compared. */
  latest: ErxesStockRunView | null;
  /** A run newer than `latest` that failed. */
  failed: ErxesStockRunView | null;
}

export interface ErxesStockLocation {
  code: string;
  name: string | null;
  warehouseId: number | null;
  warehouseName: string | null;
  /** The newest finished run read this location. */
  read: boolean;
}

export interface StockCompareQuery {
  warehouseId: number;
  group?: StockGroup;
  onlyDifferent?: boolean;
  q?: string;
  cursor?: string;
  limit?: number;
}

/** One row of the comparison, whichever group it is in. */
export interface StockCompareRow {
  key: string;
  productId: number | null;
  erxesId: string | null;
  code: string | null;
  name: string | null;
  erxesCodes: string[];
  erxesUom: string | null;
  btoUnit: string | null;
  erkhet: string | null;
  bto: string | null;
  difference: string | null;
  unitDiffers: boolean;
  reason: ErxesStockMatchReason | null;
}

export interface StockCompareResult {
  runId: number | null;
  readAt: Date | null;
  locations: { code: string; name: string | null }[];
  counts: { matched: number; different: number; notInBto: number; notInErkhet: number };
  data: StockCompareRow[];
  nextCursor: string | null;
}

/** The search key of a code or a name: case and spaces aside. */
const keyOf = (text: string | null) => (text ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

function matchedRow(row: MatchedRow): StockCompareRow {
  const uoms = [...new Set(row.erxes.map((entry) => entry.uom).filter(Boolean))];
  return {
    key: `p${row.productId}`,
    productId: row.productId,
    erxesId: row.erxes[0]?.erxesId ?? null,
    code: row.sku,
    name: row.name,
    erxesCodes: row.erxes.map((entry) => entry.code ?? entry.erxesId),
    erxesUom: uoms.join(', ') || null,
    btoUnit: row.btoUnit,
    erkhet: row.erkhet?.toString() ?? null,
    bto: row.bto.toString(),
    difference: row.difference?.toString() ?? null,
    unitDiffers: row.unitDiffers,
    reason: null,
  };
}

function notInBtoRow(row: NotInBtoRow): StockCompareRow {
  return {
    key: `e${row.erxesId}`,
    productId: null,
    erxesId: row.erxesId,
    code: row.code,
    name: row.name,
    erxesCodes: row.code ? [row.code] : [],
    erxesUom: row.uom,
    btoUnit: null,
    erkhet: row.erkhet.toString(),
    bto: null,
    difference: null,
    unitDiffers: false,
    reason: row.reason,
  };
}

function notInErkhetRow(row: NotInErkhetRow): StockCompareRow {
  return {
    key: `p${row.productId}`,
    productId: row.productId,
    erxesId: null,
    code: row.sku,
    name: row.name,
    erxesCodes: [],
    erxesUom: null,
    btoUnit: row.btoUnit,
    erkhet: null,
    bto: row.bto.toString(),
    difference: null,
    unitDiffers: false,
    reason: null,
  };
}

/**
 * «Эрхэтийн үлдэгдэл» (ADR-0221): the runs, the links of Erkhet's locations to Bto's warehouses and
 * the comparison, which is made when the page asks: Erkhet's side is the newest finished run, Bto's
 * is the on-hand of this moment. Nothing here calls erxes or changes stock.
 */
@Injectable()
export class ErxesStockService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly settings: ErxesSettingsFlowService,
    private readonly audit: AuditService,
    private readonly names: UserNamesService,
    private readonly org: OrgService,
    private readonly catalog: CatalogService,
    private readonly stock: StockQueryService,
    private readonly jobs: JobsService,
  ) {}

  async overview(): Promise<ErxesStockOverview> {
    const saved = await this.settings.saved();
    const [newest] = await this.db
      .select()
      .from(erxesStockRuns)
      .orderBy(desc(erxesStockRuns.id))
      .limit(1);
    const [done] = await this.db
      .select()
      .from(erxesStockRuns)
      .where(eq(erxesStockRuns.status, 'DONE'))
      .orderBy(desc(erxesStockRuns.id))
      .limit(1);
    const views = await this.views([newest, done].filter((row): row is RunRow => Boolean(row)));
    const view = (row: RunRow | undefined) =>
      row ? (views.find((entry) => entry.id === row.id) ?? null) : null;
    const newestView = view(newest);
    const active =
      newestView && (newestView.status === 'QUEUED' || newestView.status === 'RUNNING')
        ? newestView
        : null;
    return {
      configured: saved.account !== null,
      active,
      latest: view(done),
      failed:
        newestView?.status === 'FAILED' && (!done || newestView.id > done.id) ? newestView : null,
    };
  }

  /**
   * Starts a run, or answers the one under way. A run whose heartbeat stopped is closed as
   * interrupted first. Without a saved sign-in nothing starts and the overview says so.
   */
  async start(actor: AuthContext): Promise<ErxesStockOverview> {
    const saved = await this.settings.saved();
    if (saved.account === null) return this.overview();
    await inTransaction(this.db, async (tx) => {
      await tx
        .update(erxesStockRuns)
        .set({
          status: 'FAILED',
          failure: 'INTERRUPTED',
          activeSlot: null,
          finishedAt: sql`now()`,
        })
        .where(
          and(
            inArray(erxesStockRuns.status, ['QUEUED', 'RUNNING']),
            sql`coalesce(${erxesStockRuns.heartbeatAt}, ${erxesStockRuns.createdAt}) < now() - make_interval(mins => ${STOCK_RUN_STALE_MINUTES})`,
          ),
        );
      const [created] = await tx
        .insert(erxesStockRuns)
        .values({ status: 'QUEUED', activeSlot: 1, startedBy: actor.userId })
        .onConflictDoNothing()
        .returning({ id: erxesStockRuns.id });
      if (!created) return;
      await this.audit.record(tx, actor, {
        action: 'CREATE',
        entity: 'erxes_stock_runs',
        entityId: created.id,
      });
      await this.jobs.enqueue(
        tx,
        'erxes.stockRead',
        { runId: created.id },
        { singletonKey: `erxes-stock-${created.id}` },
      );
    });
    return this.overview();
  }

  async locations(): Promise<ErxesStockLocation[]> {
    const rows = await this.db.select().from(erxesStockLocations);
    const [done] = await this.db
      .select({ plan: erxesStockRuns.plan })
      .from(erxesStockRuns)
      .where(eq(erxesStockRuns.status, 'DONE'))
      .orderBy(desc(erxesStockRuns.id))
      .limit(1);
    const read = new Set((done?.plan ?? []).flatMap((step) => step.locations));
    const warehouses = new Map((await this.org.listWarehouses()).map((row) => [row.id, row]));
    const byCode = new Map(rows.map((row) => [row.code, row]));
    const codes = [...new Set([...Object.keys(ERKHET_LOCATION_NAMES), ...byCode.keys(), ...read])];
    return codes.sort().map((code) => {
      const row = byCode.get(code);
      const warehouseId = row?.warehouseId ?? null;
      return {
        code,
        name: row?.name ?? ERKHET_LOCATION_NAMES[code] ?? null,
        warehouseId,
        warehouseName: warehouseId === null ? null : (warehouses.get(warehouseId)?.name ?? null),
        read: read.has(code),
      };
    });
  }

  /** Links an Erkhet location to a Bto warehouse, or unlinks it with null. */
  async link(
    actor: AuthContext,
    code: string,
    warehouseId: number | null,
  ): Promise<ErxesStockLocation[]> {
    const known = (await this.locations()).find((location) => location.code === code);
    if (!known) throw new AppError('NOT_FOUND', `erkhet location ${code} not found`, { code });
    if (warehouseId !== null) {
      const warehouse = (await this.org.listWarehouses()).find((row) => row.id === warehouseId);
      if (!warehouse) throw invalid('warehouseId', 'exists', 'no such warehouse');
      if (warehouse.kind === 'TRANSIT' || warehouse.status !== 'ACTIVE') {
        throw invalid('warehouseId', 'isStockWarehouse', 'not an active stock warehouse');
      }
    }
    await inTransaction(this.db, async (tx) => {
      const [before] = await tx
        .select()
        .from(erxesStockLocations)
        .where(eq(erxesStockLocations.code, code))
        .for('update');
      const values = {
        warehouseId,
        linkedBy: actor.userId,
        linkedAt: sql`now()`,
        updatedAt: sql`now()`,
      };
      if (before) {
        await tx.update(erxesStockLocations).set(values).where(eq(erxesStockLocations.code, code));
      } else {
        await tx.insert(erxesStockLocations).values({ code, name: known.name, ...values });
      }
      await this.audit.record(tx, actor, {
        action: 'UPDATE',
        entity: 'erxes_stock_locations',
        entityId: code,
        before: { warehouseId: before?.warehouseId ?? null },
        after: { warehouseId },
      });
    });
    return this.locations();
  }

  /** Erkhet's balances beside Bto's for one warehouse and the Erkhet locations linked to it. */
  async compare(query: StockCompareQuery): Promise<StockCompareResult> {
    const linked = await this.db
      .select({ code: erxesStockLocations.code, name: erxesStockLocations.name })
      .from(erxesStockLocations)
      .where(eq(erxesStockLocations.warehouseId, query.warehouseId))
      .orderBy(erxesStockLocations.code);
    const [run] = await this.db
      .select({ id: erxesStockRuns.id, finishedAt: erxesStockRuns.finishedAt })
      .from(erxesStockRuns)
      .where(eq(erxesStockRuns.status, 'DONE'))
      .orderBy(desc(erxesStockRuns.id))
      .limit(1);
    const empty: StockCompareResult = {
      runId: run?.id ?? null,
      readAt: run?.finishedAt ?? null,
      locations: linked,
      counts: { matched: 0, different: 0, notInBto: 0, notInErkhet: 0 },
      data: [],
      nextCursor: null,
    };
    if (!run || linked.length === 0) return empty;

    const comparison = compareStock(
      ...(await this.sides(
        run.id,
        query.warehouseId,
        linked.map((location) => location.code),
      )),
    );
    const different = comparison.matched.filter(
      (row) => row.difference === null || !row.difference.isZero(),
    );
    const group = query.group ?? 'MATCHED';
    let rows: StockCompareRow[] =
      group === 'NOT_IN_BTO'
        ? comparison.notInBto.map(notInBtoRow)
        : group === 'NOT_IN_ERKHET'
          ? comparison.notInErkhet.map(notInErkhetRow)
          : (query.onlyDifferent ? different : comparison.matched).map(matchedRow);
    const q = keyOf(query.q ?? null);
    if (q !== '') {
      rows = rows.filter((row) =>
        [row.code, row.name, ...row.erxesCodes].some((text) => keyOf(text).includes(q)),
      );
    }
    const after = decodeCursor(query.cursor);
    const offset = typeof after?.offset === 'number' && after.offset > 0 ? after.offset : 0;
    const limit = query.limit ?? 100;
    return {
      ...empty,
      counts: {
        matched: comparison.matched.length,
        different: different.length,
        notInBto: comparison.notInBto.length,
        notInErkhet: comparison.notInErkhet.length,
      },
      data: rows.slice(offset, offset + limit),
      nextCursor: rows.length > offset + limit ? encodeCursor({ offset: offset + limit }) : null,
    };
  }

  // ---------------------------------------------------------------------------------------------

  /**
   * Both sides: the run's products with a balance at the locations, plus those whose Bto product
   * holds stock in the warehouse; Bto's on-hand of all of them, and of every product with stock
   * there.
   */
  private async sides(
    runId: number,
    warehouseId: number,
    locations: string[],
  ): Promise<[ErkhetSide[], Map<number, BtoSide>]> {
    const product = erxesStockProducts;
    const withBalance = await this.db
      .select({
        erxesId: product.erxesId,
        code: product.code,
        name: product.name,
        uom: product.uom,
        productId: product.productId,
        matchReason: product.matchReason,
        readOk: product.readOk,
        quantity: sql<string>`sum(${erxesStockBalances.quantity})::text`,
      })
      .from(product)
      .innerJoin(
        erxesStockBalances,
        and(
          eq(erxesStockBalances.runId, product.runId),
          eq(erxesStockBalances.erxesId, product.erxesId),
        ),
      )
      .where(and(eq(product.runId, runId), inArray(erxesStockBalances.location, locations)))
      .groupBy(product.id);
    const erkhet: ErkhetSide[] = withBalance.map((row) => ({
      ...row,
      quantity: new Decimal(row.quantity),
    }));

    // Bto's products with stock in the warehouse.
    const bto = new Map<number, BtoSide>();
    let cursor: string | undefined;
    do {
      const page = await this.stock.overview({
        warehouseId,
        inStock: true,
        limit: BTO_PAGE,
        ...(cursor ? { cursor } : {}),
      });
      for (const entry of page.data) {
        const here = entry.warehouses.find((balance) => balance.warehouseId === warehouseId);
        bto.set(entry.product.id, {
          productId: entry.product.id,
          sku: entry.product.sku,
          name: entry.product.name,
          unit: entry.product.baseUnit.uomName,
          onHand: here?.onHand ?? new Decimal(0),
        });
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor);

    // The run's products whose Bto product holds stock but which have no Erkhet balance here.
    const seen = new Set(erkhet.map((row) => row.erxesId));
    const stocked = [...bto.keys()];
    if (stocked.length > 0) {
      const zero = await this.db
        .select({
          erxesId: product.erxesId,
          code: product.code,
          name: product.name,
          uom: product.uom,
          productId: product.productId,
          matchReason: product.matchReason,
          readOk: product.readOk,
        })
        .from(product)
        .where(
          and(
            eq(product.runId, runId),
            sql`${product.productId} = ANY(${sql.param(stocked)}::bigint[])`,
          ),
        );
      for (const row of zero) {
        if (!seen.has(row.erxesId)) erkhet.push({ ...row, quantity: new Decimal(0) });
      }
    }

    // Bto's side of matched products that hold no positive stock here (none, or below zero).
    const missing = [
      ...new Set(
        erkhet.flatMap((row) =>
          row.productId !== null && !bto.has(row.productId) ? [row.productId] : [],
        ),
      ),
    ];
    if (missing.length > 0) {
      const balances = await this.stock.balancesOf(missing);
      for (const summary of await this.catalog.getMany(missing)) {
        const here = (balances.get(summary.id) ?? []).find(
          (balance) => balance.warehouseId === warehouseId,
        );
        bto.set(summary.id, {
          productId: summary.id,
          sku: summary.sku,
          name: summary.name,
          unit: summary.baseUnit.uomName,
          onHand: here?.onHand ?? new Decimal(0),
        });
      }
    }
    return [erkhet, bto];
  }

  private async views(rows: RunRow[]): Promise<ErxesStockRunView[]> {
    if (rows.length === 0) return [];
    const users = rows.flatMap((row) => (row.startedBy === null ? [] : [row.startedBy]));
    const names = await this.names.namesOf(users);
    const unread = await this.db
      .select({ runId: erxesStockProducts.runId, count: sql<number>`count(*)::int` })
      .from(erxesStockProducts)
      .where(
        and(
          inArray(
            erxesStockProducts.runId,
            rows.map((row) => row.id),
          ),
          eq(erxesStockProducts.readOk, false),
        ),
      )
      .groupBy(erxesStockProducts.runId);
    const stale = Date.now() - STOCK_RUN_STALE_MINUTES * 60_000;
    return rows.map((row) => {
      const interrupted =
        (row.status === 'QUEUED' || row.status === 'RUNNING') &&
        (row.heartbeatAt ?? row.createdAt).getTime() < stale;
      return {
        id: row.id,
        status: interrupted ? 'FAILED' : row.status,
        createdAt: row.createdAt,
        startedAt: row.startedAt,
        finishedAt: row.finishedAt,
        startedBy: row.startedBy === null ? null : (names.get(row.startedBy) ?? null),
        products: row.products,
        batchesTotal: row.batchesTotal,
        batchesDone: row.batchesDone,
        batchesFailed: row.batchesFailed,
        productsUnread: unread.find((entry) => entry.runId === row.id)?.count ?? 0,
        estimatedFinishAt: interrupted ? null : estimatedFinish(row),
        failure: interrupted ? 'INTERRUPTED' : row.failure,
        failureDetail: row.failureDetail,
      };
    });
  }
}

/** At the pace of the calls done so far, when the rest should be done; null before a pace. */
export function estimatedFinish(
  row: Pick<RunRow, 'status' | 'startedAt' | 'batchesDone' | 'batchesTotal'>,
  now = Date.now(),
): Date | null {
  if (row.status !== 'RUNNING' || !row.startedAt || row.batchesDone === 0) return null;
  if (row.batchesTotal <= row.batchesDone) return new Date(now);
  const spent = now - row.startedAt.getTime();
  const perCall = spent / row.batchesDone;
  return new Date(now + Math.round(perCall * (row.batchesTotal - row.batchesDone)));
}
