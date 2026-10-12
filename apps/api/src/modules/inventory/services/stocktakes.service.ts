import { Inject, Injectable } from '@nestjs/common';
import {
  type BinType,
  isBinCode,
  MAX_STOCKTAKE_BINS,
  MAX_STOCKTAKE_LINES,
  normalizeBinCode,
  USER_BIN_TYPES,
} from '@tugeel/shared/inventory';
import { Decimal } from '@tugeel/shared/money';
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { escapeLike } from '../../../common/db/like';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { DEFAULT_PAGE_LIMIT, decodeCursor, toPage } from '../../../common/pagination/page';
import { CatalogService, UnitConversionService } from '../../catalog';
import {
  type Actor,
  actorUserId,
  type AuthContext,
  AuditService,
  OrgService,
  ScopeService,
} from '../../identity';
import {
  binStock,
  bins,
  STOCKTAKE_STATUSES,
  stocktakeBins,
  stocktakeLines,
  stocktakes,
  warehouseStock,
} from '../schema';
import { type Movement, StockPostingService } from './stock-posting.service';
import { optionalText } from './support';

type StocktakeRow = typeof stocktakes.$inferSelect;
type StocktakeLineRow = typeof stocktakeLines.$inferSelect;
export type StocktakeStatus = (typeof STOCKTAKE_STATUSES)[number];

const COSTS = 'inventory.costs.manage';
const APPROVE = 'inventory.stocktakes.approve';
/** Warehouses with shelves; vehicles are counted at trip close (delivery 5). */
const COUNTED_KINDS = ['WHOLESALE', 'STORE'];
/** «Every bin»: the shelves and the sales floor, never the areas documents pass through. */
const ALL_BIN_TYPES: readonly BinType[] = ['STORAGE', 'PICKING', 'SALESFLOOR'];
// Both well under MAX_MOVEMENTS_PER_POST: one approval posts every difference.
export { MAX_STOCKTAKE_BINS, MAX_STOCKTAKE_LINES };
const ZERO = new Decimal(0);
const lineKey = (binId: number, productId: number, lotId: number | null) =>
  `${binId}:${productId}:${lotId ?? ''}`;

/** Which bins a stocktake counts: exactly one of the three. */
export interface BinSelection {
  binIds?: readonly number[];
  /** The beginning of a shelf code ("A-01"): storage and picking shelves only. */
  prefix?: string;
  /** Every shelf and the sales floor of the warehouse. */
  all?: boolean;
}

export interface StocktakeInput extends BinSelection {
  warehouseId: number;
  note?: string | null;
}

/** A count in base units that replaces the last one; goods not expected add a line with expected 0. */
export interface CountEntry {
  binId: number;
  productId: number;
  countedQty: Decimal;
  /** The count the client showed (null: none yet); a different stored count is a CONFLICT. */
  previousQty?: Decimal | null;
}

/** One scan: adds `qty` of the unit to the line (negative takes a mistaken scan back). */
export interface ScanInput {
  binId: number;
  productUnitId: number;
  qty: Decimal;
}

export interface StocktakeBin {
  id: number;
  code: string;
  type: BinType;
  finishedAt: Date | null;
  /** Frozen and found lines. */
  lineCount: number;
  /** Lines a person counted. */
  countedCount: number;
  /** Lines counted differently from the frozen quantity (not-found lines too, once finished). */
  differenceCount: number;
}

export interface StocktakeLine {
  id: number;
  binId: number;
  binCode: string;
  productId: number;
  productSku: string;
  productName: string;
  baseUnitId: number;
  baseUnitName: string;
  expectedQty: Decimal;
  countedQty: Decimal | null;
  /** NULL with a count of 0: nobody counted it before the bin was finished («not found»). */
  countedAt: Date | null;
  /** counted − expected, once counted. */
  difference: Decimal | null;
  /** Cost per base unit of a surplus, set at approval. */
  unitCost: Decimal | null;
  /** The warehouse average now: what an uncosted surplus will take. */
  avgCost: Decimal | null;
}

export interface StocktakeSummary {
  id: number;
  number: string | null;
  warehouseId: number;
  status: StocktakeStatus;
  note: string | null;
  startedAt: Date | null;
  effectiveDate: string | null;
  postedAt: Date | null;
  createdAt: Date;
  binCount: number;
  finishedBinCount: number;
}

export interface StocktakeDetail {
  id: number;
  number: string | null;
  warehouseId: number;
  status: StocktakeStatus;
  note: string | null;
  startedAt: Date | null;
  effectiveDate: string | null;
  postedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  bins: StocktakeBin[];
  lineCount: number;
  countedCount: number;
  differenceCount: number;
  /** While counting or in review, at the warehouse average: what the differences are worth. */
  shortageValue: Decimal | null;
  surplusValue: Decimal | null;
}

export interface StocktakeLineQuery {
  binId?: number;
  /** Only lines counted differently from the frozen quantity. */
  differences?: boolean;
  /** Only lines a person counted: what counters see (ADR-0038). */
  countedOnly?: boolean;
  cursor?: string;
  limit?: number;
}

export interface ScanResult {
  line: StocktakeLine;
  /** What the scan added, in its unit and in base units (negative for a take-back). */
  added: { qty: Decimal; unitName: string; qtyBase: Decimal };
  bin: StocktakeBin;
}

export interface BinPreview {
  binCount: number;
  /** Bins another stocktake is counting: starting would be refused. */
  countingCount: number;
  firstCode: string | null;
  lastCode: string | null;
}

/**
 * Stocktakes (ST-, SPEC §6.8, ADR-0038): planned per bin range and started on the counting day.
 * Starting locks the bins (COUNTING, no movement can touch them) and freezes what they hold.
 * Counters scan what they find, bin by bin, without seeing the frozen quantities; finishing a bin
 * sets what nobody counted to 0. In review an approver sees the differences, sends bins back for a
 * recount or approves: COUNT_CORRECTION = counted − frozen, and the bins are freed. Cancelling
 * frees them without postings. Counts are in base units and never show a cost.
 */
@Injectable()
export class StocktakesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly catalog: CatalogService,
    private readonly org: OrgService,
    private readonly posting: StockPostingService,
    private readonly scope: ScopeService,
    private readonly units: UnitConversionService,
  ) {}

  async create(ctx: AuthContext, input: StocktakeInput): Promise<StocktakeDetail> {
    this.scope.assertCanWriteWarehouse(ctx, input.warehouseId);
    return inTransaction(this.db, async (tx) => {
      const id = await this.createInTx(tx, ctx, input);
      return this.get(id, tx);
    });
  }

  async createInTx(tx: Tx, actor: Actor, input: StocktakeInput): Promise<number> {
    const warehouse = await this.org.getWarehouse(input.warehouseId, tx);
    if (!COUNTED_KINDS.includes(warehouse.kind)) {
      throw new AppError(
        'WAREHOUSE_KIND_NOT_ALLOWED',
        `no stocktakes in a ${warehouse.kind} warehouse`,
        {
          kind: warehouse.kind,
        },
      );
    }
    const selected = await this.selectBins(tx, input.warehouseId, input);
    const path = selectionPath(input);
    if (selected.length === 0) throw invalid(path, 'empty', 'a stocktake counts at least one bin');
    if (selected.length > MAX_STOCKTAKE_BINS) {
      throw invalid(path, 'max', `at most ${MAX_STOCKTAKE_BINS} bins`);
    }
    const binIds = selected.map((bin) => bin.id).sort((a, b) => a - b);
    const [header] = await tx
      .insert(stocktakes)
      .values({
        warehouseId: input.warehouseId,
        note: optionalText(input.note) ?? null,
        createdBy: actorUserId(actor),
      })
      .returning();
    if (!header) throw new Error('stocktake insert returned no row');
    await tx
      .insert(stocktakeBins)
      .values(binIds.map((binId) => ({ stocktakeId: header.id, binId })));
    await this.audit.record(tx, actor, {
      action: 'CREATE',
      entity: 'stocktakes',
      entityId: header.id,
      after: { ...header, binIds },
    });
    return header.id;
  }

  /** What a selection would count, for the create form; nothing is written. */
  async binPreview(
    ctx: AuthContext,
    warehouseId: number,
    selection: BinSelection,
  ): Promise<BinPreview> {
    this.scope.assertCanWriteWarehouse(ctx, warehouseId);
    const rows = await this.selectBins(this.db, warehouseId, selection);
    return {
      binCount: rows.length,
      countingCount: rows.filter((row) => row.status === 'COUNTING').length,
      firstCode: rows[0]?.code ?? null,
      lastCode: rows.at(-1)?.code ?? null,
    };
  }

  /**
   * DRAFT → COUNTING: locks the bins in id order (a posting holding one finishes first), refuses
   * bins another stocktake is counting, and freezes what each bin holds as the expected quantities.
   */
  start(ctx: AuthContext, id: number): Promise<StocktakeDetail> {
    return inTransaction(this.db, async (tx) => {
      const header = await this.lockState(tx, ctx, id, 'DRAFT');
      const binIds = await this.binIdsOf(tx, id);
      const locked = await tx
        .select({ id: bins.id, code: bins.code, status: bins.status, archivedAt: bins.archivedAt })
        .from(bins)
        .where(inArray(bins.id, binIds))
        .orderBy(bins.id)
        .for('update');
      for (const bin of locked) {
        if (bin.status === 'COUNTING') {
          throw new AppError('BIN_LOCKED_FOR_COUNT', `bin ${bin.code} is being counted`, {
            code: bin.code,
          });
        }
        if (bin.archivedAt)
          throw new AppError('BIN_ARCHIVED', `bin ${bin.code} is archived`, { code: bin.code });
      }
      await tx
        .update(bins)
        .set({ status: 'COUNTING', lockedByStocktakeId: id, updatedAt: sql`now()` })
        .where(inArray(bins.id, binIds));
      // Read after the bin locks: every posting into these bins has committed or will be refused.
      // One INSERT … SELECT, so the number of frozen rows never meets the bind-parameter limit.
      const frozen = await tx.execute(sql`
        INSERT INTO stocktake_lines (stocktake_id, bin_id, product_id, lot_id, expected_qty)
        SELECT ${id}::bigint, bs.bin_id, bs.product_id, bs.lot_id, bs.on_hand
        FROM bin_stock bs
        WHERE bs.bin_id IN (SELECT sb.bin_id FROM stocktake_bins sb WHERE sb.stocktake_id = ${id}::bigint)
          AND bs.on_hand > 0
        ORDER BY bs.bin_id, bs.product_id, bs.lot_id`);
      const lines = frozen.rowCount ?? 0;
      if (lines > MAX_STOCKTAKE_LINES) {
        throw invalid('bins', 'lines', `at most ${MAX_STOCKTAKE_LINES} lines: count fewer bins`);
      }
      await tx
        .update(stocktakes)
        .set({
          status: 'COUNTING',
          startedAt: sql`now()`,
          startedBy: actorUserId(ctx),
          updatedAt: sql`now()`,
        })
        .where(eq(stocktakes.id, id));
      await this.audit.record(tx, ctx, {
        action: 'START',
        entity: 'stocktakes',
        entityId: id,
        before: header,
        after: { lines },
      });
      return this.get(id, tx);
    });
  }

  /**
   * Adds one scan to its line while COUNTING: `COALESCE(counted, 0) + qty` in one statement, so
   * counters scanning the same goods never lose an increment (the header lock orders them too).
   */
  scan(ctx: AuthContext, id: number, input: ScanInput): Promise<ScanResult> {
    if (input.qty.isZero()) throw invalid('qty', 'zero', 'a scan adds or takes back a quantity');
    return inTransaction(this.db, async (tx) => {
      await this.lockState(tx, ctx, id, 'COUNTING');
      await this.assertBinOf(tx, id, input.binId);
      const converted = await this.units.toBase(input.productUnitId, input.qty.abs(), tx);
      const delta = input.qty.isNegative() ? converted.qtyBase.negated() : converted.qtyBase;
      // PostgreSQL checks an upsert's proposed row before its conflict, so a take-back is an
      // UPDATE of the line; a count below zero breaks stocktake_lines_qty (422).
      const result = delta.isNegative()
        ? await tx.execute<{ id: string; inserted: boolean }>(sql`
            UPDATE stocktake_lines
            SET counted_qty = COALESCE(counted_qty, 0) + ${delta.toFixed()}::numeric,
              counted_at = now(), updated_at = now()
            WHERE stocktake_id = ${id} AND bin_id = ${input.binId}
              AND product_id = ${converted.productId} AND lot_id IS NULL
            RETURNING id, false AS inserted`)
        : await tx.execute<{ id: string; inserted: boolean }>(sql`
            INSERT INTO stocktake_lines
              (stocktake_id, bin_id, product_id, lot_id, expected_qty, counted_qty, counted_at)
            VALUES (${id}, ${input.binId}, ${converted.productId}, NULL, 0, ${delta.toFixed()}, now())
            ON CONFLICT ON CONSTRAINT stocktake_lines_key
            DO UPDATE SET counted_qty = COALESCE(stocktake_lines.counted_qty, 0) + excluded.counted_qty,
              counted_at = now(), updated_at = now()
            RETURNING id, (xmax = 0) AS inserted`);
      const [row] = result.rows;
      if (!row) throw invalid('qty', 'min', 'nothing counted here to take back');
      if (row.inserted) await this.assertLineCap(tx, id);
      await this.touch(tx, id);
      const [line] = await this.linesById(tx, [Number.parseInt(row.id, 10)]);
      const unit = (await this.units.describe([input.productUnitId], tx)).get(input.productUnitId);
      const [bin] = await this.binsOf(tx, id, input.binId);
      if (!line || !unit || !bin) throw new Error(`stocktake ${id} lost the scanned line`);
      return { line, added: { qty: input.qty, unitName: unit.uomName, qtyBase: delta }, bin };
    });
  }

  /**
   * Sets counts while COUNTING; a repeated count of the same bin and product replaces the last.
   * With `previousQty`, a count someone else changed meanwhile is refused (CONFLICT).
   */
  count(ctx: AuthContext, id: number, entries: readonly CountEntry[]): Promise<StocktakeLine[]> {
    return inTransaction(this.db, async (tx) => {
      await this.lockState(tx, ctx, id, 'COUNTING');
      const binIds = new Set(await this.binIdsOf(tx, id));
      const productIds = [...new Set(entries.map((entry) => entry.productId))];
      const known = new Set(
        (await this.catalog.getMany(productIds, tx)).map((product) => product.id),
      );
      const lineIds: number[] = [];
      for (const entry of entries) {
        if (!binIds.has(entry.binId)) throw invalid('entries', 'bin', 'bins of this stocktake');
        if (!known.has(entry.productId)) throw invalid('entries', 'product', 'existing products');
        if (entry.countedQty.isNegative()) throw invalid('entries', 'min', 'counted quantity ≥ 0');
        const guard =
          entry.previousQty === undefined
            ? sql``
            : sql` WHERE stocktake_lines.counted_qty IS NOT DISTINCT FROM ${
                entry.previousQty === null ? null : entry.previousQty.toFixed()
              }::numeric`;
        const result = await tx.execute<{ id: string; inserted: boolean }>(sql`
          INSERT INTO stocktake_lines
            (stocktake_id, bin_id, product_id, lot_id, expected_qty, counted_qty, counted_at)
          VALUES (${id}, ${entry.binId}, ${entry.productId}, NULL, 0, ${entry.countedQty.toFixed()}, now())
          ON CONFLICT ON CONSTRAINT stocktake_lines_key
          DO UPDATE SET counted_qty = excluded.counted_qty, counted_at = now(), updated_at = now()${guard}
          RETURNING id, (xmax = 0) AS inserted`);
        const [row] = result.rows;
        if (!row) {
          throw new AppError('CONFLICT', 'the count changed meanwhile', {
            binId: entry.binId,
            productId: entry.productId,
          });
        }
        if (row.inserted) await this.assertLineCap(tx, id);
        lineIds.push(Number.parseInt(row.id, 10));
      }
      await this.touch(tx, id);
      return this.linesById(tx, lineIds);
    });
  }

  /**
   * A counter is done with a bin: what nobody counted there is 0 («not found», `counted_at` stays
   * NULL) and the bin is marked. Scans may still add to it afterwards.
   */
  finishBin(ctx: AuthContext, id: number, binId: number): Promise<StocktakeBin> {
    return inTransaction(this.db, async (tx) => {
      await this.lockState(tx, ctx, id, 'COUNTING');
      await this.assertBinOf(tx, id, binId);
      const missing = await tx
        .update(stocktakeLines)
        .set({ countedQty: ZERO, updatedAt: sql`now()` })
        .where(
          and(
            eq(stocktakeLines.stocktakeId, id),
            eq(stocktakeLines.binId, binId),
            isNull(stocktakeLines.countedQty),
          ),
        )
        .returning({ id: stocktakeLines.id });
      const finished = await tx
        .update(stocktakeBins)
        .set({ finishedAt: sql`now()`, finishedBy: actorUserId(ctx) })
        .where(
          and(
            eq(stocktakeBins.stocktakeId, id),
            eq(stocktakeBins.binId, binId),
            isNull(stocktakeBins.finishedAt),
          ),
        )
        .returning({ binId: stocktakeBins.binId });
      if (finished.length > 0 || missing.length > 0) {
        await this.audit.record(tx, ctx, {
          action: 'UPDATE',
          entity: 'stocktakes',
          entityId: id,
          after: { binId, finished: true, notFound: missing.length },
        });
        await this.touch(tx, id);
      }
      const [bin] = await this.binsOf(tx, id, binId);
      if (!bin) throw new Error(`stocktake ${id} lost bin ${binId}`);
      return bin;
    });
  }

  /** COUNTING → REVIEW: every bin must be finished, so every line has a count. */
  review(ctx: AuthContext, id: number): Promise<StocktakeDetail> {
    return inTransaction(this.db, async (tx) => {
      const header = await this.lockState(tx, ctx, id, 'COUNTING');
      const [open] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(stocktakeBins)
        .where(and(eq(stocktakeBins.stocktakeId, id), isNull(stocktakeBins.finishedAt)));
      const unfinished = open?.count ?? 0;
      if (unfinished > 0) {
        throw new AppError('STOCKTAKE_BINS_UNFINISHED', `${unfinished} bins are not finished`, {
          unfinished,
        });
      }
      const uncounted = await tx
        .select({ id: stocktakeLines.id })
        .from(stocktakeLines)
        .where(and(eq(stocktakeLines.stocktakeId, id), isNull(stocktakeLines.countedQty)))
        .limit(1);
      if (uncounted.length > 0) throw invalid('lines', 'uncounted', 'every line needs a count');
      await tx
        .update(stocktakes)
        .set({ status: 'REVIEW', updatedAt: sql`now()` })
        .where(eq(stocktakes.id, id));
      await this.audit.record(tx, ctx, {
        action: 'REVIEW',
        entity: 'stocktakes',
        entityId: id,
        before: header,
      });
      return this.get(id, tx);
    });
  }

  /**
   * REVIEW → COUNTING by an approver: the chosen bins lose their counts (found lines go, frozen
   * lines are uncounted again) and are counted anew. The bins stay locked and frozen throughout.
   */
  recount(ctx: AuthContext, id: number, binIds: readonly number[]): Promise<StocktakeDetail> {
    return inTransaction(this.db, async (tx) => {
      const header = await this.lockState(tx, ctx, id, 'REVIEW');
      const own = new Set(await this.binIdsOf(tx, id));
      const chosen = [...new Set(binIds)].sort((a, b) => a - b);
      if (chosen.length === 0) throw invalid('binIds', 'empty', 'choose the bins to count again');
      if (chosen.some((binId) => !own.has(binId))) {
        throw invalid('binIds', 'bin', 'bins of this stocktake');
      }
      const counts = await tx
        .select({
          id: stocktakeLines.id,
          binId: stocktakeLines.binId,
          productId: stocktakeLines.productId,
          expectedQty: stocktakeLines.expectedQty,
          countedQty: stocktakeLines.countedQty,
        })
        .from(stocktakeLines)
        .where(and(eq(stocktakeLines.stocktakeId, id), inArray(stocktakeLines.binId, chosen)))
        .orderBy(stocktakeLines.id);
      await tx
        .delete(stocktakeLines)
        .where(
          and(
            eq(stocktakeLines.stocktakeId, id),
            inArray(stocktakeLines.binId, chosen),
            sql`${stocktakeLines.expectedQty} = 0`,
          ),
        );
      await tx
        .update(stocktakeLines)
        .set({ countedQty: null, countedAt: null, updatedAt: sql`now()` })
        .where(and(eq(stocktakeLines.stocktakeId, id), inArray(stocktakeLines.binId, chosen)));
      await tx
        .update(stocktakeBins)
        .set({ finishedAt: null, finishedBy: null })
        .where(and(eq(stocktakeBins.stocktakeId, id), inArray(stocktakeBins.binId, chosen)));
      await tx
        .update(stocktakes)
        .set({ status: 'COUNTING', updatedAt: sql`now()` })
        .where(eq(stocktakes.id, id));
      await this.audit.record(tx, ctx, {
        action: 'RETURN',
        entity: 'stocktakes',
        entityId: id,
        before: { ...header, recount: chosen, counts },
        after: { status: 'COUNTING' },
      });
      return this.get(id, tx);
    });
  }

  /**
   * REVIEW → APPROVED by an approver: frees the bins and posts the differences. Surpluses take the
   * given costs (cost holders only), else the average.
   */
  async approve(
    ctx: AuthContext,
    id: number,
    costs: readonly { lineId: number; unitCost: Decimal }[] = [],
  ): Promise<StocktakeDetail> {
    if (costs.length > 0 && !ctx.permissions.has(COSTS)) {
      throw new AppError('FORBIDDEN', 'costs are set by cost holders', { permission: COSTS });
    }
    return inTransaction(this.db, async (tx) => {
      const header = await this.lockHeader(tx, id);
      this.scope.assertCanWriteWarehouse(ctx, header.warehouseId);
      await this.approveInTx(tx, ctx, id, costs);
      return this.get(id, tx);
    });
  }

  async approveInTx(
    tx: Tx,
    actor: Actor,
    id: number,
    costs: readonly { lineId: number; unitCost: Decimal }[] = [],
  ): Promise<void> {
    const header = await this.lockHeader(tx, id);
    assertState(header, 'REVIEW');
    const binIds = await this.binIdsOf(tx, id);
    await this.lockBins(tx, binIds);
    let lines = await this.linesOf(tx, id);
    await this.assertFrozen(tx, binIds, lines);

    if (costs.length > 0) {
      const byId = new Map(lines.map((line) => [line.id, line]));
      for (const cost of costs) {
        const line = byId.get(cost.lineId);
        if (!line) throw invalid('costs', 'line', 'lines of this stocktake');
        if (!differenceOf(line).gt(0))
          throw invalid('costs', 'surplus', 'only surpluses take a cost');
        await tx
          .update(stocktakeLines)
          .set({ unitCost: cost.unitCost, updatedAt: sql`now()` })
          .where(eq(stocktakeLines.id, cost.lineId));
      }
      lines = await this.linesOf(tx, id);
    }

    await tx
      .update(bins)
      .set({ status: 'ACTIVE', lockedByStocktakeId: null, updatedAt: sql`now()` })
      .where(eq(bins.lockedByStocktakeId, id));
    const changed = lines.filter((line) => !differenceOf(line).isZero());
    const baseUnits = await this.units.baseUnits(
      [...new Set(changed.map((line) => line.productId))],
      tx,
    );
    const movements: Movement[] = changed.map((line) => {
      const difference = differenceOf(line);
      const unit = baseUnits.get(line.productId);
      if (!unit) throw new Error(`product ${line.productId} has no base unit`);
      return {
        docType: 'ST',
        docId: id,
        docLineId: line.id,
        movementType: 'COUNT_CORRECTION',
        leg: 1,
        warehouseId: header.warehouseId,
        binId: line.binId,
        productId: line.productId,
        lotId: line.lotId,
        qtyBase: difference,
        enteredQty: difference.abs(),
        productUnitId: unit.unitId,
        factorSnapshot: unit.factorToBase,
        ...(difference.gt(0) && line.unitCost ? { unitCost: line.unitCost } : {}),
      };
    });
    const result = await this.posting.post(tx, actor, {
      docs: [{ docType: 'ST', docId: id, expectedStatus: 'REVIEW', nextStatus: 'APPROVED' }],
      movements,
    });
    await this.audit.record(tx, actor, {
      action: 'POST',
      entity: 'stocktakes',
      entityId: id,
      before: header,
      after: { number: result.numbers.get(id), corrections: movements.length },
    });
  }

  /**
   * Any state but APPROVED → CANCELLED; counted bins are freed without postings. A stocktake in
   * review is cancelled by an approver only: its differences are already known.
   */
  cancel(ctx: AuthContext, id: number): Promise<StocktakeDetail> {
    return inTransaction(this.db, async (tx) => {
      const header = await this.lockHeader(tx, id);
      this.scope.assertCanWriteWarehouse(ctx, header.warehouseId);
      if (header.status === 'APPROVED') {
        throw new AppError('DOC_ALREADY_POSTED', `stocktake ${id} is approved`, {
          status: header.status,
        });
      }
      if (header.status === 'CANCELLED') return this.get(id, tx);
      if (header.status === 'REVIEW' && !ctx.permissions.has(APPROVE)) {
        throw new AppError('FORBIDDEN', 'a stocktake in review is cancelled by an approver', {
          permission: APPROVE,
        });
      }
      if (header.status !== 'DRAFT') {
        await this.lockBins(tx, await this.binIdsOf(tx, id));
        await tx
          .update(bins)
          .set({ status: 'ACTIVE', lockedByStocktakeId: null, updatedAt: sql`now()` })
          .where(eq(bins.lockedByStocktakeId, id));
      }
      await tx
        .update(stocktakes)
        .set({ status: 'CANCELLED', updatedAt: sql`now()` })
        .where(eq(stocktakes.id, id));
      await this.audit.record(tx, ctx, {
        action: 'CANCEL',
        entity: 'stocktakes',
        entityId: id,
        before: header,
      });
      return this.get(id, tx);
    });
  }

  async list(query: {
    warehouseId?: number;
    status?: StocktakeStatus;
    cursor?: string;
    limit?: number;
  }): Promise<{ data: StocktakeSummary[]; nextCursor: string | null }> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const filters: SQL[] = [];
    if (query.warehouseId) filters.push(eq(stocktakes.warehouseId, query.warehouseId));
    if (query.status) filters.push(eq(stocktakes.status, query.status));
    const after = decodeCursor(query.cursor);
    if (typeof after?.id === 'number') filters.push(lt(stocktakes.id, after.id));
    const rows = await this.db
      .select({
        id: stocktakes.id,
        number: stocktakes.number,
        warehouseId: stocktakes.warehouseId,
        status: stocktakes.status,
        note: stocktakes.note,
        startedAt: stocktakes.startedAt,
        effectiveDate: stocktakes.effectiveDate,
        postedAt: stocktakes.postedAt,
        createdAt: stocktakes.createdAt,
        // Spelled out: a single-table select leaves columns unqualified (see ReceiptsService.list).
        binCount: sql<number>`(SELECT count(*)::int FROM stocktake_bins sb WHERE sb.stocktake_id = stocktakes.id)`,
        finishedBinCount: sql<number>`(SELECT count(*)::int FROM stocktake_bins sb
          WHERE sb.stocktake_id = stocktakes.id AND sb.finished_at IS NOT NULL)`,
      })
      .from(stocktakes)
      .where(and(...filters))
      .orderBy(desc(stocktakes.id))
      .limit(limit + 1);
    return toPage(rows, limit, (row) => ({ id: row.id }));
  }

  /** The header, its bins with their progress and, while open, what the differences are worth. */
  async get(id: number, executor: Db | Tx = this.db): Promise<StocktakeDetail> {
    const [header] = await executor.select().from(stocktakes).where(eq(stocktakes.id, id));
    if (!header) throw notFound('stocktake', id);
    const binRows = await this.binsOf(executor, id);
    const open = header.status === 'COUNTING' || header.status === 'REVIEW';
    const [values] = open
      ? await executor
          .select({
            shortage: sql<string>`COALESCE(sum(round(
              (${stocktakeLines.expectedQty} - ${stocktakeLines.countedQty}) * COALESCE(${warehouseStock.avgCost}, 0), 2))
              FILTER (WHERE ${stocktakeLines.countedQty} < ${stocktakeLines.expectedQty}), 0)`,
            surplus: sql<string>`COALESCE(sum(round(
              (${stocktakeLines.countedQty} - ${stocktakeLines.expectedQty})
                * COALESCE(${stocktakeLines.unitCost}, ${warehouseStock.avgCost}, 0), 2))
              FILTER (WHERE ${stocktakeLines.countedQty} > ${stocktakeLines.expectedQty}), 0)`,
          })
          .from(stocktakeLines)
          .leftJoin(warehouseStock, this.averageOf(header.warehouseId))
          .where(eq(stocktakeLines.stocktakeId, id))
      : [];
    const sum = (pick: (bin: StocktakeBin) => number) =>
      binRows.reduce((total, bin) => total + pick(bin), 0);
    return {
      id: header.id,
      number: header.number,
      warehouseId: header.warehouseId,
      status: header.status,
      note: header.note,
      startedAt: header.startedAt,
      effectiveDate: header.effectiveDate,
      postedAt: header.postedAt,
      createdAt: header.createdAt,
      updatedAt: header.updatedAt,
      bins: binRows,
      lineCount: sum((bin) => bin.lineCount),
      countedCount: sum((bin) => bin.countedCount),
      differenceCount: sum((bin) => bin.differenceCount),
      shortageValue: values ? new Decimal(values.shortage) : null,
      surplusValue: values ? new Decimal(values.surplus) : null,
    };
  }

  /** Lines in bin order, a page at a time; counters ask with `countedOnly` (ADR-0038). */
  async lines(
    id: number,
    query: StocktakeLineQuery = {},
  ): Promise<{ data: StocktakeLine[]; nextCursor: string | null }> {
    const [header] = await this.db
      .select({ id: stocktakes.id })
      .from(stocktakes)
      .where(eq(stocktakes.id, id));
    if (!header) throw notFound('stocktake', id);
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const filters: SQL[] = [eq(stocktakeLines.stocktakeId, id)];
    if (query.binId) filters.push(eq(stocktakeLines.binId, query.binId));
    if (query.countedOnly) filters.push(isNotNull(stocktakeLines.countedAt));
    if (query.differences) {
      filters.push(sql`${stocktakeLines.countedQty} <> ${stocktakeLines.expectedQty}`);
    }
    const after = decodeCursor(query.cursor);
    if (typeof after?.binId === 'number' && typeof after.id === 'number') {
      const keyset = or(
        gt(stocktakeLines.binId, after.binId),
        and(eq(stocktakeLines.binId, after.binId), gt(stocktakeLines.id, after.id)),
      );
      if (keyset) filters.push(keyset);
    }
    const rows = await this.lineViews(this.db, filters, limit + 1);
    return toPage(rows, limit, (row) => ({ binId: row.binId, id: row.id }));
  }

  // -------------------------------------------------------------------------------------------

  /** The bins of a selection in code order: at most one more than MAX_STOCKTAKE_BINS. */
  private async selectBins(executor: Db | Tx, warehouseId: number, selection: BinSelection) {
    const given = [
      selection.binIds !== undefined,
      selection.prefix !== undefined,
      selection.all === true,
    ].filter(Boolean).length;
    if (given !== 1) throw invalid('bins', 'oneOf', 'give exactly one of binIds, prefix or all');
    const columns = {
      id: bins.id,
      code: bins.code,
      status: bins.status,
      warehouseId: bins.warehouseId,
      archivedAt: bins.archivedAt,
    };
    if (selection.binIds !== undefined) {
      const binIds = [...new Set(selection.binIds)];
      if (binIds.length === 0) return [];
      if (binIds.length > MAX_STOCKTAKE_BINS) {
        throw invalid('binIds', 'max', `at most ${MAX_STOCKTAKE_BINS} bins`);
      }
      const rows = await executor
        .select(columns)
        .from(bins)
        .where(inArray(bins.id, binIds))
        .orderBy(asc(bins.code), asc(bins.id));
      for (const binId of binIds) {
        const bin = rows.find((row) => row.id === binId);
        if (bin?.warehouseId !== warehouseId) {
          throw invalid('binIds', 'warehouse', 'bins of the stocktake’s warehouse');
        }
        if (bin.archivedAt)
          throw new AppError('BIN_ARCHIVED', `bin ${bin.code} is archived`, { code: bin.code });
      }
      return rows;
    }
    const filters: SQL[] = [eq(bins.warehouseId, warehouseId), isNull(bins.archivedAt)];
    if (selection.prefix !== undefined) {
      const prefix = normalizeBinCode(selection.prefix);
      if (!prefix || !isBinCode(prefix)) {
        throw invalid('prefix', 'format', 'the beginning of a shelf code');
      }
      filters.push(
        inArray(bins.type, [...USER_BIN_TYPES]),
        like(bins.code, `${escapeLike(prefix)}%`),
      );
    } else {
      filters.push(inArray(bins.type, [...ALL_BIN_TYPES]));
    }
    return executor
      .select(columns)
      .from(bins)
      .where(and(...filters))
      .orderBy(asc(bins.code), asc(bins.id))
      .limit(MAX_STOCKTAKE_BINS + 1);
  }

  /** Bins with their progress, in code order; one bin with `binId`. */
  private async binsOf(executor: Db | Tx, id: number, binId?: number): Promise<StocktakeBin[]> {
    const filters: SQL[] = [eq(stocktakeBins.stocktakeId, id)];
    if (binId !== undefined) filters.push(eq(stocktakeBins.binId, binId));
    return executor
      .select({
        id: bins.id,
        code: bins.code,
        type: bins.type,
        finishedAt: stocktakeBins.finishedAt,
        lineCount: sql<number>`count(${stocktakeLines.id})::int`,
        countedCount: sql<number>`count(${stocktakeLines.countedAt})::int`,
        differenceCount: sql<number>`(count(*) FILTER (
          WHERE ${stocktakeLines.countedQty} <> ${stocktakeLines.expectedQty}))::int`,
      })
      .from(stocktakeBins)
      .innerJoin(bins, eq(bins.id, stocktakeBins.binId))
      .leftJoin(
        stocktakeLines,
        and(
          eq(stocktakeLines.stocktakeId, stocktakeBins.stocktakeId),
          eq(stocktakeLines.binId, stocktakeBins.binId),
        ),
      )
      .where(and(...filters))
      .groupBy(bins.id, bins.code, bins.type, stocktakeBins.finishedAt)
      .orderBy(asc(bins.code), asc(bins.id));
  }

  private async linesById(executor: Db | Tx, ids: readonly number[]): Promise<StocktakeLine[]> {
    if (ids.length === 0) return [];
    return this.lineViews(executor, [inArray(stocktakeLines.id, [...ids])], ids.length);
  }

  /** Lines with their bin code, product, base unit and the warehouse average. */
  private async lineViews(
    executor: Db | Tx,
    filters: SQL[],
    limit: number,
  ): Promise<StocktakeLine[]> {
    const rows = await executor
      .select({
        id: stocktakeLines.id,
        binId: stocktakeLines.binId,
        binCode: bins.code,
        productId: stocktakeLines.productId,
        expectedQty: stocktakeLines.expectedQty,
        countedQty: stocktakeLines.countedQty,
        countedAt: stocktakeLines.countedAt,
        unitCost: stocktakeLines.unitCost,
        avgCost: warehouseStock.avgCost,
      })
      .from(stocktakeLines)
      .innerJoin(stocktakes, eq(stocktakes.id, stocktakeLines.stocktakeId))
      .innerJoin(bins, eq(bins.id, stocktakeLines.binId))
      .leftJoin(warehouseStock, this.averageOf(stocktakes.warehouseId))
      .where(and(...filters))
      .orderBy(asc(stocktakeLines.binId), asc(stocktakeLines.id))
      .limit(limit);
    const products = new Map(
      (await this.catalog.getMany([...new Set(rows.map((row) => row.productId))], executor)).map(
        (product) => [product.id, product],
      ),
    );
    return rows.map((row) => {
      const product = products.get(row.productId);
      return {
        ...row,
        productSku: product?.sku ?? '',
        productName: product?.name ?? '',
        baseUnitId: product?.baseUnit.id ?? 0,
        baseUnitName: product?.baseUnit.uomName ?? '',
        difference: row.countedQty === null ? null : row.countedQty.minus(row.expectedQty),
      };
    });
  }

  /** The join to a line's warehouse balance, for its average cost. */
  private averageOf(warehouseId: number | typeof stocktakes.warehouseId): SQL | undefined {
    return and(
      eq(warehouseStock.warehouseId, warehouseId),
      eq(warehouseStock.productId, stocktakeLines.productId),
      sql`${warehouseStock.lotId} IS NOT DISTINCT FROM ${stocktakeLines.lotId}`,
    );
  }

  private async assertBinOf(executor: Db | Tx, id: number, binId: number): Promise<void> {
    const [row] = await executor
      .select({ binId: stocktakeBins.binId })
      .from(stocktakeBins)
      .where(and(eq(stocktakeBins.stocktakeId, id), eq(stocktakeBins.binId, binId)));
    if (!row) throw invalid('binId', 'bin', 'bins of this stocktake');
  }

  /** Found goods add lines: refuse the one past MAX_STOCKTAKE_LINES. */
  private async assertLineCap(tx: Tx, id: number): Promise<void> {
    const [row] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(stocktakeLines)
      .where(eq(stocktakeLines.stocktakeId, id));
    if ((row?.count ?? 0) > MAX_STOCKTAKE_LINES) {
      throw invalid('lines', 'max', `at most ${MAX_STOCKTAKE_LINES} lines`);
    }
  }

  private async binIdsOf(executor: Db | Tx, id: number): Promise<number[]> {
    const rows = await executor
      .select({ binId: stocktakeBins.binId })
      .from(stocktakeBins)
      .where(eq(stocktakeBins.stocktakeId, id))
      .orderBy(stocktakeBins.binId);
    return rows.map((row) => row.binId);
  }

  private async linesOf(executor: Db | Tx, id: number): Promise<StocktakeLineRow[]> {
    return executor
      .select()
      .from(stocktakeLines)
      .where(eq(stocktakeLines.stocktakeId, id))
      .orderBy(stocktakeLines.id);
  }

  private async lockBins(tx: Tx, binIds: readonly number[]): Promise<void> {
    if (binIds.length === 0) return;
    await tx
      .select({ id: bins.id })
      .from(bins)
      .where(inArray(bins.id, [...binIds]))
      .orderBy(bins.id)
      .for('update');
  }

  /**
   * The frozen quantities must still be what the bins hold: no posting can touch a COUNTING bin, so
   * a difference means the caches were changed behind the ledger's back (e.g. a rebuild).
   */
  private async assertFrozen(
    tx: Tx,
    binIds: readonly number[],
    lines: readonly StocktakeLineRow[],
  ): Promise<void> {
    const held = await tx
      .select({
        binId: binStock.binId,
        productId: binStock.productId,
        lotId: binStock.lotId,
        onHand: binStock.onHand,
      })
      .from(binStock)
      .where(inArray(binStock.binId, [...binIds]));
    const expected = new Map(
      lines.map((line) => [lineKey(line.binId, line.productId, line.lotId), line.expectedQty]),
    );
    const keys = new Set([
      ...expected.keys(),
      ...held.map((row) => lineKey(row.binId, row.productId, row.lotId)),
    ]);
    const actual = new Map(
      held.map((row) => [lineKey(row.binId, row.productId, row.lotId), row.onHand]),
    );
    for (const key of keys) {
      if (!(expected.get(key) ?? ZERO).equals(actual.get(key) ?? ZERO)) {
        throw new AppError('CONFLICT', `bin stock changed during the count (${key})`, { key });
      }
    }
  }

  private async lockHeader(tx: Tx, id: number): Promise<StocktakeRow> {
    const [row] = await tx.select().from(stocktakes).where(eq(stocktakes.id, id)).for('update');
    if (!row) throw notFound('stocktake', id);
    return row;
  }

  private async lockState(
    tx: Tx,
    ctx: AuthContext,
    id: number,
    status: StocktakeStatus,
  ): Promise<StocktakeRow> {
    const header = await this.lockHeader(tx, id);
    this.scope.assertCanWriteWarehouse(ctx, header.warehouseId);
    assertState(header, status);
    return header;
  }

  private async touch(tx: Tx, id: number): Promise<void> {
    await tx
      .update(stocktakes)
      .set({ updatedAt: sql`now()` })
      .where(eq(stocktakes.id, id));
  }
}

function assertState(header: StocktakeRow, status: StocktakeStatus): void {
  if (header.status === 'APPROVED') {
    throw new AppError('DOC_ALREADY_POSTED', `stocktake ${header.id} is approved`, {
      status: header.status,
    });
  }
  if (header.status !== status) {
    throw new AppError('DOC_STATE_INVALID', `stocktake ${header.id} is ${header.status}`, {
      status: header.status,
    });
  }
}

/** The request field a selection error points at. */
function selectionPath(selection: BinSelection): string {
  if (selection.binIds !== undefined) return 'binIds';
  return selection.prefix !== undefined ? 'prefix' : 'all';
}

function differenceOf(line: StocktakeLineRow): Decimal {
  return (line.countedQty ?? line.expectedQty).minus(line.expectedQty);
}
