import { Inject, Injectable } from '@nestjs/common';
import { isIsoDate } from '@tugeel/shared/time';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { type AuthContext, AuditService, UserNamesService } from '../../identity';
import { amountOf } from '../kpi-sheet';
import { assertPayroll, PAYROLL_MANAGE } from '../payroll.rights';
import { payrollAdvances } from '../schema';
import { PayrollPeopleService } from './payroll-people.service';
import { assertMonth, cleanNote, lockMonth, PayrollRunsService } from './payroll-runs.service';

export interface PayrollAdvance {
  id: number;
  userId: number;
  fullName: string;
  month: string;
  amount: string;
  paidOn: string;
  note: string | null;
  createdByName: string | null;
  createdAt: Date;
  voidedAt: Date | null;
  voidedByName: string | null;
  voidReason: string | null;
}

export interface PayrollAdvanceInput {
  userId: number;
  month: string;
  amount: string;
  paidOn: string;
  note: string | null;
}

/**
 * Salary advances (ADR-0235 #7): HR records what was paid ahead, per employee and month; the
 * month's payslip deducts their sum. An advance is never edited or deleted: a wrong one is voided
 * with a reason and typed again. A month whose run is APPROVED takes no change; a DRAFT line
 * follows at once, in the same transaction.
 */
@Injectable()
export class PayrollAdvancesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly names: UserNamesService,
    private readonly people: PayrollPeopleService,
    private readonly runs: PayrollRunsService,
  ) {}

  async list(filter: {
    month?: string;
    userId?: number;
    includeVoided?: boolean;
  }): Promise<PayrollAdvance[]> {
    if (filter.month !== undefined) assertMonth(filter.month);
    const rows = await this.db
      .select()
      .from(payrollAdvances)
      .where(
        and(
          filter.month === undefined ? undefined : eq(payrollAdvances.month, filter.month),
          filter.userId === undefined ? undefined : eq(payrollAdvances.userId, filter.userId),
          filter.includeVoided ? undefined : isNull(payrollAdvances.voidedAt),
        ),
      )
      .orderBy(desc(payrollAdvances.month), desc(payrollAdvances.paidOn), desc(payrollAdvances.id))
      .limit(2000);
    const names = await this.names.namesOf(
      rows.flatMap((row) => [row.userId, row.createdBy, ...(row.voidedBy ? [row.voidedBy] : [])]),
    );
    return rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      fullName: names.get(row.userId) ?? '',
      month: row.month,
      amount: row.amount.toFixed(2),
      paidOn: row.paidOn,
      note: row.note,
      createdByName: names.get(row.createdBy) ?? null,
      createdAt: row.createdAt,
      voidedAt: row.voidedAt,
      voidedByName: row.voidedBy === null ? null : (names.get(row.voidedBy) ?? null),
      voidReason: row.voidReason,
    }));
  }

  async create(ctx: AuthContext, input: PayrollAdvanceInput): Promise<PayrollAdvance> {
    assertPayroll(ctx, PAYROLL_MANAGE);
    assertMonth(input.month);
    if (!isIsoDate(input.paidOn)) throw invalid('paidOn', 'isDate', 'YYYY-MM-DD');
    const amount = amountOf('amount', input.amount);
    if (amount.lte(0)) throw invalid('amount', 'isPositive', 'an amount above zero');
    const note = cleanNote('note', input.note);
    if (!(await this.people.byId()).has(input.userId)) {
      throw invalid('userId', 'exists', `employee ${input.userId} not found`);
    }
    const id = await inTransaction(this.db, async (tx) => {
      await lockMonth(tx, input.month);
      const [row] = await tx
        .insert(payrollAdvances)
        .values({
          userId: input.userId,
          month: input.month,
          amount,
          paidOn: input.paidOn,
          note,
          createdBy: ctx.userId,
        })
        .returning({ id: payrollAdvances.id });
      if (!row) throw new Error('advance insert returned no row');
      await this.runs.advanceChangedInTx(tx, input.month, input.userId);
      await this.audit.record(tx, ctx, {
        action: 'CREATE',
        entity: 'payroll_advance',
        entityId: row.id,
        after: { userId: input.userId, month: input.month, amount, paidOn: input.paidOn, note },
      });
      return row.id;
    });
    return this.one(id);
  }

  async void(ctx: AuthContext, id: number, reason: string): Promise<PayrollAdvance> {
    assertPayroll(ctx, PAYROLL_MANAGE);
    const text = cleanNote('reason', reason);
    if (text === null) throw invalid('reason', 'isNotEmpty', 'voiding needs a reason');
    const [found] = await this.db.select().from(payrollAdvances).where(eq(payrollAdvances.id, id));
    if (!found) throw notFound('payroll advance', id);
    await inTransaction(this.db, async (tx) => {
      await lockMonth(tx, found.month);
      const [row] = await tx.select().from(payrollAdvances).where(eq(payrollAdvances.id, id));
      if (!row) throw notFound('payroll advance', id);
      if (row.voidedAt !== null) {
        throw new AppError('DOC_STATE_INVALID', `advance ${id} is voided already`, {
          status: 'VOIDED',
        });
      }
      await tx
        .update(payrollAdvances)
        .set({ voidedAt: sql`now()`, voidedBy: ctx.userId, voidReason: text })
        .where(eq(payrollAdvances.id, id));
      await this.runs.advanceChangedInTx(tx, row.month, row.userId);
      await this.audit.record(tx, ctx, {
        action: 'VOID',
        entity: 'payroll_advance',
        entityId: id,
        before: { userId: row.userId, month: row.month, amount: row.amount, paidOn: row.paidOn },
        after: { reason: text },
      });
    });
    return this.one(id);
  }

  private async one(id: number): Promise<PayrollAdvance> {
    const [row] = await this.db.select().from(payrollAdvances).where(eq(payrollAdvances.id, id));
    if (!row) throw notFound('payroll advance', id);
    const found = (
      await this.list({ month: row.month, userId: row.userId, includeVoided: true })
    ).find((entry) => entry.id === id);
    if (!found) throw notFound('payroll advance', id);
    return found;
  }
}
