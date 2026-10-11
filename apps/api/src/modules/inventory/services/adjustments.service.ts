import { Inject, Injectable } from '@nestjs/common';
import { ADJUSTMENT_REASONS, type AdjustmentReason } from '@tugeel/shared/inventory';
import type { Decimal } from '@tugeel/shared/money';
import { and, desc, eq, inArray, lt, type SQL, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
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
import { ADJUSTMENT_STATUSES, adjustmentLines, adjustments, bins } from '../schema';
import { ProductLocationsService } from './product-locations.service';
import { MAX_MOVEMENTS_PER_POST, StockPostingService } from './stock-posting.service';
import { optionalText } from './support';

type AdjustmentRow = typeof adjustments.$inferSelect;
type AdjustmentLineRow = typeof adjustmentLines.$inferSelect;
export type AdjustmentStatus = (typeof ADJUSTMENT_STATUSES)[number];

const APPROVE = 'inventory.adjustments.approve';
const COSTS = 'inventory.costs.manage';
/** Warehouses whose stock people adjust; vehicles and TRANSIT are corrected by their own flows. */
const ADJUSTABLE_KINDS = ['WHOLESALE', 'STORE'];

export interface AdjustmentLineInput {
  productUnitId: number;
  /** Positive: the reason decides whether stock goes up or down. */
  enteredQty: Decimal;
  binId: number;
  /** Cost per base unit of an inbound line (cost holders only); omitted: the average. */
  unitCost?: Decimal | null;
  note?: string | null;
}

/** A line of a system adjustment: the unit and factor frozen by the caller. */
export interface SystemAdjustmentLine {
  productId: number;
  productUnitId: number;
  enteredQty: Decimal;
  factorSnapshot: Decimal;
  binId: number;
  /** Inbound only: cost per base unit (opening stock); null = the average. */
  unitCost: Decimal | null;
}

export interface SystemAdjustmentInput {
  warehouseId: number;
  reason: 'OPENING' | 'OPENING_REVERSAL';
  note?: string | null;
  /** The OPENING adjustment a reversal takes back. */
  reversesAdjustmentId?: number;
  lines: readonly SystemAdjustmentLine[];
}

/** Rows per multi-row statement. */
const CHUNK = 1_000;

export interface AdjustmentInput {
  warehouseId: number;
  reason: AdjustmentReason;
  note?: string | null;
  lines?: readonly AdjustmentLineInput[];
}

export interface AdjustmentLine {
  id: number;
  productId: number;
  productSku: string;
  productName: string;
  productUnitId: number;
  unitName: string;
  enteredQty: Decimal;
  qtyBase: Decimal;
  binId: number;
  binCode: string;
  note: string | null;
}

export interface AdjustmentDetail {
  id: number;
  number: string | null;
  warehouseId: number;
  reason: AdjustmentReason;
  status: AdjustmentStatus;
  note: string | null;
  submittedAt: Date | null;
  effectiveDate: string | null;
  postedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  lines: AdjustmentLine[];
}

export interface AdjustmentSummary {
  id: number;
  number: string | null;
  warehouseId: number;
  reason: AdjustmentReason;
  status: AdjustmentStatus;
  lineCount: number;
  submittedAt: Date | null;
  effectiveDate: string | null;
  createdAt: Date;
}

/**
 * Adjustments (ADJ-, owner 2026-10-11): warehouse staff write down damaged, expired or missing goods
 * and record found ones, then submit; an approver posts or returns them. The reason fixes the
 * direction. OPENING (opening stock) is for approvers and the importer only. Costs never appear in
 * the responses; an approver with inventory.costs.manage may set the cost of inbound lines.
 */
@Injectable()
export class AdjustmentsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly catalog: CatalogService,
    private readonly locations: ProductLocationsService,
    private readonly org: OrgService,
    private readonly posting: StockPostingService,
    private readonly scope: ScopeService,
    private readonly units: UnitConversionService,
  ) {}

  async create(ctx: AuthContext, input: AdjustmentInput): Promise<AdjustmentDetail> {
    this.scope.assertCanWriteWarehouse(ctx, input.warehouseId);
    assertRequestable(input.reason);
    if (input.reason === 'OPENING' && !ctx.permissions.has(APPROVE)) {
      throw new AppError('FORBIDDEN', 'opening stock is entered by approvers', {
        reason: 'OPENING',
      });
    }
    if (input.lines?.some((line) => line.unitCost !== undefined && line.unitCost !== null)) {
      this.assertCosts(ctx);
    }
    return inTransaction(this.db, async (tx) => {
      const id = await this.createInTx(tx, ctx, input);
      return this.get(id, tx);
    });
  }

  async createInTx(tx: Tx, actor: Actor, input: AdjustmentInput): Promise<number> {
    const warehouse = await this.org.getWarehouse(input.warehouseId, tx);
    if (!ADJUSTABLE_KINDS.includes(warehouse.kind)) {
      throw new AppError(
        'WAREHOUSE_KIND_NOT_ALLOWED',
        `no adjustments in a ${warehouse.kind} warehouse`,
        {
          kind: warehouse.kind,
        },
      );
    }
    const [header] = await tx
      .insert(adjustments)
      .values({
        warehouseId: input.warehouseId,
        reason: input.reason,
        note: optionalText(input.note) ?? null,
        createdBy: actorUserId(actor),
      })
      .returning();
    if (!header) throw new Error('adjustment insert returned no row');
    for (const line of input.lines ?? []) await this.insertLine(tx, header, line);
    await this.audit.record(tx, actor, {
      action: 'CREATE',
      entity: 'adjustments',
      entityId: header.id,
      after: header,
    });
    return header.id;
  }

  update(
    ctx: AuthContext,
    id: number,
    patch: { reason?: AdjustmentReason; note?: string | null },
  ): Promise<AdjustmentDetail> {
    return inTransaction(this.db, async (tx) => {
      const header = await this.lockDraft(tx, ctx, id);
      if (patch.reason) assertRequestable(patch.reason);
      if (patch.reason === 'OPENING' && !ctx.permissions.has(APPROVE)) {
        throw new AppError('FORBIDDEN', 'opening stock is entered by approvers', {
          reason: 'OPENING',
        });
      }
      if (patch.reason && direction(patch.reason) === 1 && direction(header.reason) === -1) {
        const lines = await this.linesOf(tx, id);
        await this.locations.assertMayReceive(
          tx,
          header.warehouseId,
          lines.map((line) => line.productId),
        );
      }
      await tx
        .update(adjustments)
        .set({
          ...(patch.reason === undefined ? {} : { reason: patch.reason }),
          ...(patch.note === undefined ? {} : { note: optionalText(patch.note) ?? null }),
          updatedAt: sql`now()`,
        })
        .where(eq(adjustments.id, id));
      return this.get(id, tx);
    });
  }

  async addLine(
    ctx: AuthContext,
    id: number,
    line: AdjustmentLineInput,
  ): Promise<AdjustmentDetail> {
    if (line.unitCost !== undefined && line.unitCost !== null) this.assertCosts(ctx);
    return inTransaction(this.db, async (tx) => {
      const header = await this.lockDraft(tx, ctx, id);
      await this.insertLine(tx, header, line);
      await this.touch(tx, id);
      return this.get(id, tx);
    });
  }

  updateLine(
    ctx: AuthContext,
    lineId: number,
    patch: { enteredQty?: Decimal; binId?: number; note?: string | null },
  ): Promise<AdjustmentDetail> {
    return inTransaction(this.db, async (tx) => {
      const { header, line } = await this.lockLine(tx, ctx, lineId);
      const enteredQty = patch.enteredQty ?? line.enteredQty;
      const converted = await this.units.toBase(line.productUnitId, enteredQty, tx);
      if (patch.binId !== undefined) await this.assertBin(tx, header.warehouseId, patch.binId);
      await tx
        .update(adjustmentLines)
        .set({
          enteredQty,
          factorSnapshot: converted.factorSnapshot,
          qtyBase: converted.qtyBase,
          ...(patch.binId === undefined ? {} : { binId: patch.binId }),
          ...(patch.note === undefined ? {} : { note: optionalText(patch.note) ?? null }),
          updatedAt: sql`now()`,
        })
        .where(eq(adjustmentLines.id, lineId));
      await this.touch(tx, header.id);
      return this.get(header.id, tx);
    });
  }

  removeLine(ctx: AuthContext, lineId: number): Promise<AdjustmentDetail> {
    return inTransaction(this.db, async (tx) => {
      const { header } = await this.lockLine(tx, ctx, lineId);
      await tx.delete(adjustmentLines).where(eq(adjustmentLines.id, lineId));
      await this.touch(tx, header.id);
      return this.get(header.id, tx);
    });
  }

  /** DRAFT → SUBMITTED: the lines are frozen for the approver. */
  submit(ctx: AuthContext, id: number): Promise<AdjustmentDetail> {
    return inTransaction(this.db, async (tx) => {
      const header = await this.lockDraft(tx, ctx, id);
      const lines = await this.linesOf(tx, id);
      if (lines.length === 0)
        throw invalid('lines', 'empty', 'an adjustment needs at least one line');
      await tx
        .update(adjustments)
        .set({
          status: 'SUBMITTED',
          submittedAt: sql`now()`,
          submittedBy: actorUserId(ctx),
          updatedAt: sql`now()`,
        })
        .where(eq(adjustments.id, id));
      await this.audit.record(tx, ctx, {
        action: 'SUBMIT',
        entity: 'adjustments',
        entityId: id,
        before: header,
      });
      return this.get(id, tx);
    });
  }

  /** SUBMITTED → DRAFT, for the warehouse to correct it. */
  returnToDraft(ctx: AuthContext, id: number): Promise<AdjustmentDetail> {
    return inTransaction(this.db, async (tx) => {
      const header = await this.lockState(tx, ctx, id, 'SUBMITTED');
      await tx
        .update(adjustments)
        .set({ status: 'DRAFT', submittedAt: null, submittedBy: null, updatedAt: sql`now()` })
        .where(eq(adjustments.id, id));
      await this.audit.record(tx, ctx, {
        action: 'RETURN',
        entity: 'adjustments',
        entityId: id,
        before: header,
      });
      return this.get(id, tx);
    });
  }

  cancel(ctx: AuthContext, id: number): Promise<AdjustmentDetail> {
    return inTransaction(this.db, async (tx) => {
      const header = await this.lockHeader(tx, id);
      this.scope.assertCanWriteWarehouse(ctx, header.warehouseId);
      if (header.status === 'POSTED') {
        throw new AppError('DOC_ALREADY_POSTED', `adjustment ${id} is posted`, {
          status: header.status,
        });
      }
      if (header.status === 'CANCELLED') return this.get(id, tx);
      await tx
        .update(adjustments)
        .set({ status: 'CANCELLED', updatedAt: sql`now()` })
        .where(eq(adjustments.id, id));
      await this.audit.record(tx, ctx, {
        action: 'CANCEL',
        entity: 'adjustments',
        entityId: id,
        before: header,
      });
      return this.get(id, tx);
    });
  }

  /**
   * SUBMITTED → POSTED by an approver. Inbound lines take the given costs (cost holders only), else
   * their stored cost, else the average.
   */
  async approve(
    ctx: AuthContext,
    id: number,
    costs: readonly { lineId: number; unitCost: Decimal }[] = [],
  ): Promise<AdjustmentDetail> {
    if (costs.length > 0) this.assertCosts(ctx);
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
    if (header.status === 'POSTED') {
      throw new AppError('DOC_ALREADY_POSTED', `adjustment ${id} is posted`, {
        status: header.status,
      });
    }
    if (header.status !== 'SUBMITTED') {
      throw new AppError('DOC_STATE_INVALID', `adjustment ${id} is ${header.status}`, {
        status: header.status,
      });
    }
    const sign = direction(header.reason);
    if (costs.length > 0) {
      if (sign === -1) throw invalid('costs', 'outbound', 'only inbound lines take a cost');
      const own = new Set((await this.linesOf(tx, id)).map((line) => line.id));
      for (const cost of costs) {
        if (!own.has(cost.lineId)) throw invalid('costs', 'line', 'lines of this adjustment');
        await tx
          .update(adjustmentLines)
          .set({ unitCost: cost.unitCost, updatedAt: sql`now()` })
          .where(eq(adjustmentLines.id, cost.lineId));
      }
    }
    const lines = await this.linesOf(tx, id);
    if (sign === 1) {
      await this.locations.assertMayReceive(
        tx,
        header.warehouseId,
        lines.map((line) => line.productId),
      );
    }
    for (const line of lines) {
      // A unit superseded since the line was entered refuses the posting (UNIT_SUPERSEDED).
      await this.units.toBase(line.productUnitId, line.enteredQty, tx);
    }
    const result = await this.posting.post(tx, actor, {
      docs: [{ docType: 'ADJ', docId: id, expectedStatus: 'SUBMITTED', nextStatus: 'POSTED' }],
      movements: lines.map((line) => ({
        docType: 'ADJ' as const,
        docId: id,
        docLineId: line.id,
        movementType: 'ADJUSTMENT' as const,
        leg: 1,
        warehouseId: header.warehouseId,
        binId: line.binId,
        productId: line.productId,
        lotId: line.lotId,
        qtyBase: sign === 1 ? line.qtyBase : line.qtyBase.negated(),
        enteredQty: line.enteredQty,
        productUnitId: line.productUnitId,
        factorSnapshot: line.factorSnapshot,
        ...(sign === 1 && line.unitCost ? { unitCost: line.unitCost } : {}),
      })),
    });
    await this.audit.record(tx, actor, {
      action: 'POST',
      entity: 'adjustments',
      entityId: id,
      before: header,
      after: { number: result.numbers.get(id), lines },
    });
  }

  /**
   * An adjustment written and posted by the system in the caller's transaction (opening stock of
   * an import and its reversal, ADR-0036): lines inserted in chunks, one posting, one audit row.
   * Units and factors come from the caller (frozen on the lines); bins must be in the warehouse.
   */
  async postSystemInTx(
    tx: Tx,
    actor: Actor,
    input: SystemAdjustmentInput,
  ): Promise<{ id: number; number: string }> {
    if (input.lines.length === 0) throw invalid('lines', 'empty', 'an adjustment needs lines');
    if (input.lines.length > MAX_MOVEMENTS_PER_POST) {
      throw invalid('lines', 'max', `at most ${MAX_MOVEMENTS_PER_POST} lines`);
    }
    const warehouse = await this.org.getWarehouse(input.warehouseId, tx);
    if (!ADJUSTABLE_KINDS.includes(warehouse.kind)) {
      throw new AppError('WAREHOUSE_KIND_NOT_ALLOWED', `no adjustments in ${warehouse.kind}`, {
        kind: warehouse.kind,
      });
    }
    const binIds = [...new Set(input.lines.map((line) => line.binId))];
    for (let start = 0; start < binIds.length; start += CHUNK) {
      const part = binIds.slice(start, start + CHUNK);
      const found = await tx
        .select({ id: bins.id })
        .from(bins)
        .where(and(inArray(bins.id, part), eq(bins.warehouseId, input.warehouseId)));
      if (found.length !== part.length) {
        throw invalid('binId', 'warehouse', 'bins of the adjustment’s warehouse');
      }
    }
    const sign = direction(input.reason);
    const [header] = await tx
      .insert(adjustments)
      .values({
        warehouseId: input.warehouseId,
        reason: input.reason,
        status: 'SUBMITTED',
        note: optionalText(input.note) ?? null,
        submittedAt: sql`now()`,
        submittedBy: actorUserId(actor),
        reversesAdjustmentId: input.reversesAdjustmentId ?? null,
        createdBy: actorUserId(actor),
      })
      .returning();
    if (!header) throw new Error('adjustment insert returned no row');
    const lines: AdjustmentLineRow[] = [];
    for (let start = 0; start < input.lines.length; start += CHUNK) {
      lines.push(
        ...(await tx
          .insert(adjustmentLines)
          .values(
            input.lines.slice(start, start + CHUNK).map((line) => ({
              adjustmentId: header.id,
              productId: line.productId,
              productUnitId: line.productUnitId,
              enteredQty: line.enteredQty,
              factorSnapshot: line.factorSnapshot,
              qtyBase: line.enteredQty.times(line.factorSnapshot),
              binId: line.binId,
              unitCost: sign === 1 ? (line.unitCost ?? null) : null,
            })),
          )
          .returning()),
      );
    }
    const result = await this.posting.post(tx, actor, {
      docs: [
        { docType: 'ADJ', docId: header.id, expectedStatus: 'SUBMITTED', nextStatus: 'POSTED' },
      ],
      movements: lines.map((line) => ({
        docType: 'ADJ' as const,
        docId: header.id,
        docLineId: line.id,
        movementType: 'ADJUSTMENT' as const,
        leg: 1,
        warehouseId: input.warehouseId,
        binId: line.binId,
        productId: line.productId,
        lotId: line.lotId,
        qtyBase: sign === 1 ? line.qtyBase : line.qtyBase.negated(),
        enteredQty: line.enteredQty,
        productUnitId: line.productUnitId,
        factorSnapshot: line.factorSnapshot,
        ...(sign === 1 && line.unitCost ? { unitCost: line.unitCost } : {}),
      })),
    });
    const number = result.numbers.get(header.id);
    if (!number) throw new Error(`adjustment ${header.id} got no number`);
    await this.audit.record(tx, actor, {
      action: 'POST',
      entity: 'adjustments',
      entityId: header.id,
      after: {
        number,
        warehouseId: input.warehouseId,
        reason: input.reason,
        reversesAdjustmentId: input.reversesAdjustmentId ?? null,
        lineCount: lines.length,
      },
    });
    return { id: header.id, number };
  }

  /**
   * Takes back a posted opening-stock adjustment with an OPENING_REVERSAL of the same lines
   * (an import revert). Never twice: `reverses_adjustment_id` is unique. STOCK_INSUFFICIENT when
   * the goods have moved since.
   */
  async reverseOpeningInTx(
    tx: Tx,
    actor: Actor,
    adjustmentId: number,
  ): Promise<{ id: number; number: string }> {
    const header = await this.lockHeader(tx, adjustmentId);
    if (header.reason !== 'OPENING' || header.status !== 'POSTED') {
      throw new AppError(
        'DOC_STATE_INVALID',
        `adjustment ${adjustmentId} is not posted opening stock`,
        {
          status: header.status,
        },
      );
    }
    const [reversed] = await tx
      .select({ id: adjustments.id })
      .from(adjustments)
      .where(eq(adjustments.reversesAdjustmentId, adjustmentId));
    if (reversed) {
      throw new AppError('DOC_ALREADY_POSTED', `adjustment ${adjustmentId} is already reversed`, {
        status: header.status,
      });
    }
    const lines = await this.linesOf(tx, adjustmentId);
    return this.postSystemInTx(tx, actor, {
      warehouseId: header.warehouseId,
      reason: 'OPENING_REVERSAL',
      note: header.number,
      reversesAdjustmentId: adjustmentId,
      lines: lines.map((line) => ({
        productId: line.productId,
        productUnitId: line.productUnitId,
        enteredQty: line.enteredQty,
        factorSnapshot: line.factorSnapshot,
        binId: line.binId,
        unitCost: null,
      })),
    });
  }

  async get(id: number, executor: Db | Tx = this.db): Promise<AdjustmentDetail> {
    const [header] = await executor.select().from(adjustments).where(eq(adjustments.id, id));
    if (!header) throw notFound('adjustment', id);
    const lines = await this.describe(executor, await this.linesOf(executor, id));
    return {
      id: header.id,
      number: header.number,
      warehouseId: header.warehouseId,
      reason: header.reason,
      status: header.status,
      note: header.note,
      submittedAt: header.submittedAt,
      effectiveDate: header.effectiveDate,
      postedAt: header.postedAt,
      createdAt: header.createdAt,
      updatedAt: header.updatedAt,
      lines,
    };
  }

  async list(query: {
    warehouseId?: number;
    status?: AdjustmentStatus;
    cursor?: string;
    limit?: number;
  }): Promise<{ data: AdjustmentSummary[]; nextCursor: string | null }> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const filters: SQL[] = [];
    if (query.warehouseId) filters.push(eq(adjustments.warehouseId, query.warehouseId));
    if (query.status) filters.push(eq(adjustments.status, query.status));
    const after = decodeCursor(query.cursor);
    if (typeof after?.id === 'number') filters.push(lt(adjustments.id, after.id));
    const rows = await this.db
      .select({
        id: adjustments.id,
        number: adjustments.number,
        warehouseId: adjustments.warehouseId,
        reason: adjustments.reason,
        status: adjustments.status,
        submittedAt: adjustments.submittedAt,
        effectiveDate: adjustments.effectiveDate,
        createdAt: adjustments.createdAt,
        // Spelled out: a single-table select leaves columns unqualified (see ReceiptsService.list).
        lineCount: sql<string>`(SELECT count(*) FROM adjustment_lines l WHERE l.adjustment_id = adjustments.id)`,
      })
      .from(adjustments)
      .where(and(...filters))
      .orderBy(desc(adjustments.id))
      .limit(limit + 1);
    const page = toPage(rows, limit, (row) => ({ id: row.id }));
    return {
      data: page.data.map((row) => ({ ...row, lineCount: Number.parseInt(row.lineCount, 10) })),
      nextCursor: page.nextCursor,
    };
  }

  // -------------------------------------------------------------------------------------------

  private assertCosts(ctx: AuthContext): void {
    if (!ctx.permissions.has(COSTS)) {
      throw new AppError('FORBIDDEN', 'costs are set by cost holders', { permission: COSTS });
    }
  }

  private async insertLine(
    tx: Tx,
    header: AdjustmentRow,
    line: AdjustmentLineInput,
  ): Promise<void> {
    const converted = await this.units.toBase(line.productUnitId, line.enteredQty, tx);
    if (direction(header.reason) === 1) {
      await this.locations.assertMayReceive(tx, header.warehouseId, [converted.productId]);
    } else if (line.unitCost !== undefined && line.unitCost !== null) {
      throw invalid('unitCost', 'outbound', 'only inbound lines take a cost');
    }
    await this.assertBin(tx, header.warehouseId, line.binId);
    await tx.insert(adjustmentLines).values({
      adjustmentId: header.id,
      productId: converted.productId,
      productUnitId: converted.unitId,
      enteredQty: line.enteredQty,
      factorSnapshot: converted.factorSnapshot,
      qtyBase: converted.qtyBase,
      binId: line.binId,
      unitCost: line.unitCost ?? null,
      note: optionalText(line.note) ?? null,
    });
  }

  private async assertBin(tx: Tx, warehouseId: number, binId: number): Promise<void> {
    const [bin] = await tx.select().from(bins).where(eq(bins.id, binId));
    if (!bin || bin.warehouseId !== warehouseId) {
      throw invalid('binId', 'warehouse', 'a bin of the adjustment’s warehouse');
    }
    if (bin.archivedAt)
      throw new AppError('BIN_ARCHIVED', `bin ${bin.code} is archived`, { code: bin.code });
  }

  private async linesOf(executor: Db | Tx, id: number): Promise<AdjustmentLineRow[]> {
    return executor
      .select()
      .from(adjustmentLines)
      .where(eq(adjustmentLines.adjustmentId, id))
      .orderBy(adjustmentLines.id);
  }

  private async describe(
    executor: Db | Tx,
    lines: readonly AdjustmentLineRow[],
  ): Promise<AdjustmentLine[]> {
    const products = new Map(
      (await this.catalog.getMany([...new Set(lines.map((line) => line.productId))], executor)).map(
        (product) => [product.id, product],
      ),
    );
    const units = await this.units.describe(
      [...new Set(lines.map((line) => line.productUnitId))],
      executor,
    );
    const binIds = [...new Set(lines.map((line) => line.binId))];
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
    return lines.map((line) => ({
      id: line.id,
      productId: line.productId,
      productSku: products.get(line.productId)?.sku ?? '',
      productName: products.get(line.productId)?.name ?? '',
      productUnitId: line.productUnitId,
      unitName: units.get(line.productUnitId)?.uomName ?? '',
      enteredQty: line.enteredQty,
      qtyBase: line.qtyBase,
      binId: line.binId,
      binCode: codes.get(line.binId) ?? '',
      note: line.note,
    }));
  }

  private async lockHeader(tx: Tx, id: number): Promise<AdjustmentRow> {
    const [row] = await tx.select().from(adjustments).where(eq(adjustments.id, id)).for('update');
    if (!row) throw notFound('adjustment', id);
    return row;
  }

  private async lockState(
    tx: Tx,
    ctx: AuthContext,
    id: number,
    status: AdjustmentStatus,
  ): Promise<AdjustmentRow> {
    const header = await this.lockHeader(tx, id);
    this.scope.assertCanWriteWarehouse(ctx, header.warehouseId);
    if (header.status === 'POSTED') {
      throw new AppError('DOC_ALREADY_POSTED', `adjustment ${id} is posted`, {
        status: header.status,
      });
    }
    if (header.status !== status) {
      throw new AppError('DOC_STATE_INVALID', `adjustment ${id} is ${header.status}`, {
        status: header.status,
      });
    }
    return header;
  }

  private lockDraft(tx: Tx, ctx: AuthContext, id: number): Promise<AdjustmentRow> {
    return this.lockState(tx, ctx, id, 'DRAFT');
  }

  private async lockLine(
    tx: Tx,
    ctx: AuthContext,
    lineId: number,
  ): Promise<{ header: AdjustmentRow; line: AdjustmentLineRow }> {
    const [peek] = await tx
      .select({ adjustmentId: adjustmentLines.adjustmentId })
      .from(adjustmentLines)
      .where(eq(adjustmentLines.id, lineId));
    if (!peek) throw notFound('adjustment line', lineId);
    const header = await this.lockDraft(tx, ctx, peek.adjustmentId);
    const [line] = await tx.select().from(adjustmentLines).where(eq(adjustmentLines.id, lineId));
    if (!line) throw notFound('adjustment line', lineId);
    return { header, line };
  }

  private async touch(tx: Tx, id: number): Promise<void> {
    await tx
      .update(adjustments)
      .set({ updatedAt: sql`now()` })
      .where(eq(adjustments.id, id));
  }
}

/** OPENING_REVERSAL is posted only when an import is reverted (ADR-0036). */
function assertRequestable(reason: AdjustmentReason): void {
  if (reason === 'OPENING_REVERSAL') throw invalid('reason', 'system', 'a system reason');
}

function direction(reason: AdjustmentReason): -1 | 1 {
  return ADJUSTMENT_REASONS[reason];
}
