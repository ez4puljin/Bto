import { Inject, Injectable } from '@nestjs/common';
import { Decimal, toMoney } from '@tugeel/shared/money';
import {
  checkPayrollSettings,
  DEFAULT_PAYROLL_SETTINGS,
  type PayrollSettings,
  type PayrollTaxCreditBracket,
} from '@tugeel/shared/payroll';
import { eq, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { invalid } from '../../../common/errors/app-error';
import { type AuthContext, AuditService } from '../../identity';
import { assertPayroll, PAYROLL_MANAGE } from '../payroll.rights';
import { payrollSettings } from '../schema';

/** The stored settings (or a run's snapshot of them) as `PayrollSettings`. */
export function settingsOf(value: unknown): PayrollSettings {
  const raw = value as Partial<PayrollSettings> | null;
  if (!raw || typeof raw !== 'object') return DEFAULT_PAYROLL_SETTINGS;
  return { ...DEFAULT_PAYROLL_SETTINGS, ...raw };
}

/**
 * The payroll rates (ADR-0235 #6): the late penalty, the insurance percents and its capped base,
 * the income tax and its credit table. One row; without it the defaults of the shared rules.
 */
@Injectable()
export class PayrollSettingsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  async get(executor: Db | Tx = this.db): Promise<PayrollSettings> {
    const [row] = await executor.select().from(payrollSettings).where(eq(payrollSettings.id, 1));
    if (!row) return DEFAULT_PAYROLL_SETTINGS;
    return {
      latePenaltyPercent: row.latePenaltyPercent.toString(),
      employeeSiPercent: row.employeeSiPercent.toString(),
      employerSiPercent: row.employerSiPercent.toString(),
      minimumWage: row.minimumWage.toString(),
      siCapMultiplier: row.siCapMultiplier.toString(),
      pitPercent: row.pitPercent.toString(),
      pitCredits: (row.pitCredits as PayrollTaxCreditBracket[]).map((step) => ({
        upTo: step.upTo,
        credit: step.credit,
      })),
    };
  }

  async update(ctx: AuthContext, input: PayrollSettings): Promise<PayrollSettings> {
    assertPayroll(ctx, PAYROLL_MANAGE);
    const checked = checkPayrollSettings(input);
    if (!checked.ok) throw invalid(checked.path, 'payrollSettings', checked.detail);
    const next = checked.settings;
    return inTransaction(this.db, async (tx) => {
      const before = await this.get(tx);
      const values = {
        latePenaltyPercent: new Decimal(next.latePenaltyPercent),
        employeeSiPercent: new Decimal(next.employeeSiPercent),
        employerSiPercent: new Decimal(next.employerSiPercent),
        minimumWage: toMoney(next.minimumWage),
        siCapMultiplier: new Decimal(next.siCapMultiplier),
        pitPercent: new Decimal(next.pitPercent),
        pitCredits: next.pitCredits,
        updatedBy: ctx.userId,
        updatedAt: sql`now()`,
      };
      await tx
        .insert(payrollSettings)
        .values({ id: 1, ...values })
        .onConflictDoUpdate({ target: payrollSettings.id, set: values });
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'payroll_settings',
        entityId: 1,
        before,
        after: next,
      });
      return this.get(tx);
    });
  }
}
