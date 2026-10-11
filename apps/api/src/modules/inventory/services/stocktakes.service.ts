import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from '@tugeel/shared/money';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
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
} from '../schema';
import { type Movement, StockPostingService } from './stock-posting.service';
import { optionalText } from './support';

type StocktakeRow = typeof stocktakes.$inferSelect;
type StocktakeLineRow = typeof stocktakeLines.$inferSelect;
export type StocktakeStatus = (typeof STOCKTAKE_STATUSES)[number];

const COSTS = 'inventory.costs.manage';
/** Warehouses with shelves; vehicles are counted at trip close (delivery 5). */
const COUNTED_KINDS = ['WHOLESALE', 'STORE'];
const ZERO = new Decimal(0);
const lineKey = (binId: number, productId: number, lotId: number | null) =>
  `${binId}:${productId}:${lotId ?? ''}`;

export interface StocktakeInput {
  warehouseId: number;
  binIds: readonly number[];
  note?: string | null;
}

/** A count in base units; goods not expected on the bin add a line with expected 0. */
export interface CountEntry {
  binId: number;
  productId: number;
  lotId?: number | null;
  countedQty: Decimal;
}

export interface StocktakeLine {
  id: number;
  binId: number;
  binCode: string;
  productId: number;
  productSku: string;
  productName: string;
  lotId: number | null;
  expectedQty: Decimal;
  countedQty: Decimal | null;
  /** counted − expected, once counted. */
  difference: Decimal | null;
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
  binIds: number[];
  lines: StocktakeLine[];
}

/**
 * Stocktakes (ST-, SPEC §6.8): planned per bin range and started on the counting day (owner,
 * 2026-10-11). Starting locks the bins (COUNTING, no movement can touch them) and freezes what they
 * hold; approval posts COUNT_CORRECTION = counted − frozen and frees the bins; cancelling frees them
 * without postings. Counts are in base units and never show a cost. REST and screens come later
 * (cut line #3); the service and its integrity tests are here.
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
    const binIds = [...new Set(input.binIds)].sort((a, b) => a - b);
    if (binIds.length === 0)
      throw invalid('binIds', 'empty', 'a stocktake counts at least one bin');
    const rows = await tx.select().from(bins).where(inArray(bins.id, binIds));
    for (const binId of binIds) {
      const bin = rows.find((row) => row.id === binId);
      if (bin?.warehouseId !== input.warehouseId) {
        throw invalid('binIds', 'warehouse', 'bins of the stocktake’s warehouse');
      }
      if (bin.archivedAt)
        throw new AppError('BIN_ARCHIVED', `bin ${bin.code} is archived`, { code: bin.code });
    }
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
      const held = await tx
        .select({
          binId: binStock.binId,
          productId: binStock.productId,
          lotId: binStock.lotId,
          onHand: binStock.onHand,
        })
        .from(binStock)
        .where(and(inArray(binStock.binId, binIds), sql`${binStock.onHand} > 0`))
        .orderBy(binStock.binId, binStock.productId, binStock.lotId);
      if (held.length > 0) {
        await tx.insert(stocktakeLines).values(
          held.map((row) => ({
            stocktakeId: id,
            binId: row.binId,
            productId: row.productId,
            lotId: row.lotId,
            expectedQty: row.onHand,
          })),
        );
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
        after: { lines: held.length },
      });
      return this.get(id, tx);
    });
  }

  /** Records counts while COUNTING; a repeated count of the same bin and product replaces the last. */
  count(ctx: AuthContext, id: number, entries: readonly CountEntry[]): Promise<StocktakeDetail> {
    return inTransaction(this.db, async (tx) => {
      await this.lockState(tx, ctx, id, 'COUNTING');
      const binIds = new Set(await this.binIdsOf(tx, id));
      const productIds = [...new Set(entries.map((entry) => entry.productId))];
      const known = new Set(
        (await this.catalog.getMany(productIds, tx)).map((product) => product.id),
      );
      for (const entry of entries) {
        if (!binIds.has(entry.binId)) throw invalid('entries', 'bin', 'bins of this stocktake');
        if (!known.has(entry.productId)) throw invalid('entries', 'product', 'existing products');
        if (entry.countedQty.isNegative()) throw invalid('entries', 'min', 'counted quantity ≥ 0');
        await tx.execute(sql`
          INSERT INTO stocktake_lines (stocktake_id, bin_id, product_id, lot_id, expected_qty, counted_qty)
          VALUES (${id}, ${entry.binId}, ${entry.productId}, ${entry.lotId ?? null}, 0, ${entry.countedQty.toFixed()})
          ON CONFLICT ON CONSTRAINT stocktake_lines_key
          DO UPDATE SET counted_qty = excluded.counted_qty, updated_at = now()`);
      }
      await this.touch(tx, id);
      return this.get(id, tx);
    });
  }

  /** COUNTING → REVIEW: every line must be counted (0 for goods not found). */
  review(ctx: AuthContext, id: number): Promise<StocktakeDetail> {
    return inTransaction(this.db, async (tx) => {
      const header = await this.lockState(tx, ctx, id, 'COUNTING');
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
        if (!differenceOf(line).isPositive())
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
        ...(difference.isPositive() && line.unitCost ? { unitCost: line.unitCost } : {}),
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

  /** Any state but APPROVED → CANCELLED; counted bins are freed without postings. */
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

  async get(id: number, executor: Db | Tx = this.db): Promise<StocktakeDetail> {
    const [header] = await executor.select().from(stocktakes).where(eq(stocktakes.id, id));
    if (!header) throw notFound('stocktake', id);
    const binIds = await this.binIdsOf(executor, id);
    const lines = await this.linesOf(executor, id);
    const products = new Map(
      (await this.catalog.getMany([...new Set(lines.map((line) => line.productId))], executor)).map(
        (product) => [product.id, product],
      ),
    );
    const codes = new Map(
      binIds.length === 0
        ? []
        : (
            await executor
              .select({ id: bins.id, code: bins.code })
              .from(bins)
              .where(inArray(bins.id, binIds))
          ).map((bin) => [bin.id, bin.code]),
    );
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
      binIds,
      lines: lines.map((line) => ({
        id: line.id,
        binId: line.binId,
        binCode: codes.get(line.binId) ?? '',
        productId: line.productId,
        productSku: products.get(line.productId)?.sku ?? '',
        productName: products.get(line.productId)?.name ?? '',
        lotId: line.lotId,
        expectedQty: line.expectedQty,
        countedQty: line.countedQty,
        difference: line.countedQty === null ? null : differenceOf(line),
      })),
    };
  }

  // -------------------------------------------------------------------------------------------

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

function differenceOf(line: StocktakeLineRow): Decimal {
  return (line.countedQty ?? line.expectedQty).minus(line.expectedQty);
}
