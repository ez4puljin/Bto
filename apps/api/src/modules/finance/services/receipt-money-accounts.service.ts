import { Injectable } from '@nestjs/common';
import type { Db, Tx } from '../../../common/db/db.types';
import { invalid } from '../../../common/errors/app-error';
import type {
  ReceiptMoneyAccount,
  ReceiptMoneyAccountKind,
  ReceiptMoneyAccounts,
} from '../../inventory';
import { MoneyAccountsService } from './money-accounts.service';

/**
 * Finance's answer to inventory's `RECEIPT_MONEY_ACCOUNTS` (ADR-0078): the cash boxes and bank
 * accounts a goods receipt may say it was paid from. Nothing is booked here; the payable or the
 * voucher is the Finance Core's (ADR-0077).
 */
@Injectable()
export class ReceiptMoneyAccountsService implements ReceiptMoneyAccounts {
  constructor(private readonly accounts: MoneyAccountsService) {}

  async active(executor?: Db | Tx): Promise<ReceiptMoneyAccount[]> {
    return (await this.accounts.list(executor))
      .filter((account) => account.status === 'ACTIVE')
      .sort((a, b) => a.kind.localeCompare(b.kind) || a.code.localeCompare(b.code))
      .map(({ id, code, name, kind }) => ({ id, code, name, kind }));
  }

  async assertUsable(
    tx: Tx,
    id: number,
    kind: ReceiptMoneyAccountKind,
  ): Promise<ReceiptMoneyAccount> {
    const account = await this.accounts.lockActive(tx, id);
    if (account.kind !== kind) {
      throw invalid('moneyAccountId', 'kind', `money account ${id} is not a ${kind} account`);
    }
    return { id: account.id, code: account.code, name: account.name, kind: account.kind };
  }
}
