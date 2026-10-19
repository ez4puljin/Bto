import { Inject, Injectable } from '@nestjs/common';
import type { MoneyAccountKind } from '@tugeel/shared/finance';
import { Decimal } from '@tugeel/shared/money';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { invalid, notFound } from '../../../common/errors/app-error';
import {
  type FinBranchRef,
  FinChartService,
  type FinMoneyAccountView,
  FinOrgService,
} from '../../../finance-core';
import { BTO_SOURCE } from '../../fin-bridge';
import { AuditService, type AuthContext, OrgService } from '../../identity';
import { payments } from '../schema';
import { FinBooks } from './fin-books';
import type { AccountStatus } from './gl-accounts.service';
import { GlAccountsService } from './gl-accounts.service';

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
  /** The customer app shows it (ADR-0079 #7); bank accounts only. */
  showToCustomers: boolean;
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
  /** «Харилцагчид харуулах» (ADR-0079 #7); false when left out. */
  showToCustomers?: boolean;
}

/** A bank account the customer app lists, with the advice to name the invoice (ADR-0079 #7). */
export interface CustomerBankAccount {
  id: number;
  name: string;
  bankName: string | null;
  bankAccountNo: string | null;
}

export type MoneyAccountPatch = Partial<Omit<MoneyAccountInput, 'kind'>> & {
  status?: AccountStatus;
};

/**
 * The cash boxes and bank accounts (ADR-0060 #5), kept by the Finance Core since F1's ledger
 * (`fin.money_accounts`, ADR-0089): one per branch and bank account, each mapped to the journal
 * account its vouchers hit. Never deleted (vouchers point at them); deactivated. The balance is
 * still Σ of Bto's posted vouchers until the receivables move to the core (F2).
 */
@Injectable()
export class MoneyAccountsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly org: OrgService,
    private readonly chart: FinChartService,
    private readonly finOrg: FinOrgService,
    private readonly accounts: GlAccountsService,
    private readonly books: FinBooks,
  ) {}

  async list(executor: Db | Tx = this.db): Promise<MoneyAccount[]> {
    return this.rows(undefined, executor);
  }

  async get(id: number, executor: Db | Tx = this.db): Promise<MoneyAccount> {
    const [row] = await this.rows([id], executor);
    if (!row) throw notFound('money_account', id);
    return row;
  }

  /** The account a voucher is posted to: shared-locked and active. */
  async lockActive(tx: Tx, id: number): Promise<MoneyAccount> {
    const locked = await this.chart.lockMoneyAccountInTx(tx, this.books.source(), {
      company: await this.books.company(),
      id,
    });
    if (!locked) throw invalid('moneyAccountId', 'exists', `money account ${id} does not exist`);
    if (locked.status !== 'ACTIVE') {
      throw invalid('moneyAccountId', 'active', `money account ${id} is inactive`);
    }
    return this.get(id, tx);
  }

  /** The ACTIVE bank accounts marked «Харилцагчид харуулах», by code (ADR-0079 #7). */
  async shownToCustomers(): Promise<CustomerBankAccount[]> {
    const accounts = await this.chart.moneyAccounts(this.books.source(), {
      company: await this.books.company(),
    });
    return accounts
      .filter((row) => row.showToCustomers && row.kind === 'BANK' && row.status === 'ACTIVE')
      .map(({ id, name, bankName, bankAccountNo }) => ({ id, name, bankName, bankAccountNo }));
  }

  async create(ctx: AuthContext, input: MoneyAccountInput): Promise<MoneyAccount> {
    const values = await this.normalize(input);
    const showToCustomers = shown(input.kind, input.showToCustomers ?? false);
    return inTransaction(this.db, async (tx) => {
      const branch = await this.mappedBranch(tx, ctx, values.branchId);
      const row = await this.chart.createMoneyAccountInTx(tx, this.books.user(ctx), {
        company: await this.books.company(),
        code: values.code,
        name: values.name,
        kind: input.kind,
        branch,
        accountId: values.glAccountId,
        bankName: values.bankName,
        bankAccountNo: values.bankAccountNo,
        showToCustomers,
      });
      await this.audit.record(tx, ctx, {
        action: 'CREATE',
        entity: 'money_accounts',
        entityId: row.id,
        after: { ...values, kind: input.kind, showToCustomers },
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
      const showToCustomers = shown(before.kind, patch.showToCustomers ?? before.showToCustomers);
      const status = patch.status ?? before.status;
      const branchChanged = values.branchId !== before.branchId;
      await this.chart.updateMoneyAccountInTx(tx, this.books.user(ctx), {
        company: await this.books.company(),
        id,
        patch: {
          code: values.code,
          name: values.name,
          ...(branchChanged ? { branch: await this.mappedBranch(tx, ctx, values.branchId) } : {}),
          accountId: values.glAccountId,
          bankName: values.bankName,
          bankAccountNo: values.bankAccountNo,
          showToCustomers,
          status,
        },
      });
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
          showToCustomers: before.showToCustomers,
          status: before.status,
        },
        after: { ...values, showToCustomers, status },
      });
      return this.get(id, tx);
    });
  }

  private async normalize(input: Omit<MoneyAccountInput, 'kind'>) {
    const account = await this.accounts.get(input.glAccountId).catch(() => null);
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

  /**
   * The core's ref of a Bto branch, mapped now if it was added after the last boot; a closed branch
   * takes no new money account (the core never maps a closed branch, ADR-0084 #1).
   */
  private async mappedBranch(
    tx: Tx,
    ctx: AuthContext,
    branchId: number | null,
  ): Promise<FinBranchRef | null> {
    if (branchId === null) return null;
    const branch = await this.org.getBranch(branchId);
    if (branch.status !== 'ACTIVE') {
      throw invalid('branchId', 'active', `branch ${branch.code} is closed`);
    }
    await this.finOrg.syncBranchInTx(tx, this.books.source(ctx), {
      company: await this.books.company(),
      branch: { externalId: String(branch.id), code: branch.code, name: branch.name, active: true },
    });
    return { system: BTO_SOURCE, externalId: String(branch.id) };
  }

  private async rows(
    ids: readonly number[] | undefined,
    executor: Db | Tx,
  ): Promise<MoneyAccount[]> {
    const accounts = await this.chart.moneyAccounts(
      this.books.source(),
      { company: await this.books.company(), ...(ids ? { ids } : {}) },
      this.books.executor(executor),
    );
    if (accounts.length === 0) return [];
    const balances = new Map(
      (
        await executor
          .select({
            id: payments.moneyAccountId,
            balance: sql<string>`coalesce(sum(CASE ${payments.direction} WHEN 'IN' THEN ${payments.amount} ELSE -${payments.amount} END), 0)`,
          })
          .from(payments)
          .where(
            and(
              eq(payments.status, 'POSTED'),
              inArray(
                payments.moneyAccountId,
                accounts.map((account) => account.id),
              ),
            ),
          )
          .groupBy(payments.moneyAccountId)
      ).map((row) => [row.id, new Decimal(row.balance)]),
    );
    const branches = new Map((await this.org.listBranches()).map((branch) => [branch.id, branch]));
    return accounts.map((account) => {
      const branchId = btoBranchId(account);
      return {
        id: account.id,
        code: account.code,
        name: account.name,
        kind: moneyKind(account),
        branchId,
        branchName: branchId === null ? null : (branches.get(branchId)?.name ?? null),
        bankName: account.bankName,
        bankAccountNo: account.bankAccountNo,
        glAccountId: account.accountId,
        glAccountCode: account.accountCode,
        glAccountName: account.accountName,
        showToCustomers: account.showToCustomers,
        status: account.status,
        balance: balances.get(account.id) ?? new Decimal(0),
        createdAt: account.createdAt,
        updatedAt: account.updatedAt,
      };
    });
  }
}

/** Bto's id of the money account's branch (its ref under source BTO). */
function btoBranchId(account: FinMoneyAccountView): number | null {
  const ref = account.branchRefs.find((own) => own.system === BTO_SOURCE);
  return ref === undefined ? null : Number.parseInt(ref.externalId, 10);
}

/** Bto opens CASH and BANK accounts only; a CLEARING account of the core reads as BANK nowhere. */
function moneyKind(account: FinMoneyAccountView): MoneyAccountKind {
  return account.kind === 'CASH' ? 'CASH' : 'BANK';
}

/** Only a bank account is shown to customers: they pay by transfer there (ADR-0079 #7). */
function shown(kind: MoneyAccountKind, value: boolean): boolean {
  if (value && kind !== 'BANK') {
    throw invalid('showToCustomers', 'bankOnly', 'only a bank account is shown to customers');
  }
  return value;
}

/** Σ in − Σ out of an account's posted vouchers up to a date, for the book's opening balance. */
export function bookBalanceSql(moneyAccountId: number, before: string) {
  return sql<string>`(SELECT coalesce(sum(CASE ${payments.direction} WHEN 'IN' THEN ${payments.amount} ELSE -${payments.amount} END), 0)
    FROM ${payments} WHERE ${payments.moneyAccountId} = ${moneyAccountId} AND ${payments.status} = 'POSTED' AND ${payments.paidOn} < ${before})`;
}

export const postedPaymentsOf = (moneyAccountId: number) =>
  and(eq(payments.moneyAccountId, moneyAccountId), eq(payments.status, 'POSTED'));
