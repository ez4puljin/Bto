import { Inject, Injectable } from '@nestjs/common';
import { canRecost, costingDeadline, lineAmountOf, unitCostOf } from '@tugeel/shared/inventory';
import { Decimal } from '@tugeel/shared/money';
import { businessDate } from '@tugeel/shared/time';
import { and, desc, eq, ilike, inArray, lt, or, type SQL, sql } from 'drizzle-orm';
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
import { SuppliersService } from '../../partners';
import { bins, goodsReceiptLines, goodsReceipts, RECEIPT_STATUSES } from '../schema';
import { BinsService } from './bins.service';
import { ProductLocationsService } from './product-locations.service';
import { StockPostingService } from './stock-posting.service';
import { optionalText } from './support';

type ReceiptRow = typeof goodsReceipts.$inferSelect;
type LineRow = typeof goodsReceiptLines.$inferSelect;
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];

/** Bins a receipt may fill: the receiving area and shelves (ADR-0033 #1). */
const RECEIPT_BIN_TYPES = ['RECEIVING', 'STORAGE', 'PICKING'];

export interface ReceiptLineInput {
  productUnitId: number;
  enteredQty: Decimal;
  /** Omitted: the product's fixed shelf in the warehouse, else the RECEIVING bin. */
  binId?: number | null;
}

export interface ReceiptInput {
  warehouseId: number;
  supplierId: number;
  supplierDocNo?: string | null;
  supplierDocDate?: string | null;
  note?: string | null;
  lines?: readonly ReceiptLineInput[];
}

export interface ReceiptPatch {
  supplierId?: number;
  supplierDocNo?: string | null;
  supplierDocDate?: string | null;
  note?: string | null;
}

export interface ReceiptLine {
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
  lotId: number | null;
}

export interface ReceiptDetail {
  id: number;
  number: string | null;
  warehouseId: number;
  warehouseName: string;
  supplierId: number;
  supplierCode: string;
  supplierName: string;
  supplierDocNo: string | null;
  supplierDocDate: string | null;
  status: ReceiptStatus;
  costingStatus: 'PENDING' | 'COSTED' | null;
  note: string | null;
  effectiveDate: string | null;
  postedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  lines: ReceiptLine[];
}

export interface ReceiptSummary {
  id: number;
  number: string | null;
  warehouseId: number;
  supplierId: number;
  supplierName: string;
  supplierDocNo: string | null;
  status: ReceiptStatus;
  costingStatus: 'PENDING' | 'COSTED' | null;
  lineCount: number;
  effectiveDate: string | null;
  createdAt: Date;
}

export interface ReceiptQuery {
  warehouseId?: number;
  status?: ReceiptStatus;
  /** Posted receipts the accountant has not costed yet. */
  costingPending?: boolean;
  supplierId?: number;
  /** Number or supplier document number. */
  q?: string;
  cursor?: string;
  limit?: number;
}

export interface CostLineInput {
  lineId: number;
  /** Line amount, MNT ex-VAT. */
  amount?: Decimal;
  /** Or a price per entered unit (converted with round(price × entered qty, 2)). */
  unitPrice?: Decimal;
  freeGoods?: boolean;
}

export interface CostedReceiptLine {
  lineId: number;
  productId: number;
  productName: string;
  unitName: string;
  enteredQty: Decimal;
  qtyBase: Decimal;
  provisionalUnitCost: Decimal;
  amount: Decimal | null;
  unitCost: Decimal | null;
  freeGoods: boolean;
}

export interface ReceiptCosting {
  receiptId: number;
  number: string | null;
  status: ReceiptStatus;
  costingStatus: 'PENDING' | 'COSTED' | null;
  costingVersion: number;
  /** Last business date a costed receipt may be costed again. */
  recostUntil: string | null;
  costedAt: Date | null;
  total: Decimal | null;
  lines: CostedReceiptLine[];
}

/**
 * Goods receipts (GR-, SPEC §5.4, ADR-0033): warehouse staff count what arrived into its shelf and
 * post it, so it is sellable at once at a provisional cost; the accountant costs the receipt later.
 * Every action locks the receipt header first and reads its lines after (ADR-0034). Draft edits are
 * not audited; creation, posting, cancelling and costing are.
 */
@Injectable()
export class ReceiptsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly bins: BinsService,
    private readonly catalog: CatalogService,
    private readonly locations: ProductLocationsService,
    private readonly org: OrgService,
    private readonly posting: StockPostingService,
    private readonly scope: ScopeService,
    private readonly suppliers: SuppliersService,
    private readonly units: UnitConversionService,
  ) {}

  async create(ctx: AuthContext, input: ReceiptInput): Promise<ReceiptDetail> {
    this.scope.assertCanWriteWarehouse(ctx, input.warehouseId);
    return inTransaction(this.db, async (tx) => {
      const id = await this.createInTx(tx, ctx, input);
      return this.get(id, tx);
    });
  }

  async createInTx(tx: Tx, actor: Actor, input: ReceiptInput): Promise<number> {
    const warehouse = await this.org.getWarehouse(input.warehouseId, tx);
    if (warehouse.kind !== 'WHOLESALE') {
      throw new AppError(
        'WAREHOUSE_KIND_NOT_ALLOWED',
        'goods are received into wholesale warehouses',
        {
          kind: warehouse.kind,
        },
      );
    }
    await this.suppliers.assertActive(tx, input.supplierId);
    const [row] = await tx
      .insert(goodsReceipts)
      .values({
        warehouseId: input.warehouseId,
        supplierId: input.supplierId,
        supplierDocNo: optionalText(input.supplierDocNo) ?? null,
        supplierDocDate: input.supplierDocDate ?? null,
        note: optionalText(input.note) ?? null,
        createdBy: actorUserId(actor),
      })
      .returning();
    if (!row) throw new Error('receipt insert returned no row');
    for (const line of input.lines ?? []) await this.insertLine(tx, row, line);
    await this.audit.record(tx, actor, {
      action: 'CREATE',
      entity: 'goods_receipts',
      entityId: row.id,
      after: row,
    });
    return row.id;
  }

  update(ctx: AuthContext, id: number, patch: ReceiptPatch): Promise<ReceiptDetail> {
    return inTransaction(this.db, async (tx) => {
      const header = await this.lockDraft(tx, ctx, id);
      if (patch.supplierId !== undefined && patch.supplierId !== header.supplierId) {
        await this.suppliers.assertActive(tx, patch.supplierId);
      }
      await tx
        .update(goodsReceipts)
        .set({
          ...(patch.supplierId === undefined ? {} : { supplierId: patch.supplierId }),
          ...(patch.supplierDocNo === undefined
            ? {}
            : { supplierDocNo: optionalText(patch.supplierDocNo) ?? null }),
          ...(patch.supplierDocDate === undefined
            ? {}
            : { supplierDocDate: patch.supplierDocDate }),
          ...(patch.note === undefined ? {} : { note: optionalText(patch.note) ?? null }),
          updatedAt: sql`now()`,
        })
        .where(eq(goodsReceipts.id, id));
      return this.get(id, tx);
    });
  }

  addLine(ctx: AuthContext, receiptId: number, line: ReceiptLineInput): Promise<ReceiptDetail> {
    return inTransaction(this.db, async (tx) => {
      const header = await this.lockDraft(tx, ctx, receiptId);
      await this.insertLine(tx, header, line);
      await this.touch(tx, receiptId);
      return this.get(receiptId, tx);
    });
  }

  updateLine(
    ctx: AuthContext,
    lineId: number,
    patch: { enteredQty?: Decimal; binId?: number },
  ): Promise<ReceiptDetail> {
    return inTransaction(this.db, async (tx) => {
      const { header, line } = await this.lockLine(tx, ctx, lineId);
      const enteredQty = patch.enteredQty ?? line.enteredQty;
      const converted = await this.units.toBase(line.productUnitId, enteredQty, tx);
      const binId = patch.binId ?? line.binId;
      if (patch.binId !== undefined) await this.assertBin(tx, header.warehouseId, binId);
      await tx
        .update(goodsReceiptLines)
        .set({
          enteredQty,
          factorSnapshot: converted.factorSnapshot,
          qtyBase: converted.qtyBase,
          binId,
          updatedAt: sql`now()`,
        })
        .where(eq(goodsReceiptLines.id, lineId));
      await this.touch(tx, header.id);
      return this.get(header.id, tx);
    });
  }

  removeLine(ctx: AuthContext, lineId: number): Promise<ReceiptDetail> {
    return inTransaction(this.db, async (tx) => {
      const { header } = await this.lockLine(tx, ctx, lineId);
      await tx.delete(goodsReceiptLines).where(eq(goodsReceiptLines.id, lineId));
      await this.touch(tx, header.id);
      return this.get(header.id, tx);
    });
  }

  /** DRAFT → POSTED: stock arrives in each line's bin at the provisional cost (ADR-0033). */
  post(ctx: AuthContext, id: number): Promise<ReceiptDetail> {
    return inTransaction(this.db, async (tx) => {
      const header = await this.lockHeader(tx, id);
      this.scope.assertCanWriteWarehouse(ctx, header.warehouseId);
      assertDraft(header);
      const lines = await this.linesOf(tx, id);
      if (lines.length === 0) throw invalid('lines', 'empty', 'a receipt needs at least one line');
      await this.suppliers.assertActive(tx, header.supplierId);
      for (const line of lines) {
        // A unit superseded since the line was entered refuses the posting (UNIT_SUPERSEDED).
        await this.units.toBase(line.productUnitId, line.enteredQty, tx);
      }
      await this.locations.assertMayReceive(
        tx,
        header.warehouseId,
        lines.map((line) => line.productId),
      );
      const result = await this.posting.post(tx, ctx, {
        docs: [{ docType: 'GR', docId: id, expectedStatus: 'DRAFT', nextStatus: 'POSTED' }],
        movements: lines.map((line) => ({
          docType: 'GR' as const,
          docId: id,
          docLineId: line.id,
          movementType: 'RECEIPT' as const,
          leg: 1,
          warehouseId: header.warehouseId,
          binId: line.binId,
          productId: line.productId,
          lotId: line.lotId,
          qtyBase: line.qtyBase,
          enteredQty: line.enteredQty,
          productUnitId: line.productUnitId,
          factorSnapshot: line.factorSnapshot,
        })),
      });
      await this.audit.record(tx, ctx, {
        action: 'POST',
        entity: 'goods_receipts',
        entityId: id,
        before: header,
        after: { number: result.numbers.get(id), lines },
      });
      return this.get(id, tx);
    });
  }

  cancel(ctx: AuthContext, id: number): Promise<ReceiptDetail> {
    return inTransaction(this.db, async (tx) => {
      const header = await this.lockDraft(tx, ctx, id);
      await tx
        .update(goodsReceipts)
        .set({ status: 'CANCELLED', updatedAt: sql`now()` })
        .where(eq(goodsReceipts.id, id));
      await this.audit.record(tx, ctx, {
        action: 'CANCEL',
        entity: 'goods_receipts',
        entityId: id,
        before: header,
      });
      return this.get(id, tx);
    });
  }

  /**
   * The accountant's costing (ADR-0033): every line at once, by amount or price per entered unit,
   * bonus lines at zero. `costingVersion` is the version the form was opened at.
   */
  cost(
    ctx: AuthContext,
    id: number,
    input: { costingVersion: number; lines: readonly CostLineInput[] },
  ): Promise<ReceiptCosting> {
    return inTransaction(this.db, async (tx) => {
      const header = await this.lockHeader(tx, id);
      this.scope.assertCanWriteWarehouse(ctx, header.warehouseId);
      if (header.status !== 'POSTED') {
        throw new AppError('DOC_STATE_INVALID', `receipt ${id} is ${header.status}`, {
          status: header.status,
        });
      }
      if (header.costingVersion !== input.costingVersion) {
        throw new AppError('CONFLICT', `receipt ${id} was costed meanwhile`, {
          costingVersion: header.costingVersion,
        });
      }
      if (header.costingVersion > 0 && header.effectiveDate) {
        const deadline = costingDeadline(header.effectiveDate);
        if (!canRecost(header.effectiveDate, businessDate())) {
          throw new AppError('COSTING_CLOSED', `receipt ${id} could be costed until ${deadline}`, {
            deadline,
          });
        }
      }
      const lines = await this.linesOf(tx, id);
      const given = new Map(input.lines.map((line) => [line.lineId, line]));
      if (
        given.size !== input.lines.length ||
        lines.some((line) => !given.has(line.id)) ||
        given.size !== lines.length
      ) {
        throw invalid('lines', 'complete', 'cost every line of the receipt once');
      }
      const version = header.costingVersion + 1;
      await this.posting.revalue(tx, ctx, {
        docId: id,
        version,
        lines: lines.map((line) => {
          const cost = given.get(line.id);
          if (!cost) throw new Error(`line ${line.id} not costed`);
          return {
            docLineId: line.id,
            warehouseId: header.warehouseId,
            productId: line.productId,
            lotId: line.lotId,
            qtyBase: line.qtyBase,
            amount: lineAmount(cost, line.enteredQty),
            freeGoods: cost.freeGoods ?? false,
          };
        }),
      });
      await tx
        .update(goodsReceipts)
        .set({
          costingStatus: 'COSTED',
          costingVersion: version,
          costedAt: sql`now()`,
          costedBy: actorUserId(ctx),
          updatedAt: sql`now()`,
        })
        .where(eq(goodsReceipts.id, id));
      await this.audit.record(tx, ctx, {
        action: 'COST',
        entity: 'goods_receipts',
        entityId: id,
        after: {
          version,
          lines: lines.map((line) => {
            const cost = given.get(line.id);
            return { lineId: line.id, amount: cost ? lineAmount(cost, line.enteredQty) : null };
          }),
        },
      });
      return this.costing(id, tx);
    });
  }

  async costing(id: number, executor: Db | Tx = this.db): Promise<ReceiptCosting> {
    const [header] = await executor.select().from(goodsReceipts).where(eq(goodsReceipts.id, id));
    if (!header) throw notFound('goods receipt', id);
    const lines = await this.describeLines(executor, await this.linesOf(executor, id));
    const provisional = await this.posting.receiptCosts(id, executor);
    const latest = await this.posting.costingOf(id, executor);
    const costed = lines.map((line) => {
      const valuation = latest.get(line.id);
      return {
        lineId: line.id,
        productId: line.productId,
        productName: line.productName,
        unitName: line.unitName,
        enteredQty: line.enteredQty,
        qtyBase: line.qtyBase,
        provisionalUnitCost: provisional.get(line.id) ?? new Decimal(0),
        amount: valuation?.amount ?? null,
        unitCost: valuation ? unitCostOf(valuation.amount, line.qtyBase) : null,
        freeGoods: valuation?.freeGoods ?? false,
      };
    });
    const total =
      header.costingVersion > 0
        ? costed.reduce((sum, line) => sum.plus(line.amount ?? 0), new Decimal(0))
        : null;
    return {
      receiptId: id,
      number: header.number,
      status: header.status,
      costingStatus: header.costingStatus,
      costingVersion: header.costingVersion,
      recostUntil: header.effectiveDate ? costingDeadline(header.effectiveDate) : null,
      costedAt: header.costedAt,
      total,
      lines: costed,
    };
  }

  async get(id: number, executor: Db | Tx = this.db): Promise<ReceiptDetail> {
    const [header] = await executor.select().from(goodsReceipts).where(eq(goodsReceipts.id, id));
    if (!header) throw notFound('goods receipt', id);
    const [supplier] = await this.suppliers.getMany([header.supplierId], executor);
    const warehouse = await this.org.getWarehouse(header.warehouseId, executor);
    const lines = await this.describeLines(executor, await this.linesOf(executor, id));
    return {
      id: header.id,
      number: header.number,
      warehouseId: header.warehouseId,
      warehouseName: warehouse.name,
      supplierId: header.supplierId,
      supplierCode: supplier?.code ?? '',
      supplierName: supplier?.name ?? '',
      supplierDocNo: header.supplierDocNo,
      supplierDocDate: header.supplierDocDate,
      status: header.status,
      costingStatus: header.costingStatus,
      note: header.note,
      effectiveDate: header.effectiveDate,
      postedAt: header.postedAt,
      createdAt: header.createdAt,
      updatedAt: header.updatedAt,
      lines,
    };
  }

  async list(query: ReceiptQuery): Promise<{ data: ReceiptSummary[]; nextCursor: string | null }> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const filters: SQL[] = [];
    if (query.warehouseId) filters.push(eq(goodsReceipts.warehouseId, query.warehouseId));
    if (query.status) filters.push(eq(goodsReceipts.status, query.status));
    if (query.costingPending) {
      filters.push(
        sql`${goodsReceipts.status} = 'POSTED' AND ${goodsReceipts.costingStatus} = 'PENDING'`,
      );
    }
    if (query.supplierId) filters.push(eq(goodsReceipts.supplierId, query.supplierId));
    const q = query.q?.trim();
    if (q) {
      const pattern = `%${escapeLike(q)}%`;
      const match = or(
        ilike(goodsReceipts.number, pattern),
        ilike(goodsReceipts.supplierDocNo, pattern),
      );
      if (match) filters.push(match);
    }
    const after = decodeCursor(query.cursor);
    if (typeof after?.id === 'number') filters.push(lt(goodsReceipts.id, after.id));
    const rows = await this.db
      .select({
        id: goodsReceipts.id,
        number: goodsReceipts.number,
        warehouseId: goodsReceipts.warehouseId,
        supplierId: goodsReceipts.supplierId,
        supplierDocNo: goodsReceipts.supplierDocNo,
        status: goodsReceipts.status,
        costingStatus: goodsReceipts.costingStatus,
        effectiveDate: goodsReceipts.effectiveDate,
        createdAt: goodsReceipts.createdAt,
        // Spelled out: Drizzle leaves columns of a single-table select unqualified, and a bare "id"
        // inside the subquery would mean the line’s own id.
        lineCount: sql<string>`(SELECT count(*) FROM goods_receipt_lines l WHERE l.receipt_id = goods_receipts.id)`,
      })
      .from(goodsReceipts)
      .where(and(...filters))
      .orderBy(desc(goodsReceipts.id))
      .limit(limit + 1);
    const page = toPage(rows, limit, (row) => ({ id: row.id }));
    const suppliers = new Map(
      (await this.suppliers.getMany([...new Set(page.data.map((row) => row.supplierId))])).map(
        (supplier) => [supplier.id, supplier],
      ),
    );
    return {
      data: page.data.map((row) => ({
        ...row,
        lineCount: Number.parseInt(row.lineCount, 10),
        supplierName: suppliers.get(row.supplierId)?.name ?? '',
      })),
      nextCursor: page.nextCursor,
    };
  }

  // -------------------------------------------------------------------------------------------

  private async insertLine(tx: Tx, header: ReceiptRow, line: ReceiptLineInput): Promise<void> {
    const converted = await this.units.toBase(line.productUnitId, line.enteredQty, tx);
    await this.locations.assertMayReceive(tx, header.warehouseId, [converted.productId]);
    const binId =
      line.binId ??
      (await this.locations.defaultBinOf(header.warehouseId, [converted.productId], tx)).get(
        converted.productId,
      ) ??
      (await this.bins.systemBin(header.warehouseId, 'RECEIVING', tx)).id;
    await this.assertBin(tx, header.warehouseId, binId);
    await tx.insert(goodsReceiptLines).values({
      receiptId: header.id,
      productId: converted.productId,
      productUnitId: converted.unitId,
      enteredQty: line.enteredQty,
      factorSnapshot: converted.factorSnapshot,
      qtyBase: converted.qtyBase,
      binId,
    });
  }

  private async assertBin(tx: Tx, warehouseId: number, binId: number): Promise<void> {
    const bin = await this.bins.get(binId, tx).catch(() => undefined);
    if (!bin || bin.warehouseId !== warehouseId) {
      throw invalid('binId', 'warehouse', 'a bin of the receipt’s warehouse');
    }
    if (!RECEIPT_BIN_TYPES.includes(bin.type)) {
      throw invalid('binId', 'type', 'the receiving area or a shelf');
    }
    if (bin.archivedAt)
      throw new AppError('BIN_ARCHIVED', `bin ${bin.code} is archived`, { code: bin.code });
  }

  private async linesOf(executor: Db | Tx, receiptId: number): Promise<LineRow[]> {
    return executor
      .select()
      .from(goodsReceiptLines)
      .where(eq(goodsReceiptLines.receiptId, receiptId))
      .orderBy(goodsReceiptLines.id);
  }

  private async describeLines(
    executor: Db | Tx,
    lines: readonly LineRow[],
  ): Promise<ReceiptLine[]> {
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
      lotId: line.lotId,
    }));
  }

  private async lockHeader(tx: Tx, id: number): Promise<ReceiptRow> {
    const [row] = await tx
      .select()
      .from(goodsReceipts)
      .where(eq(goodsReceipts.id, id))
      .for('update');
    if (!row) throw notFound('goods receipt', id);
    return row;
  }

  private async lockDraft(tx: Tx, ctx: AuthContext, id: number): Promise<ReceiptRow> {
    const header = await this.lockHeader(tx, id);
    this.scope.assertCanWriteWarehouse(ctx, header.warehouseId);
    assertDraft(header);
    return header;
  }

  /** The line's receipt header is locked before the line is read again (ADR-0034 #1). */
  private async lockLine(
    tx: Tx,
    ctx: AuthContext,
    lineId: number,
  ): Promise<{ header: ReceiptRow; line: LineRow }> {
    const [peek] = await tx
      .select({ receiptId: goodsReceiptLines.receiptId })
      .from(goodsReceiptLines)
      .where(eq(goodsReceiptLines.id, lineId));
    if (!peek) throw notFound('receipt line', lineId);
    const header = await this.lockDraft(tx, ctx, peek.receiptId);
    const [line] = await tx
      .select()
      .from(goodsReceiptLines)
      .where(eq(goodsReceiptLines.id, lineId));
    if (!line) throw notFound('receipt line', lineId);
    return { header, line };
  }

  private async touch(tx: Tx, id: number): Promise<void> {
    await tx
      .update(goodsReceipts)
      .set({ updatedAt: sql`now()` })
      .where(eq(goodsReceipts.id, id));
  }
}

function assertDraft(header: ReceiptRow): void {
  if (header.status === 'POSTED') {
    throw new AppError('DOC_ALREADY_POSTED', `receipt ${header.id} is posted`, {
      status: header.status,
    });
  }
  if (header.status !== 'DRAFT') {
    throw new AppError('DOC_STATE_INVALID', `receipt ${header.id} is ${header.status}`, {
      status: header.status,
    });
  }
}

/** A costed line's amount: bonus lines are free, a unit price is multiplied by the entered quantity. */
function lineAmount(cost: CostLineInput, enteredQty: Decimal): Decimal {
  if (cost.freeGoods) return new Decimal(0);
  if (cost.amount) return cost.amount;
  if (cost.unitPrice) return lineAmountOf(cost.unitPrice, enteredQty);
  throw invalid('lines', 'amount', 'an amount or a unit price for every line that is not a bonus');
}
