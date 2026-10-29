import type { Decimal } from '@tugeel/shared/money';
import type { Db, Tx } from '../../common/db/db.types';
import type { Actor } from '../identity';

/**
 * What inventory asks of finance (ADR-0078): a receipt paid in cash or by bank names a money
 * account, which finance owns. Finance binds this token with `useExisting`; `ReceiptsService`
 * resolves it through `ModuleRef` (`strict: false`) and accepts no account when nothing is bound
 * (the worker, tests that load inventory alone).
 */

export type ReceiptMoneyAccountKind = 'CASH' | 'BANK';

export interface ReceiptMoneyAccount {
  id: number;
  code: string;
  name: string;
  kind: ReceiptMoneyAccountKind;
}

export interface ReceiptMoneyAccounts {
  /** The active cash boxes and bank accounts, by kind then code. */
  active(executor?: Db | Tx): Promise<ReceiptMoneyAccount[]>;
  /** Refuses an unknown or inactive account, or one of the other kind (422 `moneyAccountId`). */
  assertUsable(tx: Tx, id: number, kind: ReceiptMoneyAccountKind): Promise<ReceiptMoneyAccount>;
}

export const RECEIPT_MONEY_ACCOUNTS = Symbol('RECEIPT_MONEY_ACCOUNTS');

/**
 * What inventory asks of pricing (ADR-0099 #5): a receipt line may carry a new warehouse price per
 * base unit, put in force by the receipt's posting from its business date, in the posting's
 * transaction. Pricing binds this token with `useExisting`; with nothing bound (the worker, tests
 * that load inventory alone) a receipt's sale prices are not applied.
 */
export interface ReceiptSalePrice {
  productId: number;
  /** Whole MNT per base unit, VAT included. */
  warehousePrice: Decimal;
}

export interface ReceiptSalePrices {
  /**
   * Puts each price in force from `validFrom`, keeping the profile and whole unit of the terms in
   * force; a price equal to the one in force writes nothing. SALE_PRICE_NO_TERMS for a product
   * without terms in force (its first terms are set on the price page).
   */
  applyInTx(
    tx: Tx,
    actor: Actor,
    validFrom: string,
    prices: readonly ReceiptSalePrice[],
  ): Promise<void>;
}

export const RECEIPT_SALE_PRICES = Symbol('RECEIPT_SALE_PRICES');

/**
 * A receipt's figures for the books at one costing version (ADR-0078 #4, F3 ADR-0091): the payable
 * is Σ `doc_amount` less each line's share of the note's discount (VAT included, ADR-0099 #4), the
 * stock Σ `amount` (ex-VAT cost), the input VAT their difference, its base the stock of the lines
 * that carry VAT.
 */
export interface ReceiptBookTotals {
  payable: Decimal;
  vat: Decimal;
  vatBase: Decimal;
  stock: Decimal;
}

/** A receipt that got its prices (version 1) or was costed again (version n ≥ 2, with n − 1's). */
export interface ReceiptBookFacts {
  receiptId: number;
  number: string;
  supplierId: number;
  /** The delivery note's date, else the posting's business date. */
  date: string;
  version: number;
  totals: ReceiptBookTotals;
  previous: ReceiptBookTotals | null;
  /** The document's warehouses: the books tag it with their branch when they share one (ADR-0106 #4). */
  warehouseIds: number[];
}

/**
 * A goods issue to a supplier (a supplier return, ADR-0081) at the average cost, with its VAT. Since
 * ADR-0117 one part per confirmed warehouse: `docId` is the books' identity of the part
 * (`<issue>:<warehouse>`; the plain issue id for an issue posted before, in one step).
 */
export interface SupplierReturnFacts {
  issueId: number;
  /** The part's identity in the books. */
  docId: string;
  /** The document number the books show for the part (`GI-…/<warehouse code>`). */
  docNo: string;
  supplierId: number;
  date: string;
  cost: Decimal;
  vat: Decimal;
  vatBase: Decimal;
  /** The document's warehouses: the books tag it with their branch when they share one (ADR-0106 #4). */
  warehouseIds: number[];
}

/**
 * What inventory tells the books about purchases (F3, ADR-0091): a receipt's bill or a re-costing's
 * difference, and a supplier return, inside the posting's transaction (a refusal rolls it back).
 * Finance binds it with `useExisting`; nothing is booked when nothing is bound (the worker, tests
 * that load inventory alone). A correction (ADR-0117 #5) reverses the corrected part's credit by
 * its `docId` before the new part is booked.
 */
export interface PurchaseBooks {
  receiptCostedInTx(tx: Tx, actor: Actor, facts: ReceiptBookFacts): Promise<void>;
  supplierReturnPostedInTx(tx: Tx, actor: Actor, facts: SupplierReturnFacts): Promise<void>;
  supplierReturnReversedInTx(tx: Tx, actor: Actor, docId: string, reason: string): Promise<void>;
}

export const PURCHASE_BOOKS = Symbol('PURCHASE_BOOKS');

/**
 * What inventory tells procurement about a receipt a purchase order made (ADR-0115): the keepers'
 * last confirmation posted it («Нягтлан шалгаж»), the accountant's price check costed it for the
 * first time («Орлого авсан»). Procurement binds it with `useExisting`; inside the posting's or the
 * costing's transaction; nothing happens when nothing is bound or the receipt has no order.
 */
export interface ReceiptProgress {
  receiptPostedInTx(tx: Tx, actor: Actor, receiptId: number): Promise<void>;
  receiptCostedInTx(tx: Tx, actor: Actor, receiptId: number): Promise<void>;
}

export const RECEIPT_PROGRESS = Symbol('RECEIPT_PROGRESS');

/**
 * What a stock line does to the books (F4, ADR-0097; TODO-VERIFY D8): goods received (before or
 * with their bill), sold or taken back from a sale, lost or found, the opening stock, issued for an
 * expense type. Value-neutral moves (transfers, picks, bin moves) book only a non-zero remainder.
 */
export const STOCK_BOOK_KINDS = [
  'RECEIPT',
  'SALE',
  'SALE_RETURN',
  'LOSS',
  'GAIN',
  'OPENING',
  'ISSUE',
] as const;
export type StockBookKind = (typeof STOCK_BOOK_KINDS)[number];

/** One kind's value in a posting: positive when stock came in, negative when it left. */
export interface StockBookLine {
  kind: StockBookKind;
  /** A goods issue's expense type code (null for an admin-added type). */
  issueType?: string | null;
  /** A goods issue's expense type (its own account when finance maps one, ADR-0106 #3). */
  issueTypeId?: number | null;
  value: Decimal;
}

/**
 * A goods issue's party (ADR-0117 #2): the staff member, customer, supplier or typed name the goods
 * went to, carried onto the booking so the account report filters by account and party.
 */
export interface StockBookParty {
  kind: 'USER' | 'CUSTOMER' | 'SUPPLIER' | 'OTHER';
  /** The user, customer or supplier id; null for a typed name. */
  id: number | null;
  name: string;
}

/** A stock posting of one document, valued by the ledger's costs. */
export interface StockPostedFacts {
  docType: string;
  docId: number;
  /** Inventory's own document number; null for another module's document. */
  number: string | null;
  /** The posting's business date. */
  date: string;
  /** The first ledger row of this posting: with the document, its durable identity. */
  firstLedgerId: number;
  lines: StockBookLine[];
  /** The document's warehouses: the books tag it with their branch when they share one (ADR-0106 #4). */
  warehouseIds: number[];
  /** A goods issue's party (ADR-0117 #2); absent on every other document. */
  party?: StockBookParty;
}

/**
 * Damage charged to a person (ADR-0117 #3): one confirmed warehouse's part of a «Хүнд тооцох» issue,
 * priced at the sale price, becomes a receivable on the party; `docId` identifies the part
 * (`<issue>:<warehouse>`) and a correction reverses it by that id.
 */
export interface DamageChargeFacts {
  issueId: number;
  docId: string;
  /** `GI-…/<warehouse code>`, the number the books show. */
  docNo: string;
  /** The posting's business date (the charge is due on it). */
  date: string;
  party: StockBookParty;
  /** Σ sale amounts of the part's lines, whole MNT. */
  amount: Decimal;
  warehouseIds: number[];
}

/** A receipt's costing: what moved the stock's value and what had already left (the variance). */
export interface StockRevaluedFacts {
  receiptId: number;
  number: string | null;
  version: number;
  date: string;
  absorbed: Decimal;
  variance: Decimal;
  /** The document's warehouses: the books tag it with their branch when they share one (ADR-0106 #4). */
  warehouseIds: number[];
}

/**
 * The stock's value in the books (F4, ADR-0097): every posting and every receipt costing, inside
 * the posting's transaction (a refusal rolls it back). Finance binds it with `useExisting`; nothing
 * is booked when nothing is bound (tests that load inventory alone).
 */
export interface StockBooks {
  stockPostedInTx(tx: Tx, actor: Actor, facts: StockPostedFacts): Promise<void>;
  stockRevaluedInTx(tx: Tx, actor: Actor, facts: StockRevaluedFacts): Promise<void>;
  /** A «Хүнд тооцох» part confirmed: the receivable on the party (ADR-0117 #3). */
  damageChargedInTx(tx: Tx, actor: Actor, facts: DamageChargeFacts): Promise<void>;
  /** A correction confirmed: the corrected part's charge reversed (ADR-0117 #5). */
  damageReversedInTx(tx: Tx, actor: Actor, docId: string, reason: string): Promise<void>;
}

export const STOCK_BOOKS = Symbol('STOCK_BOOKS');

/**
 * The sale price of products on a date (ADR-0117 #3): the warehouse price per base unit in force,
 * whole MNT, VAT included, no discount programs. Pricing binds it with `useExisting`; inventory
 * never imports pricing (architecture §4). A product without terms is left out of the map.
 */
export interface SalePriceReader {
  warehousePricesInTx(
    tx: Tx,
    productIds: readonly number[],
    date: string,
  ): Promise<Map<number, Decimal>>;
}

export const SALE_PRICE_READER = Symbol('SALE_PRICE_READER');
