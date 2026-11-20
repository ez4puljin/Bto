import type { Permission } from '@tugeel/shared/auth';
import { AppError } from '../../common/errors/app-error';
import type { AuthContext } from '../identity';

/** Every run and payslip, the terms, templates, advances and rates (ADR-0235 #10). */
export const PAYROLL_VIEW = 'hr.payroll.view' satisfies Permission;
/** Terms, templates, rates, runs, advances, approval and reopening. */
export const PAYROLL_MANAGE = 'hr.payroll.manage' satisfies Permission;
/** Scoring the work-evaluation KPI items; with this code alone no amount is shown. */
export const PAYROLL_SCORE = 'hr.payroll.score' satisfies Permission;

export function assertPayroll(ctx: AuthContext, ...anyOf: Permission[]): void {
  if (anyOf.some((code) => ctx.permissions.has(code))) return;
  throw new AppError('FORBIDDEN', `payroll needs ${anyOf.join(' or ')}`, {
    permission: anyOf[0] ?? PAYROLL_MANAGE,
  });
}
