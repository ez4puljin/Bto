import { Inject, Injectable } from '@nestjs/common';
import type { GlAccountKind, GlRole } from '@tugeel/shared/finance';
import { Decimal } from '@tugeel/shared/money';
import { businessDate } from '@tugeel/shared/time';
import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { type AuthContext, AuditService } from '../../identity';
import { glAccounts, journalEntries, journalLines } from '../schema';

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
 * The chart of accounts (ADR-0060 #7): the seeded accounts and the ones the accountant adds. An
 * account is never deleted (journal lines point at it); it is deactivated instead. At most one
 * account holds each role, and the automatic entries look their accounts up by role.
 */
@Injectable()
export class GlAccountsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  list(executor: Db | Tx = this.db): Promise<GlAccount[]> {
    return executor.select().from(glAccounts).orderBy(asc(glAccounts.code));
  }

  /** Every account with Σ debit, Σ credit and the balance of the entries up to `asOf`. */
  async listWithBalances(asOf: string = businessDate()): Promise<GlAccountBalance[]> {
    const sums = this.db
      .select({
        accountId: journalLines.accountId,
        debit: sql<string>`sum(${journalLines.debit})`.as('debit'),
        credit: sql<string>`sum(${journalLines.credit})`.as('credit'),
      })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
      .where(lte(journalEntries.entryDate, asOf))
      .groupBy(journalLines.accountId)
      .as('sums');
    const rows = await this.db
      .select({
        account: glAccounts,
        debit: sql<string | null>`${sums.debit}`,
        credit: sql<string | null>`${sums.credit}`,
      })
      .from(glAccounts)
      .leftJoin(sums, eq(sums.accountId, glAccounts.id))
      .orderBy(asc(glAccounts.code));
    return rows.map(({ account, debit, credit }) => {
      const dr = new Decimal(debit ?? 0);
      const cr = new Decimal(credit ?? 0);
      return { ...account, debit: dr, credit: cr, balance: dr.minus(cr) };
    });
  }

  async get(id: number, executor: Db | Tx = this.db): Promise<GlAccount> {
    const [row] = await executor.select().from(glAccounts).where(eq(glAccounts.id, id));
    if (!row) throw notFound('gl_account', id);
    return row;
  }

  /** The active accounts of these ids, by id; a missing or inactive one is a field error. */
  async activeByIds(
    ids: readonly number[],
    path: (index: number) => string,
    executor: Db | Tx = this.db,
  ): Promise<Map<number, GlAccount>> {
    const unique = [...new Set(ids)];
    const rows = unique.length
      ? await executor.select().from(glAccounts).where(inArray(glAccounts.id, unique))
      : [];
    const found = new Map(rows.map((row) => [row.id, row]));
    ids.forEach((id, index) => {
      const account = found.get(id);
      if (!account) throw invalid(path(index), 'exists', `account ${id} does not exist`);
      if (account.status !== 'ACTIVE') {
        throw invalid(path(index), 'active', `account ${account.code} is inactive`);
      }
    });
    return found;
  }

  /** The active account holding a role; 409 ACCOUNT_ROLE_MISSING when the chart has none. */
  async byRole(role: GlRole, executor: Db | Tx = this.db): Promise<GlAccount> {
    const [row] = await executor
      .select()
      .from(glAccounts)
      .where(and(eq(glAccounts.role, role), eq(glAccounts.status, 'ACTIVE')));
    if (!row) {
      throw new AppError('ACCOUNT_ROLE_MISSING', `no active account holds the role ${role}`, {
        role,
      });
    }
    return row;
  }

  async create(ctx: AuthContext, input: GlAccountInput): Promise<GlAccount> {
    const code = input.code.trim();
    const name = input.name.trim();
    return inTransaction(this.db, async (tx) => {
      const [row] = await tx
        .insert(glAccounts)
        .values({ code, name, kind: input.kind })
        .returning();
      if (!row) throw new Error('gl_accounts insert returned no row');
      await this.audit.record(tx, ctx, {
        action: 'CREATE',
        entity: 'gl_accounts',
        entityId: row.id,
        after: { code, name, kind: input.kind },
      });
      return row;
    });
  }

  async update(ctx: AuthContext, id: number, patch: GlAccountPatch): Promise<GlAccount> {
    return inTransaction(this.db, async (tx) => {
      const before = await this.lock(tx, id);
      if (patch.status === 'INACTIVE' && before.role !== null) {
        throw invalid('status', 'role', 'an account holding a role stays active');
      }
      const set = {
        ...(patch.code !== undefined ? { code: patch.code.trim() } : {}),
        ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
        ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
      };
      const [row] = await tx
        .update(glAccounts)
        .set({ ...set, updatedAt: sql`now()` })
        .where(eq(glAccounts.id, id))
        .returning();
      if (!row) throw notFound('gl_account', id);
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'gl_accounts',
        entityId: id,
        before: { code: before.code, name: before.name, kind: before.kind, status: before.status },
        after: set,
      });
      return row;
    });
  }

  /**
   * Gives an account a role or takes it away (ADR-0060 #9, `finance.settings.manage`). A role
   * another account holds is 409 ACCOUNT_ROLE_TAKEN: clear it there first.
   */
  async setRole(ctx: AuthContext, id: number, role: GlRole | null): Promise<GlAccount> {
    return inTransaction(this.db, async (tx) => {
      const before = await this.lock(tx, id);
      if (role !== null) {
        if (before.status !== 'ACTIVE') {
          throw invalid('role', 'active', 'only an active account takes a role');
        }
        const [holder] = await tx
          .select({ id: glAccounts.id, code: glAccounts.code })
          .from(glAccounts)
          .where(eq(glAccounts.role, role))
          .for('update');
        if (holder && holder.id !== id) {
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
      const [row] = await tx
        .update(glAccounts)
        .set({ role, updatedAt: sql`now()` })
        .where(eq(glAccounts.id, id))
        .returning();
      if (!row) throw notFound('gl_account', id);
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'gl_accounts',
        entityId: id,
        before: { role: before.role },
        after: { role },
      });
      return row;
    });
  }

  private async lock(tx: Tx, id: number): Promise<GlAccount> {
    const [row] = await tx.select().from(glAccounts).where(eq(glAccounts.id, id)).for('update');
    if (!row) throw notFound('gl_account', id);
    return row;
  }
}
