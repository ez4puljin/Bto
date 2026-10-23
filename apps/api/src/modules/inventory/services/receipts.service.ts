import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
  allocateReceiptDiscounts,
  canRecost,
  costingDeadline,
  lineAmountOf,
  ReceiptDiscountError,
  type ReceiptDiscountKind,
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
import { CatalogService, UnitConversionService } from '../../catalog';
import {
  type Actor,
  actorUserId,
  type AuthContext,
  AuditService,
  OrgService,
} from '../../identity';
import { ProductSuppliersService, SuppliersService } from '../../partners';
import {
  RECEIPT_MONEY_ACCOUNTS,
  RECEIPT_SALE_PRICES,
  type ReceiptMoneyAccount,
  type ReceiptMoneyAccounts,
  type ReceiptBookFacts,
  type ReceiptBookTotals,
  type ReceiptSalePrices,
} from '../hooks';
import {
  bins,
  goodsReceiptDiscountLines,
  goodsReceiptDiscounts,
  goodsReceiptLines,
  goodsReceipts,
  RECEIPT_STATUSES,
} from '../schema';
import { BinsService } from './bins.service';
import { ProductLocationsService } from './product-locations.service';
import { PurchaseBooksService } from './purchase-books.service';
import { StockPostingService } from './stock-posting.service';
import { optionalText } from './support';

type ReceiptRow = typeof goodsReceipts.$inferSelect;
type LineRow = typeof goodsReceiptLines.$inferSelect;
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];

const COSTS = 'inventory.costs.manage';
/** A receipt line's new sale price is a price change (ADR-0099 #5). */
const PRICES = 'pricing.prices.manage';

/** Shelves a receipt line may go to besides the receiving area (ADR-0033 #1). */
const SHELF_TYPES = ['STORAGE', 'PICKING'];

export interface ReceiptLineInput {
  productUnitId: number;
  enteredQty: Decimal;
  /**
   * Only for a product without a home warehouse (ADR-0099 #1): the wholesale warehouse it is
   * received into, which becomes its home. A product with a home always goes there.
   */
  warehouseId?: number | null;
  /** The delivery note's price per entered unit (ADR-0078; cost holders only). */
  docUnitPrice?: Decimal | null;
  /** Or its line amount, VAT included as printed. */
  docAmount?: Decimal | null;
  /** Free goods (бонус), costed at zero. */
  freeGoods?: boolean;
  /** A new warehouse price per base unit, in force from the posting (price holders only). */
  salePrice?: Decimal | null;
}

export interface ReceiptLinePatch {
  enteredQty?: Decimal;
  /** A price per entered unit; null clears the price. */
  docUnitPrice?: Decimal | null;
  /** A line amount; null clears the price. */
  docAmount?: Decimal | null;
  freeGoods?: boolean;
  /** A new warehouse price per base unit; null clears it. */
  salePrice?: Decimal | null;
}

export interface ReceiptInput {
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

/**
 * A discount as typed (ADR-0101): on chosen lines (`LINES`) or on the whole note (`NOTE`, at most
 * one), a percentage or an amount.
 */
export interface ReceiptDiscountRequest {
  kind: ReceiptDiscountKind;
  pct: Decimal | null;
  amount: Decimal | null;
  /** The lines of a LINES discount (priced, not free goods); none for NOTE. */
  lineIds: readonly number[];
}

export interface ReceiptDiscountView extends ReceiptDiscountRequest {
  id: number;
  /** The discount in tugriks on the lines priced so far; null while it exceeds them. */
  total: Decimal | null;
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
  /** The line's wholesale warehouse (its product's home, ADR-0099 #1). */
  warehouseId: number;
  warehouseName: string;
  binId: number;
  binCode: string;
  lotId: number | null;
  /** Net weight of one base unit in kilograms; NULL when the product has none recorded. */
  weightKg: Decimal | null;
  /** The new warehouse price per base unit the posting puts in force (ADR-0099 #5). */
  salePrice: Decimal | null;
  /** The delivery note's price (ADR-0078): the draft's, else the latest costing's. Cost data. */
  docUnitPrice: Decimal | null;
  docAmount: Decimal | null;
  freeGoods: boolean;
  /** The line's share of the receipt's discounts (ADR-0099 #4, ADR-0101). */
  discountAmount: Decimal | null;
  /** `docAmount` less its discount share: what the supplier is owed for the line. */
  netAmount: Decimal | null;
  /** The VAT inside `netAmount` (0 for a product without VAT or a receipt without it). */
  vatAmount: Decimal | null;
  /** `netAmount` less its VAT: the line's cost. */
  costAmount: Decimal | null;
}

export interface ReceiptTotals {
  /** Σ delivery-note amounts of the priced lines, VAT included, before the discount. */
  docTotal: Decimal;
  /** The receipt's discounts in tugriks. */
  discountTotal: Decimal;
  /** A discount exceeds the lines it applies to: the posting will refuse it. */
  discountTooLarge: boolean;
  /** `docTotal` less the discount: the payable. */
  netTotal: Decimal;
  vatTotal: Decimal;
  costTotal: Decimal;
  /** Lines with a price or marked free, of all lines. */
  pricedLines: number;
  /** Σ base quantity × weight of the lines whose product has a weight (kg). */
  weightKg: Decimal;
  /** Lines whose product has no weight recorded. */
  weightMissing: number;
}

export interface ReceiptDetail {
  id: number;
  number: string | null;
  /** The warehouses of its lines, by name. */
  warehouses: { id: number; name: string }[];
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
  /** Cost data, like the prices (ADR-0101). */
  discounts: ReceiptDiscountView[];
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
  supplierId: number;
  supplierName: string;
  supplierDocNo: string | null;
  supplierDocDate: string | null;
  status: ReceiptStatus;
  costingStatus: 'PENDING' | 'COSTED' | null;
  paymentMethod: ReceiptPaymentMethod;
  lineCount: number;
  /** The payable: the latest costing's, else the typed prices less the discount. Cost data. */
  netAmount: Decimal | null;
  effectiveDate: string | null;
  createdAt: Date;
}

export interface ReceiptQuery {
  /** Receipts with a line in this warehouse. */
  warehouseId?: number;
  status?: ReceiptStatus;
  /** Posted receipts the accountant has not costed yet. */
  costingPending?: boolean;
  supplierId?: number;
  /** Receipts with a line of this product. */
  productId?: number;
  /** The delivery note's date (else the posting's) on or after / on or before. */
  from?: string;
  to?: string;
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

/** A product's latest delivery-note price (ADR-0099 #3), before the note's discount. */
export interface LastReceiptPrice {
  productId: number;
  receiptId: number;
  receiptNumber: string;
  /** The delivery note's date, else the posting's. */
  date: string;
  supplierName: string;
  unitName: string;
  /** Per entered unit, VAT included as printed. */
  unitPrice: Decimal;
  /** Per base unit. */
  basePrice: Decimal;
}

/** The costing's discounts: given, they replace the receipt's (an empty list clears them). */
export interface CostDiscountInput {
  discounts?: readonly ReceiptDiscountRequest[];
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
  /** The line's share of the discount (ADR-0099 #4). */
  discountAmount: Decimal | null;
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
  discounts: ReceiptDiscountView[];
  total: Decimal | null;
  docTotal: Decimal | null;
  lines: CostedReceiptLine[];
}

/**
 * Goods receipts (GR-, SPEC §5.4, ADR-0033, ADR-0078, ADR-0099): one window for the delivery note.
 * Each line goes to its product's home warehouse and fixed shelf (else that warehouse's receiving
 * area), so one note may fill several wholesale warehouses; anyone with the receipt right writes
 * them, whatever their warehouse scope. A cost holder may type the note's prices and its discount
 * on the draft (VAT included as printed), a price holder a new sale price per line. Posting brings
 * the stock in at once and puts the sale prices in force; a receipt priced in full is costed in the
 * same transaction, otherwise the accountant costs it later. Every action locks the receipt header
 * first and reads its lines after (ADR-0034). Draft edits are not audited; creation, posting,
 * cancelling and costing are.
 */
@Injectable()
export class ReceiptsService implements OnModuleInit {
  private moneyAccounts: ReceiptMoneyAccounts | null = null;
  private salePrices: ReceiptSalePrices | null = null;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly bins: BinsService,
    private readonly catalog: CatalogService,
    private readonly locations: ProductLocationsService,
    private readonly org: OrgService,
    private readonly posting: StockPostingService,
    private readonly suppliers: SuppliersService,
    private readonly links: ProductSuppliersService,
    private readonly units: UnitConversionService,
    private readonly purchases: PurchaseBooksService,
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
    try {
      this.salePrices = this.moduleRef.get<ReceiptSalePrices>(RECEIPT_SALE_PRICES, {
        strict: false,
      });
    } catch {
      this.salePrices = null;
    }
  }

  /** The cash boxes and bank accounts a receipt may name (finance's; empty without finance). */
  async paymentAccounts(): Promise<ReceiptMoneyAccount[]> {
    return this.moneyAccounts ? this.moneyAccounts.active(this.db) : [];
  }

  async create(ctx: AuthContext, input: ReceiptInput): Promise<ReceiptDetail> {
    if ((input.lines ?? []).some(hasPrice)) assertCosts(ctx);
    if ((input.lines ?? []).some(hasSalePrice)) assertPrices(ctx);
    return inTransaction(this.db, async (tx) => {
      const id = await this.createInTx(tx, ctx, input);
      return this.get(id, tx);
    });
  }

  async createInTx(tx: Tx, actor: Actor, input: ReceiptInput): Promise<number> {
    await this.suppliers.assertActive(tx, input.supplierId);
    const paymentMethod = input.paymentMethod ?? 'CREDIT';
    const moneyAccountId = await this.checkPayment(tx, paymentMethod, input.moneyAccountId);
    const supplierDocDate = input.supplierDocDate ?? null;
    const [row] = await tx
      .insert(goodsReceipts)
      .values({
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
    for (const line of input.lines ?? []) await this.insertLine(tx, actor, row, line);
    await this.audit.record(tx, actor, {
      action: 'CREATE',
      entity: 'goods_receipts',
      entityId: row.id,
      after: row,
    });
    return row.id;
  }

  update(_ctx: AuthContext, id: number, patch: ReceiptPatch): Promise<ReceiptDetail> {
    return inTransaction(this.db, async (tx) => {
      const header = await this.lockDraft(tx, id);
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

  /**
   * A draft's discounts, replaced as a whole (ADR-0101, cost holders): line discounts name lines of
   * this receipt that are not free goods; at most one note discount. Whether a discount fits its
   * lines is checked by the posting and the costing (the prices may come later).
   */
  setDiscounts(
    ctx: AuthContext,
    id: number,
    discounts: readonly ReceiptDiscountRequest[],
  ): Promise<ReceiptDetail> {
    assertCosts(ctx);
    return inTransaction(this.db, async (tx) => {
      await this.lockDraft(tx, id);
      await this.writeDiscounts(tx, id, await this.linesOf(tx, id), discounts);
      await this.touch(tx, id);
      return this.get(id, tx);
    });
  }

  addLine(ctx: AuthContext, receiptId: number, line: ReceiptLineInput): Promise<ReceiptDetail> {
    if (hasPrice(line)) assertCosts(ctx);
    if (hasSalePrice(line)) assertPrices(ctx);
    return inTransaction(this.db, async (tx) => {
      const header = await this.lockDraft(tx, receiptId);
      await this.insertLine(tx, ctx, header, line);
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
    if (patch.salePrice !== undefined) assertPrices(ctx);
    return inTransaction(this.db, async (tx) => {
      const { header, line } = await this.lockLine(tx, lineId);
      const enteredQty = patch.enteredQty ?? line.enteredQty;
      const converted = await this.units.toBase(line.productUnitId, enteredQty, tx);
      const salePrice = patch.salePrice === undefined ? line.salePrice : patch.salePrice;
      if (salePrice !== null) assertSalePrice(salePrice);
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
          ...priced,
          salePrice,
          updatedAt: sql`now()`,
        })
        .where(eq(goodsReceiptLines.id, lineId));
      await this.touch(tx, header.id);
      return this.get(header.id, tx);
    });
  }

  removeLine(ctx: AuthContext, lineId: number): Promise<ReceiptDetail> {
    return inTransaction(this.db, async (tx) => {
      const { header } = await this.lockLine(tx, lineId);
      await tx.delete(goodsReceiptLines).where(eq(goodsReceiptLines.id, lineId));
      // A line discount whose last line went goes with it (ADR-0101).
      await tx.execute(sql`
        DELETE FROM goods_receipt_discounts d
         WHERE d.receipt_id = ${header.id} AND d.kind = 'LINES'
           AND NOT EXISTS (SELECT 1 FROM goods_receipt_discount_lines l WHERE l.discount_id = d.id)`);
      await this.touch(tx, header.id);
      return this.get(header.id, tx);
    });
  }

  /**
   * DRAFT → POSTED: stock arrives in each line's bin, in its warehouse, at the provisional cost
   * (ADR-0033); the lines' sale prices come into force from the posting's business date (ADR-0099
   * #5); a receipt whose every line has its price or is free is costed at once from those prices,
   * less its discounts (ADR-0078 #3, ADR-0101); each product not yet linked to the supplier is
   * linked to it (ADR-0101).
   */
  post(ctx: AuthContext, id: number): Promise<ReceiptDetail> {
    return inTransaction(this.db, async (tx) => {
      const header = await this.lockHeader(tx, id);
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
      // A home moved since the line was entered refuses the posting (PRODUCT_NOT_IN_WAREHOUSE).
      for (const warehouseId of new Set(lines.map((line) => line.warehouseId))) {
        await this.locations.assertMayReceive(
          tx,
          warehouseId,
          lines.filter((line) => line.warehouseId === warehouseId).map((line) => line.productId),
        );
      }
      const salePrices = salePricesOf(lines);
      const priced = lines.every((line) => line.freeGoods || line.docAmount !== null);
      const shares = priced
        ? sharesOf(lineAmounts(lines), await this.discountsOf(tx, id)).shares
        : null;
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
          warehouseId: line.warehouseId,
          binId: line.binId,
          productId: line.productId,
          lotId: line.lotId,
          qtyBase: line.qtyBase,
          enteredQty: line.enteredQty,
          productUnitId: line.productUnitId,
          factorSnapshot: line.factorSnapshot,
        })),
      });
      if (salePrices.length > 0 && this.salePrices) {
        await this.salePrices.applyInTx(tx, ctx, result.effectiveDate, salePrices);
      }
      await this.linkSupplierInTx(tx, ctx, header.supplierId, lines);
      if (shares) {
        const rates = await this.lineVatRates(tx, lines, vatRatePct);
        await this.posting.revalue(tx, ctx, {
          docId: id,
          version: 1,
          lines: lines.map((line) => {
            const share = shares.get(line.id) ?? new Decimal(0);
            return {
              docLineId: line.id,
              warehouseId: line.warehouseId,
              productId: line.productId,
              lotId: line.lotId,
              qtyBase: line.qtyBase,
              amount: line.freeGoods
                ? new Decimal(0)
                : receiptLineCost(
                    (line.docAmount ?? new Decimal(0)).minus(share),
                    rates.get(line.id) ?? 0,
                  ),
              docAmount: line.freeGoods ? new Decimal(0) : line.docAmount,
              discountAmount: line.freeGoods ? null : share,
              freeGoods: line.freeGoods,
            };
          }),
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
        await this.purchases.receiptCostedInTx(tx, ctx, await this.bookFacts(id, tx, null));
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
      const header = await this.lockDraft(tx, id);
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
   * form was opened at. The receipt's discounts (ADR-0101) lower the lines' cost; discounts given
   * here replace the receipt's.
   */
  cost(
    ctx: AuthContext,
    id: number,
    input: CostDiscountInput & { costingVersion: number; lines: readonly CostLineInput[] },
  ): Promise<ReceiptCosting> {
    return inTransaction(this.db, async (tx) => {
      const header = await this.lockHeader(tx, id);
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
      // The books take the difference from the version this costing replaces (F3, ADR-0091).
      const previous = version > 1 ? (await this.bookFacts(id, tx, null)).totals : null;
      const typed = new Map(
        lines.map((line) => {
          const cost = given.get(line.id);
          if (!cost) throw new Error(`line ${line.id} not costed`);
          return [line.id, lineAmount(cost, line.enteredQty)];
        }),
      );
      const free = (line: LineRow) => given.get(line.id)?.freeGoods ?? false;
      if (input.discounts !== undefined) {
        // Free goods as this costing has them, not as the draft typed them.
        await this.writeDiscounts(
          tx,
          id,
          lines.map((line) => ({ ...line, freeGoods: free(line) })),
          input.discounts,
        );
      }
      const discounts = await this.discountsOf(tx, id);
      const { shares } = sharesOf(
        lines.map((line) => ({
          id: line.id,
          amount: free(line) ? null : (typed.get(line.id) ?? new Decimal(0)),
        })),
        discounts,
      );
      await this.posting.revalue(tx, ctx, {
        docId: id,
        version,
        lines: lines.map((line) => {
          const docAmount = typed.get(line.id) ?? new Decimal(0);
          const share = free(line) ? null : (shares.get(line.id) ?? new Decimal(0));
          return {
            docLineId: line.id,
            warehouseId: line.warehouseId,
            productId: line.productId,
            lotId: line.lotId,
            qtyBase: line.qtyBase,
            amount: receiptLineCost(docAmount.minus(share ?? 0), rates.get(line.id) ?? 0),
            docAmount,
            discountAmount: share,
            freeGoods: free(line),
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
          discounts,
          lines: lines.map((line) => ({ lineId: line.id, docAmount: typed.get(line.id) ?? null })),
        },
      });
      await this.purchases.receiptCostedInTx(tx, ctx, await this.bookFacts(id, tx, previous));
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
        discountAmount: valuation?.discountAmount ?? null,
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
      discounts: discountViews(
        await this.discountsOf(executor, id),
        costed.map((line) => ({
          id: line.lineId,
          amount: line.freeGoods ? null : line.docAmount,
        })),
      ),
      total: header.costingVersion > 0 ? sum((line) => line.amount) : null,
      docTotal: header.costingVersion > 0 ? sum((line) => line.docAmount) : null,
      lines: costed,
    };
  }

  async get(id: number, executor: Db | Tx = this.db): Promise<ReceiptDetail> {
    const [header] = await executor.select().from(goodsReceipts).where(eq(goodsReceipts.id, id));
    if (!header) throw notFound('goods receipt', id);
    const [supplier] = await this.suppliers.getMany([header.supplierId], executor);
    const rows = await this.linesOf(executor, id);
    const lines = await this.describeLines(executor, rows);
    // A costed receipt shows its latest costing; a draft or a pending one its typed prices, its
    // discounts spread over the lines priced so far (none while one exceeds them).
    const latest = header.costingVersion > 0 ? await this.posting.costingOf(id, executor) : null;
    const rates = await this.lineVatRates(executor, rows, header.vatRatePct);
    const stored = await this.discountsOf(executor, id);
    const typed = latest ? null : trySharesOf(lineAmounts(rows), stored);
    const priced = lines.map((line) => {
      const valuation = latest?.get(line.id);
      const docAmount = valuation ? (valuation.docAmount ?? valuation.amount) : line.docAmount;
      const freeGoods = valuation ? valuation.freeGoods : line.freeGoods;
      const docUnitPrice = valuation
        ? line.enteredQty.isZero()
          ? null
          : (docAmount?.dividedBy(line.enteredQty).toDecimalPlaces(2) ?? null)
        : line.docUnitPrice;
      const discountAmount =
        docAmount === null || freeGoods
          ? null
          : valuation
            ? (valuation.discountAmount ?? new Decimal(0))
            : (typed?.shares.get(line.id) ?? new Decimal(0));
      const netAmount = docAmount === null ? null : docAmount.minus(discountAmount ?? 0);
      const vatAmount =
        netAmount === null ? null : receiptLineVat(netAmount, rates.get(line.id) ?? 0);
      return {
        ...line,
        docUnitPrice,
        docAmount,
        freeGoods,
        discountAmount,
        netAmount,
        vatAmount,
        costAmount: netAmount === null || vatAmount === null ? null : netAmount.minus(vatAmount),
      };
    });
    const zero = new Decimal(0);
    const sum = (pick: (line: (typeof priced)[number]) => Decimal | null) =>
      priced.reduce((total, line) => total.plus(pick(line) ?? 0), zero);
    const docTotal = sum((line) => line.docAmount);
    const discountTotal = sum((line) => line.discountAmount);
    const views = discountViews(
      stored,
      priced.map((line) => ({ id: line.id, amount: line.freeGoods ? null : line.docAmount })),
    );
    const warehouses = [
      ...new Map(lines.map((line) => [line.warehouseId, line.warehouseName])).entries(),
    ]
      .map(([warehouseId, name]) => ({ id: warehouseId, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const accountName =
      header.moneyAccountId === null
        ? null
        : ((await this.paymentAccounts()).find((account) => account.id === header.moneyAccountId)
            ?.name ?? null);
    return {
      id: header.id,
      number: header.number,
      warehouses,
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
      discounts: views,
      effectiveDate: header.effectiveDate,
      postedAt: header.postedAt,
      createdAt: header.createdAt,
      updatedAt: header.updatedAt,
      lines: priced,
      totals: {
        docTotal,
        discountTotal,
        discountTooLarge: stored.length > 0 && !latest && typed === null,
        netTotal: docTotal.minus(discountTotal),
        vatTotal: sum((line) => line.vatAmount),
        costTotal: sum((line) => line.costAmount),
        pricedLines: priced.filter((line) => line.freeGoods || line.docAmount !== null).length,
        weightKg: sum((line) => (line.weightKg ? line.weightKg.times(line.qtyBase) : null)),
        weightMissing: priced.filter((line) => line.weightKg === null).length,
      },
    };
  }

  /**
   * Each product's latest delivery-note price (ADR-0099 #3): its line on the newest posted receipt
   * that has a price, from any supplier — the latest costing's amount, else the typed one — per
   * entered unit and per base unit, before the note's discount, VAT included as printed. Cost data.
   */
  async lastPrices(productIds: readonly number[]): Promise<LastReceiptPrice[]> {
    const ids = [...new Set(productIds)];
    if (ids.length === 0) return [];
    const rows = await this.db.execute<{
      line_id: string;
      receipt_id: string;
      number: string;
      product_id: string;
      product_unit_id: string;
      entered_qty: string;
      qty_base: string;
      doc_amount: string | null;
      day: string;
      supplier_id: string;
      costing_version: number;
    }>(sql`
      SELECT DISTINCT ON (l.product_id) l.id AS line_id, r.id AS receipt_id, r.number,
             l.product_id, l.product_unit_id, l.entered_qty, l.qty_base, l.doc_amount,
             coalesce(r.supplier_doc_date, r.effective_date)::text AS day, r.supplier_id,
             r.costing_version
        FROM goods_receipt_lines l
        JOIN goods_receipts r ON r.id = l.receipt_id
       WHERE l.product_id IN (${sql.join(
         ids.map((id) => sql`${id}`),
         sql`, `,
       )})
         AND r.status = 'POSTED' AND NOT l.free_goods
         AND (l.doc_amount IS NOT NULL OR r.costing_status = 'COSTED')
       ORDER BY l.product_id, coalesce(r.supplier_doc_date, r.effective_date) DESC, r.id DESC,
                l.id DESC`);
    const costings = new Map<number, Awaited<ReturnType<StockPostingService['costingOf']>>>();
    for (const receiptId of new Set(
      rows.rows.filter((row) => row.costing_version > 0).map((row) => int(row.receipt_id)),
    )) {
      costings.set(receiptId, await this.posting.costingOf(receiptId));
    }
    const units = await this.units.describe(rows.rows.map((row) => int(row.product_unit_id)));
    const suppliers = new Map(
      (
        await this.suppliers.getMany([...new Set(rows.rows.map((row) => int(row.supplier_id)))])
      ).map((supplier) => [supplier.id, supplier.name]),
    );
    return rows.rows.flatMap((row) => {
      const valuation = costings.get(int(row.receipt_id))?.get(int(row.line_id));
      if (valuation?.freeGoods) return [];
      const amount = valuation
        ? (valuation.docAmount ?? valuation.amount)
        : row.doc_amount === null
          ? null
          : new Decimal(row.doc_amount);
      if (amount === null) return [];
      const enteredQty = new Decimal(row.entered_qty);
      const qtyBase = new Decimal(row.qty_base);
      return [
        {
          productId: int(row.product_id),
          receiptId: int(row.receipt_id),
          receiptNumber: row.number,
          date: row.day,
          supplierName: suppliers.get(int(row.supplier_id)) ?? '',
          unitName: units.get(int(row.product_unit_id))?.uomName ?? '',
          unitPrice: amount.dividedBy(enteredQty).toDecimalPlaces(2),
          basePrice: amount.dividedBy(qtyBase).toDecimalPlaces(2),
        },
      ];
    });
  }

  async list(query: ReceiptQuery): Promise<{ data: ReceiptSummary[]; nextCursor: string | null }> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const filters: SQL[] = [];
    // Spelled out: Drizzle leaves the columns of a single-table select unqualified.
    if (query.warehouseId) {
      filters.push(
        sql`EXISTS (SELECT 1 FROM goods_receipt_lines l WHERE l.receipt_id = goods_receipts.id AND l.warehouse_id = ${query.warehouseId})`,
      );
    }
    if (query.productId) {
      filters.push(
        sql`EXISTS (SELECT 1 FROM goods_receipt_lines l WHERE l.receipt_id = goods_receipts.id AND l.product_id = ${query.productId})`,
      );
    }
    const day = sql`coalesce(goods_receipts.supplier_doc_date, goods_receipts.effective_date)`;
    if (query.from) filters.push(sql`${day} >= ${query.from}::date`);
    if (query.to) filters.push(sql`${day} <= ${query.to}::date`);
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
        supplierId: goodsReceipts.supplierId,
        supplierDocNo: goodsReceipts.supplierDocNo,
        supplierDocDate: goodsReceipts.supplierDocDate,
        status: goodsReceipts.status,
        costingStatus: goodsReceipts.costingStatus,
        costingVersion: goodsReceipts.costingVersion,
        paymentMethod: goodsReceipts.paymentMethod,
        effectiveDate: goodsReceipts.effectiveDate,
        createdAt: goodsReceipts.createdAt,
        // Spelled out: Drizzle leaves columns of a single-table select unqualified, and a bare "id"
        // inside the subquery would mean the line’s own id.
        lineCount: sql<string>`(SELECT count(*) FROM goods_receipt_lines l WHERE l.receipt_id = goods_receipts.id)`,
        typedTotal: sql<
          string | null
        >`(SELECT sum(l.doc_amount) FROM goods_receipt_lines l WHERE l.receipt_id = goods_receipts.id)`,
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
    const payables = await this.posting.receiptPayables(
      page.data.filter((row) => row.costingVersion > 0).map((row) => row.id),
    );
    const drafts = await this.typedPayables(
      page.data.filter((row) => row.costingVersion === 0).map((row) => row.id),
    );
    return {
      data: page.data.map(({ costingVersion, typedTotal, ...row }) => ({
        ...row,
        lineCount: Number.parseInt(row.lineCount, 10),
        supplierName: suppliers.get(row.supplierId)?.name ?? '',
        netAmount:
          costingVersion > 0
            ? (payables.get(row.id) ?? new Decimal(0))
            : typedTotal === null
              ? null
              : (drafts.get(row.id) ?? new Decimal(typedTotal)),
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
  private vatRateOf(
    executor: Db | Tx,
    supplierId: number,
    onDate: string | null,
  ): Promise<Decimal> {
    return this.purchases.supplierRate(executor, supplierId, onDate);
  }

  /** Each line's VAT rate: the receipt's for a product that carries VAT, 0 for an exempt one. */
  private lineVatRates(
    executor: Db | Tx,
    lines: readonly LineRow[],
    receiptRate: Decimal,
  ): Promise<Map<number, Decimal>> {
    return this.purchases.lineRates(executor, lines, receiptRate);
  }

  /** The posted, costed receipts, oldest first (the development re-post of their bills, F3). */
  async postedCostedIds(): Promise<number[]> {
    const rows = await this.db
      .select({ id: goodsReceipts.id })
      .from(goodsReceipts)
      .where(and(eq(goodsReceipts.status, 'POSTED'), eq(goodsReceipts.costingStatus, 'COSTED')))
      .orderBy(goodsReceipts.id);
    return rows.map((row) => row.id);
  }

  /**
   * A posted, costed receipt's figures for the books at its latest costing version (F3, ADR-0091):
   * the payable Σ delivery-note amounts, the stock Σ ex-VAT costs, the VAT their difference and its
   * base the stock of the lines that carry VAT. `previous`: the replaced version's totals.
   */
  async bookFacts(
    id: number,
    executor: Db | Tx = this.db,
    previous: ReceiptBookTotals | null = null,
  ): Promise<ReceiptBookFacts> {
    const [header] = await executor.select().from(goodsReceipts).where(eq(goodsReceipts.id, id));
    if (!header) throw notFound('goods receipt', id);
    if (header.status !== 'POSTED' || header.costingVersion === 0 || header.number === null) {
      throw new Error(`receipt ${id} is not posted and costed`);
    }
    const rows = await this.linesOf(executor, id);
    const latest = await this.posting.costingOf(id, executor);
    const rates = await this.lineVatRates(executor, rows, header.vatRatePct);
    const zero = new Decimal(0);
    const totals = { payable: zero, vat: zero, vatBase: zero, stock: zero };
    for (const row of rows) {
      const valuation = latest.get(row.id);
      if (!valuation || valuation.freeGoods) continue;
      const stock = valuation.amount;
      const payable = (valuation.docAmount ?? valuation.amount).minus(
        valuation.discountAmount ?? zero,
      );
      totals.payable = totals.payable.plus(payable);
      totals.stock = totals.stock.plus(stock);
      totals.vat = totals.vat.plus(payable.minus(stock));
      if (!(rates.get(row.id) ?? zero).isZero()) totals.vatBase = totals.vatBase.plus(stock);
    }
    return {
      receiptId: id,
      number: header.number,
      supplierId: header.supplierId,
      date: header.supplierDocDate ?? header.effectiveDate ?? businessDate(),
      version: header.costingVersion,
      totals,
      previous,
    };
  }

  /** A receipt's discounts with the lines of each (ADR-0101), in the order they were added. */
  private async discountsOf(
    executor: Db | Tx,
    receiptId: number,
  ): Promise<(ReceiptDiscountRequest & { id: number })[]> {
    return (await this.discountsOfMany(executor, [receiptId])).get(receiptId) ?? [];
  }

  /** `discountsOf` for several receipts in two statements, by receipt. */
  private async discountsOfMany(
    executor: Db | Tx,
    receiptIds: readonly number[],
  ): Promise<Map<number, (ReceiptDiscountRequest & { id: number })[]>> {
    const byReceipt = new Map<number, (ReceiptDiscountRequest & { id: number })[]>();
    if (receiptIds.length === 0) return byReceipt;
    const rows = await executor
      .select()
      .from(goodsReceiptDiscounts)
      .where(inArray(goodsReceiptDiscounts.receiptId, [...receiptIds]))
      .orderBy(goodsReceiptDiscounts.id);
    if (rows.length === 0) return byReceipt;
    const links = await executor
      .select()
      .from(goodsReceiptDiscountLines)
      .where(
        inArray(
          goodsReceiptDiscountLines.discountId,
          rows.map((row) => row.id),
        ),
      )
      .orderBy(goodsReceiptDiscountLines.lineId);
    for (const row of rows) {
      const list = byReceipt.get(row.receiptId) ?? [];
      list.push({
        id: row.id,
        kind: row.kind,
        pct: row.pct,
        amount: row.amount,
        lineIds: links.filter((link) => link.discountId === row.id).map((link) => link.lineId),
      });
      byReceipt.set(row.receiptId, list);
    }
    return byReceipt;
  }

  /** Replaces a receipt's discounts after checking them against `lines` (those that may take one). */
  private async writeDiscounts(
    tx: Tx,
    receiptId: number,
    lines: readonly LineRow[],
    discounts: readonly ReceiptDiscountRequest[],
  ): Promise<void> {
    const allowed = new Set(lines.filter((line) => !line.freeGoods).map((line) => line.id));
    if (discounts.filter((discount) => discount.kind === 'NOTE').length > 1) {
      throw invalid('discounts', 'oneNote', 'at most one discount on the whole note');
    }
    discounts.forEach((discount, index) => {
      assertDiscountValue(discount, index);
      if (discount.kind === 'LINES') {
        if (discount.lineIds.length === 0) {
          throw invalid(`discounts[${index}].lineIds`, 'required', 'choose the lines');
        }
        if (discount.lineIds.some((lineId) => !allowed.has(lineId))) {
          throw invalid(`discounts[${index}].lineIds`, 'line', 'priced lines of this receipt');
        }
      }
    });
    await tx.delete(goodsReceiptDiscounts).where(eq(goodsReceiptDiscounts.receiptId, receiptId));
    for (const discount of discounts) {
      const [row] = await tx
        .insert(goodsReceiptDiscounts)
        .values({ receiptId, kind: discount.kind, pct: discount.pct, amount: discount.amount })
        .returning({ id: goodsReceiptDiscounts.id });
      if (!row) throw new Error('discount insert returned no row');
      const lineIds = discount.kind === 'LINES' ? [...new Set(discount.lineIds)] : [];
      if (lineIds.length > 0) {
        await tx
          .insert(goodsReceiptDiscountLines)
          .values(lineIds.map((lineId) => ({ discountId: row.id, lineId })));
      }
    }
  }

  /** The payable of drafts and pending receipts: the typed amounts less their discounts. */
  private async typedPayables(receiptIds: readonly number[]): Promise<Map<number, Decimal>> {
    const payables = new Map<number, Decimal>();
    if (receiptIds.length === 0) return payables;
    const rows = await this.db
      .select()
      .from(goodsReceiptLines)
      .where(inArray(goodsReceiptLines.receiptId, [...receiptIds]))
      .orderBy(goodsReceiptLines.id);
    const discounts = await this.discountsOfMany(this.db, receiptIds);
    for (const receiptId of receiptIds) {
      const lines = rows.filter((line) => line.receiptId === receiptId);
      const typed = lines.reduce((sum, line) => sum.plus(line.docAmount ?? 0), new Decimal(0));
      const shares = trySharesOf(lineAmounts(lines), discounts.get(receiptId) ?? []);
      const discount = shares
        ? [...shares.shares.values()].reduce((sum, share) => sum.plus(share), new Decimal(0))
        : new Decimal(0);
      payables.set(receiptId, typed.minus(discount));
    }
    return payables;
  }

  /**
   * Links the receipt's supplier to each of its products not linked to it yet (ADR-0101, owner
   * 2026-10-23), in the posting's transaction; a product's first link becomes its main supplier.
   */
  private async linkSupplierInTx(
    tx: Tx,
    actor: Actor,
    supplierId: number,
    lines: readonly LineRow[],
  ): Promise<void> {
    const linked = new Set(
      await this.links.productIdsWhere({ field: 'supplier', op: 'IN', ids: [supplierId] }, tx),
    );
    const missing = [...new Set(lines.map((line) => line.productId))]
      .filter((productId) => !linked.has(productId))
      .sort((a, b) => a - b);
    // linkManyInTx locks the links and skips pairs another posting linked meanwhile.
    if (missing.length > 0) {
      await this.links.linkManyInTx(
        tx,
        actor,
        missing.map((productId) => ({ productId, supplierId })),
      );
    }
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

  /**
   * A line goes to its product's home warehouse (ADR-0099 #1): a product without one takes the
   * warehouse the line names, which becomes its home (PRODUCT_NO_HOME when none is named); then
   * the product's fixed shelf there, else that warehouse's receiving area.
   */
  private async insertLine(
    tx: Tx,
    actor: Actor,
    header: ReceiptRow,
    line: ReceiptLineInput,
  ): Promise<void> {
    const converted = await this.units.toBase(line.productUnitId, line.enteredQty, tx);
    const productId = converted.productId;
    let warehouseId = (await this.locations.homeOf([productId], tx)).get(productId);
    if (warehouseId === undefined) {
      if (line.warehouseId === undefined || line.warehouseId === null) {
        throw new AppError('PRODUCT_NO_HOME', `product ${productId} has no home warehouse`, {
          productId,
        });
      }
      await this.locations.setHomeInTx(tx, actor, productId, line.warehouseId);
      warehouseId = line.warehouseId;
    }
    // The fixed shelf while it can take goods (not archived, a shelf), else the receiving area.
    const fixedId = (await this.locations.defaultBinOf(warehouseId, [productId], tx)).get(
      productId,
    );
    const fixed = fixedId === undefined ? undefined : await this.bins.get(fixedId, tx);
    const binId =
      fixed && !fixed.archivedAt && SHELF_TYPES.includes(fixed.type)
        ? fixed.id
        : (await this.bins.systemBin(warehouseId, 'RECEIVING', tx)).id;
    const salePrice = line.salePrice ?? null;
    if (salePrice !== null) assertSalePrice(salePrice);
    await tx.insert(goodsReceiptLines).values({
      receiptId: header.id,
      productId,
      productUnitId: converted.unitId,
      enteredQty: line.enteredQty,
      factorSnapshot: converted.factorSnapshot,
      qtyBase: converted.qtyBase,
      warehouseId,
      binId,
      ...priceOf(line, line.enteredQty),
      salePrice,
    });
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
    const warehouseNames = new Map<number, string>();
    for (const warehouseId of new Set(lines.map((line) => line.warehouseId))) {
      warehouseNames.set(warehouseId, (await this.org.getWarehouse(warehouseId, executor)).name);
    }
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
      warehouseId: line.warehouseId,
      warehouseName: warehouseNames.get(line.warehouseId) ?? '',
      binId: line.binId,
      binCode: binCodes.get(line.binId) ?? '',
      lotId: line.lotId,
      weightKg: products.get(line.productId)?.weightKg ?? null,
      salePrice: line.salePrice,
      docUnitPrice: line.docUnitPrice,
      docAmount: line.docAmount,
      freeGoods: line.freeGoods,
      discountAmount: null,
      netAmount: null,
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

  /** Any holder of the receipt right writes a draft, whatever their warehouse scope (ADR-0099 #2). */
  private async lockDraft(tx: Tx, id: number): Promise<ReceiptRow> {
    const header = await this.lockHeader(tx, id);
    assertDraft(header);
    return header;
  }

  /** The line's receipt header is locked before the line is read again (ADR-0034 #1). */
  private async lockLine(tx: Tx, lineId: number): Promise<{ header: ReceiptRow; line: LineRow }> {
    const [peek] = await tx
      .select({ receiptId: goodsReceiptLines.receiptId })
      .from(goodsReceiptLines)
      .where(eq(goodsReceiptLines.id, lineId));
    if (!peek) throw notFound('receipt line', lineId);
    const header = await this.lockDraft(tx, peek.receiptId);
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

/** A bigint column read as text by a raw query. */
const int = (value: string) => Number.parseInt(value, 10);

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

/** A new sale price is a price change (ADR-0099 #5): only a price holder types it. */
function assertPrices(ctx: AuthContext): void {
  if (!ctx.permissions.has(PRICES)) {
    throw new AppError('FORBIDDEN', 'sale prices are set by price holders', {
      permission: PRICES,
    });
  }
}

function hasSalePrice(line: ReceiptLineInput): boolean {
  return line.salePrice !== undefined && line.salePrice !== null;
}

/** A warehouse price per base unit: whole tugriks above zero (as `product_prices`). */
function assertSalePrice(value: Decimal): void {
  if (!value.gt(0) || !value.isInteger()) {
    throw invalid('salePrice', 'wholeMnt', 'a whole number of tugriks above zero');
  }
}

/** A discount's value: a percentage in (0, 100] with two decimals, or an amount above zero. */
function assertDiscountValue(discount: ReceiptDiscountRequest, index: number): void {
  const { pct, amount } = discount;
  if ((pct === null) === (amount === null)) {
    throw invalid(`discounts[${index}].amount`, 'oneOf', 'a percentage or an amount');
  }
  if (pct !== null && (!pct.gt(0) || pct.gt(100) || pct.decimalPlaces() > 2)) {
    throw invalid(`discounts[${index}].pct`, 'percent', 'a percentage above 0 and at most 100');
  }
  if (amount !== null && (!amount.gt(0) || amount.decimalPlaces() > 2)) {
    throw invalid(`discounts[${index}].amount`, 'money', 'an amount above zero');
  }
}

/** The lines' amounts as the allocation takes them: free goods and unpriced lines take none. */
function lineAmounts(lines: readonly LineRow[]): { id: number; amount: Decimal | null }[] {
  return lines.map((line) => ({ id: line.id, amount: line.freeGoods ? null : line.docAmount }));
}

/**
 * Each line's share of the receipt's discounts and each discount in tugriks (ADR-0101);
 * RECEIPT_DISCOUNT_TOO_LARGE when one exceeds its lines.
 */
function sharesOf(
  lines: readonly { id: number; amount: Decimal | null }[],
  discounts: readonly ReceiptDiscountRequest[],
): { shares: Map<number, Decimal>; totals: Decimal[] } {
  try {
    return allocateReceiptDiscounts(lines, discounts);
  } catch (error) {
    if (!(error instanceof ReceiptDiscountError)) throw error;
    throw new AppError('RECEIPT_DISCOUNT_TOO_LARGE', error.message, {
      discount: error.discount.toFixed(2),
      total: error.base.toFixed(2),
      index: error.index,
    });
  }
}

/** `sharesOf` for a draft's view: null while a discount exceeds its lines. */
function trySharesOf(
  lines: readonly { id: number; amount: Decimal | null }[],
  discounts: readonly ReceiptDiscountRequest[],
): { shares: Map<number, Decimal>; totals: Decimal[] } | null {
  try {
    return sharesOf(lines, discounts);
  } catch (error) {
    if (error instanceof AppError) return null;
    throw error;
  }
}

/** The discounts with their tugriks on these amounts (null throughout while one exceeds its lines). */
function discountViews(
  discounts: readonly (ReceiptDiscountRequest & { id: number })[],
  lines: readonly { id: number; amount: Decimal | null }[],
): ReceiptDiscountView[] {
  const totals = trySharesOf(lines, discounts)?.totals ?? null;
  return discounts.map((discount, index) => ({ ...discount, total: totals?.[index] ?? null }));
}

/**
 * The sale prices a posting puts in force, one per product (ADR-0099 #5): two lines of one product
 * (a box and a piece) must not name different prices.
 */
function salePricesOf(lines: readonly LineRow[]): { productId: number; warehousePrice: Decimal }[] {
  const prices = new Map<number, Decimal>();
  for (const line of lines) {
    if (line.salePrice === null) continue;
    const before = prices.get(line.productId);
    if (before && !before.equals(line.salePrice)) {
      throw invalid('salePrice', 'conflict', 'one sale price per product');
    }
    prices.set(line.productId, line.salePrice);
  }
  return [...prices].map(([productId, warehousePrice]) => ({ productId, warehousePrice }));
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
