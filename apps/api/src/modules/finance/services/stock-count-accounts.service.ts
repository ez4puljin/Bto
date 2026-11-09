import { Inject, Injectable } from '@nestjs/common';
import { businessDate } from '@tugeel/shared/time';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { invalid } from '../../../common/errors/app-error';
import { FinChartService } from '../../../finance-core';
import { AuditService, type AuthContext } from '../../identity';
import type { StockCountAccount, StockCountAccounts } from '../../inventory';
import { FinBooks } from './fin-books';
import { GlAccountsService } from './gl-accounts.service';

/** The posting key of an account a count's difference may be booked to (ADR-0176 #7). */
export const stockCountKey = (code: string): string => `COUNT_${code}`;

/** An account on the counts' list, as the settings page shows it. */
export interface StockCountAccountRow extends StockCountAccount {
  accountId: number;
}

/**
 * Finance's answer to inventory's `STOCK_COUNT_ACCOUNTS` (ADR-0176 #7): the accounts the approver
 * of a count may send a surplus or a shortage to. Each has its own posting key (`COUNT_<code>`)
 * with a company rule, so the source still names a key and never an account (ADR-0071). The list
 * is kept by a holder of `finance.settings.manage`; with no account chosen a difference books to
 * the loss and gain accounts as before (ADR-0097).
 */
@Injectable()
export class StockCountAccountsService implements StockCountAccounts {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly accounts: GlAccountsService,
    private readonly chart: FinChartService,
    private readonly books: FinBooks,
  ) {}

  async list(executor?: Db | Tx): Promise<StockCountAccountRow[]> {
    const rules = await this.chart.rules(
      this.books.source(),
      { company: await this.books.company(), on: businessDate() },
      this.books.executor(executor),
    );
    return (await this.accounts.list(executor))
      .filter(
        (account) =>
          account.status === 'ACTIVE' &&
          rules.get(stockCountKey(account.code))?.accountId === account.id,
      )
      .sort((a, b) => a.code.localeCompare(b.code))
      .map(({ id, code, name }) => ({ accountId: id, code, name }));
  }

  async active(executor?: Db | Tx): Promise<StockCountAccount[]> {
    return (await this.list(executor)).map(({ code, name }) => ({ code, name }));
  }

  async assertUsable(tx: Tx, code: string): Promise<StockCountAccount> {
    const account = (await this.active(tx)).find((row) => row.code === code);
    if (!account) {
      throw invalid('accountCode', 'exists', `${code} is not a count difference account`);
    }
    return account;
  }

  /** Puts an account on the list from today. */
  add(ctx: AuthContext, accountId: number): Promise<StockCountAccountRow[]> {
    return this.set(ctx, accountId, true);
  }

  /** Takes an account off the list from today; what was posted to it stays. */
  remove(ctx: AuthContext, accountId: number): Promise<StockCountAccountRow[]> {
    return this.set(ctx, accountId, false);
  }

  private async set(
    ctx: AuthContext,
    accountId: number,
    listed: boolean,
  ): Promise<StockCountAccountRow[]> {
    await inTransaction(this.db, async (tx) => {
      const account = await this.accounts.get(accountId, tx);
      if (listed && account.status !== 'ACTIVE') {
        throw invalid('accountId', 'active', `account ${account.code} is inactive`);
      }
      const company = await this.books.company();
      const view = (
        await this.chart.accountsByIds(
          this.books.source(),
          { company, ids: [account.id] },
          this.books.executor(tx),
        )
      ).get(account.id);
      // A money or party account takes lines only with its money account or party.
      if (listed && view?.control !== 'NONE') {
        throw invalid('accountId', 'control', `account ${account.code} is a control account`);
      }
      const user = this.books.user(ctx);
      const key = stockCountKey(account.code);
      const today = businessDate();
      const before = (await this.chart.rules(user, { company, on: today, lock: true }, tx)).get(
        key,
      );
      const was = before?.accountId === account.id;
      if (was === listed) return;
      await this.chart.defineKeyInTx(tx, user, { company, code: key });
      await this.chart.setRuleInTx(tx, user, {
        company,
        key,
        accountId: listed ? account.id : null,
        effectiveFrom: today,
      });
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'gl_accounts',
        entityId: account.id,
        before: { stockCountAccount: was },
        after: { stockCountAccount: listed },
      });
    });
    return this.list();
  }
}
