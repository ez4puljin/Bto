import { Inject, Injectable } from '@nestjs/common';
import { businessDate } from '@tugeel/shared/time';
import { eq } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { FinChartService } from '../../../finance-core';
import { POSTING_KEY_OF_ROLE } from '../../fin-bridge';
import { type AuthContext, AuditService } from '../../identity';
import { CustomersService } from '../../partners';
import { customerCounterAccounts } from '../schema';
import { FinBooks } from './fin-books';
import { type GlAccount, GlAccountsService } from './gl-accounts.service';

/** The posting key of an account a customer's VAT waiver debits (ADR-0240 #4). */
export const counterAccountKey = (code: string): string => `VAT_WAIVER_${code}`;

/** The key of a customer without an account of their own: the sales discount's (520201). */
const DEFAULT_KEY = POSTING_KEY_OF_ROLE.SALES_DISCOUNT.code;

/** «Харилцсан данс» of a customer as the page shows it. */
export interface CustomerCounterAccount {
  customerId: number;
  /** False: the customer has none of their own and the sales discount account is used. */
  own: boolean;
  /** The account a waiver would debit now; null when the chart has no sales discount account. */
  account: { id: number; code: string; name: string } | null;
  updatedAt: Date | null;
}

/** What a waiver posts on: the key the intake resolves and the account it lands on. */
export interface ResolvedCounterAccount {
  key: string;
  accountId: number;
  accountCode: string;
  accountName: string;
}

/** Why an account cannot be a customer's counter account, or null when it can (ADR-0240 #7). */
function unusable(account: GlAccount, control: string | undefined): string | null {
  if (account.status !== 'ACTIVE') return 'active';
  // A receivable, payable or advance account takes lines only with a party, a money account only
  // with its cash box or bank account.
  if (control === 'MONEY' || ['CASH', 'BANK', 'MONEY'].includes(account.journal)) return 'money';
  if (control !== 'NONE') return 'control';
  if (account.journal === 'INVENTORY' || account.role === 'INVENTORY') return 'inventory';
  return null;
}

/**
 * The counter account of a customer's VAT waivers (ADR-0240 #4, #6, #7), kept by a holder of
 * `finance.settings.manage` on the customer's finance page. Each chosen account gets its own
 * posting key (`VAT_WAIVER_<code>`) with a company rule, written by that staff member, so the
 * waiver — posted as source BTO by someone who may hold no settings right — names a key and never
 * an account (ADR-0071, ADR-0154). Without an account of their own a customer's waivers debit the
 * sales discount role's account.
 */
@Injectable()
export class CustomerCounterAccountsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly customers: CustomersService,
    private readonly accounts: GlAccountsService,
    private readonly chart: FinChartService,
    private readonly books: FinBooks,
  ) {}

  async get(customerId: number, executor: Db | Tx = this.db): Promise<CustomerCounterAccount> {
    const [customer] = await this.customers.getMany([customerId], executor);
    if (!customer) throw notFound('customer', customerId);
    const [row] = await executor
      .select()
      .from(customerCounterAccounts)
      .where(eq(customerCounterAccounts.customerId, customerId));
    if (row) {
      const account = await this.accounts.get(row.accountId, executor);
      return {
        customerId,
        own: true,
        account: { id: account.id, code: account.code, name: account.name },
        updatedAt: row.updatedAt,
      };
    }
    const fallback = await this.defaultAccount(executor);
    return {
      customerId,
      own: false,
      account: fallback && { id: fallback.id, code: fallback.code, name: fallback.name },
      updatedAt: null,
    };
  }

  /** Sets the customer's account, or with null goes back to the sales discount account. */
  async set(
    ctx: AuthContext,
    customerId: number,
    accountId: number | null,
  ): Promise<CustomerCounterAccount> {
    await inTransaction(this.db, async (tx) => {
      const before = await this.get(customerId, tx);
      if (accountId === null) {
        if (!before.own) return;
        await tx
          .delete(customerCounterAccounts)
          .where(eq(customerCounterAccounts.customerId, customerId));
      } else {
        if (before.own && before.account?.id === accountId) return;
        const account = await this.accounts.get(accountId, tx);
        const reason = unusable(account, await this.controlOf(account.id, tx));
        if (reason) {
          throw invalid(
            'counterAccount',
            reason,
            `account ${account.code} cannot be a counter account`,
          );
        }
        const company = await this.books.company();
        const user = this.books.user(ctx);
        const key = counterAccountKey(account.code);
        const today = businessDate();
        const rule = (await this.chart.rules(user, { company, on: today, lock: true }, tx)).get(
          key,
        );
        if (rule?.accountId !== account.id) {
          await this.chart.defineKeyInTx(tx, user, { company, code: key });
          await this.chart.setRuleInTx(tx, user, {
            company,
            key,
            accountId: account.id,
            effectiveFrom: today,
          });
        }
        await tx
          .insert(customerCounterAccounts)
          .values({ customerId, accountId: account.id, updatedBy: ctx.userId })
          .onConflictDoUpdate({
            target: customerCounterAccounts.customerId,
            set: { accountId: account.id, updatedBy: ctx.userId, updatedAt: new Date() },
          });
      }
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'customer_counter_accounts',
        entityId: customerId,
        before: { accountId: before.own ? (before.account?.id ?? null) : null },
        after: { accountId },
      });
    });
    return this.get(customerId);
  }

  /**
   * What a waiver of this customer debits, inside the waiver's transaction: the customer's own
   * account while it still may take the line and its key still points at it (422 otherwise: the
   * account was switched off or changed kind since it was chosen), else the sales discount role's
   * (409 `ACCOUNT_ROLE_MISSING` when the chart has none).
   */
  async resolveInTx(tx: Tx, customerId: number): Promise<ResolvedCounterAccount> {
    const [row] = await tx
      .select({ accountId: customerCounterAccounts.accountId })
      .from(customerCounterAccounts)
      .where(eq(customerCounterAccounts.customerId, customerId));
    if (!row) {
      const account = await this.accounts.byRole('SALES_DISCOUNT', tx);
      return {
        key: DEFAULT_KEY,
        accountId: account.id,
        accountCode: account.code,
        accountName: account.name,
      };
    }
    const account = await this.accounts.get(row.accountId, tx);
    const key = counterAccountKey(account.code);
    const rule = (
      await this.chart.rules(
        this.books.source(),
        { company: await this.books.company(), on: businessDate() },
        tx,
      )
    ).get(key);
    const reason =
      unusable(account, await this.controlOf(account.id, tx)) ??
      (rule?.accountId === account.id ? null : 'rule');
    if (reason) {
      throw invalid(
        'counterAccount',
        'usable',
        `the customer's counter account ${account.code} cannot take the entry (${reason})`,
      );
    }
    return { key, accountId: account.id, accountCode: account.code, accountName: account.name };
  }

  private async defaultAccount(executor: Db | Tx): Promise<GlAccount | null> {
    try {
      return await this.accounts.byRole('SALES_DISCOUNT', executor);
    } catch (error) {
      if (error instanceof AppError && error.code === 'ACCOUNT_ROLE_MISSING') return null;
      throw error;
    }
  }

  private async controlOf(accountId: number, executor: Db | Tx): Promise<string | undefined> {
    return (
      await this.chart.accountsByIds(
        this.books.source(),
        { company: await this.books.company(), ids: [accountId] },
        this.books.executor(executor),
      )
    ).get(accountId)?.control;
  }
}
