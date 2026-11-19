import { Inject, Injectable } from '@nestjs/common';
import {
  type StockProblemOutcome,
  type StockProblemSheetStatus,
  stockProblemDifference,
  stockProblemOutcome,
} from '@tugeel/shared';
import mn from '@tugeel/shared/i18n/mn.json';
import { Decimal } from '@tugeel/shared/money';
import { businessDate } from '@tugeel/shared/time';
import { and, asc, desc, eq, inArray, isNotNull, lt, type SQL, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { decodeCursor, DEFAULT_PAGE_LIMIT, toPage } from '../../../common/pagination/page';
import { CatalogService, type ProductSummary } from '../../catalog';
import {
  type Actor,
  actorUserId,
  AuditService,
  type AuthContext,
  ScopeService,
  systemActor,
  UserNamesService,
  type Warehouse,
} from '../../identity';
import {
  type AdjustmentLineInput,
  AdjustmentsService,
  BinsService,
  GoodsIssuesService,
  ProductLocationsService,
} from '../../inventory';
import { stockProblemResolutions, stockProblemSheetLines, stockProblemSheets } from '../schema';
import { StockProblemsService } from './stock-problems.service';

const ADJUSTMENTS_APPROVE = 'inventory.adjustments.approve';

type SheetRow = typeof stockProblemSheets.$inferSelect;
type LineRow = typeof stockProblemSheetLines.$inferSelect;

export interface SheetSummary {
  id: number;
  warehouseId: number;
  warehouseCode: string;
  warehouseName: string;
  sheetDate: string;
  status: StockProblemSheetStatus;
  lineCount: number;
  countedCount: number;
  builtAt: Date;
  /** Null for the 07:00 job. */
  builtByName: string | null;
  approvedAt: Date | null;
  approvedByName: string | null;
  /** The goods issue of the shortages and the adjustment of the surpluses, once approved. */
  issueId: number | null;
  adjustmentId: number | null;
}

export interface SheetLine {
  id: number;
  sheetId: number;
  product: ProductSummary;
  /** The product's fixed shelf in the warehouse, where the counter looks first. */
  binCode: string | null;
  /** As the sheet was built. */
  systemQty: Decimal;
  redQty: Decimal;
  cutQty: Decimal;
  countedQty: Decimal | null;
  /** The warehouse's on-hand at the moment the count was entered. */
  onHandAtCount: Decimal | null;
  /** counted − on-hand at the count. */
  difference: Decimal | null;
  countedAt: Date | null;
  countedByName: string | null;
  outcome: StockProblemOutcome | null;
  resolutionId: number | null;
}

export interface SheetDetail extends SheetSummary {
  lines: SheetLine[];
}

export interface SheetQuery {
  warehouseId?: number;
  status?: StockProblemSheetStatus;
  sheetDate?: string;
  cursor?: string;
  limit?: number;
}

/**
 * The morning sheets (ADR-0230 #5–#7): every morning at 07:00 each warehouse with problem products
 * gets the day's sheet with the system's quantities at that moment; «Барааны мэргэжилтэн» counts it
 * in the staff app; the office approves it, and the differences go to the books — the shortages as
 * one goods issue to the warehouse's fixed customer and expense type, the surpluses as one
 * adjustment «Илүүдэл». Stock moves only when those documents post.
 */
@Injectable()
export class StockProblemSheetsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly problems: StockProblemsService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
    private readonly names: UserNamesService,
    private readonly catalog: CatalogService,
    private readonly issues: GoodsIssuesService,
    private readonly adjustments: AdjustmentsService,
    private readonly locations: ProductLocationsService,
    private readonly bins: BinsService,
  ) {}

  // ---------------------------------------------------------------------------------- building

  /**
   * Builds today's sheet of every warehouse with problem products (the 07:00 job: `ctx` null), or
   * of the user's warehouses, or of one of them. Safe to repeat: an open sheet of today only gains
   * the products that became a problem since; an approved one is left alone. A product whose
   * decision waits for its document, or whose count waits for an approval on an older sheet, is
   * left off. Older open sheets nobody counted are closed.
   */
  async build(ctx: AuthContext | null, warehouseId?: number): Promise<SheetSummary[]> {
    await this.problems.sync(ctx);
    let warehouses: Warehouse[];
    if (ctx === null) warehouses = await this.problems.problemWarehouses();
    else if (warehouseId === undefined) warehouses = await this.problems.warehousesOf(ctx);
    else warehouses = [await this.problems.warehouseFor(ctx, warehouseId)];
    const actor: Actor = ctx ?? systemActor('stockproblems.morningSheets');
    const sheetDate = businessDate();
    const ids: number[] = [];
    for (const warehouse of warehouses) {
      const id = await this.buildOne(actor, warehouse.id, sheetDate);
      if (id !== null) ids.push(id);
    }
    return this.summaries(
      ids.length === 0 ? [] : await this.sheetRows(inArray(stockProblemSheets.id, ids)),
    );
  }

  private async buildOne(
    actor: Actor,
    warehouseId: number,
    sheetDate: string,
  ): Promise<number | null> {
    const listed = (await this.problems.problemsOf([warehouseId])).filter(
      (problem) => problem.pending === null,
    );
    return inTransaction(this.db, async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`stock_problem_sheet:${warehouseId}`}, 0))`,
      );
      const older = await tx
        .select({ id: stockProblemSheets.id })
        .from(stockProblemSheets)
        .where(
          and(
            eq(stockProblemSheets.warehouseId, warehouseId),
            eq(stockProblemSheets.status, 'OPEN'),
            lt(stockProblemSheets.sheetDate, sheetDate),
          ),
        )
        .for('update');
      const waiting = new Set<number>();
      for (const sheet of older) {
        const counted = await tx
          .select({ productId: stockProblemSheetLines.productId })
          .from(stockProblemSheetLines)
          .where(
            and(
              eq(stockProblemSheetLines.sheetId, sheet.id),
              isNotNull(stockProblemSheetLines.countedQty),
            ),
          );
        if (counted.length > 0) {
          for (const line of counted) waiting.add(line.productId);
          continue;
        }
        await tx
          .update(stockProblemSheets)
          .set({ status: 'CLOSED', updatedAt: sql`now()` })
          .where(eq(stockProblemSheets.id, sheet.id));
        await this.audit.record(tx, actor, {
          action: 'CLOSE',
          entity: 'stock_problem_sheets',
          entityId: sheet.id,
          after: { status: 'CLOSED', replacedBy: sheetDate },
        });
      }
      const wanted = listed.filter((problem) => !waiting.has(problem.product.id));
      let [sheet] = await tx
        .select()
        .from(stockProblemSheets)
        .where(
          and(
            eq(stockProblemSheets.warehouseId, warehouseId),
            eq(stockProblemSheets.sheetDate, sheetDate),
          ),
        )
        .for('update');
      if (sheet && sheet.status !== 'OPEN') return sheet.id;
      if (!sheet && wanted.length === 0) return null;
      const fresh = !sheet;
      if (!sheet) {
        [sheet] = await tx
          .insert(stockProblemSheets)
          .values({ warehouseId, sheetDate, builtBy: actorUserId(actor) })
          .returning();
        if (!sheet) throw new Error('sheet insert returned no row');
      }
      const have = new Set(
        (
          await tx
            .select({ productId: stockProblemSheetLines.productId })
            .from(stockProblemSheetLines)
            .where(eq(stockProblemSheetLines.sheetId, sheet.id))
        ).map((line) => line.productId),
      );
      const added = wanted.filter((problem) => !have.has(problem.product.id));
      if (added.length > 0) {
        await tx.insert(stockProblemSheetLines).values(
          added.map((problem) => ({
            sheetId: sheet.id,
            productId: problem.product.id,
            systemQty: problem.onHand,
            redQty: problem.redQty,
            cutQty: problem.cutQty,
          })),
        );
      }
      if (fresh || added.length > 0) {
        await this.audit.record(tx, actor, {
          action: fresh ? 'CREATE' : 'UPDATE',
          entity: 'stock_problem_sheets',
          entityId: sheet.id,
          after: { warehouseId, sheetDate, added: added.map((problem) => problem.product.id) },
        });
      }
      return sheet.id;
    });
  }

  // ------------------------------------------------------------------------------------- reads

  /** The sheets of the user's warehouses, the newest first. */
  async list(
    ctx: AuthContext,
    query: SheetQuery,
  ): Promise<{ data: SheetSummary[]; nextCursor: string | null }> {
    const warehouses = await this.problems.warehousesOf(ctx);
    const allowed = warehouses
      .map((warehouse) => warehouse.id)
      .filter((id) => query.warehouseId === undefined || id === query.warehouseId);
    if (allowed.length === 0) return { data: [], nextCursor: null };
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const after = decodeCursor(query.cursor);
    const filters: SQL[] = [inArray(stockProblemSheets.warehouseId, allowed)];
    if (query.status) filters.push(eq(stockProblemSheets.status, query.status));
    if (query.sheetDate) filters.push(eq(stockProblemSheets.sheetDate, query.sheetDate));
    if (typeof after?.id === 'number') filters.push(lt(stockProblemSheets.id, after.id));
    const rows = await this.sheetRows(and(...filters), limit + 1);
    const page = toPage(rows, limit, (row) => ({ id: row.id }));
    return { data: await this.summaries(page.data), nextCursor: page.nextCursor };
  }

  /** A sheet with its lines in the order of the shelves' codes: the read the web prints. */
  async get(ctx: AuthContext, id: number): Promise<SheetDetail> {
    const sheet = await this.sheetFor(ctx, id);
    const [detail] = await this.details([sheet]);
    if (!detail) throw notFound('stock_problem_sheet', id);
    return detail;
  }

  /** The staff app: today's open sheets of the counter's warehouses, with their lines. */
  async mine(ctx: AuthContext): Promise<SheetDetail[]> {
    const warehouses = await this.problems.warehousesOf(ctx);
    if (warehouses.length === 0) return [];
    const rows = await this.sheetRows(
      and(
        inArray(
          stockProblemSheets.warehouseId,
          warehouses.map((warehouse) => warehouse.id),
        ),
        eq(stockProblemSheets.status, 'OPEN'),
        eq(stockProblemSheets.sheetDate, businessDate()),
      ),
    );
    return this.details(rows);
  }

  // ---------------------------------------------------------------------------------- counting

  /**
   * The counter's quantity of a line, in base units; it may be entered again until the sheet is
   * approved. Each entry stores the warehouse's on-hand at that moment and the difference against
   * it, so what moves afterwards stays in the stock.
   */
  async count(ctx: AuthContext, lineId: number, countedQty: Decimal): Promise<SheetLine> {
    if (countedQty.isNegative()) throw invalid('countedQty', 'min', 'zero or more');
    const sheetId = await inTransaction(this.db, async (tx) => {
      const [line] = await tx
        .select()
        .from(stockProblemSheetLines)
        .where(eq(stockProblemSheetLines.id, lineId));
      if (!line) throw notFound('stock_problem_sheet_line', lineId);
      const sheet = await this.lockSheet(tx, ctx, line.sheetId);
      if (sheet.status !== 'OPEN') throw sheetState(sheet);
      const onHand =
        (await this.problems.onHandOf(sheet.warehouseId, [line.productId])).get(line.productId) ??
        new Decimal(0);
      const values = {
        countedQty,
        onHandAtCount: onHand,
        difference: stockProblemDifference(countedQty, onHand),
        countedAt: sql`now()`,
        countedBy: ctx.userId,
      };
      await tx
        .update(stockProblemSheetLines)
        .set(values)
        .where(eq(stockProblemSheetLines.id, lineId));
      await this.audit.record(tx, ctx, {
        action: 'COUNT',
        entity: 'stock_problem_sheet_lines',
        entityId: lineId,
        before: { countedQty: line.countedQty, onHandAtCount: line.onHandAtCount },
        after: { countedQty, onHandAtCount: onHand, difference: values.difference },
      });
      return sheet.id;
    });
    const line = (await this.get(ctx, sheetId)).lines.find((row) => row.id === lineId);
    if (!line) throw notFound('stock_problem_sheet_line', lineId);
    return line;
  }

  // --------------------------------------------------------------------------------- approving

  /**
   * Approves a counted sheet. Every line must be counted unless `countedOnly` (the uncounted
   * products stay on the list for the next morning). Shortage lines become ONE goods issue to the
   * warehouse's fixed customer and expense type, created and sent here and confirmed by the keeper
   * (ADR-0117); surplus lines become ONE adjustment «Илүүдэл», submitted here and posted at once
   * when the approver holds `inventory.adjustments.approve`, else left for that approver; equal
   * lines are resolved at once. A product leaves the list when its document posts. Repeating the
   * call on an approved sheet changes nothing.
   */
  async approve(
    ctx: AuthContext,
    id: number,
    options: { countedOnly?: boolean } = {},
  ): Promise<SheetDetail> {
    const peek = await this.sheetFor(ctx, id);
    const warehouse = await this.problems.warehouseFor(ctx, peek.warehouseId);
    const docs = await inTransaction(this.db, async (tx) => {
      const sheet = await this.lockSheet(tx, ctx, id);
      if (sheet.status === 'APPROVED') return null;
      if (sheet.status !== 'OPEN') throw sheetState(sheet);
      const lines = await tx
        .select()
        .from(stockProblemSheetLines)
        .where(eq(stockProblemSheetLines.sheetId, id))
        .orderBy(asc(stockProblemSheetLines.productId))
        .for('update');
      const counted = lines.filter((line) => line.countedQty !== null);
      if (counted.length === 0) throw invalid('lines', 'empty', 'nothing is counted yet');
      if (!options.countedOnly && counted.length < lines.length) {
        throw new AppError('CONFLICT', 'the sheet has lines nobody counted', {
          reason: 'SHEET_LINES_UNCOUNTED',
          count: lines.length - counted.length,
        });
      }
      // The same lock «Зүй ёсны» and «Үлдэгдэл тэглэх» take, in product order (the lines are read
      // in it), before the waiting decisions are read: a zero-out sent at the same moment either
      // is seen here or finds this approval's decision, never both missing each other.
      for (const line of counted) {
        await this.problems.lockProduct(tx, sheet.warehouseId, line.productId);
      }
      // A product whose decision already waits for a document (zeroed after the sheet was built)
      // keeps that decision: its count is left without an outcome.
      const busy = new Set(
        (
          await tx
            .select({ productId: stockProblemResolutions.productId })
            .from(stockProblemResolutions)
            .where(
              and(
                eq(stockProblemResolutions.warehouseId, sheet.warehouseId),
                eq(stockProblemResolutions.status, 'PENDING'),
              ),
            )
        ).map((row) => row.productId),
      );
      const taken = counted.filter((line) => !busy.has(line.productId));
      const products = new Map(
        (
          await this.catalog.getMany(
            taken.map((line) => line.productId),
            tx,
          )
        ).map((product) => [product.id, product]),
      );
      const productOf = (line: LineRow): ProductSummary => {
        const product = products.get(line.productId);
        if (!product) throw notFound('product', line.productId);
        return product;
      };
      const outcomeOf = (line: LineRow) => stockProblemOutcome(line.difference ?? 0);
      const shortages = taken.filter((line) => outcomeOf(line) === 'SHORTAGE');
      const surpluses = taken.filter((line) => outcomeOf(line) === 'SURPLUS');

      let issueId: number | null = null;
      if (shortages.length > 0) {
        const settings = await this.problems.requireSettings(sheet.warehouseId);
        const onHand = await this.problems.onHandOf(
          sheet.warehouseId,
          shortages.map((line) => line.productId),
        );
        for (const line of shortages) {
          const have = onHand.get(line.productId) ?? new Decimal(0);
          const short = (line.difference ?? new Decimal(0)).abs();
          if (short.gt(have)) {
            throw new AppError('STOCK_INSUFFICIENT', 'the shortage is more than is on hand now', {
              productId: line.productId,
              warehouseId: sheet.warehouseId,
              onHand: have.toFixed(),
              requested: short.toFixed(),
            });
          }
        }
        issueId = await this.issues.createInTx(tx, ctx, {
          warehouseId: sheet.warehouseId,
          expenseTypeId: settings.expenseTypeId,
          recipient: { kind: 'CUSTOMER', customerId: settings.customerId },
          note: mn.stockProblems.sheetIssueNote.replace('{{date}}', sheet.sheetDate),
          lines: await this.problems.issueLines(
            sheet.warehouseId,
            shortages.map((line) => ({
              product: productOf(line),
              qty: (line.difference ?? new Decimal(0)).abs(),
            })),
          ),
        });
      }

      let adjustmentId: number | null = null;
      if (surpluses.length > 0) {
        const shelves = await this.surplusBins(
          tx,
          warehouse,
          surpluses.map((line) => line.productId),
        );
        const adjustmentLines: AdjustmentLineInput[] = surpluses.map((line) => ({
          productUnitId: productOf(line).baseUnit.id,
          enteredQty: line.difference ?? new Decimal(0),
          binId: shelves(line.productId),
        }));
        adjustmentId = await this.adjustments.createInTx(tx, ctx, {
          warehouseId: sheet.warehouseId,
          reason: 'SURPLUS',
          note: mn.stockProblems.sheetAdjustmentNote.replace('{{date}}', sheet.sheetDate),
          lines: adjustmentLines,
        });
      }

      for (const line of taken) {
        const outcome = outcomeOf(line);
        const [resolution] = await tx
          .insert(stockProblemResolutions)
          .values({
            warehouseId: sheet.warehouseId,
            productId: line.productId,
            kind: 'COUNT',
            status: outcome === 'EQUAL' ? 'DONE' : 'PENDING',
            coversUntil: line.countedAt ?? sql`now()`,
            qtyBase: outcome === 'EQUAL' ? null : (line.difference ?? new Decimal(0)).abs(),
            onHand: line.onHandAtCount,
            issueId: outcome === 'SHORTAGE' ? issueId : null,
            adjustmentId: outcome === 'SURPLUS' ? adjustmentId : null,
            sheetId: sheet.id,
            createdBy: ctx.userId,
            closedAt: outcome === 'EQUAL' ? sql`now()` : null,
          })
          .returning({ id: stockProblemResolutions.id });
        if (!resolution) throw new Error('resolution insert returned no row');
        await tx
          .update(stockProblemSheetLines)
          .set({ outcome, resolutionId: resolution.id })
          .where(eq(stockProblemSheetLines.id, line.id));
      }
      await tx
        .update(stockProblemSheets)
        .set({
          status: 'APPROVED',
          approvedAt: sql`now()`,
          approvedBy: ctx.userId,
          issueId,
          adjustmentId,
          updatedAt: sql`now()`,
        })
        .where(eq(stockProblemSheets.id, id));
      await this.audit.record(tx, ctx, {
        action: 'APPROVE',
        entity: 'stock_problem_sheets',
        entityId: id,
        before: { status: sheet.status },
        after: {
          status: 'APPROVED',
          issueId,
          adjustmentId,
          equal: taken.length - shortages.length - surpluses.length,
          shortages: shortages.length,
          surpluses: surpluses.length,
          uncounted: lines.length - counted.length,
        },
      });
      return { issueId, adjustmentId };
    });
    if (docs?.issueId != null) await this.issues.send(ctx, docs.issueId);
    if (docs?.adjustmentId != null) {
      await this.adjustments.submit(ctx, docs.adjustmentId);
      if (ctx.permissions.has(ADJUSTMENTS_APPROVE)) {
        await this.adjustments.approve(ctx, docs.adjustmentId);
      }
    }
    // The equal lines' till shortfalls, a posted adjustment's products, and a draft left by a
    // request that failed after its transaction (a repeat of the approval sends it).
    await this.problems.sync(ctx);
    return this.get(ctx, id);
  }

  /**
   * Where a surplus is put: the product's fixed shelf in the warehouse, else a store's sales floor,
   * else the receiving area.
   */
  private async surplusBins(
    tx: Tx,
    warehouse: Warehouse,
    productIds: readonly number[],
  ): Promise<(productId: number) => number> {
    const fixed = await this.locations.defaultBinOf(warehouse.id, productIds, tx);
    let fallback: number | null = null;
    if (productIds.some((productId) => !fixed.has(productId))) {
      const salesfloor =
        warehouse.kind === 'STORE'
          ? await this.bins.systemBin(warehouse.id, 'SALESFLOOR', tx).catch(() => null)
          : null;
      fallback = (salesfloor ?? (await this.bins.systemBin(warehouse.id, 'RECEIVING', tx))).id;
    }
    return (productId) => {
      const binId = fixed.get(productId) ?? fallback;
      if (binId === null) throw new Error(`no shelf for the surplus of product ${productId}`);
      return binId;
    };
  }

  // ---------------------------------------------------------------------------------- internals

  private async sheetFor(ctx: AuthContext, id: number): Promise<SheetRow> {
    const [sheet] = await this.sheetRows(eq(stockProblemSheets.id, id));
    if (!sheet) throw notFound('stock_problem_sheet', id);
    this.scope.assertCanWriteWarehouse(ctx, sheet.warehouseId);
    return sheet;
  }

  private async lockSheet(tx: Tx, ctx: AuthContext, id: number): Promise<SheetRow> {
    const [sheet] = await tx
      .select()
      .from(stockProblemSheets)
      .where(eq(stockProblemSheets.id, id))
      .for('update');
    if (!sheet) throw notFound('stock_problem_sheet', id);
    this.scope.assertCanWriteWarehouse(ctx, sheet.warehouseId);
    return sheet;
  }

  private sheetRows(where: SQL | undefined, limit?: number): Promise<SheetRow[]> {
    const query = this.db
      .select()
      .from(stockProblemSheets)
      .where(where)
      .orderBy(desc(stockProblemSheets.id));
    return limit === undefined ? query : query.limit(limit);
  }

  private async summaries(sheets: readonly SheetRow[]): Promise<SheetSummary[]> {
    if (sheets.length === 0) return [];
    const ids = sheets.map((sheet) => sheet.id);
    const counts = new Map(
      (
        await this.db
          .select({
            sheetId: stockProblemSheetLines.sheetId,
            lines: sql<number>`count(*)::int`,
            counted: sql<number>`count(${stockProblemSheetLines.countedQty})::int`,
          })
          .from(stockProblemSheetLines)
          .where(inArray(stockProblemSheetLines.sheetId, ids))
          .groupBy(stockProblemSheetLines.sheetId)
      ).map((row) => [row.sheetId, row]),
    );
    const warehouses = new Map(
      (await this.problems.problemWarehouses()).map((warehouse) => [warehouse.id, warehouse]),
    );
    const names = await this.names.namesOf(
      sheets.flatMap((sheet) => [sheet.builtBy, sheet.approvedBy]).filter((id) => id !== null),
    );
    return sheets.map((sheet) => ({
      id: sheet.id,
      warehouseId: sheet.warehouseId,
      warehouseCode: warehouses.get(sheet.warehouseId)?.code ?? '',
      warehouseName: warehouses.get(sheet.warehouseId)?.name ?? '',
      sheetDate: sheet.sheetDate,
      status: sheet.status,
      lineCount: counts.get(sheet.id)?.lines ?? 0,
      countedCount: counts.get(sheet.id)?.counted ?? 0,
      builtAt: sheet.builtAt,
      builtByName: sheet.builtBy === null ? null : (names.get(sheet.builtBy) ?? null),
      approvedAt: sheet.approvedAt,
      approvedByName: sheet.approvedBy === null ? null : (names.get(sheet.approvedBy) ?? null),
      issueId: sheet.issueId,
      adjustmentId: sheet.adjustmentId,
    }));
  }

  private async details(sheets: readonly SheetRow[]): Promise<SheetDetail[]> {
    if (sheets.length === 0) return [];
    const summaries = await this.summaries(sheets);
    const lines = await this.db
      .select()
      .from(stockProblemSheetLines)
      .where(
        inArray(
          stockProblemSheetLines.sheetId,
          sheets.map((sheet) => sheet.id),
        ),
      )
      .orderBy(asc(stockProblemSheetLines.id));
    const productIds = [...new Set(lines.map((line) => line.productId))];
    const products = new Map(
      (await this.catalog.getMany(productIds)).map((product) => [product.id, product]),
    );
    const names = await this.names.namesOf(
      lines.map((line) => line.countedBy).filter((id) => id !== null),
    );
    const details: SheetDetail[] = [];
    for (const summary of summaries) {
      const own = lines.filter((line) => line.sheetId === summary.id);
      const shelves = await this.locations.defaultBinOf(
        summary.warehouseId,
        own.map((line) => line.productId),
      );
      const codes = new Map(
        (await this.bins.getMany([...new Set(shelves.values())])).map((bin) => [bin.id, bin.code]),
      );
      const views = own.flatMap((line): SheetLine[] => {
        const product = products.get(line.productId);
        if (!product) return [];
        const binId = shelves.get(line.productId);
        return [
          {
            id: line.id,
            sheetId: line.sheetId,
            product,
            binCode: binId === undefined ? null : (codes.get(binId) ?? null),
            systemQty: line.systemQty,
            redQty: line.redQty,
            cutQty: line.cutQty,
            countedQty: line.countedQty,
            onHandAtCount: line.onHandAtCount,
            difference: line.difference,
            countedAt: line.countedAt,
            countedByName: line.countedBy === null ? null : (names.get(line.countedBy) ?? null),
            outcome: line.outcome,
            resolutionId: line.resolutionId,
          },
        ];
      });
      views.sort(
        (a, b) =>
          (a.binCode ?? '￿').localeCompare(b.binCode ?? '￿') ||
          a.product.name.localeCompare(b.product.name) ||
          a.id - b.id,
      );
      details.push({ ...summary, lines: views });
    }
    return details;
  }
}

function sheetState(sheet: SheetRow): AppError {
  return new AppError('DOC_STATE_INVALID', `sheet ${sheet.id} is ${sheet.status}`, {
    status: sheet.status,
  });
}
