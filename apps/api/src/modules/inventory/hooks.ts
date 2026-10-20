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
