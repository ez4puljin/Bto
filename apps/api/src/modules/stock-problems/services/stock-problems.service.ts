import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  STOCK_PROBLEM_NOTE_MAX,
  type StockProblemResolutionKind,
  type StockProblemResolutionStatus,
  stockProblemGroup,
} from '@tugeel/shared';
import mn from '@tugeel/shared/i18n/mn.json';
import { Decimal } from '@tugeel/shared/money';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { CatalogService, type ProductSummary } from '../../catalog';
import {
  type Actor,
  AuditService,
  type AuthContext,
  OrgService,
  ScopeService,
  systemActor,
  type Warehouse,
} from '../../identity';
import {
  AdjustmentsService,
  GoodsIssuesService,
  type IssueLineInput,
  IssueExpenseTypesService,
  StockQueryService,
} from '../../inventory';
import { CustomersService } from '../../partners';
import { stockProblemResolutions, stockProblemSettings } from '../schema';
import {
  type ProblemEvent,
  ProblemSourcesService,
  problemWindowStart,
} from './problem-sources.service';
import { ShortfallResolver } from './shortfall-resolver';

const MANAGE = 'stockProblems.manage';
const ZERO = new Decimal(0);

/** The warehouses with a problem list: where goods are kept and sold (as goods issues, ADR-0081). */
const PROBLEM_WAREHOUSE_KINDS: readonly string[] = ['WHOLESALE', 'STORE'];
/** The bins a goods issue may leave from (ADR-0117): the lines of a zeroed balance name them. */
const ISSUE_BIN_TYPES: readonly string[] = [
  'RECEIVING',
  'STORAGE',
  'PICKING',
  'SALESFLOOR',
  'RETURNS',
  'DAMAGED',
];

type ResolutionRow = typeof stockProblemResolutions.$inferSelect;

/** A decision that waits for its document, as the list shows it beside the product. */
export interface PendingResolution {
  id: number;
  kind: StockProblemResolutionKind;
  qtyBase: Decimal | null;
  issueId: number | null;
  adjustmentId: number | null;
  sheetId: number | null;
  createdAt: Date;
}

export interface ProblemProduct {
  warehouseId: number;
  product: ProductSummary;
  /** The warehouse's on-hand now, every bin. */
  onHand: Decimal;
  /** Σ of the till shortfalls («Улайсан»). */
  redQty: Decimal;
  /** Σ of the order cuts («Дарагдсан»). */
  cutQty: Decimal;
  lastEventAt: Date;
  events: ProblemEvent[];
  pending: PendingResolution | null;
}

export interface ProblemWarehouse {
  warehouseId: number;
  warehouseCode: string;
  warehouseName: string;
  productCount: number;
  redCount: number;
  cutCount: number;
  /** Both the fixed customer and the expense type are chosen. */
  settingsReady: boolean;
}

export interface WarehouseSettings {
  warehouseId: number;
  warehouseCode: string;
  warehouseName: string;
  customerId: number | null;
  customerName: string | null;
  expenseTypeId: number | null;
  expenseTypeName: string | null;
  updatedAt: Date | null;
}

export interface ResolutionView {
  id: number;
  warehouseId: number;
  productId: number;
  kind: StockProblemResolutionKind;
  status: StockProblemResolutionStatus;
  qtyBase: Decimal | null;
  onHand: Decimal | null;
  note: string | null;
  issueId: number | null;
  /** The issue's status right after the action (SENT once the keeper may confirm it). */
  issueStatus: string | null;
  adjustmentId: number | null;
  sheetId: number | null;
  createdAt: Date;
}

/** A product of a warehouse, the grouping key of the list. */
export const problemKey = (warehouseId: number, productId: number): string =>
  `${warehouseId}:${productId}`;

/**
 * «Асуудалтай бараа» (ADR-0230): per warehouse, the products the system got wrong — a till sold
 * what the shelf lacked, an order's quantity was cut — since the product's last resolution there,
 * and the two decisions that take a product off the list: «Зүй ёсны» at once, «Үлдэгдэл тэглэх»
 * when its goods issue posts. Stock moves only through the goods issue (ADR-0117); this service
 * writes no stock.
 */
@Injectable()
export class StockProblemsService {
  private readonly logger = new Logger(StockProblemsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly sources: ProblemSourcesService,
    private readonly audit: AuditService,
    private readonly org: OrgService,
    private readonly scope: ScopeService,
    private readonly catalog: CatalogService,
    private readonly stock: StockQueryService,
    private readonly issues: GoodsIssuesService,
    private readonly adjustments: AdjustmentsService,
    private readonly expenseTypes: IssueExpenseTypesService,
    private readonly customers: CustomersService,
    private readonly pos: ShortfallResolver,
  ) {}

  // ------------------------------------------------------------------------------ the warehouses

  /** The warehouses a user sees: those of their scope (every one without a scope). */
  async warehousesOf(ctx: AuthContext): Promise<Warehouse[]> {
    return (await this.problemWarehouses()).filter((warehouse) =>
      this.scope.canWriteWarehouse(ctx, warehouse.id),
    );
  }

  /** Every warehouse that keeps a problem list. */
  async problemWarehouses(): Promise<Warehouse[]> {
    return (await this.org.listWarehouses()).filter((warehouse) =>
      PROBLEM_WAREHOUSE_KINDS.includes(warehouse.kind),
    );
  }

  /** The warehouse, when the user may see it (403 `WAREHOUSE_SCOPE` otherwise). */
  async warehouseFor(ctx: AuthContext, warehouseId: number): Promise<Warehouse> {
    const warehouse = await this.org.getWarehouse(warehouseId);
    this.scope.assertCanWriteWarehouse(ctx, warehouseId);
    if (!PROBLEM_WAREHOUSE_KINDS.includes(warehouse.kind)) {
      throw new AppError('WAREHOUSE_KIND_NOT_ALLOWED', 'no problem list in this warehouse', {
        kind: warehouse.kind,
      });
    }
    return warehouse;
  }

  // ------------------------------------------------------------------------------------ the list

  /** The user's warehouses with how many products each has on its list. */
  async summary(ctx: AuthContext): Promise<ProblemWarehouse[]> {
    await this.sync(ctx);
    const warehouses = await this.warehousesOf(ctx);
    const problems = await this.problemsOf(warehouses.map((warehouse) => warehouse.id));
    const settings = await this.settingsRows(warehouses.map((warehouse) => warehouse.id));
    return warehouses.map((warehouse) => {
      const own = problems.filter((problem) => problem.warehouseId === warehouse.id);
      const row = settings.get(warehouse.id);
      return {
        warehouseId: warehouse.id,
        warehouseCode: warehouse.code,
        warehouseName: warehouse.name,
        productCount: own.length,
        redCount: own.filter((problem) => problem.redQty.gt(0)).length,
        cutCount: own.filter((problem) => problem.cutQty.gt(0)).length,
        settingsReady: !!row && row.customerId !== null && row.expenseTypeId !== null,
      };
    });
  }

  /** A warehouse's list, the newest problem first. */
  async list(ctx: AuthContext, warehouseId: number): Promise<ProblemProduct[]> {
    await this.warehouseFor(ctx, warehouseId);
    await this.sync(ctx);
    return this.problemsOf([warehouseId]);
  }

  /**
   * The problem products of these warehouses: the events inside the window that no DONE resolution
   * of the product in that warehouse answers yet, with the on-hand now and the decision that waits.
   */
  async problemsOf(
    warehouseIds: readonly number[],
    productId?: number,
    now: Date = new Date(),
  ): Promise<ProblemProduct[]> {
    if (warehouseIds.length === 0) return [];
    const [events, cutoffs] = await Promise.all([
      this.sources.events(warehouseIds, productId, now),
      this.cutoffs(warehouseIds, productId),
    ]);
    const groups = new Map<string, ProblemEvent[]>();
    for (const event of events) {
      const key = problemKey(event.warehouseId, event.productId);
      const cutoff = cutoffs.get(key);
      if (cutoff && event.at <= cutoff) continue;
      const group = groups.get(key);
      if (group) group.push(event);
      else groups.set(key, [event]);
    }
    if (groups.size === 0) return [];
    const productIds = [...new Set([...groups.values()].map((group) => group[0]!.productId))];
    const [products, balances, pending] = await Promise.all([
      this.catalog.getMany(productIds),
      this.stock.balancesOf(productIds),
      this.pendingOf(warehouseIds, productIds),
    ]);
    const byId = new Map(products.map((product) => [product.id, product]));
    const list: ProblemProduct[] = [];
    for (const [key, group] of groups) {
      const first = group[0]!;
      const product = byId.get(first.productId);
      if (!product) continue;
      const sum = (red: boolean) =>
        group
          .filter((event) => (stockProblemGroup(event.kind) === 'RED') === red)
          .reduce((total, event) => total.plus(event.qtyBase), ZERO);
      list.push({
        warehouseId: first.warehouseId,
        product,
        onHand:
          balances.get(first.productId)?.find((row) => row.warehouseId === first.warehouseId)
            ?.onHand ?? ZERO,
        redQty: sum(true),
        cutQty: sum(false),
        lastEventAt: first.at,
        events: group,
        pending: pending.get(key) ?? null,
      });
    }
    return list.sort(
      (a, b) => b.lastEventAt.getTime() - a.lastEventAt.getTime() || a.product.id - b.product.id,
    );
  }

  /** The warehouse's on-hand of these products now (every bin, lots summed). */
  async onHandOf(
    warehouseId: number,
    productIds: readonly number[],
  ): Promise<Map<number, Decimal>> {
    const balances = await this.stock.balancesOf(productIds);
    return new Map(
      productIds.map((productId) => [
        productId,
        balances.get(productId)?.find((row) => row.warehouseId === warehouseId)?.onHand ?? ZERO,
      ]),
    );
  }

  // ------------------------------------------------------------------------------- the decisions

  /**
   * «Зүй ёсны»: nothing is wrong with this product here. It leaves this warehouse's list at once;
   * a later event brings it back. The tills' shortfalls it answers are marked checked in pos.
   */
  async markLegitimate(
    ctx: AuthContext,
    input: { warehouseId: number; productId: number; note?: string | null },
  ): Promise<ResolutionView> {
    await this.warehouseFor(ctx, input.warehouseId);
    const note = noteOf(input.note);
    const row = await inTransaction(this.db, async (tx) => {
      const problem = await this.lockProblem(tx, input.warehouseId, input.productId);
      const [inserted] = await tx
        .insert(stockProblemResolutions)
        .values({
          warehouseId: input.warehouseId,
          productId: input.productId,
          kind: 'LEGIT',
          status: 'DONE',
          onHand: problem.onHand,
          note,
          createdBy: ctx.userId,
          closedAt: sql`now()`,
        })
        .returning();
      if (!inserted) throw new Error('resolution insert returned no row');
      await this.audit.record(tx, ctx, {
        action: 'RESOLVE',
        entity: 'stock_problem_resolutions',
        entityId: inserted.id,
        after: { ...inserted, events: problem.events.length },
      });
      return inserted;
    });
    await this.resolveShortfalls(ctx, [row]);
    return toResolutionView(row, null);
  }

  /**
   * «Үлдэгдэл тэглэх»: the system shows a balance, the goods are gone and no reason is found. A
   * goods issue (ADR-0117) for the quantity (default: the whole on-hand of the warehouse) to the
   * warehouse's fixed customer and expense type is created and sent; the keeper confirms it and
   * the stock leaves then. The product leaves the list when the issue posts.
   */
  async zeroOut(
    ctx: AuthContext,
    input: { warehouseId: number; productId: number; qty?: Decimal | null },
  ): Promise<ResolutionView> {
    await this.warehouseFor(ctx, input.warehouseId);
    const settings = await this.requireSettings(input.warehouseId);
    const row = await inTransaction(this.db, async (tx) => {
      const problem = await this.lockProblem(tx, input.warehouseId, input.productId);
      const qty = input.qty ?? problem.onHand;
      if (!qty.gt(0)) throw invalid('qty', 'min', 'nothing on hand to zero');
      if (qty.gt(problem.onHand)) {
        throw new AppError('STOCK_INSUFFICIENT', 'more than the warehouse has on hand', {
          productId: input.productId,
          warehouseId: input.warehouseId,
          onHand: problem.onHand.toFixed(),
          requested: qty.toFixed(),
        });
      }
      const issueId = await this.issues.createInTx(tx, ctx, {
        warehouseId: input.warehouseId,
        expenseTypeId: settings.expenseTypeId,
        recipient: { kind: 'CUSTOMER', customerId: settings.customerId },
        note: mn.stockProblems.issueNote,
        lines: await this.issueLines(input.warehouseId, [{ product: problem.product, qty }]),
      });
      const [inserted] = await tx
        .insert(stockProblemResolutions)
        .values({
          warehouseId: input.warehouseId,
          productId: input.productId,
          kind: 'ZERO_OUT',
          status: 'PENDING',
          qtyBase: qty,
          onHand: problem.onHand,
          issueId,
          createdBy: ctx.userId,
        })
        .returning();
      if (!inserted) throw new Error('resolution insert returned no row');
      await this.audit.record(tx, ctx, {
        action: 'CREATE',
        entity: 'stock_problem_resolutions',
        entityId: inserted.id,
        after: inserted,
      });
      return inserted;
    });
    const issue = await this.issues.send(ctx, row.issueId ?? 0);
    return toResolutionView(row, issue.status);
  }

  /**
   * The transaction's lock on a product of a warehouse: every decision takes it before it reads
   * the waiting decisions, so two of them never both find none. A caller locking several products
   * takes them in product order.
   */
  async lockProduct(tx: Tx, warehouseId: number, productId: number): Promise<void> {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`stock_problem:${problemKey(warehouseId, productId)}`}, 0))`,
    );
  }

  /**
   * The product's problem in this warehouse, with the pair locked for the transaction so two
   * decisions cannot both take it: 404 when it is not on the list, 409 when a decision waits.
   */
  async lockProblem(tx: Tx, warehouseId: number, productId: number): Promise<ProblemProduct> {
    await this.lockProduct(tx, warehouseId, productId);
    const [waiting] = await tx
      .select({ id: stockProblemResolutions.id })
      .from(stockProblemResolutions)
      .where(
        and(
          eq(stockProblemResolutions.warehouseId, warehouseId),
          eq(stockProblemResolutions.productId, productId),
          eq(stockProblemResolutions.status, 'PENDING'),
        ),
      )
      .limit(1);
    if (waiting) {
      throw new AppError('CONFLICT', 'a decision on this product waits for its document', {
        reason: 'STOCK_PROBLEM_PENDING',
        resolutionId: waiting.id,
      });
    }
    const [problem] = await this.problemsOf([warehouseId], productId);
    if (!problem) throw notFound('stock_problem', productId);
    return problem;
  }

  /**
   * The lines of a goods issue taking these quantities out of a warehouse: a line per bin that
   * holds the product, the fullest first, so a balance spread over several shelves can leave in
   * full; what no listed bin covers goes on a line whose shelf the keeper's confirmation picks.
   */
  async issueLines(
    warehouseId: number,
    wanted: readonly { product: ProductSummary; qty: Decimal }[],
  ): Promise<IssueLineInput[]> {
    const lines: IssueLineInput[] = [];
    for (const { product, qty } of wanted) {
      const held = new Map<number, Decimal>();
      for (const bin of (await this.stock.ofProduct(product.id)).bins) {
        if (bin.warehouseId !== warehouseId || !ISSUE_BIN_TYPES.includes(bin.binType)) continue;
        held.set(bin.binId, (held.get(bin.binId) ?? ZERO).plus(bin.onHand));
      }
      let left = qty;
      const fullest = [...held].sort((a, b) => b[1].comparedTo(a[1]) || a[0] - b[0]);
      for (const [binId, onHand] of fullest) {
        if (!left.gt(0)) break;
        const take = Decimal.min(left, onHand);
        if (!take.gt(0)) continue;
        lines.push({ productUnitId: product.baseUnit.id, enteredQty: take, warehouseId, binId });
        left = left.minus(take);
      }
      if (left.gt(0)) {
        lines.push({ productUnitId: product.baseUnit.id, enteredQty: left, warehouseId });
      }
    }
    return lines;
  }

  // -------------------------------------------------------------------------------- the settings

  async settings(ctx: AuthContext): Promise<WarehouseSettings[]> {
    const warehouses = await this.warehousesOf(ctx);
    return this.settingsViews(warehouses);
  }

  /** The warehouse's fixed customer and expense type; either may be cleared with null. */
  async setSettings(
    ctx: AuthContext,
    warehouseId: number,
    input: { customerId: number | null; expenseTypeId: number | null },
  ): Promise<WarehouseSettings> {
    const warehouse = await this.warehouseFor(ctx, warehouseId);
    await inTransaction(this.db, async (tx) => {
      if (input.customerId !== null) await this.customers.get(input.customerId, tx);
      if (input.expenseTypeId !== null)
        await this.expenseTypes.assertActive(tx, input.expenseTypeId);
      const [before] = await tx
        .select()
        .from(stockProblemSettings)
        .where(eq(stockProblemSettings.warehouseId, warehouseId))
        .for('update');
      const values = {
        customerId: input.customerId,
        expenseTypeId: input.expenseTypeId,
        updatedAt: sql`now()`,
        updatedBy: ctx.userId,
      };
      await tx
        .insert(stockProblemSettings)
        .values({ warehouseId, ...values })
        .onConflictDoUpdate({ target: stockProblemSettings.warehouseId, set: values });
      await this.audit.record(tx, ctx, {
        action: before ? 'UPDATE' : 'CREATE',
        entity: 'stock_problem_settings',
        entityId: warehouseId,
        before: before ?? null,
        after: { warehouseId, customerId: input.customerId, expenseTypeId: input.expenseTypeId },
      });
    });
    const [view] = await this.settingsViews([warehouse]);
    if (!view) throw notFound('warehouse', warehouseId);
    return view;
  }

  /** Both defaults of a warehouse, or 409 `SETTING_MISSING` naming the warehouse. */
  async requireSettings(
    warehouseId: number,
  ): Promise<{ customerId: number; expenseTypeId: number }> {
    const row = (await this.settingsRows([warehouseId])).get(warehouseId);
    if (!row || row.customerId === null || row.expenseTypeId === null) {
      throw new AppError('SETTING_MISSING', `warehouse ${warehouseId} has no problem settings`, {
        key: 'stockProblems.settings',
        warehouseId,
      });
    }
    return { customerId: row.customerId, expenseTypeId: row.expenseTypeId };
  }

  private async settingsViews(warehouses: readonly Warehouse[]): Promise<WarehouseSettings[]> {
    const rows = await this.settingsRows(warehouses.map((warehouse) => warehouse.id));
    const customerIds = [...rows.values()].flatMap((row) =>
      row.customerId === null ? [] : [row.customerId],
    );
    const customers = new Map(
      (await this.customers.getMany(customerIds)).map((customer) => [customer.id, customer.name]),
    );
    const types = new Map((await this.expenseTypes.list()).map((type) => [type.id, type.name]));
    return warehouses.map((warehouse) => {
      const row = rows.get(warehouse.id);
      const customerId = row?.customerId ?? null;
      const expenseTypeId = row?.expenseTypeId ?? null;
      return {
        warehouseId: warehouse.id,
        warehouseCode: warehouse.code,
        warehouseName: warehouse.name,
        customerId,
        customerName: customerId === null ? null : (customers.get(customerId) ?? null),
        expenseTypeId,
        expenseTypeName: expenseTypeId === null ? null : (types.get(expenseTypeId) ?? null),
        updatedAt: row?.updatedAt ?? null,
      };
    });
  }

  private async settingsRows(
    warehouseIds: readonly number[],
  ): Promise<Map<number, typeof stockProblemSettings.$inferSelect>> {
    if (warehouseIds.length === 0) return new Map();
    const rows = await this.db
      .select()
      .from(stockProblemSettings)
      .where(inArray(stockProblemSettings.warehouseId, [...warehouseIds]));
    return new Map(rows.map((row) => [row.warehouseId, row]));
  }

  // ------------------------------------------------------------------- the documents that decide

  /**
   * Brings the waiting decisions up to their documents: a posted goods issue or adjustment makes
   * its decisions DONE (the products leave the list), a cancelled one CANCELLED (they are back).
   * Called before every read and by the morning job. With a manager's context it also sends a
   * draft a failed request left behind and marks the answered till shortfalls checked in pos.
   */
  async sync(ctx: AuthContext | null): Promise<void> {
    const pending = await this.db
      .select()
      .from(stockProblemResolutions)
      .where(eq(stockProblemResolutions.status, 'PENDING'));
    const manager = ctx !== null && ctx.permissions.has(MANAGE) ? ctx : null;
    const issueIds = [
      ...new Set(pending.flatMap((row) => (row.issueId === null ? [] : [row.issueId]))),
    ];
    const adjustmentIds = [
      ...new Set(pending.flatMap((row) => (row.adjustmentId === null ? [] : [row.adjustmentId]))),
    ];
    const issueStatus = new Map<number, string>();
    for (const id of issueIds) {
      let status: string = (await this.issues.get(id)).status;
      if (status === 'DRAFT' && manager)
        status = await this.finish(() => this.issues.send(manager, id), status);
      issueStatus.set(id, status);
    }
    const adjustmentStatus = new Map<number, string>();
    for (const id of adjustmentIds) {
      let status: string = (await this.adjustments.get(id)).status;
      if (status === 'DRAFT' && manager) {
        status = await this.finish(() => this.adjustments.submit(manager, id), status);
      }
      adjustmentStatus.set(id, status);
    }
    const outcomes = pending.flatMap((row): { id: number; status: 'DONE' | 'CANCELLED' }[] => {
      const status =
        row.issueId !== null
          ? issueStatus.get(row.issueId)
          : row.adjustmentId !== null
            ? adjustmentStatus.get(row.adjustmentId)
            : undefined;
      if (status === 'POSTED') return [{ id: row.id, status: 'DONE' }];
      if (status === 'CANCELLED') return [{ id: row.id, status: 'CANCELLED' }];
      return [];
    });
    if (outcomes.length > 0) {
      const actor: Actor = ctx ?? systemActor('stock-problems');
      await inTransaction(this.db, async (tx) => {
        for (const outcome of outcomes) {
          const [closed] = await tx
            .update(stockProblemResolutions)
            .set({ status: outcome.status, closedAt: sql`now()` })
            .where(
              and(
                eq(stockProblemResolutions.id, outcome.id),
                eq(stockProblemResolutions.status, 'PENDING'),
              ),
            )
            .returning({ id: stockProblemResolutions.id });
          if (!closed) continue;
          await this.audit.record(tx, actor, {
            action: outcome.status === 'DONE' ? 'RESOLVE' : 'CANCEL',
            entity: 'stock_problem_resolutions',
            entityId: outcome.id,
            after: { status: outcome.status },
          });
        }
      });
    }
    if (manager) {
      const unanswered = await this.db
        .select()
        .from(stockProblemResolutions)
        .where(
          and(
            eq(stockProblemResolutions.status, 'DONE'),
            isNull(stockProblemResolutions.posResolvedAt),
          ),
        )
        .orderBy(desc(stockProblemResolutions.id));
      await this.resolveShortfalls(manager, unanswered);
    }
  }

  /** A document step that may be refused (the type was retired, a unit changed): the status stays. */
  private async finish(step: () => Promise<{ status: string }>, status: string): Promise<string> {
    try {
      return (await step()).status;
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      this.logger.warn(`a waiting document could not be sent: ${error.code}`);
      return status;
    }
  }

  /**
   * Marks the tills' open shortfalls these DONE decisions answer (same product and warehouse, sold
   * at or before the decision) as checked, through the pos module's own resolve, then stamps the
   * decisions so the work is done once. The list never depends on it: it filters by the decision.
   */
  async resolveShortfalls(ctx: AuthContext, rows: readonly ResolutionRow[]): Promise<void> {
    const since = problemWindowStart();
    for (const row of rows) {
      if (row.status !== 'DONE' || row.posResolvedAt !== null) continue;
      const open = await this.sources.shortfalls(new Set([row.warehouseId]), since, row.productId);
      for (const event of open) {
        if (event.shortfallId === null || event.at > row.coversUntil) continue;
        await this.pos.resolveShortfall(ctx, event.shortfallId, shortfallNote(row));
      }
      await this.db
        .update(stockProblemResolutions)
        .set({ posResolvedAt: sql`now()` })
        .where(eq(stockProblemResolutions.id, row.id));
    }
  }

  // ---------------------------------------------------------------------------------- internals

  /** warehouse:product → the latest DONE decision's moment. */
  private async cutoffs(
    warehouseIds: readonly number[],
    productId?: number,
  ): Promise<Map<string, Date>> {
    const rows = await this.db
      .select({
        warehouseId: stockProblemResolutions.warehouseId,
        productId: stockProblemResolutions.productId,
        until: sql<Date>`max(${stockProblemResolutions.coversUntil})`.mapWith(
          stockProblemResolutions.coversUntil,
        ),
      })
      .from(stockProblemResolutions)
      .where(
        and(
          eq(stockProblemResolutions.status, 'DONE'),
          inArray(stockProblemResolutions.warehouseId, [...warehouseIds]),
          ...(productId === undefined ? [] : [eq(stockProblemResolutions.productId, productId)]),
        ),
      )
      .groupBy(stockProblemResolutions.warehouseId, stockProblemResolutions.productId);
    return new Map(rows.map((row) => [problemKey(row.warehouseId, row.productId), row.until]));
  }

  private async pendingOf(
    warehouseIds: readonly number[],
    productIds: readonly number[],
  ): Promise<Map<string, PendingResolution>> {
    const rows = await this.db
      .select()
      .from(stockProblemResolutions)
      .where(
        and(
          eq(stockProblemResolutions.status, 'PENDING'),
          inArray(stockProblemResolutions.warehouseId, [...warehouseIds]),
          inArray(stockProblemResolutions.productId, [...productIds]),
        ),
      )
      .orderBy(stockProblemResolutions.id);
    return new Map(
      rows.map((row) => [
        problemKey(row.warehouseId, row.productId),
        {
          id: row.id,
          kind: row.kind,
          qtyBase: row.qtyBase,
          issueId: row.issueId,
          adjustmentId: row.adjustmentId,
          sheetId: row.sheetId,
          createdAt: row.createdAt,
        },
      ]),
    );
  }
}

/** A trimmed note or null; 422 beyond the limit. */
export function noteOf(note: string | null | undefined): string | null {
  const trimmed = note?.trim() || null;
  if (trimmed && trimmed.length > STOCK_PROBLEM_NOTE_MAX) {
    throw invalid('note', 'length', `at most ${STOCK_PROBLEM_NOTE_MAX} characters`);
  }
  return trimmed;
}

/** What the pos shortfall keeps as its note: the decision in the owner's words, then the note. */
function shortfallNote(row: ResolutionRow): string {
  const label: string = mn.stockProblems.resolutionKind[row.kind];
  return (row.note ? `${label}: ${row.note}` : label).slice(0, STOCK_PROBLEM_NOTE_MAX);
}

export function toResolutionView(row: ResolutionRow, issueStatus: string | null): ResolutionView {
  return {
    id: row.id,
    warehouseId: row.warehouseId,
    productId: row.productId,
    kind: row.kind,
    status: row.status,
    qtyBase: row.qtyBase,
    onHand: row.onHand,
    note: row.note,
    issueId: row.issueId,
    issueStatus,
    adjustmentId: row.adjustmentId,
    sheetId: row.sheetId,
    createdAt: row.createdAt,
  };
}
