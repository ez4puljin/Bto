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
 * A receipt's figures for the books at one costing version (ADR-0078 #4, F3 ADR-0091): the payable
 * is Σ `doc_amount` (the delivery note, VAT included), the stock Σ `amount` (ex-VAT cost), the
 * input VAT their difference, its base the stock of the lines that carry VAT.
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
}

/** A goods issue to a supplier (a supplier return, ADR-0081) at the average cost, with its VAT. */
export interface SupplierReturnFacts {
  issueId: number;
  number: string;
  supplierId: number;
  date: string;
  cost: Decimal;
  vat: Decimal;
  vatBase: Decimal;
}

/**
 * What inventory tells the books about purchases (F3, ADR-0091): a receipt's bill or a re-costing's
 * difference, and a supplier return, inside the posting's transaction (a refusal rolls it back).
 * Finance binds it with `useExisting`; nothing is booked when nothing is bound (the worker, tests
 * that load inventory alone).
 */
export interface PurchaseBooks {
  receiptCostedInTx(tx: Tx, actor: Actor, facts: ReceiptBookFacts): Promise<void>;
  supplierReturnPostedInTx(tx: Tx, actor: Actor, facts: SupplierReturnFacts): Promise<void>;
}

export const PURCHASE_BOOKS = Symbol('PURCHASE_BOOKS');

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
  value: Decimal;
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
}

/** A receipt's costing: what moved the stock's value and what had already left (the variance). */
export interface StockRevaluedFacts {
  receiptId: number;
  number: string | null;
  version: number;
  date: string;
  absorbed: Decimal;
  variance: Decimal;
}

/**
 * The stock's value in the books (F4, ADR-0097): every posting and every receipt costing, inside
 * the posting's transaction (a refusal rolls it back). Finance binds it with `useExisting`; nothing
 * is booked when nothing is bound (tests that load inventory alone).
 */
export interface StockBooks {
  stockPostedInTx(tx: Tx, actor: Actor, facts: StockPostedFacts): Promise<void>;
  stockRevaluedInTx(tx: Tx, actor: Actor, facts: StockRevaluedFacts): Promise<void>;
}

export const STOCK_BOOKS = Symbol('STOCK_BOOKS');
