import { isSalaryProrated } from '@tugeel/shared/payroll';
import type { Me } from '../api/session';

// «Миний цалин» (ADR-0235): the pure parts, tested without a phone.

/** Scoring the manual KPI items on the phone: who scores or manages payroll. */
export const PAYROLL_SCORE_RIGHT = 'hr.payroll.score';
export const PAYROLL_MANAGE_RIGHT = 'hr.payroll.manage';

export function mayScoreKpi(me: Pick<Me, 'permissions'>): boolean {
  return (
    me.permissions.includes(PAYROLL_SCORE_RIGHT) || me.permissions.includes(PAYROLL_MANAGE_RIGHT)
  );
}

/** «2026-11» → the year and month number for «{{year}} оны {{month}}-р сар». */
export function monthParts(month: string): { year: string; month: number } {
  const [year = '', mon = '1'] = month.split('-');
  return { year, month: Number.parseInt(mon, 10) };
}

/** A percent for reading: «86.90» → «86.9», «100.00» → «100»; null stays null. */
export function percentText(value: string | null): string | null {
  if (value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? String(Number(n.toFixed(2))) : null;
}

/** What the person typed as a score: ok with null when empty, not ok outside 0–100. */
export function parseScore(text: string): { ok: true; value: string | null } | { ok: false } {
  const clean = text.trim().replace(',', '.');
  if (clean === '') return { ok: true, value: null };
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(clean) || Number(clean) > 100) return { ok: false };
  return { ok: true, value: clean };
}

/** A money text is zero: «0», «0.00». */
export function isZero(value: string): boolean {
  return Number(value) === 0;
}

/**
 * The fixed salary split by the workdays (joined or left inside the month, ADR-0235 2026-11-21):
 * the days for «11 / 22 ажлын өдөр», or null when the month was paid whole.
 */
export function salaryFraction(slip: {
  salaryDays: number | null;
  salaryMonthDays: number | null;
}): { days: number; total: number } | null {
  return isSalaryProrated(slip.salaryDays, slip.salaryMonthDays)
    ? { days: slip.salaryDays ?? 0, total: slip.salaryMonthDays ?? 0 }
    : null;
}
