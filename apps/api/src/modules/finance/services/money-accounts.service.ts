import { Inject, Injectable } from '@nestjs/common';
import type { MoneyAccountKind } from '@tugeel/shared/finance';
import { Decimal } from '@tugeel/shared/money';
import { and, asc, eq, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { invalid, notFound } from '../../../common/errors/app-error';
import { AuditService, type AuthContext, OrgService } from '../../identity';
import { glAccounts, moneyAccounts, payments } from '../schema';
import type { AccountStatus } from './gl-accounts.service';

export interface MoneyAccount {
  id: number;
  code: string;
  name: string;
  kind: MoneyAccountKind;
  branchId: number | null;
  branchName: string | null;
  bankName: string | null;
  bankAccountNo: string | null;
  glAccountId: number;
  glAccountCode: string;
  glAccountName: string;
  status: AccountStatus;
  /** Σ in − Σ out of the posted vouchers. */
  balance: Decimal;
  createdAt: Date;
  updatedAt: Date;
}

export interface MoneyAccountInput {
  code: string;
  name: string;
  kind: MoneyAccountKind;
  branchId: number | null;
  bankName: string | null;
  bankAccountNo: string | null;
  glAccountId: number;
}

export type MoneyAccountPatch = Partial<Omit<MoneyAccountInput, 'kind'>> & {
  status?: AccountStatus;
};

/**
 * The cash boxes and bank accounts (ADR-0060 #5): one per branch and bank account, each mapped to
 * the journal account its vouchers hit. Never deleted (vouchers point at them); deactivated.
 */
@Injectable()
export class MoneyAccountsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly org: OrgService,
  ) {}

  async list(executor: Db | Tx = this.db): Promise<MoneyAccount[]> {
    return this.rows(undefined, executor);
  }

  async get(id: number, executor: Db | Tx = this.db): Promise<MoneyAccount> {
    const [row] = await this.rows(eq(moneyAccounts.id, id), executor);
    if (!row) throw notFound('money_account', id);
    return row;
  }

  /** The account a voucher is posted to: shared-locked and active. */
  async lockActive(tx: Tx, id: number): Promise<MoneyAccount> {
    const [row] = await tx
      .select({ id: moneyAccounts.id, status: moneyAccounts.status })
      .from(moneyAccounts)
      .where(eq(moneyAccounts.id, id))
      .for('share');
    if (!row) throw invalid('moneyAccountId', 'exists', `money account ${id} does not exist`);
    if (row.status !== 'ACTIVE') {
      throw invalid('moneyAccountId', 'active', `money account ${id} is inactive`);
    }
    return this.get(id, tx);
  }

  async create(ctx: AuthContext, input: MoneyAccountInput): Promise<MoneyAccount> {
    const values = await this.normalize(input);
    return inTransaction(this.db, async (tx) => {
      const [row] = await tx
        .insert(moneyAccounts)
        .values({ ...values, kind: input.kind })
        .returning({ id: moneyAccounts.id });
      if (!row) throw new Error('money_accounts insert returned no row');
      await this.audit.record(tx, ctx, {
        action: 'CREATE',
        entity: 'money_accounts',
        entityId: row.id,
        after: { ...values, kind: input.kind },
      });
      return this.get(row.id, tx);
    });
  }

  async update(ctx: AuthContext, id: number, patch: MoneyAccountPatch): Promise<MoneyAccount> {
    return inTransaction(this.db, async (tx) => {
      const before = await this.get(id, tx);
      const values = await this.normalize({
        code: patch.code ?? before.code,
        name: patch.name ?? before.name,
        branchId: patch.branchId === undefined ? before.branchId : patch.branchId,
        bankName: patch.bankName === undefined ? before.bankName : patch.bankName,
        bankAccountNo:
          patch.bankAccountNo === undefined ? before.bankAccountNo : patch.bankAccountNo,
        glAccountId: patch.glAccountId ?? before.glAccountId,
      });
      await tx
        .update(moneyAccounts)
        .set({ ...values, status: patch.status ?? before.status, updatedAt: sql`now()` })
        .where(eq(moneyAccounts.id, id));
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'money_accounts',
        entityId: id,
        before: {
          code: before.code,
          name: before.name,
          branchId: before.branchId,
          bankName: before.bankName,
          bankAccountNo: before.bankAccountNo,
          glAccountId: before.glAccountId,
          status: before.status,
        },
        after: { ...values, status: patch.status ?? before.status },
      });
      return this.get(id, tx);
    });
  }

  private async normalize(input: Omit<MoneyAccountInput, 'kind'>) {
    const [account] = await this.db
      .select({ kind: glAccounts.kind, status: glAccounts.status })
      .from(glAccounts)
      .where(eq(glAccounts.id, input.glAccountId));
    if (!account || account.status !== 'ACTIVE' || account.kind !== 'ASSET') {
      throw invalid('glAccountId', 'asset', 'an active asset account');
    }
    if (input.branchId !== null) await this.org.getBranch(input.branchId);
    return {
      code: input.code.trim(),
      name: input.name.trim(),
      branchId: input.branchId,
      bankName: input.bankName?.trim() || null,
      bankAccountNo: input.bankAccountNo?.trim() || null,
      glAccountId: input.glAccountId,
    };
  }

  private async rows(where: ReturnType<typeof eq> | undefined, executor: Db | Tx) {
    const rows = await executor
      .select({
        account: moneyAccounts,
        glAccountCode: glAccounts.code,
        glAccountName: glAccounts.name,
        balance: sql<string>`(SELECT coalesce(sum(CASE p.direction WHEN 'IN' THEN p.amount ELSE -p.amount END), 0)
          FROM payments p WHERE p.money_account_id = money_accounts.id AND p.status = 'POSTED')`,
      })
      .from(moneyAccounts)
      .innerJoin(glAccounts, eq(glAccounts.id, moneyAccounts.glAccountId))
      .where(where)
      .orderBy(asc(moneyAccounts.code));
    const branches = new Map((await this.org.listBranches()).map((branch) => [branch.id, branch]));
    return rows.map(({ account, glAccountCode, glAccountName, balance }) => ({
      ...account,
      branchName: account.branchId === null ? null : (branches.get(account.branchId)?.name ?? null),
      glAccountCode,
      glAccountName,
      balance: new Decimal(balance),
    }));
  }
}

/** Σ in − Σ out of an account's posted vouchers up to a date, for the book's opening balance. */
export function bookBalanceSql(moneyAccountId: number, before: string) {
  return sql<string>`(SELECT coalesce(sum(CASE ${payments.direction} WHEN 'IN' THEN ${payments.amount} ELSE -${payments.amount} END), 0)
    FROM ${payments} WHERE ${payments.moneyAccountId} = ${moneyAccountId} AND ${payments.status} = 'POSTED' AND ${payments.paidOn} < ${before})`;
}

export const postedPaymentsOf = (moneyAccountId: number) =>
  and(eq(payments.moneyAccountId, moneyAccountId), eq(payments.status, 'POSTED'));
