import type { Db, Tx } from '../../common/db/db.types';

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
