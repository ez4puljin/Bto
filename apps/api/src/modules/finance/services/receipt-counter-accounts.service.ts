import { Injectable } from '@nestjs/common';
import { businessDate } from '@tugeel/shared/time';
import type { Db, Tx } from '../../../common/db/db.types';
import { invalid } from '../../../common/errors/app-error';
import { FinChartService } from '../../../finance-core';
import { POSTING_KEY_OF_ROLE } from '../../fin-bridge';
import type { ReceiptCounterAccount, ReceiptCounterAccounts } from '../../inventory';
import { FinBooks } from './fin-books';
import { GlAccountsService } from './gl-accounts.service';
import { isReceiptCounterCode, receiptCounterKey } from './receipt-counter-key';

/**
 * Finance's answer to inventory's `RECEIPT_COUNTER_ACCOUNTS` (owner 2026-11-05, ADR-0154): the
 * accounts a goods receipt's bill may credit, each with its own posting key (`AP_<code>`), so a
 * source still names a key and never an account (ADR-0071). The default is the account of the key AP.
 */
@Injectable()
export class ReceiptCounterAccountsService implements ReceiptCounterAccounts {
  constructor(
    private readonly accounts: GlAccountsService,
    private readonly chart: FinChartService,
    private readonly books: FinBooks,
  ) {}

  async active(executor?: Db | Tx): Promise<ReceiptCounterAccount[]> {
    const rules = await this.chart.rules(
      this.books.source(),
      { company: await this.books.company(), on: businessDate() },
      this.books.executor(executor),
    );
    const payable = rules.get(POSTING_KEY_OF_ROLE.AP.code)?.accountId ?? null;
    return (await this.accounts.list(executor))
      .filter(
        (account) =>
          account.status === 'ACTIVE' &&
          (account.id === payable ||
            (isReceiptCounterCode(account.code) &&
              rules.get(receiptCounterKey(account.code))?.accountId === account.id)),
      )
      .sort((a, b) => a.code.localeCompare(b.code))
      .map(({ id, code, name }) => ({ code, name, isDefault: id === payable }));
  }

  async assertUsable(tx: Tx, code: string): Promise<ReceiptCounterAccount> {
    const account = (await this.active(tx)).find((row) => row.code === code);
    if (!account) {
      throw invalid('counterAccountCode', 'exists', `${code} is not a receipt's counter account`);
    }
    return account;
  }
}
