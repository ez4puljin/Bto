import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
  DAMAGE_CHARGE_TYPE,
  type IssueRecipientKind,
  type IssueStatus,
  MAX_ISSUE_LINES,
  SELLABLE_BIN_TYPES,
} from '@tugeel/shared/inventory';
import { Decimal, toMoney, toWholeMnt } from '@tugeel/shared/money';
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
import {
  type DamageChargeFacts,
  SALE_PRICE_READER,
  type SalePriceReader,
  STOCK_BOOKS,
  type StockBookParty,
  type StockBooks,
  type SupplierReturnFacts,
} from '../hooks';
import { bins, binStock, goodsIssueConfirmations, goodsIssueLines, goodsIssues } from '../schema';
import { BinsService } from './bins.service';
import { IssueExpenseTypesService } from './issue-expense-types.service';
import { ProductLocationsService } from './product-locations.service';
import { PurchaseBooksService } from './purchase-books.service';
import { type Movement, StockPostingService } from './stock-posting.service';
import { optionalText } from './support';

type IssueRow = typeof goodsIssues.$inferSelect;
type LineRow = typeof goodsIssueLines.$inferSelect;
type ConfirmationRow = typeof goodsIssueConfirmations.$inferSelect;
export type { IssueStatus };

/** Goods leave the stock from these warehouse kinds (owner 2026-10-18: every warehouse). */
const ISSUE_WAREHOUSE_KINDS = ['WHOLESALE', 'STORE'];
/** Bins goods may leave from: the receiving area, shelves and the sales floor. */
const ISSUE_BIN_TYPES = ['RECEIVING', 'STORAGE', 'PICKING', 'SALESFLOOR', 'RETURNS', 'DAMAGED'];
/** The statuses the accountant may still edit (unconfirmed warehouses only). */
const EDITABLE: readonly IssueStatus[] = ['DRAFT', 'SENT', 'RETURNED'];

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
  /** Omitted: the product's home warehouse, else the issue's default warehouse (ADR-0117 #1). */
  warehouseId?: number | null;
  /** Omitted: picked at the confirmation (the fixed shelf while it holds the product, else the fullest). */
  binId?: number | null;
}

export interface IssueInput {
  /** The default warehouse of lines whose product has no home. */
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
  warehouseId?: number;
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
  warehouseId: number;
  warehouseName: string;
  binId: number | null;
  binCode: string | null;
  checkedAt: Date | null;
  /** The sale price per base unit of a «Хүнд тооцох» line, frozen at the send (whole MNT). */
  saleUnitPrice: Decimal | null;
  saleAmount: Decimal | null;
  /** Cost data: the average it left at (null until its warehouse's part posted). */
  unitCost: Decimal | null;
  amount: Decimal | null;
}

export interface IssueConfirmation {
  warehouseId: number;
  warehouseName: string;
  confirmedBy: string | null;
  confirmedAt: Date;
  /** A correction's warehouse whose lines equal the parent's: nothing left, nothing to confirm. */
  unchanged: boolean;
}

export interface IssueWarehouse {
  warehouseId: number;
  warehouseName: string;
  lineCount: number;
  checkedCount: number;
  confirmed: boolean;
}

export interface IssueDetail {
  id: number;
  number: string | null;
  warehouseId: number;
  warehouseName: string;
  issuedOn: string;
  expenseTypeId: number;
  expenseTypeName: string;
  expenseTypeCode: string | null;
  recipientKind: IssueRecipientKind;
  recipientUserId: number | null;
  recipientCustomerId: number | null;
  recipientSupplierId: number | null;
  recipientName: string | null;
  status: IssueStatus;
  note: string | null;
  sentAt: Date | null;
  returnNote: string | null;
  returnedAt: Date | null;
  returnedBy: string | null;
  /** The posted issue this one corrects (ADR-0117 #5). */
  correctsIssueId: number | null;
  correctsIssueNumber: string | null;
  /** The open or posted correction of this issue, if any. */
  correctedByIssueId: number | null;
  correctedByIssueNumber: string | null;
  effectiveDate: string | null;
  postedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  lines: IssueLine[];
  warehouses: IssueWarehouse[];
  confirmations: IssueConfirmation[];
  /** Σ sale amounts of a «Хүнд тооцох» issue once sent. */
  saleTotal: Decimal | null;
  /** Cost data: Σ line amounts of the posted parts. */
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
  /** The line warehouses, in id order. */
  warehouseIds: number[];
  /** The warehouses whose part posted (or is marked unchanged). */
  confirmedWarehouseIds: number[];
  correctsIssueId: number | null;
  effectiveDate: string | null;
  createdAt: Date;
}

export interface IssueQuery {
  /** A header's default warehouse or a line's warehouse. */
  warehouseId?: number;
  status?: IssueStatus;
  expenseTypeId?: number;
  /** Number or recipient name. */
  q?: string;
  /** Only issues with a line in one of these warehouses still waiting for a confirmation. */
  pendingIn?: readonly number[] | null;
  cursor?: string;
  limit?: number;
}

/**
 * Goods issues (GI-, ADR-0081, ADR-0117): goods leave for an expense type and a party at the
 * warehouse's average cost. The accountant builds the document (lines from any warehouse: the
 * product's home, else the default) and **sends** it; each warehouse's keeper ticks their lines and
 * **confirms**, and that part leaves at once under the one document number; a keeper may send the
 * document back with a note; it is POSTED once every warehouse confirmed. «Хүнд тооцох» lines are
 * priced at the sale price at the send and each confirmed part becomes a receivable on the party.
 * A posted issue is corrected by a child document whose confirmation reverses the parent's part and
 * posts the new content in one transaction. Every action locks the header first (ADR-0034).
 */
@Injectable()
export class GoodsIssuesService implements OnModuleInit {
  private salePrices: SalePriceReader | null = null;
  private books: StockBooks | null = null;

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
    private readonly purchases: PurchaseBooksService,
    private readonly moduleRef: ModuleRef,
  ) {}

  onModuleInit(): void {
    try {
      this.salePrices = this.moduleRef.get<SalePriceReader>(SALE_PRICE_READER, { strict: false });
    } catch {
      this.salePrices = null;
    }
    try {
      this.books = this.moduleRef.get<StockBooks>(STOCK_BOOKS, { strict: false });
    } catch {
      this.books = null;
    }
  }

  // ----------------------------------------------------------------- the accountant's document

  async create(ctx: AuthContext, input: IssueInput): Promise<IssueDetail> {
    return inTransaction(this.db, async (tx) => {
      const id = await this.createInTx(tx, ctx, input);
      return this.get(id, tx);
    });
  }

  async createInTx(tx: Tx, actor: Actor, input: IssueInput): Promise<number> {
    await this.assertIssueWarehouse(tx, input.warehouseId);
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
      const header = await this.lockEditable(tx, id);
      if (patch.expenseTypeId !== undefined && patch.expenseTypeId !== header.expenseTypeId) {
        await this.expenseTypes.assertActive(tx, patch.expenseTypeId);
      }
      if (patch.warehouseId !== undefined && patch.warehouseId !== header.warehouseId) {
        await this.assertIssueWarehouse(tx, patch.warehouseId);
      }
      // The type and the party of a document with a posted part are fixed (the books carry them).
      if (
        (patch.expenseTypeId !== undefined && patch.expenseTypeId !== header.expenseTypeId) ||
        patch.recipient !== undefined
      ) {
        const posted = (await this.confirmationsOf(tx, id)).filter((row) => !row.unchanged);
        if (posted.length > 0) {
          throw new AppError('ISSUE_WAREHOUSE_CONFIRMED', `issue ${id} has posted parts`, {
            issueId: id,
            warehouseId: posted[0]?.warehouseId ?? null,
          });
        }
      }
      const recipient = patch.recipient ? await this.recipientOf(tx, patch.recipient) : {};
      await tx
        .update(goodsIssues)
        .set({
          ...(patch.issuedOn === undefined ? {} : { issuedOn: patch.issuedOn }),
          ...(patch.expenseTypeId === undefined ? {} : { expenseTypeId: patch.expenseTypeId }),
          ...(patch.warehouseId === undefined ? {} : { warehouseId: patch.warehouseId }),
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
      const header = await this.lockEditable(tx, issueId);
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

  /** The accountant's edit of a line: the quantity (clears the keeper's tick) or the warehouse. */
  updateLine(
    ctx: AuthContext,
    lineId: number,
    patch: { enteredQty?: Decimal; warehouseId?: number },
  ): Promise<IssueDetail> {
    return inTransaction(this.db, async (tx) => {
      const { header, line } = await this.lockEditableLine(tx, lineId);
      const enteredQty = patch.enteredQty ?? line.enteredQty;
      const converted = await this.units.toBase(line.productUnitId, enteredQty, tx);
      const warehouseId = patch.warehouseId ?? line.warehouseId;
      if (warehouseId !== line.warehouseId) {
        await this.assertIssueWarehouse(tx, warehouseId);
        await this.assertNotConfirmed(tx, header.id, warehouseId);
      }
      const changed = !enteredQty.eq(line.enteredQty) || warehouseId !== line.warehouseId;
      await tx
        .update(goodsIssueLines)
        .set({
          enteredQty,
          factorSnapshot: converted.factorSnapshot,
          qtyBase: converted.qtyBase,
          warehouseId,
          // A moved line leaves its shelf behind; a changed quantity needs the keeper's tick again.
          ...(warehouseId !== line.warehouseId ? { binId: null } : {}),
          ...(changed ? { checkedAt: null } : {}),
          ...(changed && line.saleUnitPrice
            ? { saleAmount: toWholeMnt(line.saleUnitPrice.times(converted.qtyBase)) }
            : {}),
          updatedAt: sql`now()`,
        })
        .where(eq(goodsIssueLines.id, lineId));
      await this.touch(tx, header.id);
      return this.get(header.id, tx);
    });
  }

  removeLine(ctx: AuthContext, lineId: number): Promise<IssueDetail> {
    return inTransaction(this.db, async (tx) => {
      const { header } = await this.lockEditableLine(tx, lineId);
      await tx.delete(goodsIssueLines).where(eq(goodsIssueLines.id, lineId));
      await this.touch(tx, header.id);
      // A sent document whose remaining warehouses all posted is complete (ADR-0117 #1).
      if (header.status === 'SENT') await this.completeIfPosted(tx, ctx, header.id);
      return this.get(header.id, tx);
    });
  }

  /**
   * DRAFT / RETURNED → SENT (ADR-0117 #1): at least one line, an active type, a party of the kind
   * the type allows; «Хүнд тооцох» lines take their sale price now (PRICE_MISSING names a product
   * without one). A correction marks the warehouses whose lines equal the parent's as unchanged.
   */
  send(ctx: AuthContext, id: number): Promise<IssueDetail> {
    return inTransaction(this.db, async (tx) => {
      const header = await this.lockHeader(tx, id);
      if (header.status !== 'DRAFT' && header.status !== 'RETURNED') {
        throw stateError(header);
      }
      const lines = await this.linesOf(tx, id);
      if (lines.length === 0) throw invalid('lines', 'empty', 'an issue needs at least one line');
      const type = await this.expenseTypes.assertActive(tx, header.expenseTypeId);
      if (type.code === DAMAGE_CHARGE_TYPE) {
        if (header.recipientKind !== 'USER' && header.recipientKind !== 'CUSTOMER') {
          throw new AppError('ISSUE_RECIPIENT_KIND', 'damage is charged to a user or a customer', {
            recipientKind: header.recipientKind,
          });
        }
        await this.priceLines(tx, lines);
      }
      for (const line of lines) {
        // A unit superseded since the line was entered refuses the send (UNIT_SUPERSEDED).
        await this.units.toBase(line.productUnitId, line.enteredQty, tx);
      }
      await tx
        .update(goodsIssues)
        .set({
          status: 'SENT',
          sentAt: sql`now()`,
          sentBy: actorUserId(ctx),
          returnNote: null,
          returnedAt: null,
          returnedBy: null,
          updatedAt: sql`now()`,
        })
        .where(eq(goodsIssues.id, id));
      if (header.correctsIssueId !== null) {
        const unchanged = await this.markUnchanged(tx, header.id, header.correctsIssueId, lines);
        const parentLines = await this.linesOf(tx, header.correctsIssueId);
        if (unchanged.length === warehousesOf(lines, parentLines).length) {
          throw invalid('lines', 'unchanged', 'a correction must change something');
        }
      }
      await this.audit.record(tx, ctx, {
        action: 'SUBMIT',
        entity: 'goods_issues',
        entityId: id,
        before: { status: header.status },
        after: { status: 'SENT', lines: lines.length },
      });
      await this.completeIfPosted(tx, ctx, id);
      return this.get(id, tx);
    });
  }

  cancel(ctx: AuthContext, id: number): Promise<IssueDetail> {
    return inTransaction(this.db, async (tx) => {
      const header = await this.lockEditable(tx, id);
      await this.cancelLocked(tx, ctx, header);
      return this.get(id, tx);
    });
  }

  /**
   * A correction of a posted issue (ADR-0117 #5): a child DRAFT with the parent's header and a copy
   * of its lines; the accountant changes quantities or removes lines and sends it. One open
   * correction per issue.
   */
  createCorrection(ctx: AuthContext, parentId: number): Promise<IssueDetail> {
    return inTransaction(this.db, async (tx) => {
      const parent = await this.lockHeader(tx, parentId);
      if (parent.status !== 'POSTED') throw stateError(parent);
      // One correction per issue: a corrected issue is corrected again through its correction.
      const open = await this.correctionOf(tx, parentId, true);
      if (open) {
        throw new AppError('ISSUE_CORRECTION_OPEN', `issue ${parentId} is being corrected`, {
          issueId: open.id,
          number: open.number ?? `#${open.id}`,
        });
      }
      const [child] = await tx
        .insert(goodsIssues)
        .values({
          warehouseId: parent.warehouseId,
          issuedOn: businessDate(),
          expenseTypeId: parent.expenseTypeId,
          recipientKind: parent.recipientKind,
          recipientUserId: parent.recipientUserId,
          recipientCustomerId: parent.recipientCustomerId,
          recipientSupplierId: parent.recipientSupplierId,
          recipientName: parent.recipientName,
          note: parent.note,
          correctsIssueId: parent.id,
          createdBy: actorUserId(ctx),
        })
        .returning();
      if (!child) throw new Error('issue insert returned no row');
      const lines = await this.linesOf(tx, parentId);
      if (lines.length > 0) {
        await tx.insert(goodsIssueLines).values(
          lines.map((line) => ({
            issueId: child.id,
            warehouseId: line.warehouseId,
            productId: line.productId,
            productUnitId: line.productUnitId,
            enteredQty: line.enteredQty,
            factorSnapshot: line.factorSnapshot,
            qtyBase: line.qtyBase,
            lotId: line.lotId,
            binId: line.binId,
          })),
        );
      }
      await this.audit.record(tx, ctx, {
        action: 'CREATE',
        entity: 'goods_issues',
        entityId: child.id,
        after: { ...child, correctsNumber: parent.number },
      });
      return this.get(child.id, tx);
    });
  }

  // --------------------------------------------------------------------- the keeper's side

  /** The keeper ticks a line of their warehouse on a sent issue (ADR-0117 #1). */
  checkLine(ctx: AuthContext, lineId: number, checked: boolean): Promise<IssueDetail> {
    return inTransaction(this.db, async (tx) => {
      const { header, line } = await this.lockKeeperLine(tx, ctx, lineId);
      await tx
        .update(goodsIssueLines)
        .set({ checkedAt: checked ? sql`now()` : null, updatedAt: sql`now()` })
        .where(eq(goodsIssueLines.id, lineId));
      await this.touch(tx, header.id);
      return this.get(line.issueId, tx);
    });
  }

  /** The keeper names the shelf a line leaves from (a scanned label), before confirming. */
  setLineBin(ctx: AuthContext, lineId: number, binId: number): Promise<IssueDetail> {
    return inTransaction(this.db, async (tx) => {
      const { header, line } = await this.lockKeeperLine(tx, ctx, lineId);
      await this.assertBin(tx, line.warehouseId, binId);
      await tx
        .update(goodsIssueLines)
        .set({ binId, updatedAt: sql`now()` })
        .where(eq(goodsIssueLines.id, lineId));
      await this.touch(tx, header.id);
      return this.get(header.id, tx);
    });
  }

  /**
   * The keeper's confirmation (ADR-0117 #1–#2): every warehouse of the issue in the caller's write
   * scope that has no confirmation yet, each line ticked, posts at once — the goods leave at the
   * average cost under the one document number, the books get the part (its party, a «Хүнд тооцох»
   * receivable, a supplier's credit); a correction first brings the parent's part back. POSTED once
   * every warehouse has its row.
   */
  confirm(ctx: AuthContext, id: number): Promise<IssueDetail> {
    return inTransaction(this.db, async (tx) => {
      const header = await this.lockHeader(tx, id);
      if (header.status !== 'SENT') {
        throw new AppError('ISSUE_NOT_SENT', `issue ${id} is ${header.status}`, {
          status: header.status,
        });
      }
      const lines = await this.linesOf(tx, id);
      const parentLines =
        header.correctsIssueId === null ? [] : await this.linesOf(tx, header.correctsIssueId);
      const warehouseIds = warehousesOf(lines, parentLines);
      const mine = warehouseIds.filter((warehouseId) =>
        this.scope.canWriteWarehouse(ctx, warehouseId),
      );
      if (mine.length === 0) {
        throw new AppError('FORBIDDEN', `issue ${id} has no lines in the caller's warehouses`, {
          reason: 'WAREHOUSE_SCOPE',
        });
      }
      const confirmed = new Set((await this.confirmationsOf(tx, id)).map((row) => row.warehouseId));
      const fresh = mine.filter((warehouseId) => !confirmed.has(warehouseId));
      for (const warehouseId of fresh) {
        const unchecked = lines.filter(
          (line) => line.warehouseId === warehouseId && line.checkedAt === null,
        ).length;
        if (unchecked > 0) {
          throw new AppError('ISSUE_LINES_UNCHECKED', `issue ${id} has unchecked lines`, {
            warehouseId,
            count: unchecked,
          });
        }
      }
      const type = await this.expenseTypes.assertActive(tx, header.expenseTypeId);
      for (const warehouseId of fresh) {
        await this.postPart(
          tx,
          ctx,
          header,
          type.code,
          warehouseId,
          lines.filter((line) => line.warehouseId === warehouseId),
          parentLines.filter((line) => line.warehouseId === warehouseId),
        );
      }
      if (fresh.length > 0) {
        await this.audit.record(tx, ctx, {
          action: 'CONFIRM',
          entity: 'goods_issues',
          entityId: id,
          after: { warehouseIds: fresh },
        });
      }
      await this.completeIfPosted(tx, ctx, id);
      return this.get(id, tx);
    });
  }

  /** The keeper sends a sent issue back to the accountant with a note (ADR-0117 #1). */
  return(ctx: AuthContext, id: number, note: string): Promise<IssueDetail> {
    return inTransaction(this.db, async (tx) => {
      const header = await this.lockHeader(tx, id);
      if (header.status !== 'SENT') {
        throw new AppError('ISSUE_NOT_SENT', `issue ${id} is ${header.status}`, {
          status: header.status,
        });
      }
      const text = optionalText(note);
      if (!text) throw invalid('note', 'required', 'why the issue is sent back');
      if (text.length > 500) throw invalid('note', 'length', 'at most 500 characters');
      const lines = await this.linesOf(tx, id);
      const confirmed = new Set((await this.confirmationsOf(tx, id)).map((row) => row.warehouseId));
      const pending = warehousesOf(lines, []).filter((warehouseId) => !confirmed.has(warehouseId));
      if (!pending.some((warehouseId) => this.scope.canWriteWarehouse(ctx, warehouseId))) {
        throw new AppError(
          'FORBIDDEN',
          `issue ${id} has no pending lines in the caller's warehouses`,
          {
            reason: 'WAREHOUSE_SCOPE',
          },
        );
      }
      await tx
        .update(goodsIssues)
        .set({
          status: 'RETURNED',
          returnNote: text,
          returnedAt: sql`now()`,
          returnedBy: actorUserId(ctx),
          updatedAt: sql`now()`,
        })
        .where(eq(goodsIssues.id, id));
      await this.audit.record(tx, ctx, {
        action: 'RETURN',
        entity: 'goods_issues',
        entityId: id,
        after: { note: text },
      });
      return this.get(id, tx);
    });
  }

  // ------------------------------------------------------------------------ the books' reads

  /** The posted supplier-return parts, oldest first (the development re-post of their credits, F3). */
  async postedSupplierReturnParts(): Promise<{ issueId: number; warehouseId: number | null }[]> {
    const rows = await this.db
      .select({
        id: goodsIssues.id,
        warehouseId: goodsIssueConfirmations.warehouseId,
        unchanged: goodsIssueConfirmations.unchanged,
      })
      .from(goodsIssues)
      .leftJoin(goodsIssueConfirmations, eq(goodsIssueConfirmations.issueId, goodsIssues.id))
      .where(and(eq(goodsIssues.status, 'POSTED'), eq(goodsIssues.recipientKind, 'SUPPLIER')))
      .orderBy(goodsIssues.id, goodsIssueConfirmations.warehouseId);
    return rows
      .filter((row) => row.unchanged !== true)
      .map((row) => ({ issueId: row.id, warehouseId: row.warehouseId }));
  }

  /**
   * A posted supplier-return part as the books see it (F3, ADR-0091): each line at the cost it
   * left at (two decimals), plus the VAT the supplier's prices carry on the issue's date (the
   * receipt's rule, ADR-0078 #1). `warehouseId` null: an issue posted in one step before ADR-0117.
   */
  async supplierReturnFacts(
    id: number,
    warehouseId: number | null,
    executor: Db | Tx = this.db,
  ): Promise<SupplierReturnFacts> {
    const [header] = await executor.select().from(goodsIssues).where(eq(goodsIssues.id, id));
    if (!header) throw notFound('goods issue', id);
    if (
      header.recipientKind !== 'SUPPLIER' ||
      header.recipientSupplierId === null ||
      header.number === null
    ) {
      throw new Error(`goods issue ${id} is not a numbered supplier return`);
    }
    const lines = (await this.linesOf(executor, id)).filter(
      (line) =>
        line.unitCost !== null && (warehouseId === null || line.warehouseId === warehouseId),
    );
    const date = header.effectiveDate ?? header.issuedOn;
    const rate = await this.purchases.supplierRate(executor, header.recipientSupplierId, date);
    const rates = await this.purchases.lineRates(executor, lines, rate);
    let cost = new Decimal(0);
    let vat = new Decimal(0);
    let vatBase = new Decimal(0);
    for (const line of lines) {
      const amount = toMoney((line.unitCost ?? new Decimal(0)).times(line.qtyBase));
      const lineRate = rates.get(line.id) ?? new Decimal(0);
      cost = cost.plus(amount);
      if (lineRate.isZero()) continue;
      vat = vat.plus(toMoney(amount.times(lineRate).dividedBy(100)));
      vatBase = vatBase.plus(amount);
    }
    const warehouse =
      warehouseId === null ? null : await this.org.getWarehouse(warehouseId, executor);
    return {
      issueId: id,
      docId: warehouseId === null ? String(id) : partDocId(id, warehouseId),
      docNo: warehouse === null ? header.number : `${header.number}/${warehouse.code}`,
      supplierId: header.recipientSupplierId,
      date,
      cost,
      vat,
      vatBase,
      warehouseIds: [warehouseId ?? header.warehouseId],
    };
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

  // ------------------------------------------------------------------------------- reads

  async get(id: number, executor: Db | Tx = this.db): Promise<IssueDetail> {
    const [header] = await executor.select().from(goodsIssues).where(eq(goodsIssues.id, id));
    if (!header) throw notFound('goods issue', id);
    const warehouse = await this.org.getWarehouse(header.warehouseId, executor);
    const expenseType = await this.expenseTypes.get(header.expenseTypeId, executor);
    const rawLines = await this.linesOf(executor, id);
    const confirmationRows = await this.confirmationsOf(executor, id);
    const parentLines =
      header.correctsIssueId === null ? [] : await this.linesOf(executor, header.correctsIssueId);
    const warehouseIds = [
      ...new Set([
        ...warehousesOf(rawLines, parentLines),
        ...confirmationRows.map((row) => row.warehouseId),
      ]),
    ].sort((a, b) => a - b);
    const names = await this.warehouseNames(executor, warehouseIds);
    const lines = await this.describeLines(executor, rawLines, names);
    const confirmedSet = new Set(confirmationRows.map((row) => row.warehouseId));
    const userNames = await this.users.summariesOf(
      confirmationRows.flatMap((row) => (row.confirmedBy === null ? [] : [row.confirmedBy])),
    );
    const returnedBy =
      header.returnedBy === null
        ? null
        : ((await this.users.summariesOf([header.returnedBy])).get(header.returnedBy)?.fullName ??
          null);
    const parent =
      header.correctsIssueId === null
        ? null
        : await this.numberOf(executor, header.correctsIssueId);
    const child = await this.correctionOf(executor, id, true);
    const posted = lines.filter((line) => line.unitCost !== null);
    return {
      id: header.id,
      number: header.number,
      warehouseId: header.warehouseId,
      warehouseName: warehouse.name,
      issuedOn: header.issuedOn,
      expenseTypeId: header.expenseTypeId,
      expenseTypeName: expenseType.name,
      expenseTypeCode: expenseType.code,
      recipientKind: header.recipientKind,
      recipientUserId: header.recipientUserId,
      recipientCustomerId: header.recipientCustomerId,
      recipientSupplierId: header.recipientSupplierId,
      recipientName: header.recipientName,
      status: header.status,
      note: header.note,
      sentAt: header.sentAt,
      returnNote: header.returnNote,
      returnedAt: header.returnedAt,
      returnedBy,
      correctsIssueId: header.correctsIssueId,
      correctsIssueNumber: parent,
      correctedByIssueId: child?.id ?? null,
      correctedByIssueNumber: child ? (child.number ?? `#${child.id}`) : null,
      effectiveDate: header.effectiveDate,
      postedAt: header.postedAt,
      createdAt: header.createdAt,
      updatedAt: header.updatedAt,
      lines,
      warehouses: warehouseIds.map((warehouseId) => ({
        warehouseId,
        warehouseName: names.get(warehouseId) ?? '',
        lineCount: rawLines.filter((line) => line.warehouseId === warehouseId).length,
        checkedCount: rawLines.filter(
          (line) => line.warehouseId === warehouseId && line.checkedAt !== null,
        ).length,
        confirmed: confirmedSet.has(warehouseId),
      })),
      confirmations: confirmationRows.map((row) => ({
        warehouseId: row.warehouseId,
        warehouseName: names.get(row.warehouseId) ?? '',
        confirmedBy:
          row.confirmedBy === null ? null : (userNames.get(row.confirmedBy)?.fullName ?? null),
        confirmedAt: row.confirmedAt,
        unchanged: row.unchanged,
      })),
      saleTotal: lines.some((line) => line.saleAmount !== null)
        ? lines.reduce((sum, line) => sum.plus(line.saleAmount ?? 0), new Decimal(0))
        : null,
      total:
        posted.length > 0
          ? posted.reduce((sum, line) => sum.plus(line.amount ?? 0), new Decimal(0))
          : null,
    };
  }

  async list(query: IssueQuery): Promise<{ data: IssueSummary[]; nextCursor: string | null }> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const filters: SQL[] = [];
    if (query.warehouseId) {
      filters.push(
        sql`(${goodsIssues.warehouseId} = ${query.warehouseId} OR EXISTS (
          SELECT 1 FROM goods_issue_lines l
           WHERE l.issue_id = goods_issues.id AND l.warehouse_id = ${query.warehouseId}))`,
      );
    }
    if (query.status) filters.push(eq(goodsIssues.status, query.status));
    if (query.expenseTypeId) filters.push(eq(goodsIssues.expenseTypeId, query.expenseTypeId));
    if (query.pendingIn !== undefined) {
      // The keeper's work: sent issues with a line of theirs no confirmation covers yet.
      const scope =
        query.pendingIn === null
          ? sql`true`
          : query.pendingIn.length === 0
            ? sql`false`
            : sql`l.warehouse_id IN (${sql.join(
                query.pendingIn.map((id) => sql`${id}`),
                sql`, `,
              )})`;
      filters.push(
        sql`${goodsIssues.status} = 'SENT' AND EXISTS (
          SELECT 1 FROM goods_issue_lines l
           WHERE l.issue_id = goods_issues.id AND ${scope}
             AND NOT EXISTS (SELECT 1 FROM goods_issue_confirmations c
                              WHERE c.issue_id = l.issue_id AND c.warehouse_id = l.warehouse_id))`,
      );
    }
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
        correctsIssueId: goodsIssues.correctsIssueId,
        effectiveDate: goodsIssues.effectiveDate,
        createdAt: goodsIssues.createdAt,
        // Spelled out: a bare "id" inside the subquery would mean the line's own id.
        lineCount: sql<string>`(SELECT count(*) FROM goods_issue_lines l WHERE l.issue_id = goods_issues.id)`,
        warehouseIds: sql<
          number[]
        >`(SELECT coalesce(array_agg(DISTINCT l.warehouse_id ORDER BY l.warehouse_id), '{}') FROM goods_issue_lines l WHERE l.issue_id = goods_issues.id)`,
        confirmedWarehouseIds: sql<
          number[]
        >`(SELECT coalesce(array_agg(c.warehouse_id ORDER BY c.warehouse_id), '{}') FROM goods_issue_confirmations c WHERE c.issue_id = goods_issues.id)`,
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
        warehouseIds: row.warehouseIds.map((id) => Number.parseInt(String(id), 10)),
        confirmedWarehouseIds: row.confirmedWarehouseIds.map((id) =>
          Number.parseInt(String(id), 10),
        ),
        expenseTypeName: types.get(row.expenseTypeId) ?? '',
      })),
      nextCursor: page.nextCursor,
    };
  }

  // -------------------------------------------------------------------------------------------

  /**
   * One warehouse's part leaves (ADR-0117 #2): bins resolved where the keeper named none, one
   * posting for the part — a correction's reversal rows (the parent's lines back at their cost)
   * first, then the new content — the costs kept on the lines, the confirmation row written, the
   * books told about a supplier's credit or a «Хүнд тооцох» receivable (reversed and re-booked for
   * a correction).
   */
  private async postPart(
    tx: Tx,
    ctx: AuthContext,
    header: IssueRow,
    typeCode: string | null,
    warehouseId: number,
    lines: LineRow[],
    parentLines: LineRow[],
  ): Promise<void> {
    const movements: Movement[] = [];
    for (const line of parentLines) {
      if (line.unitCost === null || line.binId === null) {
        throw new Error(`issue line ${line.id} of the corrected issue was never posted`);
      }
      movements.push({
        docType: 'GI',
        docId: header.id,
        docLineId: line.id,
        movementType: 'GOODS_ISSUE_REVERSAL',
        leg: 1,
        warehouseId,
        binId: line.binId,
        productId: line.productId,
        lotId: line.lotId,
        qtyBase: line.qtyBase,
        enteredQty: line.enteredQty,
        productUnitId: line.productUnitId,
        factorSnapshot: line.factorSnapshot,
        unitCost: line.unitCost,
      });
    }
    const binOf = new Map<number, number>();
    for (const line of lines) {
      const binId = line.binId ?? (await this.sourceBin(tx, warehouseId, line.productId));
      await this.assertBin(tx, warehouseId, binId);
      binOf.set(line.id, binId);
      movements.push({
        docType: 'GI',
        docId: header.id,
        docLineId: line.id,
        movementType: 'GOODS_ISSUE',
        leg: 1,
        warehouseId,
        binId,
        productId: line.productId,
        lotId: line.lotId,
        qtyBase: line.qtyBase.negated(),
        enteredQty: line.enteredQty,
        productUnitId: line.productUnitId,
        factorSnapshot: line.factorSnapshot,
      });
    }
    const warehouse = await this.org.getWarehouse(warehouseId, tx);
    let date = businessDate();
    let number = header.number;
    if (movements.length > 0) {
      const result = await this.posting.post(tx, ctx, {
        docs: [
          {
            docType: 'GI',
            docId: header.id,
            expectedStatus: 'SENT',
            nextStatus: 'SENT',
            partial: true,
          },
        ],
        movements,
      });
      date = result.effectiveDate;
      number = result.numbers.get(header.id) ?? number;
      for (const line of lines) {
        const unitCost = result.unitCosts.get(`${line.id}:GOODS_ISSUE:1`);
        if (unitCost === undefined) continue;
        await tx
          .update(goodsIssueLines)
          .set({ unitCost, binId: binOf.get(line.id) ?? line.binId, updatedAt: sql`now()` })
          .where(eq(goodsIssueLines.id, line.id));
      }
    } else if (number === null) {
      // A correction that removes a warehouse's every line still needs the document's number for
      // its books; the posting of another part, or this one, gives it.
      throw new Error(`issue ${header.id}: a correction part with nothing to post has no number`);
    }
    await tx
      .insert(goodsIssueConfirmations)
      .values({ issueId: header.id, warehouseId, confirmedBy: actorUserId(ctx) });

    // The books (F3, ADR-0091; ADR-0117 #3, #5): the parent's part is reversed, the new one booked.
    const partId = partDocId(header.id, warehouseId);
    const docNo = `${number}/${warehouse.code}`;
    const party = partyOf(header);
    if (header.correctsIssueId !== null) {
      const parentDocId = partDocId(header.correctsIssueId, warehouseId);
      const reason = `${number ?? `#${header.id}`} corrects the part`;
      if (header.recipientKind === 'SUPPLIER') {
        await this.purchases.supplierReturnReversedInTx(tx, ctx, parentDocId, reason);
      } else if (typeCode === DAMAGE_CHARGE_TYPE) {
        await this.books?.damageReversedInTx(tx, ctx, parentDocId, reason);
      }
    }
    if (lines.length === 0) return;
    if (header.recipientKind === 'SUPPLIER') {
      await this.purchases.supplierReturnPostedInTx(
        tx,
        ctx,
        await this.supplierReturnFacts(header.id, warehouseId, tx),
      );
    } else if (typeCode === DAMAGE_CHARGE_TYPE && number !== null) {
      const amount = lines.reduce((sum, line) => sum.plus(line.saleAmount ?? 0), new Decimal(0));
      const facts: DamageChargeFacts = {
        issueId: header.id,
        docId: partId,
        docNo,
        date,
        party,
        amount,
        warehouseIds: [warehouseId],
      };
      await this.books?.damageChargedInTx(tx, ctx, facts);
    }
  }

  /** A sent issue whose every warehouse has its confirmation row is POSTED (ADR-0117 #1). */
  private async completeIfPosted(tx: Tx, actor: Actor, id: number): Promise<void> {
    const [header] = await tx.select().from(goodsIssues).where(eq(goodsIssues.id, id));
    if (!header || header.status !== 'SENT') return;
    const lines = await this.linesOf(tx, id);
    const parentLines =
      header.correctsIssueId === null ? [] : await this.linesOf(tx, header.correctsIssueId);
    const warehouseIds = warehousesOf(lines, parentLines);
    const confirmed = new Set((await this.confirmationsOf(tx, id)).map((row) => row.warehouseId));
    if (warehouseIds.length === 0 || !warehouseIds.every((w) => confirmed.has(w))) return;
    if (header.number === null || header.effectiveDate === null) {
      // Nothing left the stock (a correction that only removed lines whose parent part was
      // reversed still posted its reversal, so this cannot happen); refuse rather than break the CHECK.
      throw new Error(`issue ${id} completes without a number`);
    }
    await tx
      .update(goodsIssues)
      .set({
        status: 'POSTED',
        postedAt: sql`now()`,
        postedBy: actorUserId(actor),
        updatedAt: sql`now()`,
      })
      .where(eq(goodsIssues.id, id));
    await this.audit.record(tx, actor, {
      action: 'POST',
      entity: 'goods_issues',
      entityId: id,
      after: { number: header.number, warehouseIds },
    });
  }

  /**
   * A correction's warehouses whose lines equal the parent's (same product unit and quantity set)
   * need no keeper: they are marked unchanged at every send (the marks of unconfirmed warehouses
   * are derived afresh).
   */
  private async markUnchanged(
    tx: Tx,
    childId: number,
    parentId: number,
    lines: readonly LineRow[],
  ): Promise<number[]> {
    const parentLines = await this.linesOf(tx, parentId);
    const rows = await this.confirmationsOf(tx, childId);
    const posted = new Set(rows.filter((row) => !row.unchanged).map((row) => row.warehouseId));
    await tx
      .delete(goodsIssueConfirmations)
      .where(
        and(
          eq(goodsIssueConfirmations.issueId, childId),
          eq(goodsIssueConfirmations.unchanged, true),
        ),
      );
    const keyOf = (line: LineRow) => `${line.productUnitId}:${line.qtyBase.toFixed()}`;
    const unchanged = warehousesOf(lines, parentLines).filter((warehouseId) => {
      if (posted.has(warehouseId)) return false;
      const mine = lines
        .filter((line) => line.warehouseId === warehouseId)
        .map(keyOf)
        .sort();
      const theirs = parentLines
        .filter((line) => line.warehouseId === warehouseId)
        .map(keyOf)
        .sort();
      return mine.length === theirs.length && mine.every((key, index) => key === theirs[index]);
    });
    if (unchanged.length > 0) {
      await tx
        .insert(goodsIssueConfirmations)
        .values(
          unchanged.map((warehouseId) => ({ issueId: childId, warehouseId, unchanged: true })),
        );
    }
    return unchanged;
  }

  /** «Хүнд тооцох»: every line takes the warehouse price per base unit in force on the send's day. */
  private async priceLines(tx: Tx, lines: readonly LineRow[]): Promise<void> {
    if (!this.salePrices) {
      throw new AppError('PRICE_MISSING', 'no price reader is bound', { productId: null });
    }
    const productIds = [...new Set(lines.map((line) => line.productId))];
    const prices = await this.salePrices.warehousePricesInTx(tx, productIds, businessDate());
    for (const line of lines) {
      const price = prices.get(line.productId);
      if (price === undefined) {
        const [product] = await this.catalog.getMany([line.productId], tx);
        throw new AppError('PRICE_MISSING', `product ${line.productId} has no sale price`, {
          productId: line.productId,
          product: product?.name ?? '',
          sku: product?.sku ?? '',
        });
      }
      await tx
        .update(goodsIssueLines)
        .set({
          saleUnitPrice: price,
          saleAmount: toWholeMnt(price.times(line.qtyBase)),
          updatedAt: sql`now()`,
        })
        .where(eq(goodsIssueLines.id, line.id));
    }
  }

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

  private async assertIssueWarehouse(tx: Db | Tx, warehouseId: number): Promise<void> {
    const warehouse = await this.org.getWarehouse(warehouseId, tx);
    if (!ISSUE_WAREHOUSE_KINDS.includes(warehouse.kind)) {
      throw new AppError(
        'WAREHOUSE_KIND_NOT_ALLOWED',
        'goods are issued from a warehouse or store',
        { kind: warehouse.kind },
      );
    }
  }

  /**
   * A new line (ADR-0117 #1): the product's home warehouse, else the issue's default; a bin only
   * when the caller named one (the keeper's confirmation picks the shelf otherwise).
   */
  private async insertLine(tx: Tx, header: IssueRow, line: IssueLineInput): Promise<void> {
    const converted = await this.units.toBase(line.productUnitId, line.enteredQty, tx);
    const warehouseId =
      line.warehouseId ??
      (await this.locations.homeOf([converted.productId], tx)).get(converted.productId) ??
      header.warehouseId;
    if (warehouseId !== header.warehouseId) await this.assertIssueWarehouse(tx, warehouseId);
    await this.assertNotConfirmed(tx, header.id, warehouseId);
    if (line.binId != null) await this.assertBin(tx, warehouseId, line.binId);
    await tx.insert(goodsIssueLines).values({
      issueId: header.id,
      warehouseId,
      productId: converted.productId,
      productUnitId: converted.unitId,
      enteredQty: line.enteredQty,
      factorSnapshot: converted.factorSnapshot,
      qtyBase: converted.qtyBase,
      binId: line.binId ?? null,
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
      throw invalid('binId', 'warehouse', 'a bin of the line’s warehouse');
    }
    if (!ISSUE_BIN_TYPES.includes(bin.type)) {
      throw invalid('binId', 'type', 'a shelf, the sales floor or the receiving area');
    }
    if (bin.archivedAt) {
      throw new AppError('BIN_ARCHIVED', `bin ${bin.code} is archived`, { code: bin.code });
    }
  }

  private async cancelLocked(tx: Tx, actor: Actor, header: IssueRow): Promise<void> {
    const posted = (await this.confirmationsOf(tx, header.id)).filter((row) => !row.unchanged);
    if (posted.length > 0) {
      throw new AppError('ISSUE_PARTLY_POSTED', `issue ${header.id} has posted parts`, {
        issueId: header.id,
        warehouseIds: posted.map((row) => row.warehouseId).join(','),
      });
    }
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

  private async confirmationsOf(executor: Db | Tx, issueId: number): Promise<ConfirmationRow[]> {
    return executor
      .select()
      .from(goodsIssueConfirmations)
      .where(eq(goodsIssueConfirmations.issueId, issueId))
      .orderBy(goodsIssueConfirmations.warehouseId);
  }

  /** The correction of an issue: the open one, or with `any` the latest one whatever its status. */
  private async correctionOf(
    executor: Db | Tx,
    parentId: number,
    any = false,
  ): Promise<{ id: number; number: string | null; status: IssueStatus } | null> {
    const [row] = await executor
      .select({ id: goodsIssues.id, number: goodsIssues.number, status: goodsIssues.status })
      .from(goodsIssues)
      .where(
        and(
          eq(goodsIssues.correctsIssueId, parentId),
          any
            ? sql`${goodsIssues.status} <> 'CANCELLED'`
            : inArray(goodsIssues.status, ['DRAFT', 'SENT', 'RETURNED']),
        ),
      )
      .orderBy(desc(goodsIssues.id))
      .limit(1);
    return row ?? null;
  }

  private async numberOf(executor: Db | Tx, id: number): Promise<string | null> {
    const [row] = await executor
      .select({ number: goodsIssues.number })
      .from(goodsIssues)
      .where(eq(goodsIssues.id, id));
    return row?.number ?? (row ? `#${id}` : null);
  }

  private async warehouseNames(
    executor: Db | Tx,
    ids: readonly number[],
  ): Promise<Map<number, string>> {
    const names = new Map<number, string>();
    for (const id of ids) names.set(id, (await this.org.getWarehouse(id, executor)).name);
    return names;
  }

  private async describeLines(
    executor: Db | Tx,
    lines: readonly LineRow[],
    warehouseNames: ReadonlyMap<number, string>,
  ): Promise<IssueLine[]> {
    const products = new Map(
      (await this.catalog.getMany([...new Set(lines.map((line) => line.productId))], executor)).map(
        (product) => [product.id, product],
      ),
    );
    const units = await this.units.describe(
      [...new Set(lines.map((line) => line.productUnitId))],
      executor,
    );
    const binIds = [...new Set(lines.flatMap((line) => (line.binId === null ? [] : [line.binId])))];
    const binCodes = new Map(
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
      factorSnapshot: line.factorSnapshot,
      qtyBase: line.qtyBase,
      warehouseId: line.warehouseId,
      warehouseName: warehouseNames.get(line.warehouseId) ?? '',
      binId: line.binId,
      binCode: line.binId === null ? null : (binCodes.get(line.binId) ?? null),
      checkedAt: line.checkedAt,
      saleUnitPrice: line.saleUnitPrice,
      saleAmount: line.saleAmount,
      unitCost: line.unitCost,
      amount: line.unitCost ? line.unitCost.times(line.qtyBase).toDecimalPlaces(2) : null,
    }));
  }

  private async lockHeader(tx: Tx, id: number): Promise<IssueRow> {
    const [row] = await tx.select().from(goodsIssues).where(eq(goodsIssues.id, id)).for('update');
    if (!row) throw notFound('goods issue', id);
    return row;
  }

  /** The accountant's edit lock: DRAFT, SENT or RETURNED (posted parts are frozen line by line). */
  private async lockEditable(tx: Tx, id: number): Promise<IssueRow> {
    const header = await this.lockHeader(tx, id);
    if (!EDITABLE.includes(header.status)) throw stateError(header);
    return header;
  }

  private async lockEditableLine(
    tx: Tx,
    lineId: number,
  ): Promise<{ header: IssueRow; line: LineRow }> {
    const { header, line } = await this.lockLine(tx, lineId);
    if (!EDITABLE.includes(header.status)) throw stateError(header);
    await this.assertNotConfirmed(tx, header.id, line.warehouseId);
    return { header, line };
  }

  /** The keeper's lock: a sent issue, the line's warehouse in the caller's scope and unconfirmed. */
  private async lockKeeperLine(
    tx: Tx,
    ctx: AuthContext,
    lineId: number,
  ): Promise<{ header: IssueRow; line: LineRow }> {
    const { header, line } = await this.lockLine(tx, lineId);
    if (header.status !== 'SENT') {
      throw new AppError('ISSUE_NOT_SENT', `issue ${header.id} is ${header.status}`, {
        status: header.status,
      });
    }
    this.scope.assertCanWriteWarehouse(ctx, line.warehouseId);
    await this.assertNotConfirmed(tx, header.id, line.warehouseId);
    return { header, line };
  }

  private async lockLine(tx: Tx, lineId: number): Promise<{ header: IssueRow; line: LineRow }> {
    const [peek] = await tx
      .select({ issueId: goodsIssueLines.issueId })
      .from(goodsIssueLines)
      .where(eq(goodsIssueLines.id, lineId));
    if (!peek) throw notFound('issue line', lineId);
    const header = await this.lockHeader(tx, peek.issueId);
    const [line] = await tx.select().from(goodsIssueLines).where(eq(goodsIssueLines.id, lineId));
    if (!line) throw notFound('issue line', lineId);
    return { header, line };
  }

  /** A confirmed warehouse's lines are frozen: the goods are gone (ISSUE_WAREHOUSE_CONFIRMED). */
  private async assertNotConfirmed(tx: Tx, issueId: number, warehouseId: number): Promise<void> {
    const [row] = await tx
      .select({ unchanged: goodsIssueConfirmations.unchanged })
      .from(goodsIssueConfirmations)
      .where(
        and(
          eq(goodsIssueConfirmations.issueId, issueId),
          eq(goodsIssueConfirmations.warehouseId, warehouseId),
        ),
      );
    if (row && !row.unchanged) {
      throw new AppError('ISSUE_WAREHOUSE_CONFIRMED', `warehouse ${warehouseId} is confirmed`, {
        issueId,
        warehouseId,
      });
    }
  }

  private async touch(tx: Tx, id: number): Promise<void> {
    await tx
      .update(goodsIssues)
      .set({ updatedAt: sql`now()` })
      .where(eq(goodsIssues.id, id));
  }
}

/** The books' identity of one warehouse's part of an issue (ADR-0117 #2). */
export const partDocId = (issueId: number, warehouseId: number): string =>
  `${issueId}:${warehouseId}`;

/** The warehouses an issue covers: its lines', and for a correction the parent's too. */
function warehousesOf(lines: readonly LineRow[], parentLines: readonly LineRow[]): number[] {
  return [...new Set([...lines, ...parentLines].map((line) => line.warehouseId))].sort(
    (a, b) => a - b,
  );
}

function partyOf(header: IssueRow): StockBookParty {
  const id =
    header.recipientKind === 'USER'
      ? header.recipientUserId
      : header.recipientKind === 'CUSTOMER'
        ? header.recipientCustomerId
        : header.recipientKind === 'SUPPLIER'
          ? header.recipientSupplierId
          : null;
  return { kind: header.recipientKind, id, name: header.recipientName ?? '' };
}

function stateError(header: IssueRow): AppError {
  if (header.status === 'POSTED') {
    return new AppError('DOC_ALREADY_POSTED', `issue ${header.id} is posted`, {
      status: header.status,
    });
  }
  return new AppError('DOC_STATE_INVALID', `issue ${header.id} is ${header.status}`, {
    status: header.status,
  });
}
