import { Inject, Injectable } from '@nestjs/common';
import {
  averageAfterWithdrawal,
  formatDocNumber,
  MOVEMENT_TYPES,
  type MovementType,
  reaverage,
  revalue as revalueCost,
  type StockDocType,
  valueOf,
} from '@tugeel/shared/inventory';
import { Decimal } from '@tugeel/shared/money';
import { businessDate, businessYear } from '@tugeel/shared/time';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid } from '../../../common/errors/app-error';
import { databaseErrorOf } from '../../../common/errors/problem-details';
import { type Actor, actorUserId, NumberingService } from '../../identity';
import { stockLedger, stockValuationAdjustments } from '../ledger.schema';
import {
  adjustments,
  binMoves,
  goodsReceipts,
  reconciliationRuns,
  stocktakes,
  transfers,
} from '../schema';

/** Inventory's own stock documents; other modules guard their documents themselves (ADR-0034 #5). */
export type PostedDocType = Extract<StockDocType, 'GR' | 'BM' | 'TR' | 'ADJ' | 'ST'>;

export interface PostingDoc {
  docType: PostedDocType;
  docId: number;
  expectedStatus: string;
  nextStatus: string;
  /**
   * Default true. A requested transfer already has its number, so its shipping and receiving post
   * without a new one (ADR-0035 #3, #7).
   */
  allocateNumber?: boolean;
}

/** One posting writes at most this many movements (ADR-0035 #7); callers split larger documents. */
export const MAX_MOVEMENTS_PER_POST = 15_000;

export interface Movement {
  docType: StockDocType;
  docId: number;
  docLineId: number;
  movementType: MovementType;
  leg: number;
  warehouseId: number;
  binId: number;
  productId: number;
  lotId?: number | null;
  /** Signed base quantity: negative leaves the bin. */
  qtyBase: Decimal;
  /** Quantity as entered in its unit, positive. */
  enteredQty: Decimal;
  productUnitId: number;
  factorSnapshot: Decimal;
  /**
   * Inbound only: cost per base unit (positive adjustments and counts). Omitted: the cost of the
   * paired outbound leg of the same line, else the warehouse's current average.
   */
  unitCost?: Decimal;
}

export interface PostingResult {
  postedAt: Date;
  effectiveDate: string;
  /** Number given to each document, by document id. */
  numbers: Map<number, string>;
  /** Cost of each ledger row by `${docLineId}:${movementType}:${leg}`. */
  unitCosts: Map<string, Decimal>;
}

export interface CostedLine {
  docLineId: number;
  warehouseId: number;
  productId: number;
  lotId?: number | null;
  qtyBase: Decimal;
  amount: Decimal;
  freeGoods: boolean;
}

export interface Valuation {
  docLineId: number;
  version: number;
  amount: Decimal;
  freeGoods: boolean;
  valueBefore: Decimal;
  valueDelta: Decimal;
  absorbed: Decimal;
  variance: Decimal;
  avgBefore: Decimal;
  avgAfter: Decimal;
  postedAt: Date;
}

export interface ReconciliationDiff {
  level: 'BIN' | 'WAREHOUSE' | 'SELLABLE';
  warehouseId: number;
  binId: number | null;
  productId: number;
  lotId: number | null;
  ledger: string;
  cache: string;
}

export interface ReconciliationRun {
  id: number;
  status: 'OK' | 'DRIFT';
  diffCount: number;
  diffs: ReconciliationDiff[];
  snapshotDate: string;
}

interface WarehouseRow {
  id: number;
  warehouseId: number;
  productId: number;
  lotId: number | null;
  onHand: Decimal;
  sellableOnHand: Decimal;
  avgCost: Decimal;
}

interface BinRow {
  id: number;
  warehouseId: number;
  binId: number;
  productId: number;
  lotId: number | null;
  onHand: Decimal;
}

interface DocStamp {
  /** Null when the document keeps the number it already has. */
  number: string | null;
  postedAt: Date;
  effectiveDate: string;
  postedBy: number | null;
}

interface BinState {
  id: number;
  warehouseId: number;
  code: string;
  status: string;
  archived: boolean;
  sellable: boolean;
}

const ZERO = new Decimal(0);
const wsKey = (warehouseId: number, productId: number, lotId: number | null | undefined) =>
  `${warehouseId}:${productId}:${lotId ?? ''}`;
const bsKey = (
  warehouseId: number,
  binId: number,
  productId: number,
  lotId: number | null | undefined,
) => `${warehouseId}:${binId}:${productId}:${lotId ?? ''}`;
const legKey = (docLineId: number, movementType: MovementType, leg: number) =>
  `${docLineId}:${movementType}:${leg}`;
/** Bigint columns of raw queries arrive as strings. */
const toInt = (value: string | null) => (value === null ? null : Number.parseInt(value, 10));
const toId = (value: string) => Number.parseInt(value, 10);
const DOC_ORDER: Record<PostedDocType, number> = { ADJ: 0, BM: 1, GR: 2, ST: 3, TR: 4 };
const MAX_DIFFS = 100;
/** Rows per multi-row statement: far below the 65,535 bind parameters of one statement. */
const CHUNK = 1_000;

/**
 * The only writer of the stock ledger, the balance caches and the costing history (ADR-0007,
 * ADR-0033, ADR-0034). Every document service builds its movements and calls `post` inside its own
 * transaction, after locking its header. Lock order: document headers → bins FOR SHARE → missing
 * cache rows (sorted inserts) → warehouse_stock → bin_stock → inserts → document numbers last.
 * Multi-row statements run in chunks of 1,000 rows taken in key order, so the lock order holds
 * across chunks. Ledger reads (reconciliation, rebuild) live here too: ESLint G2 keeps the ledger
 * in this file.
 */
@Injectable()
export class StockPostingService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly numbering: NumberingService,
  ) {}

  async post(
    tx: Tx,
    actor: Actor,
    input: { docs: readonly PostingDoc[]; movements: readonly Movement[] },
  ): Promise<PostingResult> {
    const docs = [...input.docs].sort(
      (a, b) => DOC_ORDER[a.docType] - DOC_ORDER[b.docType] || a.docId - b.docId,
    );
    validateMovements(docs, input.movements);
    if (input.movements.length > MAX_MOVEMENTS_PER_POST) {
      throw invalid(
        'lines',
        'max',
        `at most ${MAX_MOVEMENTS_PER_POST} stock movements in one posting`,
      );
    }

    // 1. Document headers, re-checked under their row lock (callers already hold it).
    for (const doc of docs) await this.lockDoc(tx, doc);

    const postedAt = await transactionTime(tx);
    const effectiveDate = businessDate(postedAt);
    const unitCosts = new Map<string, Decimal>();
    const movements = [...input.movements];

    if (movements.length > 0) {
      // 2. Bins: shared locks in id order; refuse counted and archived bins.
      const binStates = await this.lockBins(tx, movements);
      for (const movement of movements) {
        const bin = binStates.get(movement.binId);
        if (!bin || bin.warehouseId !== movement.warehouseId) {
          throw new Error(`bin ${movement.binId} is not in warehouse ${movement.warehouseId}`);
        }
        if (bin.status === 'COUNTING') {
          throw new AppError('BIN_LOCKED_FOR_COUNT', `bin ${bin.code} is being counted`, {
            code: bin.code,
          });
        }
        if (bin.archived) {
          throw new AppError('BIN_ARCHIVED', `bin ${bin.code} is archived`, { code: bin.code });
        }
      }

      // 3. Missing cache rows, only where stock arrives, in key order.
      await this.ensureCacheRows(tx, movements);

      // 4. Lock balances: warehouse rows, then bin rows, each in key order.
      const warehouseRows = await this.lockWarehouseRows(tx, movements);
      const binRows = await this.lockBinRows(tx, movements);

      // 5. New quantities; nothing may go below zero.
      const binDelta = new Map<string, Decimal>();
      for (const movement of movements) {
        const key = bsKey(movement.warehouseId, movement.binId, movement.productId, movement.lotId);
        binDelta.set(key, (binDelta.get(key) ?? ZERO).plus(movement.qtyBase));
      }
      for (const [key, delta] of binDelta) {
        const row = binRows.get(key);
        const available = row?.onHand ?? ZERO;
        if (available.plus(delta).isNegative()) {
          const [warehouseId, binId, productId] = key.split(':').map(toId);
          const bin = binStates.get(binId ?? 0);
          throw new AppError(
            'STOCK_INSUFFICIENT',
            `bin ${bin?.code ?? binId} holds ${available.toFixed()}`,
            {
              binCode: bin?.code ?? null,
              warehouseId: warehouseId ?? null,
              productId: productId ?? null,
              available: available.toFixed(),
              requested: delta.negated().toFixed(),
            },
          );
        }
      }

      // 6. Costs and averages, movement by movement (outbound legs first within a line).
      const state = new Map<string, { onHand: Decimal; sellable: Decimal; avg: Decimal }>();
      for (const [key, row] of warehouseRows) {
        state.set(key, { onHand: row.onHand, sellable: row.sellableOnHand, avg: row.avgCost });
      }
      const ordered = movements
        .map((movement, index) => ({ movement, index }))
        .sort(
          (a, b) =>
            a.movement.docType.localeCompare(b.movement.docType) ||
            a.movement.docLineId - b.movement.docLineId ||
            a.movement.leg - b.movement.leg ||
            a.index - b.index,
        )
        .map(({ movement }) => movement);
      const outboundCost = new Map<string, Decimal>();
      const transitCosts = await this.transitCosts(tx, movements);
      const ledgerRows: (typeof stockLedger.$inferInsert)[] = [];
      for (const movement of ordered) {
        const key = wsKey(movement.warehouseId, movement.productId, movement.lotId);
        const balance = state.get(key);
        if (!balance) throw new Error(`no warehouse balance locked for ${key}`);
        const sellable = binStates.get(movement.binId)?.sellable ?? false;
        let unitCost: Decimal;
        if (isTransitExit(movement)) {
          // ADR-0035 #4: a line leaves TRANSIT at the cost it entered at, never at a pooled average.
          const entered = transitCosts.get(movement.docLineId);
          if (!entered)
            throw new Error(`transfer line ${movement.docLineId} never entered TRANSIT`);
          unitCost = entered;
          balance.avg = averageAfterWithdrawal(
            balance.onHand,
            balance.avg,
            movement.qtyBase.negated(),
            unitCost,
          );
          outboundCost.set(`${movement.docType}:${movement.docLineId}`, unitCost);
        } else if (movement.qtyBase.isNegative()) {
          unitCost = balance.avg;
          outboundCost.set(`${movement.docType}:${movement.docLineId}`, unitCost);
        } else {
          unitCost =
            movement.unitCost ??
            outboundCost.get(`${movement.docType}:${movement.docLineId}`) ??
            balance.avg;
          balance.avg = reaverage(balance.onHand, balance.avg, movement.qtyBase, unitCost);
        }
        balance.onHand = balance.onHand.plus(movement.qtyBase);
        if (sellable) balance.sellable = balance.sellable.plus(movement.qtyBase);
        unitCosts.set(legKey(movement.docLineId, movement.movementType, movement.leg), unitCost);
        ledgerRows.push({
          postedAt,
          effectiveDate,
          warehouseId: movement.warehouseId,
          binId: movement.binId,
          productId: movement.productId,
          lotId: movement.lotId ?? null,
          qtyBase: movement.qtyBase,
          unitCost,
          movementType: movement.movementType,
          docType: movement.docType,
          docId: movement.docId,
          docLineId: movement.docLineId,
          leg: movement.leg,
          enteredQty: movement.enteredQty,
          productUnitId: movement.productUnitId,
          factorSnapshot: movement.factorSnapshot,
          createdBy: actorUserId(actor),
        });
      }

      // 7. The ledger; a repeated (document line, movement, leg) is ALREADY_POSTED.
      try {
        for (const rows of chunks(ledgerRows)) await tx.insert(stockLedger).values(rows);
      } catch (error) {
        const database = databaseErrorOf(error);
        if (database?.code === '23505' && database.constraint === 'stock_ledger_idem') {
          throw new AppError('ALREADY_POSTED', 'these movements are already in the ledger');
        }
        throw error;
      }

      // 8. Balances: the locked rows, a chunk per UPDATE.
      const warehouseUpdates = [...warehouseRows].flatMap(([key, row]) => {
        const balance = state.get(key);
        return balance ? [{ id: row.id, ...balance }] : [];
      });
      for (const rows of chunks(warehouseUpdates)) {
        await tx.execute(sql`
          UPDATE warehouse_stock ws
             SET on_hand = v.on_hand, sellable_on_hand = v.sellable, avg_cost = v.avg_cost,
                 updated_at = ${postedAt}
            FROM (VALUES ${sql.join(
              rows.map(
                (row) =>
                  sql`(${row.id}::bigint, ${row.onHand.toFixed()}::numeric, ${row.sellable.toFixed()}::numeric, ${row.avg.toFixed()}::numeric)`,
              ),
              sql`, `,
            )}) AS v (id, on_hand, sellable, avg_cost)
           WHERE ws.id = v.id`);
      }
      const binUpdates = [...binDelta].flatMap(([key, delta]) => {
        const row = binRows.get(key);
        return row && !delta.isZero() ? [{ id: row.id, onHand: row.onHand.plus(delta) }] : [];
      });
      for (const rows of chunks(binUpdates)) {
        await tx.execute(sql`
          UPDATE bin_stock bs SET on_hand = v.on_hand, updated_at = ${postedAt}
            FROM (VALUES ${sql.join(
              rows.map((row) => sql`(${row.id}::bigint, ${row.onHand.toFixed()}::numeric)`),
              sql`, `,
            )}) AS v (id, on_hand)
           WHERE bs.id = v.id`);
      }
    }

    // 9. Documents: status, dates and their number, allocated last.
    const numbers = new Map<number, string>();
    for (const doc of docs) {
      let number: string | null = null;
      if (doc.allocateNumber !== false) {
        const value = await this.numbering.next(tx, doc.docType, businessYear(postedAt));
        number = formatDocNumber(doc.docType, businessYear(postedAt), value);
        numbers.set(doc.docId, number);
      }
      await this.finishDoc(tx, doc, {
        number,
        postedAt,
        effectiveDate,
        postedBy: actorUserId(actor),
      });
    }
    return { postedAt, effectiveDate, numbers, unitCosts };
  }

  /**
   * ADR-0033: costs the lines of a posted receipt (version = the receipt's new costing version).
   * The caller holds the receipt header lock. Per product, the coverage rule moves the average by
   * the share of the price difference still on hand; one history row per line is always written.
   */
  async revalue(
    tx: Tx,
    actor: Actor,
    input: { docId: number; version: number; lines: readonly CostedLine[] },
  ): Promise<Valuation[]> {
    const postedAt = await transactionTime(tx);
    const effectiveDate = businessDate(postedAt);
    const lineIds = input.lines.map((line) => line.docLineId);
    const before = await this.valuesBefore(tx, input.docId, lineIds);

    const byKey = new Map<string, CostedLine[]>();
    for (const line of input.lines) {
      const key = wsKey(line.warehouseId, line.productId, line.lotId);
      byKey.set(key, [...(byKey.get(key) ?? []), line]);
    }
    const warehouseRows = await this.lockWarehouseKeys(
      tx,
      input.lines.map((line) => ({
        warehouseId: line.warehouseId,
        productId: line.productId,
        lotId: line.lotId ?? null,
      })),
    );

    const results: Valuation[] = [];
    for (const [key, lines] of byKey) {
      const row = warehouseRows.get(key);
      if (!row) throw new Error(`no warehouse balance for ${key}`);
      const deltas = lines.map((line) => line.amount.minus(before.get(line.docLineId) ?? ZERO));
      const receivedQty = lines.reduce((sum, line) => sum.plus(line.qtyBase), ZERO);
      const delta = deltas.reduce((sum, value) => sum.plus(value), ZERO);
      const outcome = revalueCost({
        onHand: row.onHand,
        avg: row.avgCost,
        receivedQty,
        valueDelta: delta,
      });
      // Spread what was absorbed over the lines in proportion to their deltas; the last takes the rest.
      let absorbedLeft = outcome.absorbed;
      lines.forEach((line, index) => {
        const lineDelta = deltas[index] ?? ZERO;
        const absorbed =
          index === lines.length - 1
            ? absorbedLeft
            : delta.isZero()
              ? ZERO
              : outcome.absorbed.times(lineDelta).dividedBy(delta).toDecimalPlaces(2);
        absorbedLeft = absorbedLeft.minus(absorbed);
        results.push({
          docLineId: line.docLineId,
          version: input.version,
          amount: line.amount,
          freeGoods: line.freeGoods,
          valueBefore: before.get(line.docLineId) ?? ZERO,
          valueDelta: lineDelta,
          absorbed,
          variance: lineDelta.minus(absorbed),
          avgBefore: row.avgCost,
          avgAfter: outcome.avgAfter,
          postedAt,
        });
      });
      if (!outcome.avgAfter.equals(row.avgCost)) {
        await tx.execute(sql`
          UPDATE warehouse_stock SET avg_cost = ${outcome.avgAfter.toFixed()}, updated_at = ${postedAt}
           WHERE id = ${row.id}`);
      }
    }

    const lineById = new Map(input.lines.map((line) => [line.docLineId, line]));
    await tx.insert(stockValuationAdjustments).values(
      results.map((result) => {
        const line = lineById.get(result.docLineId);
        if (!line) throw new Error(`line ${result.docLineId} vanished`);
        const balance = warehouseRows.get(wsKey(line.warehouseId, line.productId, line.lotId));
        return {
          postedAt,
          effectiveDate,
          warehouseId: line.warehouseId,
          productId: line.productId,
          lotId: line.lotId ?? null,
          docType: 'GR' as const,
          docId: input.docId,
          docLineId: line.docLineId,
          version: input.version,
          qtyBase: line.qtyBase,
          freeGoods: line.freeGoods,
          amount: result.amount,
          valueBefore: result.valueBefore,
          valueDelta: result.valueDelta,
          onHandAt: balance?.onHand ?? ZERO,
          absorbed: result.absorbed,
          variance: result.variance,
          avgBefore: result.avgBefore,
          avgAfter: result.avgAfter,
          createdBy: actorUserId(actor),
        };
      }),
    );
    return results;
  }

  /** The latest costing of each line of a receipt (none for a receipt not costed yet). */
  async costingOf(docId: number, executor: Db | Tx = this.db): Promise<Map<number, Valuation>> {
    const rows = await executor
      .select()
      .from(stockValuationAdjustments)
      .where(
        and(
          eq(stockValuationAdjustments.docType, 'GR'),
          eq(stockValuationAdjustments.docId, docId),
        ),
      )
      .orderBy(desc(stockValuationAdjustments.version));
    const latest = new Map<number, Valuation>();
    for (const row of rows) {
      if (latest.has(row.docLineId)) continue;
      latest.set(row.docLineId, {
        docLineId: row.docLineId,
        version: row.version,
        amount: row.amount,
        freeGoods: row.freeGoods,
        valueBefore: row.valueBefore,
        valueDelta: row.valueDelta,
        absorbed: row.absorbed,
        variance: row.variance,
        avgBefore: row.avgBefore,
        avgAfter: row.avgAfter,
        postedAt: row.postedAt,
      });
    }
    return latest;
  }

  /** The provisional cost each line of a posted receipt went in at (its RECEIPT ledger row). */
  async receiptCosts(docId: number, executor: Db | Tx = this.db): Promise<Map<number, Decimal>> {
    const rows = await executor
      .select({ docLineId: stockLedger.docLineId, unitCost: stockLedger.unitCost })
      .from(stockLedger)
      .where(
        and(
          eq(stockLedger.docType, 'GR'),
          eq(stockLedger.docId, docId),
          eq(stockLedger.movementType, 'RECEIPT'),
        ),
      );
    return new Map(rows.map((row) => [row.docLineId, row.unitCost]));
  }

  /**
   * Nightly check (D10), also run by `pnpm inventory:reconcile`: the ledger's sums against both caches,
   * in one REPEATABLE READ snapshot, plus the day's warehouse snapshot. Always records a run.
   */
  reconcile(triggeredBy: string): Promise<ReconciliationRun> {
    return inTransaction(
      this.db,
      async (tx) => {
        const startedAt = await transactionTime(tx);
        const snapshotDate = businessDate(startedAt);
        const diffs = await this.differences(tx);
        await tx.execute(sql`
          INSERT INTO stock_snapshot_daily
            (snapshot_date, warehouse_id, product_id, lot_id, on_hand, sellable_on_hand, reserved, avg_cost)
          SELECT ${snapshotDate}::date, warehouse_id, product_id, lot_id, on_hand, sellable_on_hand, reserved, avg_cost
            FROM warehouse_stock WHERE on_hand <> 0 OR reserved <> 0
          ON CONFLICT ON CONSTRAINT stock_snapshot_daily_key DO UPDATE
            SET on_hand = excluded.on_hand, sellable_on_hand = excluded.sellable_on_hand,
                reserved = excluded.reserved, avg_cost = excluded.avg_cost`);
        const status = diffs.length === 0 ? 'OK' : 'DRIFT';
        const [run] = await tx
          .insert(reconciliationRuns)
          .values({
            startedAt,
            status,
            diffCount: diffs.length,
            diffs: diffs.slice(0, MAX_DIFFS),
            triggeredBy,
          })
          .returning({ id: reconciliationRuns.id });
        if (!run) throw new Error('reconciliation run insert returned no row');
        return { id: run.id, status, diffCount: diffs.length, diffs, snapshotDate };
      },
      'repeatable read',
    );
  }

  /**
   * Rebuilds both caches' quantities from the ledger (`pnpm inventory:rebuild-balances`), with the
   * tables locked against postings. Averages are kept; a missing warehouse row takes the latest
   * known average (costing history, else the last receipt or outbound ledger row).
   */
  rebuildBalances(): Promise<{ binRows: number; warehouseRows: number; newWarehouseRows: number }> {
    return inTransaction(this.db, async (tx) => {
      await tx.execute(sql`LOCK TABLE warehouse_stock, bin_stock IN EXCLUSIVE MODE`);
      const bins = await tx.execute(sql`
        WITH ledger AS (
          SELECT warehouse_id, bin_id, product_id, lot_id, sum(qty_base) AS on_hand
            FROM stock_ledger GROUP BY warehouse_id, bin_id, product_id, lot_id)
        INSERT INTO bin_stock (warehouse_id, bin_id, product_id, lot_id, on_hand)
        SELECT warehouse_id, bin_id, product_id, lot_id, on_hand FROM ledger
         ORDER BY warehouse_id, bin_id, product_id, lot_id
        ON CONFLICT ON CONSTRAINT bin_stock_key DO UPDATE SET on_hand = excluded.on_hand, updated_at = now()
        WHERE bin_stock.on_hand IS DISTINCT FROM excluded.on_hand`);
      await tx.execute(sql`
        UPDATE bin_stock bs SET on_hand = 0, updated_at = now()
         WHERE bs.on_hand <> 0 AND NOT EXISTS (
           SELECT 1 FROM stock_ledger l
            WHERE l.warehouse_id = bs.warehouse_id AND l.bin_id = bs.bin_id AND l.product_id = bs.product_id
              AND l.lot_id IS NOT DISTINCT FROM bs.lot_id)`);
      const { rows: inserted } = await tx.execute<{ count: string }>(sql`
        WITH ledger AS (
          SELECT l.warehouse_id, l.product_id, l.lot_id, sum(l.qty_base) AS on_hand,
                 coalesce(sum(l.qty_base) FILTER (WHERE b.sellable), 0) AS sellable
            FROM stock_ledger l JOIN bins b ON b.id = l.bin_id
           GROUP BY l.warehouse_id, l.product_id, l.lot_id),
        added AS (
          INSERT INTO warehouse_stock (warehouse_id, product_id, lot_id, on_hand, sellable_on_hand, avg_cost)
          SELECT k.warehouse_id, k.product_id, k.lot_id, k.on_hand, k.sellable,
                 coalesce((SELECT v.avg_after FROM stock_valuation_adjustments v
                            WHERE v.warehouse_id = k.warehouse_id AND v.product_id = k.product_id
                              AND v.lot_id IS NOT DISTINCT FROM k.lot_id ORDER BY v.id DESC LIMIT 1),
                          (SELECT l.unit_cost FROM stock_ledger l
                            WHERE l.warehouse_id = k.warehouse_id AND l.product_id = k.product_id
                              AND l.lot_id IS NOT DISTINCT FROM k.lot_id
                              AND (l.movement_type = 'RECEIPT' OR l.qty_base < 0) ORDER BY l.id DESC LIMIT 1),
                          0)
            FROM ledger k
           ORDER BY k.warehouse_id, k.product_id, k.lot_id
          ON CONFLICT ON CONSTRAINT warehouse_stock_key DO NOTHING
          RETURNING 1)
        SELECT count(*)::text AS count FROM added`);
      const warehouses = await tx.execute(sql`
        WITH ledger AS (
          SELECT l.warehouse_id, l.product_id, l.lot_id, sum(l.qty_base) AS on_hand,
                 coalesce(sum(l.qty_base) FILTER (WHERE b.sellable), 0) AS sellable
            FROM stock_ledger l JOIN bins b ON b.id = l.bin_id
           GROUP BY l.warehouse_id, l.product_id, l.lot_id)
        UPDATE warehouse_stock ws
           SET on_hand = coalesce(k.on_hand, 0), sellable_on_hand = coalesce(k.sellable, 0), updated_at = now()
          FROM warehouse_stock w0
          LEFT JOIN ledger k ON k.warehouse_id = w0.warehouse_id AND k.product_id = w0.product_id
                            AND k.lot_id IS NOT DISTINCT FROM w0.lot_id
         WHERE ws.id = w0.id
           AND (ws.on_hand IS DISTINCT FROM coalesce(k.on_hand, 0)
                OR ws.sellable_on_hand IS DISTINCT FROM coalesce(k.sellable, 0))`);
      return {
        binRows: bins.rowCount ?? 0,
        warehouseRows: warehouses.rowCount ?? 0,
        newWarehouseRows: Number.parseInt(inserted[0]?.count ?? '0', 10),
      };
    });
  }

  // -------------------------------------------------------------------------------------------

  private async differences(tx: Tx): Promise<ReconciliationDiff[]> {
    const { rows } = await tx.execute<{
      level: ReconciliationDiff['level'];
      warehouse_id: string;
      bin_id: string | null;
      product_id: string;
      lot_id: string | null;
      ledger: string;
      cache: string;
    }>(sql`
      WITH bin_ledger AS (
        SELECT warehouse_id, bin_id, product_id, lot_id, sum(qty_base) AS qty
          FROM stock_ledger GROUP BY warehouse_id, bin_id, product_id, lot_id),
      wh_ledger AS (
        SELECT l.warehouse_id, l.product_id, l.lot_id, sum(l.qty_base) AS qty,
               coalesce(sum(l.qty_base) FILTER (WHERE b.sellable), 0) AS sellable
          FROM stock_ledger l JOIN bins b ON b.id = l.bin_id
         GROUP BY l.warehouse_id, l.product_id, l.lot_id),
      bin_diff AS (
        SELECT 'BIN' AS level, coalesce(k.warehouse_id, c.warehouse_id) AS warehouse_id,
               coalesce(k.bin_id, c.bin_id) AS bin_id, coalesce(k.product_id, c.product_id) AS product_id,
               coalesce(k.lot_id, c.lot_id) AS lot_id, coalesce(k.qty, 0) AS ledger, coalesce(c.on_hand, 0) AS cache
          FROM bin_ledger k
          FULL JOIN bin_stock c ON c.warehouse_id = k.warehouse_id AND c.bin_id = k.bin_id
                               AND c.product_id = k.product_id AND coalesce(c.lot_id, 0) = coalesce(k.lot_id, 0)
         WHERE coalesce(k.qty, 0) <> coalesce(c.on_hand, 0)),
      wh_diff AS (
        SELECT 'WAREHOUSE' AS level, coalesce(k.warehouse_id, c.warehouse_id) AS warehouse_id, NULL::bigint AS bin_id,
               coalesce(k.product_id, c.product_id) AS product_id, coalesce(k.lot_id, c.lot_id) AS lot_id,
               coalesce(k.qty, 0) AS ledger, coalesce(c.on_hand, 0) AS cache
          FROM wh_ledger k
          FULL JOIN warehouse_stock c ON c.warehouse_id = k.warehouse_id AND c.product_id = k.product_id
                                     AND coalesce(c.lot_id, 0) = coalesce(k.lot_id, 0)
         WHERE coalesce(k.qty, 0) <> coalesce(c.on_hand, 0)),
      sellable_diff AS (
        SELECT 'SELLABLE' AS level, coalesce(k.warehouse_id, c.warehouse_id) AS warehouse_id, NULL::bigint AS bin_id,
               coalesce(k.product_id, c.product_id) AS product_id, coalesce(k.lot_id, c.lot_id) AS lot_id,
               coalesce(k.sellable, 0) AS ledger, coalesce(c.sellable_on_hand, 0) AS cache
          FROM wh_ledger k
          FULL JOIN warehouse_stock c ON c.warehouse_id = k.warehouse_id AND c.product_id = k.product_id
                                     AND coalesce(c.lot_id, 0) = coalesce(k.lot_id, 0)
         WHERE coalesce(k.sellable, 0) <> coalesce(c.sellable_on_hand, 0))
      SELECT level, warehouse_id::text, bin_id::text, product_id::text, lot_id::text, ledger::text, cache::text
        FROM (SELECT * FROM bin_diff UNION ALL SELECT * FROM wh_diff UNION ALL SELECT * FROM sellable_diff) d
       ORDER BY level, warehouse_id, bin_id NULLS FIRST, product_id, lot_id NULLS FIRST`);
    return rows.map((row) => ({
      level: row.level,
      warehouseId: toId(row.warehouse_id),
      binId: toInt(row.bin_id),
      productId: toId(row.product_id),
      lotId: toInt(row.lot_id),
      ledger: row.ledger,
      cache: row.cache,
    }));
  }

  private async valuesBefore(
    tx: Tx,
    docId: number,
    lineIds: readonly number[],
  ): Promise<Map<number, Decimal>> {
    const latest = await this.costingOf(docId, tx);
    const provisional = await this.receiptCosts(docId, tx);
    const quantities = await tx
      .select({ docLineId: stockLedger.docLineId, qtyBase: stockLedger.qtyBase })
      .from(stockLedger)
      .where(
        and(
          eq(stockLedger.docType, 'GR'),
          eq(stockLedger.docId, docId),
          eq(stockLedger.movementType, 'RECEIPT'),
          inArray(stockLedger.docLineId, [...lineIds]),
        ),
      );
    const before = new Map<number, Decimal>();
    for (const row of quantities) {
      const costed = latest.get(row.docLineId);
      before.set(
        row.docLineId,
        costed ? costed.amount : valueOf(row.qtyBase, provisional.get(row.docLineId) ?? ZERO),
      );
    }
    return before;
  }

  /** The cost each transfer line entered TRANSIT at (its leg 2), for the lines leaving it here. */
  private async transitCosts(
    tx: Tx,
    movements: readonly Movement[],
  ): Promise<Map<number, Decimal>> {
    const lineIds = [
      ...new Set(movements.filter(isTransitExit).map((movement) => movement.docLineId)),
    ].sort((a, b) => a - b);
    const costs = new Map<number, Decimal>();
    for (const part of chunks(lineIds)) {
      const rows = await tx
        .select({ docLineId: stockLedger.docLineId, unitCost: stockLedger.unitCost })
        .from(stockLedger)
        .where(
          and(
            eq(stockLedger.docType, 'TR'),
            eq(stockLedger.movementType, 'TRANSFER_IN'),
            eq(stockLedger.leg, 2),
            inArray(stockLedger.docLineId, part),
          ),
        );
      for (const row of rows) costs.set(row.docLineId, row.unitCost);
    }
    return costs;
  }

  private async lockDoc(tx: Tx, doc: PostingDoc): Promise<void> {
    const status = await this.docStatus(tx, doc);
    if (status === undefined)
      throw new AppError('NOT_FOUND', `${doc.docType} ${doc.docId} not found`, { id: doc.docId });
    if (status === doc.nextStatus) {
      throw new AppError('DOC_ALREADY_POSTED', `${doc.docType} ${doc.docId} is already ${status}`, {
        status,
      });
    }
    if (status !== doc.expectedStatus) {
      throw new AppError('DOC_STATE_INVALID', `${doc.docType} ${doc.docId} is ${status}`, {
        status,
      });
    }
  }

  private async docStatus(tx: Tx, doc: PostingDoc): Promise<string | undefined> {
    switch (doc.docType) {
      case 'GR': {
        const [row] = await tx
          .select({ status: goodsReceipts.status })
          .from(goodsReceipts)
          .where(eq(goodsReceipts.id, doc.docId))
          .for('update');
        return row?.status;
      }
      case 'BM': {
        const [row] = await tx
          .select({ status: binMoves.status })
          .from(binMoves)
          .where(eq(binMoves.id, doc.docId))
          .for('update');
        return row?.status;
      }
      case 'ADJ': {
        const [row] = await tx
          .select({ status: adjustments.status })
          .from(adjustments)
          .where(eq(adjustments.id, doc.docId))
          .for('update');
        return row?.status;
      }
      case 'ST': {
        const [row] = await tx
          .select({ status: stocktakes.status })
          .from(stocktakes)
          .where(eq(stocktakes.id, doc.docId))
          .for('update');
        return row?.status;
      }
      case 'TR': {
        const [row] = await tx
          .select({ status: transfers.status })
          .from(transfers)
          .where(eq(transfers.id, doc.docId))
          .for('update');
        return row?.status;
      }
    }
  }

  private async finishDoc(tx: Tx, doc: PostingDoc, values: DocStamp): Promise<void> {
    if (doc.docType === 'TR') {
      await this.finishTransfer(tx, doc, values);
      return;
    }
    if (values.number === null) {
      throw new Error(`${doc.docType} ${doc.docId} is numbered when it is posted`);
    }
    const common = {
      number: values.number,
      postedAt: values.postedAt,
      effectiveDate: values.effectiveDate,
      postedBy: values.postedBy,
      updatedAt: values.postedAt,
    };
    switch (doc.docType) {
      case 'GR':
        await tx
          .update(goodsReceipts)
          .set({ ...common, status: 'POSTED', costingStatus: 'PENDING' })
          .where(eq(goodsReceipts.id, doc.docId));
        return;
      case 'BM':
        await tx
          .update(binMoves)
          .set({ ...common, status: 'POSTED' })
          .where(eq(binMoves.id, doc.docId));
        return;
      case 'ADJ':
        await tx
          .update(adjustments)
          .set({ ...common, status: 'POSTED' })
          .where(eq(adjustments.id, doc.docId));
        return;
      case 'ST':
        await tx
          .update(stocktakes)
          .set({ ...common, status: 'APPROVED' })
          .where(eq(stocktakes.id, doc.docId));
        return;
    }
  }

  /** Shipping stamps the shipped columns, receiving the received ones (ADR-0035). */
  private async finishTransfer(tx: Tx, doc: PostingDoc, values: DocStamp): Promise<void> {
    const stamp =
      doc.nextStatus === 'SHIPPED'
        ? {
            status: 'SHIPPED' as const,
            shippedAt: values.postedAt,
            shipDate: values.effectiveDate,
            shippedBy: values.postedBy,
          }
        : doc.nextStatus === 'RECEIVED'
          ? {
              status: 'RECEIVED' as const,
              receivedAt: values.postedAt,
              receiveDate: values.effectiveDate,
              receivedBy: values.postedBy,
            }
          : null;
    if (!stamp) throw new Error(`a transfer is not posted into ${doc.nextStatus}`);
    await tx
      .update(transfers)
      .set({
        ...stamp,
        ...(values.number === null ? {} : { number: values.number }),
        updatedAt: values.postedAt,
      })
      .where(eq(transfers.id, doc.docId));
  }

  private async lockBins(tx: Tx, movements: readonly Movement[]): Promise<Map<number, BinState>> {
    const ids = [...new Set(movements.map((movement) => movement.binId))].sort((a, b) => a - b);
    const states = new Map<number, BinState>();
    for (const part of chunks(ids)) {
      const { rows } = await tx.execute<{
        id: string;
        warehouse_id: string;
        code: string;
        status: string;
        archived: boolean;
        sellable: boolean;
      }>(sql`
        SELECT id, warehouse_id, code, status, archived_at IS NOT NULL AS archived, sellable
          FROM bins WHERE id IN (${sql.join(
            part.map((id) => sql`${id}`),
            sql`, `,
          )})
         ORDER BY id FOR SHARE`);
      for (const row of rows) {
        states.set(toId(row.id), {
          id: toId(row.id),
          warehouseId: toId(row.warehouse_id),
          code: row.code,
          status: row.status,
          archived: row.archived,
          sellable: row.sellable,
        });
      }
    }
    return states;
  }

  private async ensureCacheRows(tx: Tx, movements: readonly Movement[]): Promise<void> {
    const inbound = movements.filter((movement) => movement.qtyBase.gt(0));
    if (inbound.length === 0) return;
    const warehouseKeys = uniqueBy(inbound, (m) => wsKey(m.warehouseId, m.productId, m.lotId)).sort(
      byWarehouseKey,
    );
    for (const part of chunks(warehouseKeys)) {
      await tx.execute(sql`
        INSERT INTO warehouse_stock (warehouse_id, product_id, lot_id)
        SELECT * FROM (VALUES ${sql.join(
          part.map(
            (m) =>
              sql`(${m.warehouseId}::bigint, ${m.productId}::bigint, ${m.lotId ?? null}::bigint)`,
          ),
          sql`, `,
        )}) AS k (warehouse_id, product_id, lot_id)
        ON CONFLICT ON CONSTRAINT warehouse_stock_key DO NOTHING`);
    }
    const binKeys = uniqueBy(inbound, (m) =>
      bsKey(m.warehouseId, m.binId, m.productId, m.lotId),
    ).sort(byBinKey);
    for (const part of chunks(binKeys)) {
      await tx.execute(sql`
        INSERT INTO bin_stock (warehouse_id, bin_id, product_id, lot_id)
        SELECT * FROM (VALUES ${sql.join(
          part.map(
            (m) =>
              sql`(${m.warehouseId}::bigint, ${m.binId}::bigint, ${m.productId}::bigint, ${m.lotId ?? null}::bigint)`,
          ),
          sql`, `,
        )}) AS k (warehouse_id, bin_id, product_id, lot_id)
        ON CONFLICT ON CONSTRAINT bin_stock_key DO NOTHING`);
    }
  }

  private lockWarehouseRows(
    tx: Tx,
    movements: readonly Movement[],
  ): Promise<Map<string, WarehouseRow>> {
    return this.lockWarehouseKeys(
      tx,
      movements.map((m) => ({
        warehouseId: m.warehouseId,
        productId: m.productId,
        lotId: m.lotId ?? null,
      })),
    );
  }

  /** Locks warehouse balances NULL-safely in key order; outbound keys may have no row (insufficient). */
  private async lockWarehouseKeys(
    tx: Tx,
    keys: readonly { warehouseId: number; productId: number; lotId: number | null }[],
  ): Promise<Map<string, WarehouseRow>> {
    const unique = uniqueBy(keys, (k) => wsKey(k.warehouseId, k.productId, k.lotId)).sort(
      byWarehouseKey,
    );
    const locked = new Map<string, WarehouseRow>();
    for (const part of chunks(unique)) {
      const { rows } = await tx.execute<{
        id: string;
        warehouse_id: string;
        product_id: string;
        lot_id: string | null;
        on_hand: string;
        sellable_on_hand: string;
        avg_cost: string;
      }>(sql`
        SELECT ws.id, ws.warehouse_id, ws.product_id, ws.lot_id, ws.on_hand, ws.sellable_on_hand, ws.avg_cost
          FROM warehouse_stock ws
          JOIN (VALUES ${sql.join(
            part.map(
              (k) => sql`(${k.warehouseId}::bigint, ${k.productId}::bigint, ${k.lotId}::bigint)`,
            ),
            sql`, `,
          )}) AS k (warehouse_id, product_id, lot_id)
            ON ws.warehouse_id = k.warehouse_id AND ws.product_id = k.product_id
           AND ws.lot_id IS NOT DISTINCT FROM k.lot_id
         ORDER BY ws.warehouse_id, ws.product_id, ws.lot_id NULLS FIRST
           FOR UPDATE OF ws`);
      for (const row of rows) {
        const value: WarehouseRow = {
          id: toId(row.id),
          warehouseId: toId(row.warehouse_id),
          productId: toId(row.product_id),
          lotId: toInt(row.lot_id),
          onHand: new Decimal(row.on_hand),
          sellableOnHand: new Decimal(row.sellable_on_hand),
          avgCost: new Decimal(row.avg_cost),
        };
        locked.set(wsKey(value.warehouseId, value.productId, value.lotId), value);
      }
    }
    return locked;
  }

  private async lockBinRows(tx: Tx, movements: readonly Movement[]): Promise<Map<string, BinRow>> {
    const unique = uniqueBy(movements, (m) =>
      bsKey(m.warehouseId, m.binId, m.productId, m.lotId),
    ).sort(byBinKey);
    const locked = new Map<string, BinRow>();
    for (const part of chunks(unique)) {
      const { rows } = await tx.execute<{
        id: string;
        warehouse_id: string;
        bin_id: string;
        product_id: string;
        lot_id: string | null;
        on_hand: string;
      }>(sql`
        SELECT bs.id, bs.warehouse_id, bs.bin_id, bs.product_id, bs.lot_id, bs.on_hand
          FROM bin_stock bs
          JOIN (VALUES ${sql.join(
            part.map(
              (m) =>
                sql`(${m.warehouseId}::bigint, ${m.binId}::bigint, ${m.productId}::bigint, ${m.lotId ?? null}::bigint)`,
            ),
            sql`, `,
          )}) AS k (warehouse_id, bin_id, product_id, lot_id)
            ON bs.warehouse_id = k.warehouse_id AND bs.bin_id = k.bin_id AND bs.product_id = k.product_id
           AND bs.lot_id IS NOT DISTINCT FROM k.lot_id
         ORDER BY bs.warehouse_id, bs.bin_id, bs.product_id, bs.lot_id NULLS FIRST
           FOR UPDATE OF bs`);
      for (const row of rows) {
        const value: BinRow = {
          id: toId(row.id),
          warehouseId: toId(row.warehouse_id),
          binId: toId(row.bin_id),
          productId: toId(row.product_id),
          lotId: toInt(row.lot_id),
          onHand: new Decimal(row.on_hand),
        };
        locked.set(bsKey(value.warehouseId, value.binId, value.productId, value.lotId), value);
      }
    }
    return locked;
  }
}

/** The transaction's timestamp (`now()` is fixed for the whole transaction). */
async function transactionTime(tx: Tx): Promise<Date> {
  const { rows } = await tx.execute<{ now: string | Date }>(sql`SELECT now() AS now`);
  const value = rows[0]?.now;
  if (value === undefined) throw new Error('now() returned no row');
  return value instanceof Date ? value : new Date(value);
}

/** A transfer's receive taking a line out of TRANSIT (leg 3, ADR-0035 #4). */
function isTransitExit(movement: Movement): boolean {
  return (
    movement.docType === 'TR' && movement.movementType === 'TRANSFER_OUT' && movement.leg === 3
  );
}

/** Consecutive slices of at most CHUNK items, in the given order. */
function chunks<T>(items: readonly T[]): T[][] {
  const parts: T[][] = [];
  for (let start = 0; start < items.length; start += CHUNK) {
    parts.push(items.slice(start, start + CHUNK));
  }
  return parts;
}

interface StockKey {
  warehouseId: number;
  productId: number;
  lotId?: number | null;
}

/** The SQL lock order of warehouse balances: warehouse, product, lot with NULL first. */
function byWarehouseKey(a: StockKey, b: StockKey): number {
  return (
    a.warehouseId - b.warehouseId || a.productId - b.productId || (a.lotId ?? 0) - (b.lotId ?? 0)
  );
}

/** The SQL lock order of bin balances: warehouse, bin, product, lot with NULL first. */
function byBinKey(a: StockKey & { binId: number }, b: StockKey & { binId: number }): number {
  return (
    a.warehouseId - b.warehouseId ||
    a.binId - b.binId ||
    a.productId - b.productId ||
    (a.lotId ?? 0) - (b.lotId ?? 0)
  );
}

function uniqueBy<T>(items: readonly T[], key: (item: T) => string): T[] {
  const seen = new Map<string, T>();
  for (const item of items) if (!seen.has(key(item))) seen.set(key(item), item);
  return [...seen.values()];
}

/** Movements must belong to the posted documents and agree with the ledger's rules. */
function validateMovements(docs: readonly PostingDoc[], movements: readonly Movement[]): void {
  const allowed = new Set(docs.map((doc) => `${doc.docType}:${doc.docId}`));
  for (const movement of movements) {
    if (!allowed.has(`${movement.docType}:${movement.docId}`)) {
      throw new Error(
        `movement of ${movement.docType} ${movement.docId} outside the posted documents`,
      );
    }
    const rule = MOVEMENT_TYPES[movement.movementType];
    if (movement.qtyBase.isZero()) throw new Error('a movement needs a quantity');
    const sign = movement.qtyBase.isNegative() ? -1 : 1;
    if (rule.sign !== 0 && sign !== rule.sign) {
      throw new Error(`${movement.movementType} has the wrong sign`);
    }
    if (!(rule.legs as readonly number[]).includes(movement.leg)) {
      throw new Error(`${movement.movementType} cannot use leg ${movement.leg}`);
    }
    if (
      !movement.enteredQty.gt(0) ||
      !movement.qtyBase.abs().equals(movement.enteredQty.times(movement.factorSnapshot))
    ) {
      throw new Error(`line ${movement.docLineId}: entered quantity × factor ≠ base quantity`);
    }
    if (movement.unitCost?.isNegative()) throw new Error('a unit cost is never negative');
  }
}
