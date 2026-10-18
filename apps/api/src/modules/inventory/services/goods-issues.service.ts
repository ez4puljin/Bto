import { Inject, Injectable } from '@nestjs/common';
import {
  type IssueRecipientKind,
  MAX_ISSUE_LINES,
  SELLABLE_BIN_TYPES,
} from '@tugeel/shared/inventory';
import { Decimal } from '@tugeel/shared/money';
import { businessDate } from '@tugeel/shared/time';
import { and, desc, eq, ilike, inArray, isNull, lt, or, type SQL, sql } from 'drizzle-orm';
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
  UserNamesService,
} from '../../identity';
import { CustomersService, SuppliersService } from '../../partners';
import { bins, binStock, goodsIssueLines, goodsIssues, ISSUE_STATUSES } from '../schema';
import { BinsService } from './bins.service';
import { IssueExpenseTypesService } from './issue-expense-types.service';
import { ProductLocationsService } from './product-locations.service';
import { StockPostingService } from './stock-posting.service';
import { optionalText } from './support';

type IssueRow = typeof goodsIssues.$inferSelect;
type LineRow = typeof goodsIssueLines.$inferSelect;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

/** Goods leave the stock from these warehouse kinds (owner 2026-10-18: every warehouse). */
const ISSUE_WAREHOUSE_KINDS = ['WHOLESALE', 'STORE'];
/** Bins goods may leave from: the receiving area, shelves and the sales floor. */
const ISSUE_BIN_TYPES = ['RECEIVING', 'STORAGE', 'PICKING', 'SALESFLOOR', 'RETURNS', 'DAMAGED'];

export interface IssueRecipientInput {
  kind: IssueRecipientKind;
  userId?: number | null;
  customerId?: number | null;
  supplierId?: number | null;
  /** The name of an OTHER recipient. */
  name?: string | null;
}

export interface IssueLineInput {
  productUnitId: number;
  enteredQty: Decimal;
  /** Omitted: the fixed shelf when it holds the product, else the sellable bin holding the most. */
  binId?: number | null;
}

export interface IssueInput {
  warehouseId: number;
  /** Default today (Ulaanbaatar). */
  issuedOn?: string | null;
  expenseTypeId: number;
  recipient: IssueRecipientInput;
  note?: string | null;
  lines?: readonly IssueLineInput[];
}

export interface IssuePatch {
  issuedOn?: string;
  expenseTypeId?: number;
  recipient?: IssueRecipientInput;
  note?: string | null;
}

export interface IssueLine {
  id: number;
  productId: number;
  productSku: string;
  productName: string;
  productUnitId: number;
  unitName: string;
  enteredQty: Decimal;
  factorSnapshot: Decimal;
  qtyBase: Decimal;
  binId: number;
  binCode: string;
  /** Cost data: the average it left at (null on a draft). */
  unitCost: Decimal | null;
  amount: Decimal | null;
}

export interface IssueDetail {
  id: number;
  number: string | null;
  warehouseId: number;
  warehouseName: string;
  issuedOn: string;
  expenseTypeId: number;
  expenseTypeName: string;
  recipientKind: IssueRecipientKind;
  recipientUserId: number | null;
  recipientCustomerId: number | null;
  recipientSupplierId: number | null;
  recipientName: string | null;
  status: IssueStatus;
  note: string | null;
  effectiveDate: string | null;
  postedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  lines: IssueLine[];
  /** Cost data: Σ line amounts once posted. */
  total: Decimal | null;
}

export interface IssueSummary {
  id: number;
  number: string | null;
  warehouseId: number;
  issuedOn: string;
  expenseTypeId: number;
  expenseTypeName: string;
  recipientKind: IssueRecipientKind;
  recipientName: string | null;
  status: IssueStatus;
  lineCount: number;
  effectiveDate: string | null;
  createdAt: Date;
}

export interface IssueQuery {
  warehouseId?: number;
  status?: IssueStatus;
  expenseTypeId?: number;
  /** Number or recipient name. */
  q?: string;
  cursor?: string;
  limit?: number;
}

/**
 * Goods issues (GI-, ADR-0081): goods leave a warehouse for an expense type and a recipient, at the
 * warehouse's average cost. Warehouse staff build the draft (created by its first line, like a
 * receipt) and post it themselves — no approval. Each line leaves its fixed shelf when that shelf
 * holds the product, else the sellable bin holding the most; a scanned shelf label overrides. Every
 * action locks the header first (ADR-0034); creation, posting and cancelling are audited.
 */
@Injectable()
export class GoodsIssuesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly bins: BinsService,
    private readonly catalog: CatalogService,
    private readonly customers: CustomersService,
    private readonly expenseTypes: IssueExpenseTypesService,
    private readonly locations: ProductLocationsService,
    private readonly org: OrgService,
    private readonly posting: StockPostingService,
    private readonly scope: ScopeService,
    private readonly suppliers: SuppliersService,
    private readonly units: UnitConversionService,
    private readonly users: UserNamesService,
  ) {}

  async create(ctx: AuthContext, input: IssueInput): Promise<IssueDetail> {
    this.scope.assertCanWriteWarehouse(ctx, input.warehouseId);
    return inTransaction(this.db, async (tx) => {
      const id = await this.createInTx(tx, ctx, input);
      return this.get(id, tx);
    });
  }

  async createInTx(tx: Tx, actor: Actor, input: IssueInput): Promise<number> {
    const warehouse = await this.org.getWarehouse(input.warehouseId, tx);
    if (!ISSUE_WAREHOUSE_KINDS.includes(warehouse.kind)) {
      throw new AppError(
        'WAREHOUSE_KIND_NOT_ALLOWED',
        'goods are issued from a warehouse or store',
        {
          kind: warehouse.kind,
        },
      );
    }
    await this.expenseTypes.assertActive(tx, input.expenseTypeId);
    const recipient = await this.recipientOf(tx, input.recipient);
    if ((input.lines?.length ?? 0) > MAX_ISSUE_LINES) {
      throw invalid('lines', 'max', `at most ${MAX_ISSUE_LINES} lines`);
    }
    const [row] = await tx
      .insert(goodsIssues)
      .values({
        warehouseId: input.warehouseId,
        issuedOn: input.issuedOn ?? businessDate(),
        expenseTypeId: input.expenseTypeId,
        ...recipient,
        note: optionalText(input.note) ?? null,
        createdBy: actorUserId(actor),
      })
      .returning();
    if (!row) throw new Error('issue insert returned no row');
    for (const line of input.lines ?? []) await this.insertLine(tx, row, line);
    await this.audit.record(tx, actor, {
      action: 'CREATE',
      entity: 'goods_issues',
      entityId: row.id,
      after: row,
    });
    return row.id;
  }

  update(ctx: AuthContext, id: number, patch: IssuePatch): Promise<IssueDetail> {
    return inTransaction(this.db, async (tx) => {
      const header = await this.lockDraft(tx, ctx, id);
      if (patch.expenseTypeId !== undefined && patch.expenseTypeId !== header.expenseTypeId) {
        await this.expenseTypes.assertActive(tx, patch.expenseTypeId);
      }
      const recipient = patch.recipient ? await this.recipientOf(tx, patch.recipient) : {};
      await tx
        .update(goodsIssues)
        .set({
          ...(patch.issuedOn === undefined ? {} : { issuedOn: patch.issuedOn }),
          ...(patch.expenseTypeId === undefined ? {} : { expenseTypeId: patch.expenseTypeId }),
          ...recipient,
          ...(patch.note === undefined ? {} : { note: optionalText(patch.note) ?? null }),
          updatedAt: sql`now()`,
        })
        .where(eq(goodsIssues.id, id));
      return this.get(header.id, tx);
    });
  }

  addLine(ctx: AuthContext, issueId: number, line: IssueLineInput): Promise<IssueDetail> {
    return inTransaction(this.db, async (tx) => {
      const header = await this.lockDraft(tx, ctx, issueId);
      const [count] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(goodsIssueLines)
        .where(eq(goodsIssueLines.issueId, issueId));
      if ((count?.n ?? 0) >= MAX_ISSUE_LINES) {
        throw invalid('lines', 'max', `at most ${MAX_ISSUE_LINES} lines`);
      }
      await this.insertLine(tx, header, line);
      await this.touch(tx, issueId);
      return this.get(issueId, tx);
    });
  }

  updateLine(
    ctx: AuthContext,
    lineId: number,
    patch: { enteredQty?: Decimal; binId?: number },
  ): Promise<IssueDetail> {
    return inTransaction(this.db, async (tx) => {
      const { header, line } = await this.lockLine(tx, ctx, lineId);
      const enteredQty = patch.enteredQty ?? line.enteredQty;
      const converted = await this.units.toBase(line.productUnitId, enteredQty, tx);
      const binId = patch.binId ?? line.binId;
      if (patch.binId !== undefined) await this.assertBin(tx, header.warehouseId, binId);
      await tx
        .update(goodsIssueLines)
        .set({
          enteredQty,
          factorSnapshot: converted.factorSnapshot,
          qtyBase: converted.qtyBase,
          binId,
          updatedAt: sql`now()`,
        })
        .where(eq(goodsIssueLines.id, lineId));
      await this.touch(tx, header.id);
      return this.get(header.id, tx);
    });
  }

  removeLine(ctx: AuthContext, lineId: number): Promise<IssueDetail> {
    return inTransaction(this.db, async (tx) => {
      const { header } = await this.lockLine(tx, ctx, lineId);
      await tx.delete(goodsIssueLines).where(eq(goodsIssueLines.id, lineId));
      await this.touch(tx, header.id);
      return this.get(header.id, tx);
    });
  }

  /**
   * DRAFT → POSTED by the warehouse itself (ADR-0081 #3): every line leaves its bin at the
   * warehouse's average cost; a bin that holds too little refuses the whole issue
   * (STOCK_INSUFFICIENT with the shelf and what it holds). The cost each line left at is kept.
   */
  post(ctx: AuthContext, id: number): Promise<IssueDetail> {
    return inTransaction(this.db, async (tx) => {
      const header = await this.lockHeader(tx, id);
      this.scope.assertCanWriteWarehouse(ctx, header.warehouseId);
      assertDraft(header);
      const lines = await this.linesOf(tx, id);
      if (lines.length === 0) throw invalid('lines', 'empty', 'an issue needs at least one line');
      await this.expenseTypes.assertActive(tx, header.expenseTypeId);
      for (const line of lines) {
        // A unit superseded since the line was entered refuses the posting (UNIT_SUPERSEDED).
        await this.units.toBase(line.productUnitId, line.enteredQty, tx);
      }
      const result = await this.posting.post(tx, ctx, {
        docs: [{ docType: 'GI', docId: id, expectedStatus: 'DRAFT', nextStatus: 'POSTED' }],
        movements: lines.map((line) => ({
          docType: 'GI' as const,
          docId: id,
          docLineId: line.id,
          movementType: 'GOODS_ISSUE' as const,
          leg: 1,
          warehouseId: header.warehouseId,
          binId: line.binId,
          productId: line.productId,
          lotId: line.lotId,
          qtyBase: line.qtyBase.negated(),
          enteredQty: line.enteredQty,
          productUnitId: line.productUnitId,
          factorSnapshot: line.factorSnapshot,
        })),
      });
      for (const line of lines) {
        const unitCost = result.unitCosts.get(`${line.id}:GOODS_ISSUE:1`);
        if (unitCost === undefined) continue;
        await tx.update(goodsIssueLines).set({ unitCost }).where(eq(goodsIssueLines.id, line.id));
      }
      await this.audit.record(tx, ctx, {
        action: 'POST',
        entity: 'goods_issues',
        entityId: id,
        before: header,
        after: { number: result.numbers.get(id), lines },
      });
      return this.get(id, tx);
    });
  }

  cancel(ctx: AuthContext, id: number): Promise<IssueDetail> {
    return inTransaction(this.db, async (tx) => {
      const header = await this.lockDraft(tx, ctx, id);
      await this.cancelLocked(tx, ctx, header);
      return this.get(id, tx);
    });
  }

  /** Cancels drafts an import made while every one is untouched (ADR-0081 #7). */
  async cancelDraftsInTx(
    tx: Tx,
    actor: Actor,
    ids: readonly number[],
  ): Promise<{ id: number; touched: boolean; status: IssueStatus }[]> {
    const states: { id: number; touched: boolean; status: IssueStatus }[] = [];
    for (const id of [...ids].sort((a, b) => a - b)) {
      const header = await this.lockHeader(tx, id);
      states.push({
        id,
        status: header.status,
        touched: header.updatedAt.getTime() !== header.createdAt.getTime(),
      });
    }
    if (states.some((state) => state.status !== 'DRAFT' || state.touched)) return states;
    for (const id of ids) await this.cancelLocked(tx, actor, await this.lockHeader(tx, id));
    return states;
  }

  async get(id: number, executor: Db | Tx = this.db): Promise<IssueDetail> {
    const [header] = await executor.select().from(goodsIssues).where(eq(goodsIssues.id, id));
    if (!header) throw notFound('goods issue', id);
    const warehouse = await this.org.getWarehouse(header.warehouseId, executor);
    const expenseType = await this.expenseTypes.get(header.expenseTypeId, executor);
    const lines = await this.describeLines(executor, await this.linesOf(executor, id));
    return {
      id: header.id,
      number: header.number,
      warehouseId: header.warehouseId,
      warehouseName: warehouse.name,
      issuedOn: header.issuedOn,
      expenseTypeId: header.expenseTypeId,
      expenseTypeName: expenseType.name,
      recipientKind: header.recipientKind,
      recipientUserId: header.recipientUserId,
      recipientCustomerId: header.recipientCustomerId,
      recipientSupplierId: header.recipientSupplierId,
      recipientName: header.recipientName,
      status: header.status,
      note: header.note,
      effectiveDate: header.effectiveDate,
      postedAt: header.postedAt,
      createdAt: header.createdAt,
      updatedAt: header.updatedAt,
      lines,
      total:
        header.status === 'POSTED'
          ? lines.reduce((sum, line) => sum.plus(line.amount ?? 0), new Decimal(0))
          : null,
    };
  }

  async list(query: IssueQuery): Promise<{ data: IssueSummary[]; nextCursor: string | null }> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const filters: SQL[] = [];
    if (query.warehouseId) filters.push(eq(goodsIssues.warehouseId, query.warehouseId));
    if (query.status) filters.push(eq(goodsIssues.status, query.status));
    if (query.expenseTypeId) filters.push(eq(goodsIssues.expenseTypeId, query.expenseTypeId));
    const q = query.q?.trim();
    if (q) {
      const pattern = `%${escapeLike(q)}%`;
      const match = or(
        ilike(goodsIssues.number, pattern),
        ilike(goodsIssues.recipientName, pattern),
      );
      if (match) filters.push(match);
    }
    const after = decodeCursor(query.cursor);
    if (typeof after?.id === 'number') filters.push(lt(goodsIssues.id, after.id));
    const rows = await this.db
      .select({
        id: goodsIssues.id,
        number: goodsIssues.number,
        warehouseId: goodsIssues.warehouseId,
        issuedOn: goodsIssues.issuedOn,
        expenseTypeId: goodsIssues.expenseTypeId,
        recipientKind: goodsIssues.recipientKind,
        recipientName: goodsIssues.recipientName,
        status: goodsIssues.status,
        effectiveDate: goodsIssues.effectiveDate,
        createdAt: goodsIssues.createdAt,
        // Spelled out: a bare "id" inside the subquery would mean the line's own id.
        lineCount: sql<string>`(SELECT count(*) FROM goods_issue_lines l WHERE l.issue_id = goods_issues.id)`,
      })
      .from(goodsIssues)
      .where(and(...filters))
      .orderBy(desc(goodsIssues.id))
      .limit(limit + 1);
    const page = toPage(rows, limit, (row) => ({ id: row.id }));
    const types = new Map((await this.expenseTypes.list()).map((type) => [type.id, type.name]));
    return {
      data: page.data.map((row) => ({
        ...row,
        lineCount: Number.parseInt(row.lineCount, 10),
        expenseTypeName: types.get(row.expenseTypeId) ?? '',
      })),
      nextCursor: page.nextCursor,
    };
  }

  // -------------------------------------------------------------------------------------------

  /** The recipient's columns: the chosen record (active) with its name as a snapshot, or a name. */
  private async recipientOf(
    tx: Tx,
    input: IssueRecipientInput,
  ): Promise<{
    recipientKind: IssueRecipientKind;
    recipientUserId: number | null;
    recipientCustomerId: number | null;
    recipientSupplierId: number | null;
    recipientName: string | null;
  }> {
    const none = { recipientUserId: null, recipientCustomerId: null, recipientSupplierId: null };
    switch (input.kind) {
      case 'USER': {
        const user = input.userId
          ? (await this.users.summariesOf([input.userId])).get(input.userId)
          : undefined;
        if (!user || user.status !== 'ACTIVE') {
          throw invalid('recipient.userId', 'active', 'an active user');
        }
        return {
          ...none,
          recipientKind: 'USER',
          recipientUserId: user.id,
          recipientName: user.fullName,
        };
      }
      case 'CUSTOMER': {
        if (!input.customerId) throw invalid('recipient.customerId', 'required', 'a customer');
        await this.customers.assertActive(tx, input.customerId);
        const [customer] = await this.customers.getMany([input.customerId], tx);
        return {
          ...none,
          recipientKind: 'CUSTOMER',
          recipientCustomerId: input.customerId,
          recipientName: customer?.name ?? null,
        };
      }
      case 'SUPPLIER': {
        if (!input.supplierId) throw invalid('recipient.supplierId', 'required', 'a supplier');
        await this.suppliers.assertActive(tx, input.supplierId);
        const [supplier] = await this.suppliers.getMany([input.supplierId], tx);
        return {
          ...none,
          recipientKind: 'SUPPLIER',
          recipientSupplierId: input.supplierId,
          recipientName: supplier?.name ?? null,
        };
      }
      case 'OTHER': {
        const name = optionalText(input.name);
        if (!name) throw invalid('recipient.name', 'required', 'the recipient’s name');
        if (name.length > 200) throw invalid('recipient.name', 'length', 'at most 200 characters');
        return { ...none, recipientKind: 'OTHER', recipientName: name };
      }
    }
  }

  private async insertLine(tx: Tx, header: IssueRow, line: IssueLineInput): Promise<void> {
    const converted = await this.units.toBase(line.productUnitId, line.enteredQty, tx);
    const binId = line.binId ?? (await this.sourceBin(tx, header.warehouseId, converted.productId));
    await this.assertBin(tx, header.warehouseId, binId);
    await tx.insert(goodsIssueLines).values({
      issueId: header.id,
      productId: converted.productId,
      productUnitId: converted.unitId,
      enteredQty: line.enteredQty,
      factorSnapshot: converted.factorSnapshot,
      qtyBase: converted.qtyBase,
      binId,
    });
  }

  /**
   * Where a line leaves from (ADR-0081 #4): the product's fixed shelf when it holds the product,
   * else the active sellable bin holding the most, else the fixed shelf, else the receiving area.
   */
  private async sourceBin(tx: Tx, warehouseId: number, productId: number): Promise<number> {
    const fixed = (await this.locations.defaultBinOf(warehouseId, [productId], tx)).get(productId);
    const held = await tx
      .select({ binId: binStock.binId, onHand: binStock.onHand })
      .from(binStock)
      .innerJoin(bins, eq(bins.id, binStock.binId))
      .where(
        and(
          eq(binStock.warehouseId, warehouseId),
          eq(binStock.productId, productId),
          isNull(binStock.lotId),
          isNull(bins.archivedAt),
          eq(bins.status, 'ACTIVE'),
          inArray(bins.type, [...SELLABLE_BIN_TYPES]),
        ),
      );
    const positive = held.filter((row) => row.onHand.gt(0));
    if (fixed !== undefined && positive.some((row) => row.binId === fixed)) return fixed;
    const most = positive.reduce<(typeof positive)[number] | undefined>(
      (best, row) => (best === undefined || row.onHand.gt(best.onHand) ? row : best),
      undefined,
    );
    if (most) return most.binId;
    if (fixed !== undefined) return fixed;
    return (await this.bins.systemBin(warehouseId, 'RECEIVING', tx)).id;
  }

  private async assertBin(tx: Tx, warehouseId: number, binId: number): Promise<void> {
    const bin = await this.bins.get(binId, tx).catch(() => undefined);
    if (!bin || bin.warehouseId !== warehouseId) {
      throw invalid('binId', 'warehouse', 'a bin of the issue’s warehouse');
    }
    if (!ISSUE_BIN_TYPES.includes(bin.type)) {
      throw invalid('binId', 'type', 'a shelf, the sales floor or the receiving area');
    }
    if (bin.archivedAt) {
      throw new AppError('BIN_ARCHIVED', `bin ${bin.code} is archived`, { code: bin.code });
    }
  }

  private async cancelLocked(tx: Tx, actor: Actor, header: IssueRow): Promise<void> {
    await tx
      .update(goodsIssues)
      .set({ status: 'CANCELLED', updatedAt: sql`now()` })
      .where(eq(goodsIssues.id, header.id));
    await this.audit.record(tx, actor, {
      action: 'CANCEL',
      entity: 'goods_issues',
      entityId: header.id,
      before: header,
    });
  }

  private async linesOf(executor: Db | Tx, issueId: number): Promise<LineRow[]> {
    return executor
      .select()
      .from(goodsIssueLines)
      .where(eq(goodsIssueLines.issueId, issueId))
      .orderBy(goodsIssueLines.id);
  }

  private async describeLines(executor: Db | Tx, lines: readonly LineRow[]): Promise<IssueLine[]> {
    const products = new Map(
      (await this.catalog.getMany([...new Set(lines.map((line) => line.productId))], executor)).map(
        (product) => [product.id, product],
      ),
    );
    const units = await this.units.describe(
      [...new Set(lines.map((line) => line.productUnitId))],
      executor,
    );
    const binCodes = new Map(
      lines.length === 0
        ? []
        : (
            await executor
              .select({ id: bins.id, code: bins.code })
              .from(bins)
              .where(inArray(bins.id, [...new Set(lines.map((line) => line.binId))]))
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
      factorSnapshot: line.factorSnapshot,
      qtyBase: line.qtyBase,
      binId: line.binId,
      binCode: binCodes.get(line.binId) ?? '',
      unitCost: line.unitCost,
      amount: line.unitCost ? line.unitCost.times(line.qtyBase).toDecimalPlaces(2) : null,
    }));
  }

  private async lockHeader(tx: Tx, id: number): Promise<IssueRow> {
    const [row] = await tx.select().from(goodsIssues).where(eq(goodsIssues.id, id)).for('update');
    if (!row) throw notFound('goods issue', id);
    return row;
  }

  private async lockDraft(tx: Tx, ctx: AuthContext, id: number): Promise<IssueRow> {
    const header = await this.lockHeader(tx, id);
    this.scope.assertCanWriteWarehouse(ctx, header.warehouseId);
    assertDraft(header);
    return header;
  }

  private async lockLine(
    tx: Tx,
    ctx: AuthContext,
    lineId: number,
  ): Promise<{ header: IssueRow; line: LineRow }> {
    const [peek] = await tx
      .select({ issueId: goodsIssueLines.issueId })
      .from(goodsIssueLines)
      .where(eq(goodsIssueLines.id, lineId));
    if (!peek) throw notFound('issue line', lineId);
    const header = await this.lockDraft(tx, ctx, peek.issueId);
    const [line] = await tx.select().from(goodsIssueLines).where(eq(goodsIssueLines.id, lineId));
    if (!line) throw notFound('issue line', lineId);
    return { header, line };
  }

  private async touch(tx: Tx, id: number): Promise<void> {
    await tx
      .update(goodsIssues)
      .set({ updatedAt: sql`now()` })
      .where(eq(goodsIssues.id, id));
  }
}

function assertDraft(header: IssueRow): void {
  if (header.status === 'POSTED') {
    throw new AppError('DOC_ALREADY_POSTED', `issue ${header.id} is posted`, {
      status: header.status,
    });
  }
  if (header.status !== 'DRAFT') {
    throw new AppError('DOC_STATE_INVALID', `issue ${header.id} is ${header.status}`, {
      status: header.status,
    });
  }
}
