import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
  canRecost,
  costingDeadline,
  lineAmountOf,
  type ReceiptPaymentMethod,
  receiptLineCost,
  receiptLineVat,
  unitCostOf,
} from '@tugeel/shared/inventory';
import { Decimal } from '@tugeel/shared/money';
import { businessDate } from '@tugeel/shared/time';
import { and, desc, eq, ilike, inArray, lt, or, type SQL, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { escapeLike } from '../../../common/db/like';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { DEFAULT_PAGE_LIMIT, decodeCursor, toPage } from '../../../common/pagination/page';
import { CatalogService, TaxService, UnitConversionService } from '../../catalog';
import {
  type Actor,
  actorUserId,
  type AuthContext,
  AuditService,
  OrgService,
  ScopeService,
} from '../../identity';
import { SuppliersService } from '../../partners';
import {
  RECEIPT_MONEY_ACCOUNTS,
  type ReceiptMoneyAccount,
  type ReceiptMoneyAccounts,
} from '../hooks';
import { bins, goodsReceiptLines, goodsReceipts, RECEIPT_STATUSES } from '../schema';
import { BinsService } from './bins.service';
import { ProductLocationsService } from './product-locations.service';
import { StockPostingService } from './stock-posting.service';
import { optionalText } from './support';

type ReceiptRow = typeof goodsReceipts.$inferSelect;
type LineRow = typeof goodsReceiptLines.$inferSelect;
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];

const COSTS = 'inventory.costs.manage';

/** Bins a receipt may fill: the receiving area and shelves (ADR-0033 #1). */
const RECEIPT_BIN_TYPES = ['RECEIVING', 'STORAGE', 'PICKING'];

export interface ReceiptLineInput {
  productUnitId: number;
  enteredQty: Decimal;
  /** Omitted: the product's fixed shelf in the warehouse, else the RECEIVING bin. */
  binId?: number | null;
  /** The delivery note's price per entered unit (ADR-0078; cost holders only). */
  docUnitPrice?: Decimal | null;
  /** Or its line amount, VAT included as printed. */
  docAmount?: Decimal | null;
  /** Free goods (бонус), costed at zero. */
  freeGoods?: boolean;
}

export interface ReceiptLinePatch {
  enteredQty?: Decimal;
  binId?: number;
  /** A price per entered unit; null clears the price. */
  docUnitPrice?: Decimal | null;
  /** A line amount; null clears the price. */
  docAmount?: Decimal | null;
  freeGoods?: boolean;
}

export interface ReceiptInput {
  warehouseId: number;
  supplierId: number;
  supplierDocNo?: string | null;
  supplierDocDate?: string | null;
  note?: string | null;
  /** Default CREDIT (ADR-0078). */
  paymentMethod?: ReceiptPaymentMethod;
  /** The cash box or bank account of a CASH / BANK receipt; required by the posting. */
  moneyAccountId?: number | null;
  lines?: readonly ReceiptLineInput[];
}

export interface ReceiptPatch {
  supplierId?: number;
  supplierDocNo?: string | null;
  supplierDocDate?: string | null;
  note?: string | null;
  paymentMethod?: ReceiptPaymentMethod;
  moneyAccountId?: number | null;
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
  /** The delivery note's price (ADR-0078): the draft's, else the latest costing's. Cost data. */
  docUnitPrice: Decimal | null;
  docAmount: Decimal | null;
  freeGoods: boolean;
  /** The VAT inside `docAmount` (0 for a product without VAT or a receipt without it). */
  vatAmount: Decimal | null;
  /** `docAmount` less its VAT: the line's cost. */
  costAmount: Decimal | null;
}

export interface ReceiptTotals {
  /** Σ delivery-note amounts of the priced lines, VAT included. */
  docTotal: Decimal;
  vatTotal: Decimal;
  costTotal: Decimal;
  /** Lines with a price or marked free, of all lines. */
  pricedLines: number;
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
  costingVersion: number;
  /** Last business date a costed receipt may be costed again. */
  recostUntil: string | null;
  note: string | null;
  paymentMethod: ReceiptPaymentMethod;
  moneyAccountId: number | null;
  moneyAccountName: string | null;
  supplierVatPayer: boolean;
  /** VAT inside the delivery-note prices; frozen at posting. */
  vatRatePct: Decimal;
  effectiveDate: string | null;
  postedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  lines: ReceiptLine[];
  /** Cost data, like the lines' prices. */
  totals: ReceiptTotals;
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
  /** Line amount as on the delivery note, VAT included (ADR-0078); its cost is the amount less VAT. */
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
  /** What was typed, VAT included (ADR-0078). */
  docAmount: Decimal | null;
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
  vatRatePct: Decimal;
  total: Decimal | null;
  docTotal: Decimal | null;
  lines: CostedReceiptLine[];
}

/**
 * Goods receipts (GR-, SPEC §5.4, ADR-0033, ADR-0078): one window for the delivery note. Warehouse
 * staff count what arrived into its shelf; a cost holder may type the note's prices on the draft
 * (VAT included as printed). Posting brings the stock in at once; a receipt priced in full is costed
 * in the same transaction, otherwise the accountant costs it later. Every action locks the receipt
 * header first and reads its lines after (ADR-0034). Draft edits are not audited; creation,
 * posting, cancelling and costing are.
 */
@Injectable()
export class ReceiptsService implements OnModuleInit {
  private moneyAccounts: ReceiptMoneyAccounts | null = null;

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
    private readonly tax: TaxService,
    private readonly units: UnitConversionService,
    private readonly moduleRef: ModuleRef,
  ) {}

  onModuleInit(): void {
    try {
      this.moneyAccounts = this.moduleRef.get<ReceiptMoneyAccounts>(RECEIPT_MONEY_ACCOUNTS, {
        strict: false,
      });
    } catch {
      this.moneyAccounts = null;
    }
  }

  /** The cash boxes and bank accounts a receipt may name (finance's; empty without finance). */
  async paymentAccounts(): Promise<ReceiptMoneyAccount[]> {
    return this.moneyAccounts ? this.moneyAccounts.active(this.db) : [];
  }

  async create(ctx: AuthContext, input: ReceiptInput): Promise<ReceiptDetail> {
    this.scope.assertCanWriteWarehouse(ctx, input.warehouseId);
    if ((input.lines ?? []).some(hasPrice)) assertCosts(ctx);
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
    const paymentMethod = input.paymentMethod ?? 'CREDIT';
    const moneyAccountId = await this.checkPayment(tx, paymentMethod, input.moneyAccountId);
    const supplierDocDate = input.supplierDocDate ?? null;
    const [row] = await tx
      .insert(goodsReceipts)
      .values({
        warehouseId: input.warehouseId,
        supplierId: input.supplierId,
        supplierDocNo: optionalText(input.supplierDocNo) ?? null,
        supplierDocDate,
        note: optionalText(input.note) ?? null,
        paymentMethod,
        moneyAccountId,
        vatRatePct: await this.vatRateOf(tx, input.supplierId, supplierDocDate),
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
      const supplierId = patch.supplierId ?? header.supplierId;
      if (supplierId !== header.supplierId) await this.suppliers.assertActive(tx, supplierId);
      const supplierDocDate =
        patch.supplierDocDate === undefined ? header.supplierDocDate : patch.supplierDocDate;
      const paymentMethod = patch.paymentMethod ?? header.paymentMethod;
      const moneyAccountId = await this.checkPayment(
        tx,
        paymentMethod,
        patch.moneyAccountId === undefined
          ? paymentMethod === 'CREDIT'
            ? null
            : header.moneyAccountId
          : patch.moneyAccountId,
      );
      await tx
        .update(goodsReceipts)
        .set({
          supplierId,
          ...(patch.supplierDocNo === undefined
            ? {}
            : { supplierDocNo: optionalText(patch.supplierDocNo) ?? null }),
          supplierDocDate,
          ...(patch.note === undefined ? {} : { note: optionalText(patch.note) ?? null }),
          paymentMethod,
          moneyAccountId,
          vatRatePct: await this.vatRateOf(tx, supplierId, supplierDocDate),
          updatedAt: sql`now()`,
        })
        .where(eq(goodsReceipts.id, id));
      return this.get(id, tx);
    });
  }

  addLine(ctx: AuthContext, receiptId: number, line: ReceiptLineInput): Promise<ReceiptDetail> {
    if (hasPrice(line)) assertCosts(ctx);
    return inTransaction(this.db, async (tx) => {
      const header = await this.lockDraft(tx, ctx, receiptId);
      await this.insertLine(tx, header, line);
      await this.touch(tx, receiptId);
      return this.get(receiptId, tx);
    });
  }

  updateLine(ctx: AuthContext, lineId: number, patch: ReceiptLinePatch): Promise<ReceiptDetail> {
    if (
      patch.docUnitPrice !== undefined ||
      patch.docAmount !== undefined ||
      patch.freeGoods !== undefined
    ) {
      assertCosts(ctx);
    }
    return inTransaction(this.db, async (tx) => {
      const { header, line } = await this.lockLine(tx, ctx, lineId);
      const enteredQty = patch.enteredQty ?? line.enteredQty;
      const converted = await this.units.toBase(line.productUnitId, enteredQty, tx);
      const binId = patch.binId ?? line.binId;
      if (patch.binId !== undefined) await this.assertBin(tx, header.warehouseId, binId);
      const priced =
        patch.docUnitPrice !== undefined ||
        patch.docAmount !== undefined ||
        patch.freeGoods !== undefined
          ? priceOf(patch, enteredQty)
          : // A price per unit follows a new quantity; a typed amount stays as typed.
            line.docUnitPrice !== null
            ? priceOf({ docUnitPrice: line.docUnitPrice }, enteredQty)
            : {
                docUnitPrice: null,
                docAmount: line.docAmount,
                freeGoods: line.freeGoods,
              };
      await tx
        .update(goodsReceiptLines)
        .set({
          enteredQty,
          factorSnapshot: converted.factorSnapshot,
          qtyBase: converted.qtyBase,
          binId,
          ...priced,
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

  /**
   * DRAFT → POSTED: stock arrives in each line's bin at the provisional cost (ADR-0033); a receipt
   * whose every line has its price or is free is costed at once from those prices (ADR-0078 #3).
   */
  post(ctx: AuthContext, id: number): Promise<ReceiptDetail> {
    return inTransaction(this.db, async (tx) => {
      const header = await this.lockHeader(tx, id);
      this.scope.assertCanWriteWarehouse(ctx, header.warehouseId);
      assertDraft(header);
      const lines = await this.linesOf(tx, id);
      if (lines.length === 0) throw invalid('lines', 'empty', 'a receipt needs at least one line');
      await this.suppliers.assertActive(tx, header.supplierId);
      if (header.paymentMethod !== 'CREDIT') {
        if (header.moneyAccountId === null) {
          throw invalid(
            'moneyAccountId',
            'required',
            'a receipt paid in cash or by bank names its account',
          );
        }
        await this.checkPayment(tx, header.paymentMethod, header.moneyAccountId);
      }
      for (const line of lines) {
        // A unit superseded since the line was entered refuses the posting (UNIT_SUPERSEDED).
        await this.units.toBase(line.productUnitId, line.enteredQty, tx);
      }
      await this.locations.assertMayReceive(
        tx,
        header.warehouseId,
        lines.map((line) => line.productId),
      );
      // The VAT rate is frozen with the posting, on the delivery note's date.
      const vatRatePct = await this.vatRateOf(tx, header.supplierId, header.supplierDocDate);
      await tx.update(goodsReceipts).set({ vatRatePct }).where(eq(goodsReceipts.id, id));
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
      const priced = lines.every((line) => line.freeGoods || line.docAmount !== null);
      if (priced) {
        const rates = await this.lineVatRates(tx, lines, vatRatePct);
        await this.posting.revalue(tx, ctx, {
          docId: id,
          version: 1,
          lines: lines.map((line) => ({
            docLineId: line.id,
            warehouseId: header.warehouseId,
            productId: line.productId,
            lotId: line.lotId,
            qtyBase: line.qtyBase,
            amount: line.freeGoods
              ? new Decimal(0)
              : receiptLineCost(line.docAmount ?? 0, rates.get(line.id) ?? 0),
            docAmount: line.freeGoods ? new Decimal(0) : line.docAmount,
            freeGoods: line.freeGoods,
          })),
        });
        await tx
          .update(goodsReceipts)
          .set({
            costingStatus: 'COSTED',
            costingVersion: 1,
            costedAt: sql`now()`,
            costedBy: actorUserId(ctx),
          })
          .where(eq(goodsReceipts.id, id));
      }
      await this.audit.record(tx, ctx, {
        action: 'POST',
        entity: 'goods_receipts',
        entityId: id,
        before: header,
        after: { number: result.numbers.get(id), vatRatePct, costed: priced, lines },
      });
      return this.get(id, tx);
    });
  }

  cancel(ctx: AuthContext, id: number): Promise<ReceiptDetail> {
    return inTransaction(this.db, async (tx) => {
      const header = await this.lockDraft(tx, ctx, id);
      await this.cancelLocked(tx, ctx, header);
      return this.get(id, tx);
    });
  }

  /**
   * Cancels drafts an import made, in the import's transaction (ADR-0078 #7): refused unless each is
   * still a draft untouched since the import (IMPORT_REVERT_BLOCKED by the caller's check).
   */
  async cancelDraftsInTx(
    tx: Tx,
    actor: Actor,
    ids: readonly number[],
  ): Promise<{ id: number; touched: boolean; status: ReceiptStatus }[]> {
    const states: { id: number; touched: boolean; status: ReceiptStatus }[] = [];
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

  /**
   * The accountant's costing (ADR-0033, ADR-0078 #4): every line at once, by the delivery note's
   * amount or price per entered unit (VAT included as printed), bonus lines at zero. Each line's cost
   * is its amount less the VAT at the receipt's frozen rate. `costingVersion` is the version the
   * form was opened at.
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
      const rates = await this.lineVatRates(tx, lines, header.vatRatePct);
      const version = header.costingVersion + 1;
      const typed = new Map(
        lines.map((line) => {
          const cost = given.get(line.id);
          if (!cost) throw new Error(`line ${line.id} not costed`);
          return [line.id, lineAmount(cost, line.enteredQty)];
        }),
      );
      await this.posting.revalue(tx, ctx, {
        docId: id,
        version,
        lines: lines.map((line) => {
          const docAmount = typed.get(line.id) ?? new Decimal(0);
          return {
            docLineId: line.id,
            warehouseId: header.warehouseId,
            productId: line.productId,
            lotId: line.lotId,
            qtyBase: line.qtyBase,
            amount: receiptLineCost(docAmount, rates.get(line.id) ?? 0),
            docAmount,
            freeGoods: given.get(line.id)?.freeGoods ?? false,
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
          vatRatePct: header.vatRatePct,
          lines: lines.map((line) => ({ lineId: line.id, docAmount: typed.get(line.id) ?? null })),
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
        docAmount: valuation ? (valuation.docAmount ?? valuation.amount) : line.docAmount,
        unitCost: valuation ? unitCostOf(valuation.amount, line.qtyBase) : null,
        freeGoods: valuation?.freeGoods ?? line.freeGoods,
      };
    });
    const sum = (pick: (line: (typeof costed)[number]) => Decimal | null) =>
      costed.reduce((total, line) => total.plus(pick(line) ?? 0), new Decimal(0));
    return {
      receiptId: id,
      number: header.number,
      status: header.status,
      costingStatus: header.costingStatus,
      costingVersion: header.costingVersion,
      recostUntil: header.effectiveDate ? costingDeadline(header.effectiveDate) : null,
      costedAt: header.costedAt,
      vatRatePct: header.vatRatePct,
      total: header.costingVersion > 0 ? sum((line) => line.amount) : null,
      docTotal: header.costingVersion > 0 ? sum((line) => line.docAmount) : null,
      lines: costed,
    };
  }

  async get(id: number, executor: Db | Tx = this.db): Promise<ReceiptDetail> {
    const [header] = await executor.select().from(goodsReceipts).where(eq(goodsReceipts.id, id));
    if (!header) throw notFound('goods receipt', id);
    const [supplier] = await this.suppliers.getMany([header.supplierId], executor);
    const warehouse = await this.org.getWarehouse(header.warehouseId, executor);
    const rows = await this.linesOf(executor, id);
    const lines = await this.describeLines(executor, rows);
    // A costed receipt shows its latest costing; a draft or a pending one its typed prices.
    const latest = header.costingVersion > 0 ? await this.posting.costingOf(id, executor) : null;
    const rates = await this.lineVatRates(executor, rows, header.vatRatePct);
    const priced = lines.map((line) => {
      const valuation = latest?.get(line.id);
      const docAmount = valuation ? (valuation.docAmount ?? valuation.amount) : line.docAmount;
      const freeGoods = valuation ? valuation.freeGoods : line.freeGoods;
      const docUnitPrice = valuation
        ? line.enteredQty.isZero()
          ? null
          : (docAmount?.dividedBy(line.enteredQty).toDecimalPlaces(2) ?? null)
        : line.docUnitPrice;
      const vatAmount =
        docAmount === null ? null : receiptLineVat(docAmount, rates.get(line.id) ?? 0);
      return {
        ...line,
        docUnitPrice,
        docAmount,
        freeGoods,
        vatAmount,
        costAmount: docAmount === null || vatAmount === null ? null : docAmount.minus(vatAmount),
      };
    });
    const accountName =
      header.moneyAccountId === null
        ? null
        : ((await this.paymentAccounts()).find((account) => account.id === header.moneyAccountId)
            ?.name ?? null);
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
      costingVersion: header.costingVersion,
      recostUntil: header.effectiveDate ? costingDeadline(header.effectiveDate) : null,
      note: header.note,
      paymentMethod: header.paymentMethod,
      moneyAccountId: header.moneyAccountId,
      moneyAccountName: accountName,
      supplierVatPayer: supplier?.vatPayer ?? false,
      vatRatePct: header.vatRatePct,
      effectiveDate: header.effectiveDate,
      postedAt: header.postedAt,
      createdAt: header.createdAt,
      updatedAt: header.updatedAt,
      lines: priced,
      totals: {
        docTotal: priced.reduce((sum, line) => sum.plus(line.docAmount ?? 0), new Decimal(0)),
        vatTotal: priced.reduce((sum, line) => sum.plus(line.vatAmount ?? 0), new Decimal(0)),
        costTotal: priced.reduce((sum, line) => sum.plus(line.costAmount ?? 0), new Decimal(0)),
        pricedLines: priced.filter((line) => line.freeGoods || line.docAmount !== null).length,
      },
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

  /** CREDIT names no account; CASH / BANK may name one of their kind (required at posting). */
  private async checkPayment(
    tx: Tx,
    method: ReceiptPaymentMethod,
    accountId: number | null | undefined,
  ): Promise<number | null> {
    if (method === 'CREDIT') {
      if (accountId) {
        throw invalid('moneyAccountId', 'credit', 'a receipt on credit names no money account');
      }
      return null;
    }
    if (accountId === null || accountId === undefined) return null;
    if (!this.moneyAccounts) {
      throw invalid('moneyAccountId', 'unavailable', 'money accounts are not available');
    }
    await this.moneyAccounts.assertUsable(tx, accountId, method);
    return accountId;
  }

  /**
   * VAT inside the delivery note (ADR-0078 #1): the company's rate when the company and the
   * supplier both pay VAT, on the note's date (today without one); else 0.
   */
  private async vatRateOf(
    executor: Db | Tx,
    supplierId: number,
    onDate: string | null,
  ): Promise<Decimal> {
    const company = await this.tax.companyRates(onDate ?? businessDate(), executor);
    if (!company.vatPayer) return new Decimal(0);
    const [supplier] = await this.suppliers.getMany([supplierId], executor);
    return supplier?.vatPayer ? company.vatRatePct : new Decimal(0);
  }

  /** Each line's VAT rate: the receipt's for a product that carries VAT, 0 for an exempt one. */
  private async lineVatRates(
    executor: Db | Tx,
    lines: readonly LineRow[],
    receiptRate: Decimal,
  ): Promise<Map<number, Decimal>> {
    if (receiptRate.isZero()) return new Map(lines.map((line) => [line.id, new Decimal(0)]));
    const products = new Map(
      (await this.catalog.getMany([...new Set(lines.map((line) => line.productId))], executor)).map(
        (product) => [product.id, product],
      ),
    );
    return new Map(
      lines.map((line) => [
        line.id,
        products.get(line.productId)?.vatType === 'VAT_ABLE' ? receiptRate : new Decimal(0),
      ]),
    );
  }

  private async cancelLocked(tx: Tx, actor: Actor, header: ReceiptRow): Promise<void> {
    await tx
      .update(goodsReceipts)
      .set({ status: 'CANCELLED', updatedAt: sql`now()` })
      .where(eq(goodsReceipts.id, header.id));
    await this.audit.record(tx, actor, {
      action: 'CANCEL',
      entity: 'goods_receipts',
      entityId: header.id,
      before: header,
    });
  }

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
      ...priceOf(line, line.enteredQty),
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
      docUnitPrice: line.docUnitPrice,
      docAmount: line.docAmount,
      freeGoods: line.freeGoods,
      vatAmount: null,
      costAmount: null,
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

/** Prices are cost data (ADR-0033 #8): only a cost holder types them. */
function assertCosts(ctx: AuthContext): void {
  if (!ctx.permissions.has(COSTS)) {
    throw new AppError('FORBIDDEN', 'prices are set by cost holders', { permission: COSTS });
  }
}

function hasPrice(line: ReceiptLineInput): boolean {
  return (
    (line.docUnitPrice !== undefined && line.docUnitPrice !== null) ||
    (line.docAmount !== undefined && line.docAmount !== null) ||
    line.freeGoods === true
  );
}

/**
 * A draft line's price columns from what was typed (ADR-0078 #2): free goods carry no price; a
 * price per unit makes the amount (and follows the quantity later); an amount stays as typed.
 */
function priceOf(
  input: {
    docUnitPrice?: Decimal | null;
    docAmount?: Decimal | null;
    freeGoods?: boolean;
  },
  enteredQty: Decimal,
): { docUnitPrice: Decimal | null; docAmount: Decimal | null; freeGoods: boolean } {
  if (input.freeGoods) return { docUnitPrice: null, docAmount: null, freeGoods: true };
  if (input.docUnitPrice !== undefined && input.docUnitPrice !== null) {
    assertMoney('docUnitPrice', input.docUnitPrice);
    return {
      docUnitPrice: input.docUnitPrice,
      docAmount: lineAmountOf(input.docUnitPrice, enteredQty),
      freeGoods: false,
    };
  }
  if (input.docAmount !== undefined && input.docAmount !== null) {
    assertMoney('docAmount', input.docAmount);
    return { docUnitPrice: null, docAmount: input.docAmount, freeGoods: false };
  }
  return { docUnitPrice: null, docAmount: null, freeGoods: false };
}

function assertMoney(field: string, value: Decimal): void {
  if (value.isNegative() || value.decimalPlaces() > 2) {
    throw invalid(field, 'money', 'a non-negative amount with at most two decimals');
  }
}

/** A costed line's amount as typed: bonus lines are free, a unit price × the entered quantity. */
function lineAmount(cost: CostLineInput, enteredQty: Decimal): Decimal {
  if (cost.freeGoods) return new Decimal(0);
  if (cost.amount) return cost.amount;
  if (cost.unitPrice) return lineAmountOf(cost.unitPrice, enteredQty);
  throw invalid('lines', 'amount', 'an amount or a unit price for every line that is not a bonus');
}
