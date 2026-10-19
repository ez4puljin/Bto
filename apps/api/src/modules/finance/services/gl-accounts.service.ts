import { Inject, Injectable } from '@nestjs/common';
import type { GlAccountKind, GlRole } from '@tugeel/shared/finance';
import { Decimal } from '@tugeel/shared/money';
import { businessDate } from '@tugeel/shared/time';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import {
  type FinAccountView,
  FinChartService,
  FinJournalReader,
  type FinRuleView,
} from '../../../finance-core';
import { POSTING_KEY_OF_ROLE, ROLE_OF_POSTING_KEY } from '../../fin-bridge';
import { type AuthContext, AuditService } from '../../identity';
import { FinBooks } from './fin-books';

export type AccountStatus = 'ACTIVE' | 'INACTIVE';

export interface GlAccount {
  id: number;
  code: string;
  name: string;
  kind: GlAccountKind;
  role: GlRole | null;
  status: AccountStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface GlAccountInput {
  code: string;
  name: string;
  kind: GlAccountKind;
}

export interface GlAccountPatch {
  code?: string;
  name?: string;
  kind?: GlAccountKind;
  status?: AccountStatus;
}

/** An account with its turnover and balance up to a date (debit − credit; negative = credit). */
export interface GlAccountBalance extends GlAccount {
  debit: Decimal;
  credit: Decimal;
  balance: Decimal;
}

/**
 * The chart of accounts (ADR-0060 #7), kept by the Finance Core since F1's ledger (ADR-0089):
 * `fin.accounts`, with a role being the company-default posting rule of the role's key in force
 * today. An account is never deleted (journal lines point at it); it is deactivated instead. At
 * most one account holds each role, and the automatic entries post by role.
 */
@Injectable()
export class GlAccountsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly chart: FinChartService,
    private readonly reader: FinJournalReader,
    private readonly books: FinBooks,
  ) {}

  async list(executor: Db | Tx = this.db): Promise<GlAccount[]> {
    const fx = this.books.executor(executor);
    const company = await this.books.company();
    const ctx = this.books.source();
    const [accounts, roles] = await Promise.all([
      this.chart.accounts(ctx, { company }, fx),
      this.rolesByAccount(businessDate(), executor),
    ]);
    return accounts.map((account) => toGlAccount(account, roles.get(account.id) ?? null));
  }

  /** Every account with Σ debit, Σ credit and the balance of the entries up to `asOf`. */
  async listWithBalances(asOf: string = businessDate()): Promise<GlAccountBalance[]> {
    const totals = await this.reader.accountTotals(this.books.source(), {
      company: await this.books.company(),
      asOf,
    });
    return (await this.list()).map((account) => {
      const dr = totals.get(account.id)?.debit ?? new Decimal(0);
      const cr = totals.get(account.id)?.credit ?? new Decimal(0);
      return { ...account, debit: dr, credit: cr, balance: dr.minus(cr) };
    });
  }

  async get(id: number, executor: Db | Tx = this.db): Promise<GlAccount> {
    const [account] = await this.byIds([id], executor);
    if (!account) throw notFound('gl_account', id);
    return account;
  }

  /** The active accounts of these ids, by id; a missing or inactive one is a field error. */
  async activeByIds(
    ids: readonly number[],
    path: (index: number) => string,
    executor: Db | Tx = this.db,
  ): Promise<Map<number, GlAccount>> {
    const found = new Map((await this.byIds(ids, executor)).map((row) => [row.id, row]));
    ids.forEach((id, index) => {
      const account = found.get(id);
      if (!account) throw invalid(path(index), 'exists', `account ${id} does not exist`);
      if (account.status !== 'ACTIVE') {
        throw invalid(path(index), 'active', `account ${account.code} is inactive`);
      }
    });
    return found;
  }

  /**
   * The active account holding a role on `on` (default today); 409 ACCOUNT_ROLE_MISSING when the
   * chart has none.
   */
  async byRole(
    role: GlRole,
    executor: Db | Tx = this.db,
    on: string = businessDate(),
  ): Promise<GlAccount> {
    const rules = await this.rules(on, executor);
    const accountId = rules.get(POSTING_KEY_OF_ROLE[role].code)?.accountId ?? null;
    const account = accountId === null ? undefined : (await this.byIds([accountId], executor))[0];
    if (!account || account.status !== 'ACTIVE') {
      throw new AppError('ACCOUNT_ROLE_MISSING', `no active account holds the role ${role}`, {
        role,
      });
    }
    return { ...account, role };
  }

  async create(ctx: AuthContext, input: GlAccountInput): Promise<GlAccount> {
    const code = input.code.trim();
    const name = input.name.trim();
    return inTransaction(this.db, async (tx) => {
      const row = await this.chart.createAccountInTx(tx, this.books.user(ctx), {
        company: await this.books.company(),
        code,
        name,
        kind: input.kind,
      });
      await this.audit.record(tx, ctx, {
        action: 'CREATE',
        entity: 'gl_accounts',
        entityId: row.id,
        after: { code, name, kind: input.kind },
      });
      return toGlAccount(row, null);
    });
  }

  async update(ctx: AuthContext, id: number, patch: GlAccountPatch): Promise<GlAccount> {
    return inTransaction(this.db, async (tx) => {
      const roles = await this.rolesByAccount(businessDate(), tx, true);
      const role = roles.get(id) ?? null;
      if (patch.status === 'INACTIVE' && role !== null) {
        throw invalid('status', 'role', 'an account holding a role stays active');
      }
      const set = {
        ...(patch.code !== undefined ? { code: patch.code.trim() } : {}),
        ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
        ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
      };
      const changed = await this.chart.updateAccountInTx(tx, this.books.user(ctx), {
        company: await this.books.company(),
        id,
        patch: set,
      });
      if (!changed) throw notFound('gl_account', id);
      const { before, after } = changed;
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'gl_accounts',
        entityId: id,
        before: { code: before.code, name: before.name, kind: before.kind, status: before.status },
        after: set,
      });
      return toGlAccount(after, role);
    });
  }

  /**
   * Gives an account a role or takes it away (ADR-0060 #9, `finance.settings.manage`): a new
   * company-default rule of the role's key from today (ADR-0089 #2); the role the account held
   * before is unmapped. A role another account holds is 409 ACCOUNT_ROLE_TAKEN: clear it there first.
   */
  async setRole(ctx: AuthContext, id: number, role: GlRole | null): Promise<GlAccount> {
    return inTransaction(this.db, async (tx) => {
      const today = businessDate();
      const company = await this.books.company();
      const user = this.books.user(ctx);
      const rules = await this.rules(today, tx, true);
      const before = await this.get(id, tx);
      const held = roleOf(rules, id);
      if (role !== null) {
        if (before.status !== 'ACTIVE') {
          throw invalid('role', 'active', 'only an active account takes a role');
        }
        const holderId = rules.get(POSTING_KEY_OF_ROLE[role].code)?.accountId ?? null;
        if (holderId !== null && holderId !== id) {
          const holder = await this.get(holderId, tx);
          throw new AppError(
            'ACCOUNT_ROLE_TAKEN',
            `account ${holder.code} holds the role ${role}`,
            {
              role,
              code: holder.code,
            },
          );
        }
      }
      if (held !== null && held !== role) {
        await this.chart.setRuleInTx(tx, user, {
          company,
          key: POSTING_KEY_OF_ROLE[held].code,
          accountId: null,
          effectiveFrom: today,
        });
      }
      if (role !== null && held !== role) {
        await this.chart.setRuleInTx(tx, user, {
          company,
          key: POSTING_KEY_OF_ROLE[role].code,
          accountId: id,
          effectiveFrom: today,
        });
      }
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'gl_accounts',
        entityId: id,
        before: { role: held },
        after: { role },
      });
      return { ...before, role };
    });
  }

  private async byIds(ids: readonly number[], executor: Db | Tx): Promise<GlAccount[]> {
    const fx = this.books.executor(executor);
    const accounts = await this.chart.accountsByIds(
      this.books.source(),
      { company: await this.books.company(), ids },
      fx,
    );
    const roles = await this.rolesByAccount(businessDate(), executor);
    return [...accounts.values()].map((account) =>
      toGlAccount(account, roles.get(account.id) ?? null),
    );
  }

  private async rules(on: string, executor: Db | Tx, lock = false) {
    return this.chart.rules(
      this.books.source(),
      { company: await this.books.company(), on, lock },
      this.books.executor(executor),
    );
  }

  /** The role each account holds on `on`, by account id. */
  private async rolesByAccount(
    on: string,
    executor: Db | Tx,
    lock = false,
  ): Promise<Map<number, GlRole>> {
    const rules = await this.rules(on, executor, lock);
    const result = new Map<number, GlRole>();
    for (const rule of rules.values()) {
      const role = ROLE_OF_POSTING_KEY.get(rule.key);
      if (role !== undefined && rule.accountId !== null) result.set(rule.accountId, role);
    }
    return result;
  }
}

function roleOf(rules: ReadonlyMap<string, FinRuleView>, accountId: number): GlRole | null {
  for (const rule of rules.values()) {
    if (rule.accountId === accountId) return ROLE_OF_POSTING_KEY.get(rule.key) ?? null;
  }
  return null;
}

function toGlAccount(account: FinAccountView, role: GlRole | null): GlAccount {
  return {
    id: account.id,
    code: account.code,
    name: account.name,
    kind: account.kind,
    role,
    status: account.status,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}
