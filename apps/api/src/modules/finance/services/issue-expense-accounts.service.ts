import { Inject, Injectable } from '@nestjs/common';
import { businessDate } from '@tugeel/shared/time';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { invalid } from '../../../common/errors/app-error';
import { FinChartService } from '../../../finance-core';
import { POSTING_KEY_OF_ROLE } from '../../fin-bridge';
import { AuditService, type AuthContext } from '../../identity';
import { IssueExpenseTypesService } from '../../inventory';
import { FinBooks } from './fin-books';
import { GlAccountsService } from './gl-accounts.service';
import { issueRoleOf, issueTypeKey } from './stock-books.service';

/** A goods-issue expense type and the account its issues book to (ADR-0106 #3). */
export interface IssueExpenseAccount {
  typeId: number;
  name: string;
  active: boolean;
  /** A seeded type keeps F4's account, changed with its role on «Данс» (ADR-0097). */
  seeded: boolean;
  /** Its own account; false: the issues book to «бусад» (ISSUE_OTHER). */
  own: boolean;
  accountId: number | null;
  accountCode: string | null;
  accountName: string | null;
}

/**
 * Which account each goods-issue expense type books to (the owner, 2026-10-24, questionnaire 1.4):
 * the seeded types keep F4's accounts (ADR-0097); a type the admin adds gets an account of its own
 * here, a posting key `ISSUE_TYPE_<id>` with a company-default rule from today, and until then books
 * to «бусад» (ISSUE_OTHER).
 */
@Injectable()
export class IssueExpenseAccountsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly types: IssueExpenseTypesService,
    private readonly accounts: GlAccountsService,
    private readonly chart: FinChartService,
    private readonly books: FinBooks,
  ) {}

  async list(): Promise<IssueExpenseAccount[]> {
    const [types, accounts, rules] = await Promise.all([
      this.types.list(),
      this.accounts.list(),
      this.chart.rules(this.books.source(), {
        company: await this.books.company(),
        on: businessDate(),
      }),
    ]);
    const byId = new Map(accounts.map((account) => [account.id, account]));
    const other = rules.get(POSTING_KEY_OF_ROLE.ISSUE_OTHER.code)?.accountId ?? null;
    return types.map((type) => {
      const role = issueRoleOf(type.code);
      const key = role === null ? issueTypeKey(type.id) : POSTING_KEY_OF_ROLE[role].code;
      const mapped = rules.get(key)?.accountId ?? null;
      const accountId = mapped ?? (role === null ? other : null);
      const account = accountId === null ? undefined : byId.get(accountId);
      return {
        typeId: type.id,
        name: type.name,
        active: type.active,
        seeded: role !== null,
        own: mapped !== null,
        accountId: account?.id ?? null,
        accountCode: account?.code ?? null,
        accountName: account?.name ?? null,
      };
    });
  }

  /** Gives a type that is not seeded its own account from today; null sends it back to «бусад». */
  async setAccount(
    ctx: AuthContext,
    typeId: number,
    accountId: number | null,
  ): Promise<IssueExpenseAccount[]> {
    const type = await this.types.get(typeId);
    if (issueRoleOf(type.code) !== null) {
      throw invalid('typeId', 'seeded', 'a seeded type takes its account with its role');
    }
    await inTransaction(this.db, async (tx) => {
      if (accountId !== null) {
        const account = await this.accounts.get(accountId, tx);
        if (account.status !== 'ACTIVE') {
          throw invalid('accountId', 'active', `account ${account.code} is inactive`);
        }
      }
      const company = await this.books.company();
      const user = this.books.user(ctx);
      const key = issueTypeKey(type.id);
      const today = businessDate();
      const before = (await this.chart.rules(user, { company, on: today, lock: true }, tx)).get(
        key,
      );
      if ((before?.accountId ?? null) === accountId) return;
      await this.chart.defineKeyInTx(tx, user, { company, code: key });
      await this.chart.setRuleInTx(tx, user, { company, key, accountId, effectiveFrom: today });
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'issue_expense_types',
        entityId: type.id,
        before: { accountId: before?.accountId ?? null },
        after: { accountId },
      });
    });
    return this.list();
  }
}
