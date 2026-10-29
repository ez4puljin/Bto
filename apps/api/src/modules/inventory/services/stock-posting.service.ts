import { Inject, Injectable, type OnModuleInit, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
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
import { businessDate, businessMonthStart, businessYear, isIsoDate } from '@tugeel/shared/time';
import { and, desc, eq, gte, inArray, lt, lte, type SQL, sql } from 'drizzle-orm';
import { idIn } from '../../../common/db/days';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid } from '../../../common/errors/app-error';
import { databaseErrorOf } from '../../../common/errors/problem-details';
import { DEFAULT_PAGE_LIMIT, decodeCursor, toPage } from '../../../common/pagination/page';
import { type Actor, actorUserId, NumberingService } from '../../identity';
import {
  STOCK_BOOKS,
  type StockBookKind,
  type StockBookLine,
  type StockBookParty,
  type StockBooks,
  type StockPostedFacts,
  type StockRevaluedFacts,
} from '../hooks';
import { stockLedger, stockValuationAdjustments } from '../ledger.schema';
import {
  adjustments,
  binMoves,
  goodsIssues,
  issueExpenseTypes,
  bins,
  goodsReceipts,
  reconciliationRuns,
  stockReservations,
  stocktakes,
  transfers,
} from '../schema';
import { bookKindOf } from './stock-book-kind';
import { advisoryLock, LOCKS } from './support';

/** Inventory's own stock documents; other modules guard their documents themselves (ADR-0034 #5). */
export type PostedDocType = Extract<StockDocType, 'GR' | 'BM' | 'TR' | 'ADJ' | 'ST' | 'GI'>;

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
  /**
   * A goods issue confirmed warehouse by warehouse (ADR-0117 #2): the posting writes this part's
   * rows, numbers the document on the first part only and keeps its status (`expectedStatus` =
   * `nextStatus`, SENT); the owner moves it to POSTED once every warehouse confirmed.
   */
  partial?: boolean;
}

/**
 * A document another module owns (ADR-0056 #6, ADR-0034 #5): `post()` neither locks, finishes nor
 * numbers it — the owner holds its header row FOR UPDATE and guards its state in the same
 * transaction.
 */
export type ExternalDocType = Extract<StockDocType, 'SO' | 'PK' | 'CN' | 'POS'>;

export interface ExternalPostingDoc {
  docType: ExternalDocType;
  docId: number;
  external: true;
}

export type AnyPostingDoc = PostingDoc | ExternalPostingDoc;

const isInternal = (doc: AnyPostingDoc): doc is PostingDoc => !('external' in doc);

/**
 * The reservations a posting consumes (ADR-0056 #6): the ACTIVE rows of these document lines are
 * marked CONSUMED (a line with an outbound movement) or RELEASED (a line picked at zero), and
 * `warehouse_stock.reserved` drops by their quantity in the same UPDATE that moves the stock.
 */
export interface ReservationConsume {
  docType: StockDocType;
  docLineIds: readonly number[];
}

/** Filters of the movement history; dates are Ulaanbaatar business days, both inclusive. */
export interface MovementQuery {
  productId?: number;
  warehouseId?: number;
  binId?: number;
  docType?: StockDocType;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
}

/** A ledger row as the movement history shows it. */
export interface LedgerMovement {
  id: number;
  postedAt: Date;
  effectiveDate: string;
  warehouseId: number;
  binId: number;
  binCode: string;
  productId: number;
  lotId: number | null;
  /** Signed: negative left the bin. */
  qtyBase: Decimal;
  unitCost: Decimal;
  movementType: MovementType;
  docType: StockDocType;
  docId: number;
  /** null for documents of later modules until they get their numbers here. */
  docNumber: string | null;
  /** As entered on the document line, in `productUnitId`. */
  enteredQty: Decimal;
  productUnitId: number;
  /** The product's balance in this warehouse and this bin after the movement (product queries). */
  warehouseBalance: Decimal | null;
  binBalance: Decimal | null;
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
  /** What was typed, VAT included (ADR-0078); null for a costing that typed only the cost. */
  docAmount?: Decimal | null;
  /** The line's share of the delivery note's discount (ADR-0099 #4); `amount` is already net of it. */
  discountAmount?: Decimal | null;
  freeGoods: boolean;
}

export interface Valuation {
  docLineId: number;
  version: number;
  amount: Decimal;
  docAmount: Decimal | null;
  discountAmount: Decimal | null;
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
  /** RESERVED: the cache's reserved quantity against the ACTIVE reservations (ADR-0055). */
  level: 'BIN' | 'WAREHOUSE' | 'SELLABLE' | 'RESERVED';
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

/** What the monthly partition maintenance did (D9, ADR-0040). */
export interface SnapshotPartitions {
  created: number;
  dropped: number;
}

/** A written monthly bin snapshot: its date and the rows written or rewritten. */
export interface BinSnapshot {
  snapshotDate: string;
  rows: number;
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
const DOC_ORDER: Record<PostedDocType | ExternalDocType, number> = {
  ADJ: 0,
  BM: 1,
  GR: 2,
  ST: 3,
  TR: 4,
  PK: 5,
  SO: 6,
  CN: 7,
  POS: 8,
  GI: 9,
};
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
export class StockPostingService implements OnModuleInit {
  private books: StockBooks | null = null;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly numbering: NumberingService,
    // Absent in the CLI tools, which build the service by hand and post nothing.
    @Optional() private readonly moduleRef?: ModuleRef,
  ) {}

  onModuleInit(): void {
    try {
      this.books = this.moduleRef?.get<StockBooks>(STOCK_BOOKS, { strict: false }) ?? null;
    } catch {
      this.books = null;
    }
  }

  async post(
    tx: Tx,
    actor: Actor,
    input: {
      docs: readonly AnyPostingDoc[];
      movements: readonly Movement[];
      reservationConsume?: ReservationConsume;
    },
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

    // 1. Document headers, re-checked under their row lock (callers already hold it). External
    //    documents are their owner's business (ADR-0056 #6).
    const internal = docs.filter(isInternal);
    for (const doc of internal) await this.lockDoc(tx, doc);

    const postedAt = await transactionTime(tx);
    const effectiveDate = businessDate(postedAt);
    const unitCosts = new Map<string, Decimal>();
    const movements = [...input.movements];
    // The ledger rows written, with their ids: the books value each document from them (F4).
    const written: { row: typeof stockLedger.$inferInsert; id: number }[] = [];
    // 1b. The reservations to consume, read without a lock: only the document's own writers touch
    //     them, and every one of them holds the document's header row (ADR-0056 #6).
    const consume = input.reservationConsume;
    const consumeKeys = consume ? await this.reservationKeys(tx, consume) : [];

    if (movements.length > 0 || consumeKeys.length > 0) {
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
      const warehouseRows = await this.lockWarehouseKeys(tx, [
        ...movements.map((m) => ({
          warehouseId: m.warehouseId,
          productId: m.productId,
          lotId: m.lotId ?? null,
        })),
        ...consumeKeys,
      ]);
      const binRows = await this.lockBinRows(tx, movements);
      // 4b. The reservations consumed, summed per warehouse row (ADR-0056 #6).
      const consumed = consume
        ? await this.consumeReservations(tx, consume, movements, warehouseRows)
        : new Map<string, Decimal>();

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
        for (const rows of chunks(ledgerRows)) {
          const ids = await tx.insert(stockLedger).values(rows).returning({ id: stockLedger.id });
          rows.forEach((row, index) => {
            const id = ids[index]?.id;
            if (id !== undefined) written.push({ row, id });
          });
        }
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
        return balance ? [{ id: row.id, ...balance, consumed: consumed.get(key) ?? ZERO }] : [];
      });
      // One statement moves the stock and frees the reservation (D2); `reserved` below zero is
      // drift, caught by the table's CHECK.
      for (const rows of chunks(warehouseUpdates)) {
        await tx.execute(sql`
          UPDATE warehouse_stock ws
             SET on_hand = v.on_hand, sellable_on_hand = v.sellable, avg_cost = v.avg_cost,
                 reserved = ws.reserved - v.consumed, updated_at = ${postedAt}
            FROM (VALUES ${sql.join(
              rows.map(
                (row) =>
                  sql`(${row.id}::bigint, ${row.onHand.toFixed()}::numeric, ${row.sellable.toFixed()}::numeric, ${row.avg.toFixed()}::numeric, ${row.consumed.toFixed()}::numeric)`,
              ),
              sql`, `,
            )}) AS v (id, on_hand, sellable, avg_cost, consumed)
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

    // 9. Documents: status, dates and their number, allocated last (inventory's own only). A
    //    partial posting keeps the number its first part took (ADR-0117 #2).
    const numbers = new Map<number, string>();
    for (const doc of internal) {
      let number: string | null = null;
      const existing = doc.partial ? await this.existingNumber(tx, doc) : null;
      if (existing !== null) {
        numbers.set(doc.docId, existing);
      } else if (doc.allocateNumber !== false) {
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
    // 10. The books (F4, ADR-0097): each document's stock value, in this transaction.
    if (this.books && written.length > 0) {
      for (const facts of await this.bookFacts(tx, written, numbers, effectiveDate)) {
        await this.books.stockPostedInTx(tx, actor, facts);
      }
    }
    return { postedAt, effectiveDate, numbers, unitCosts };
  }

  /**
   * The books' view of the rows one posting wrote (F4, ADR-0097; TODO-VERIFY D8): per document,
   * the value of its rows (`valueOf(qty, unit cost)`, signed) by what they did — received, sold or
   * returned from a sale, lost or found (an adjustment's reason, a count's sign), the opening stock,
   * issued for an expense type. A goods issue to a supplier is the supplier's credit (F3), never
   * here; value-neutral moves book only a non-zero remainder.
   */
  private async bookFacts(
    tx: Db | Tx,
    written: readonly { row: typeof stockLedger.$inferInsert; id: number }[],
    numbers: ReadonlyMap<number, string>,
    effectiveDate: string,
  ): Promise<StockPostedFacts[]> {
    // A correction's reversal rows (ADR-0117 #5) are the corrected issue's type and party, booked
    // as a document of their own beside the new content.
    const byDoc = new Map<string, { row: typeof stockLedger.$inferInsert; id: number }[]>();
    for (const entry of written) {
      const reversal = entry.row.movementType === 'GOODS_ISSUE_REVERSAL' ? ':R' : '';
      const key = `${entry.row.docType}:${entry.row.docId}${reversal}`;
      byDoc.set(key, [...(byDoc.get(key) ?? []), entry]);
    }
    const facts: StockPostedFacts[] = [];
    for (const entries of byDoc.values()) {
      const first = entries[0];
      if (!first) continue;
      const docType = first.row.docType;
      const docId = first.row.docId;
      let reason: string | null = null;
      let issue: {
        code: string | null;
        typeId: number | null;
        supplier: boolean;
        party: StockBookParty | undefined;
      } | null = null;
      if (docType === 'ADJ') {
        const [row] = await tx
          .select({ reason: adjustments.reason })
          .from(adjustments)
          .where(eq(adjustments.id, docId));
        reason = row?.reason ?? null;
      }
      if (docType === 'GI') {
        issue = await this.issueFacts(tx, docId, first.row.movementType === 'GOODS_ISSUE_REVERSAL');
        // The supplier's AP credit takes the stock out (F3, ADR-0091).
        if (issue.supplier) continue;
      }
      const sums = new Map<string, StockBookLine>();
      let neutral = ZERO;
      for (const { row } of entries) {
        const value = valueOf(
          new Decimal(row.qtyBase.toString()),
          new Decimal(row.unitCost.toString()),
        );
        const kind = bookKindOf(row.movementType, reason, value);
        if (kind === null) {
          neutral = neutral.plus(value);
          continue;
        }
        const code = kind === 'ISSUE' ? (issue?.code ?? null) : null;
        const key = `${kind}:${code ?? ''}`;
        const line = sums.get(key);
        sums.set(key, {
          kind,
          ...(kind === 'ISSUE' ? { issueType: code, issueTypeId: issue?.typeId ?? null } : {}),
          value: (line?.value ?? ZERO).plus(value),
        });
      }
      if (!neutral.isZero()) {
        const kind: StockBookKind = neutral.isNegative() ? 'LOSS' : 'GAIN';
        const line = sums.get(`${kind}:`);
        sums.set(`${kind}:`, { kind, value: (line?.value ?? ZERO).plus(neutral) });
      }
      const lines = [...sums.values()].filter((line) => !line.value.isZero());
      if (lines.length === 0) continue;
      facts.push({
        docType,
        docId,
        number: numbers.get(docId) ?? null,
        date: effectiveDate,
        firstLedgerId: Math.min(...entries.map((entry) => entry.id)),
        lines,
        warehouseIds: [...new Set(entries.map((entry) => entry.row.warehouseId))],
        ...(issue?.party ? { party: issue.party } : {}),
      });
    }
    return facts;
  }

  /**
   * A goods issue as the books see it: its expense type and its party (ADR-0117 #2). For a
   * correction's reversal rows, the corrected issue's (`corrects_issue_id`).
   */
  private async issueFacts(
    tx: Db | Tx,
    issueId: number,
    ofParent: boolean,
  ): Promise<{
    code: string | null;
    typeId: number | null;
    supplier: boolean;
    party: StockBookParty | undefined;
  }> {
    const [own] = await tx
      .select({ parentId: goodsIssues.correctsIssueId })
      .from(goodsIssues)
      .where(eq(goodsIssues.id, issueId));
    const id = ofParent ? (own?.parentId ?? issueId) : issueId;
    const [row] = await tx
      .select({
        code: issueExpenseTypes.code,
        typeId: goodsIssues.expenseTypeId,
        recipientKind: goodsIssues.recipientKind,
        recipientUserId: goodsIssues.recipientUserId,
        recipientCustomerId: goodsIssues.recipientCustomerId,
        recipientSupplierId: goodsIssues.recipientSupplierId,
        recipientName: goodsIssues.recipientName,
      })
      .from(goodsIssues)
      .innerJoin(issueExpenseTypes, eq(issueExpenseTypes.id, goodsIssues.expenseTypeId))
      .where(eq(goodsIssues.id, id));
    if (!row) return { code: null, typeId: null, supplier: false, party: undefined };
    const partyId =
      row.recipientKind === 'USER'
        ? row.recipientUserId
        : row.recipientKind === 'CUSTOMER'
          ? row.recipientCustomerId
          : row.recipientKind === 'SUPPLIER'
            ? row.recipientSupplierId
            : null;
    return {
      code: row.code,
      typeId: row.typeId,
      supplier: row.recipientKind === 'SUPPLIER',
      party: { kind: row.recipientKind, id: partyId, name: row.recipientName ?? '' },
    };
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
          docAmount: line.docAmount ?? null,
          discountAmount: line.discountAmount ?? null,
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
          docAmount: result.docAmount,
          discountAmount: result.discountAmount,
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
    // The books (F4, ADR-0097): what the costing moved in the stock and what had already left.
    if (this.books) {
      const absorbed = results.reduce((sum, result) => sum.plus(result.absorbed), ZERO);
      const variance = results.reduce((sum, result) => sum.plus(result.variance), ZERO);
      if (!absorbed.isZero() || !variance.isZero()) {
        const [receipt] = await tx
          .select({ number: goodsReceipts.number })
          .from(goodsReceipts)
          .where(eq(goodsReceipts.id, input.docId));
        await this.books.stockRevaluedInTx(tx, actor, {
          receiptId: input.docId,
          number: receipt?.number ?? null,
          version: input.version,
          date: effectiveDate,
          absorbed,
          variance,
          warehouseIds: [...new Set(input.lines.map((line) => line.warehouseId))],
        });
      }
    }
    return results;
  }

  /**
   * The books' view of the whole ledger, one posting at a time (the development re-post of F4,
   * ADR-0097): the rows of one document written in one transaction share their posting time.
   */
  async historyFacts(): Promise<StockPostedFacts[]> {
    const rows = await this.db.select().from(stockLedger).orderBy(stockLedger.id);
    const groups = new Map<string, { row: typeof stockLedger.$inferInsert; id: number }[]>();
    for (const row of rows) {
      const key = `${row.docType}:${row.docId}:${row.postedAt.toISOString()}`;
      groups.set(key, [...(groups.get(key) ?? []), { row, id: row.id }]);
    }
    const facts: StockPostedFacts[] = [];
    for (const entries of groups.values()) {
      const date = entries[0]?.row.effectiveDate;
      if (typeof date !== 'string') continue;
      facts.push(...(await this.bookFacts(this.db, entries, new Map(), date)));
    }
    return facts;
  }

  /** Every receipt costing's absorbed value and variance (the development re-post, F4). */
  async revaluationHistory(): Promise<StockRevaluedFacts[]> {
    const result = await this.db.execute<{
      doc_id: number;
      version: number;
      date: string;
      absorbed: string;
      variance: string;
      number: string | null;
      warehouse_ids: string[];
    }>(sql`
      SELECT v.doc_id::int AS doc_id, v.version::int AS version, min(v.effective_date)::text AS date,
             sum(v.absorbed)::text AS absorbed, sum(v.variance)::text AS variance, r.number,
             array_agg(DISTINCT v.warehouse_id::text) AS warehouse_ids
        FROM stock_valuation_adjustments v
        JOIN goods_receipts r ON r.id = v.doc_id
       WHERE v.doc_type = 'GR'
       GROUP BY v.doc_id, v.version, r.number
       ORDER BY v.doc_id, v.version`);
    return result.rows.flatMap((row) => {
      const absorbed = new Decimal(row.absorbed);
      const variance = new Decimal(row.variance);
      return absorbed.isZero() && variance.isZero()
        ? []
        : [
            {
              receiptId: row.doc_id,
              number: row.number,
              version: row.version,
              date: row.date,
              absorbed,
              variance,
              warehouseIds: row.warehouse_ids.map(toId),
            },
          ];
    });
  }

  /**
   * The stock's value: Σ on hand × average per warehouse balance, rounded to the tugrik's cents
   * (F4, ADR-0097: the books' INVENTORY account follows it).
   */
  async stockValue(executor: Db | Tx = this.db): Promise<Decimal> {
    const [row] = await executor
      .execute<{ value: string }>(
        sql`SELECT coalesce(sum(round(on_hand * avg_cost, 2)), 0)::text AS value FROM warehouse_stock`,
      )
      .then((result) => result.rows);
    return new Decimal(row?.value ?? 0);
  }

  /**
   * Each product's outflow per warehouse between two business dates, both included (ADR-0115, a
   * purchase order's «last month»): wholesale deliveries less credit-note returns, plus transfers
   * shipped to a supermarket (a STORE warehouse), in base units. Product → warehouse → quantity.
   */
  async outflow(
    productIds: readonly number[],
    from: string,
    to: string,
    executor: Db | Tx = this.db,
  ): Promise<Map<number, Map<number, Decimal>>> {
    const result = new Map<number, Map<number, Decimal>>();
    const ids = [...new Set(productIds)];
    if (ids.length === 0) return result;
    const rows = await executor.execute<{ product_id: string; warehouse_id: string; qty: string }>(
      sql`
      SELECT l.product_id::text AS product_id, l.warehouse_id::text AS warehouse_id,
             sum(-l.qty_base)::text AS qty
        FROM stock_ledger l
        LEFT JOIN transfers t ON l.doc_type = 'TR' AND t.id = l.doc_id
        LEFT JOIN warehouses d ON d.id = t.dest_warehouse_id
       WHERE l.product_id IN (${sql.join(
         ids.map((id) => sql`${id}`),
         sql`, `,
       )})
         AND l.effective_date BETWEEN ${from}::date AND ${to}::date
         AND (l.movement_type = 'DELIVERY_ISSUE'
              OR (l.movement_type = 'RETURN_IN' AND l.doc_type = 'CN')
              OR (l.movement_type = 'TRANSFER_OUT' AND l.warehouse_id = t.source_warehouse_id
                  AND d.kind = 'STORE'))
       GROUP BY l.product_id, l.warehouse_id`,
    );
    for (const row of rows.rows) {
      const productId = Number.parseInt(row.product_id, 10);
      const byWarehouse = result.get(productId) ?? new Map<number, Decimal>();
      byWarehouse.set(Number.parseInt(row.warehouse_id, 10), new Decimal(row.qty));
      result.set(productId, byWarehouse);
    }
    return result;
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
        docAmount: row.docAmount,
        discountAmount: row.discountAmount,
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

  /**
   * Each costed receipt's payable at its latest version (ADR-0099 #4): Σ over its priced lines of the
   * delivery-note amount less the line's discount share. The receipt list's amount column.
   */
  async receiptPayables(
    docIds: readonly number[],
    executor: Db | Tx = this.db,
  ): Promise<Map<number, Decimal>> {
    const payables = new Map<number, Decimal>();
    if (docIds.length === 0) return payables;
    const rows = await executor
      .select({
        docId: stockValuationAdjustments.docId,
        docLineId: stockValuationAdjustments.docLineId,
        amount: stockValuationAdjustments.amount,
        docAmount: stockValuationAdjustments.docAmount,
        discountAmount: stockValuationAdjustments.discountAmount,
        freeGoods: stockValuationAdjustments.freeGoods,
      })
      .from(stockValuationAdjustments)
      .where(
        and(
          eq(stockValuationAdjustments.docType, 'GR'),
          inArray(stockValuationAdjustments.docId, [...docIds]),
        ),
      )
      .orderBy(desc(stockValuationAdjustments.version));
    const seen = new Set<number>();
    for (const row of rows) {
      if (seen.has(row.docLineId)) continue;
      seen.add(row.docLineId);
      const payable = row.freeGoods
        ? ZERO
        : (row.docAmount ?? row.amount).minus(row.discountAmount ?? ZERO);
      payables.set(row.docId, (payables.get(row.docId) ?? ZERO).plus(payable));
    }
    return payables;
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
   * Movement history (SPEC §8.2 #1): ledger rows newest first with their shelf and document
   * number. With a product, each row also carries the product's balance in its warehouse and its
   * bin right after the movement, computed over the product's whole history.
   */
  async movements(
    query: MovementQuery,
  ): Promise<{ data: LedgerMovement[]; nextCursor: string | null }> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const filters: SQL[] = [];
    if (query.productId !== undefined) filters.push(eq(stockLedger.productId, query.productId));
    if (query.warehouseId !== undefined) {
      filters.push(eq(stockLedger.warehouseId, query.warehouseId));
    }
    if (query.binId !== undefined) filters.push(eq(stockLedger.binId, query.binId));
    if (query.docType !== undefined) filters.push(eq(stockLedger.docType, query.docType));
    if (query.from !== undefined) filters.push(gte(stockLedger.effectiveDate, query.from));
    if (query.to !== undefined) filters.push(lte(stockLedger.effectiveDate, query.to));
    const after = decodeCursor(query.cursor);
    if (typeof after?.id === 'number') filters.push(lt(stockLedger.id, after.id));
    const rows = await this.db
      .select({
        id: stockLedger.id,
        postedAt: stockLedger.postedAt,
        effectiveDate: stockLedger.effectiveDate,
        warehouseId: stockLedger.warehouseId,
        binId: stockLedger.binId,
        binCode: bins.code,
        productId: stockLedger.productId,
        lotId: stockLedger.lotId,
        qtyBase: stockLedger.qtyBase,
        unitCost: stockLedger.unitCost,
        movementType: stockLedger.movementType,
        docType: stockLedger.docType,
        docId: stockLedger.docId,
        docNumber: sql<string | null>`CASE "stock_ledger"."doc_type"
          WHEN 'GR' THEN (SELECT d.number FROM goods_receipts d WHERE d.id = "stock_ledger"."doc_id")
          WHEN 'BM' THEN (SELECT d.number FROM bin_moves d WHERE d.id = "stock_ledger"."doc_id")
          WHEN 'ADJ' THEN (SELECT d.number FROM adjustments d WHERE d.id = "stock_ledger"."doc_id")
          WHEN 'ST' THEN (SELECT d.number FROM stocktakes d WHERE d.id = "stock_ledger"."doc_id")
          WHEN 'TR' THEN (SELECT d.number FROM transfers d WHERE d.id = "stock_ledger"."doc_id")
          WHEN 'SO' THEN (SELECT d.number FROM sales_orders d WHERE d.id = "stock_ledger"."doc_id")
          WHEN 'CN' THEN (SELECT d.number FROM credit_notes d WHERE d.id = "stock_ledger"."doc_id")
          WHEN 'POS' THEN (SELECT d.number FROM pos_sales d WHERE d.id = "stock_ledger"."doc_id")
          WHEN 'GI' THEN (SELECT d.number FROM goods_issues d WHERE d.id = "stock_ledger"."doc_id")
        END`,
        enteredQty: stockLedger.enteredQty,
        productUnitId: stockLedger.productUnitId,
      })
      .from(stockLedger)
      .innerJoin(bins, eq(bins.id, stockLedger.binId))
      .where(and(...filters))
      .orderBy(desc(stockLedger.id))
      .limit(limit + 1);
    const page = toPage(rows, limit, (row) => ({ id: row.id }));
    const balances = new Map<number, { warehouse: Decimal; bin: Decimal }>();
    if (query.productId !== undefined && page.data.length > 0) {
      const ids = page.data.map((row) => row.id);
      const result = await this.db.execute<{ id: string; warehouse: string; bin: string }>(sql`
        SELECT h.id::text AS id, h.warehouse::text AS warehouse, h.bin::text AS bin FROM (
          SELECT id,
            sum(qty_base) OVER (PARTITION BY warehouse_id ORDER BY id) AS warehouse,
            sum(qty_base) OVER (PARTITION BY bin_id ORDER BY id) AS bin
          FROM stock_ledger WHERE product_id = ${query.productId}
        ) h
        WHERE h.id IN (${sql.join(
          ids.map((id) => sql`${id}`),
          sql`, `,
        )})`);
      for (const row of result.rows) {
        balances.set(Number.parseInt(row.id, 10), {
          warehouse: new Decimal(row.warehouse),
          bin: new Decimal(row.bin),
        });
      }
    }
    return {
      data: page.data.map((row) => ({
        ...row,
        warehouseBalance: balances.get(row.id)?.warehouse ?? null,
        binBalance: balances.get(row.id)?.bin ?? null,
      })),
      nextCursor: page.nextCursor,
    };
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
   * The snapshot tables' monthly partitions (D9, ADR-0040): this Ulaanbaatar month to 24 months
   * ahead exist afterwards, months more than 13 back are dropped. `app` cannot create tables, so a
   * migrator-owned SECURITY DEFINER function does the work; the lock keeps two callers apart.
   */
  maintainSnapshotPartitions(): Promise<SnapshotPartitions> {
    return inTransaction(this.db, async (tx) => {
      await advisoryLock(tx, LOCKS.snapshotPartitions);
      const { rows } = await tx.execute<{ created: number; dropped: number }>(
        sql`SELECT created, dropped FROM maintain_stock_snapshot_partitions()`,
      );
      const [result] = rows;
      if (!result) throw new Error('maintain_stock_snapshot_partitions returned no row');
      return { created: result.created, dropped: result.dropped };
    });
  }

  /**
   * The monthly bin snapshot (D9): every bin's balance at the start of `asOf`, the first day of a
   * month (default: this Ulaanbaatar month), summed from the ledger's movements dated before it,
   * so a run days late is still exact. Running a month again rewrites it, a balance gone to zero
   * since then as 0 (`app` may not delete snapshot rows). The month's partition must exist.
   */
  snapshotBins(asOf?: string): Promise<BinSnapshot> {
    return inTransaction(this.db, async (tx) => {
      const snapshotDate = asOf ?? businessMonthStart(await transactionTime(tx));
      if (!isIsoDate(snapshotDate) || !snapshotDate.endsWith('-01')) {
        throw new Error(`a bin snapshot is taken on the first day of a month, not ${snapshotDate}`);
      }
      const written = await tx.execute(sql`
        INSERT INTO stock_snapshot_bin_monthly
          (snapshot_date, warehouse_id, bin_id, product_id, lot_id, on_hand)
        SELECT ${snapshotDate}::date, l.warehouse_id, l.bin_id, l.product_id, l.lot_id, sum(l.qty_base)
          FROM stock_ledger l
         WHERE l.effective_date < ${snapshotDate}::date
         GROUP BY l.warehouse_id, l.bin_id, l.product_id, l.lot_id
        HAVING sum(l.qty_base) <> 0
            OR EXISTS (
              SELECT 1 FROM stock_snapshot_bin_monthly s
               WHERE s.snapshot_date = ${snapshotDate}::date
                 AND s.warehouse_id = l.warehouse_id AND s.bin_id = l.bin_id
                 AND s.product_id = l.product_id AND s.lot_id IS NOT DISTINCT FROM l.lot_id)
        ON CONFLICT ON CONSTRAINT stock_snapshot_bin_monthly_key DO UPDATE
          SET on_hand = excluded.on_hand`);
      return { snapshotDate, rows: written.rowCount ?? 0 };
    });
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
         WHERE coalesce(k.sellable, 0) <> coalesce(c.sellable_on_hand, 0)),
      held AS (
        SELECT warehouse_id, product_id, lot_id, sum(qty_base) AS qty
          FROM stock_reservations WHERE status = 'ACTIVE' GROUP BY warehouse_id, product_id, lot_id),
      reserved_diff AS (
        SELECT 'RESERVED' AS level, coalesce(k.warehouse_id, c.warehouse_id) AS warehouse_id, NULL::bigint AS bin_id,
               coalesce(k.product_id, c.product_id) AS product_id, coalesce(k.lot_id, c.lot_id) AS lot_id,
               coalesce(k.qty, 0) AS ledger, coalesce(c.reserved, 0) AS cache
          FROM held k
          FULL JOIN warehouse_stock c ON c.warehouse_id = k.warehouse_id AND c.product_id = k.product_id
                                     AND coalesce(c.lot_id, 0) = coalesce(k.lot_id, 0)
         WHERE coalesce(k.qty, 0) <> coalesce(c.reserved, 0))
      SELECT level, warehouse_id::text, bin_id::text, product_id::text, lot_id::text, ledger::text, cache::text
        FROM (SELECT * FROM bin_diff UNION ALL SELECT * FROM wh_diff UNION ALL SELECT * FROM sellable_diff
              UNION ALL SELECT * FROM reserved_diff) d
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
    if (!doc.partial && status === doc.nextStatus) {
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
      case 'GI': {
        const [row] = await tx
          .select({ status: goodsIssues.status })
          .from(goodsIssues)
          .where(eq(goodsIssues.id, doc.docId))
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

  /** The number a partially posted goods issue already carries (its first part's), if any. */
  private async existingNumber(tx: Tx, doc: PostingDoc): Promise<string | null> {
    if (doc.docType !== 'GI') {
      throw new Error(`${doc.docType} ${doc.docId}: only a goods issue posts in parts`);
    }
    const [row] = await tx
      .select({ number: goodsIssues.number })
      .from(goodsIssues)
      .where(eq(goodsIssues.id, doc.docId));
    return row?.number ?? null;
  }

  private async finishDoc(tx: Tx, doc: PostingDoc, values: DocStamp): Promise<void> {
    if (doc.docType === 'TR') {
      await this.finishTransfer(tx, doc, values);
      return;
    }
    if (doc.partial && doc.docType === 'GI') {
      // A part of a goods issue (ADR-0117 #2): the first part numbers and dates the document, the
      // status is the owner's (POSTED once every warehouse confirmed).
      await tx
        .update(goodsIssues)
        .set({
          ...(values.number === null ? {} : { number: values.number }),
          effectiveDate: sql`coalesce(${goodsIssues.effectiveDate}, ${values.effectiveDate}::date)`,
          updatedAt: values.postedAt,
        })
        .where(eq(goodsIssues.id, doc.docId));
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
      case 'GI':
        await tx
          .update(goodsIssues)
          .set({ ...common, status: 'POSTED' })
          .where(eq(goodsIssues.id, doc.docId));
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

  /** The (warehouse, product, lot) keys of the lines' ACTIVE reservations, without a lock. */
  private async reservationKeys(
    tx: Tx,
    consume: ReservationConsume,
  ): Promise<{ warehouseId: number; productId: number; lotId: number | null }[]> {
    if (consume.docLineIds.length === 0) return [];
    const rows = await tx
      .selectDistinct({
        warehouseId: stockReservations.warehouseId,
        productId: stockReservations.productId,
        lotId: stockReservations.lotId,
      })
      .from(stockReservations)
      .where(
        and(
          eq(stockReservations.docType, consume.docType),
          idIn(stockReservations.docLineId, consume.docLineIds),
          eq(stockReservations.status, 'ACTIVE'),
        ),
      );
    return rows;
  }

  /**
   * Marks the lines' ACTIVE reservations CONSUMED (a line that moved stock out) or RELEASED (a line
   * picked at zero) and returns the quantity freed per locked warehouse row (ADR-0056 #6).
   */
  private async consumeReservations(
    tx: Tx,
    consume: ReservationConsume,
    movements: readonly Movement[],
    warehouseRows: ReadonlyMap<string, WarehouseRow>,
  ): Promise<Map<string, Decimal>> {
    const picked = [
      ...new Set(
        movements
          .filter((m) => m.docType === consume.docType && m.qtyBase.isNegative())
          .map((m) => m.docLineId),
      ),
    ];
    const { rows } = await tx.execute<{
      warehouse_id: string;
      product_id: string;
      lot_id: string | null;
      qty: string;
    }>(sql`
      WITH done AS (
        UPDATE stock_reservations
           SET status = CASE WHEN doc_line_id = ANY(${sql.param(picked)}::bigint[]) THEN 'CONSUMED' ELSE 'RELEASED' END,
               updated_at = now()
         WHERE doc_type = ${consume.docType}
           AND doc_line_id = ANY(${sql.param([...consume.docLineIds])}::bigint[])
           AND status = 'ACTIVE'
        RETURNING warehouse_id, product_id, lot_id, qty_base)
      SELECT warehouse_id::text, product_id::text, lot_id::text, sum(qty_base)::text AS qty
        FROM done GROUP BY warehouse_id, product_id, lot_id`);
    const freed = new Map<string, Decimal>();
    for (const row of rows) {
      const key = wsKey(toId(row.warehouse_id), toId(row.product_id), toInt(row.lot_id));
      if (!warehouseRows.has(key)) throw new Error(`reservation on an unlocked balance ${key}`);
      freed.set(key, new Decimal(row.qty));
    }
    return freed;
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
function validateMovements(docs: readonly AnyPostingDoc[], movements: readonly Movement[]): void {
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
