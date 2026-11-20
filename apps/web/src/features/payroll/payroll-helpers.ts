import { PAYROLL_AMOUNT_PATTERN, PAYROLL_LIMITS, type KpiSource } from '@tugeel/shared/payroll';
import { roundHalfUp } from '@tugeel/shared/money';
import { formatMnt } from '@/lib/money';
import { randomUuid } from '@/lib/uuid';
import type { PayrollKpiItem, PayrollKpiItemRequest } from './payroll-api';

/*
 * The payroll pages' plain helpers: money and percent for reading, and the KPI items while they
 * are edited (a draft row per item).
 */

/** A money figure for reading, whole tögrög with thousands: «173,800». */
export const money = (value: string): string => formatMnt(roundHalfUp(value, 0).toFixed(2));

/** A percent for reading: «86.9%», «50%». */
export function percent(value: string | null): string {
  if (value === null) return '';
  const [whole = '0', cents = ''] = value.split('.');
  const trimmed = cents.replace(/0+$/, '');
  return `${whole}${trimmed === '' ? '' : `.${trimmed}`}%`;
}

/** Digits and one point, at most two decimals: what a percent field may hold. */
export function cleanPercent(text: string): string {
  const [whole = '', ...rest] = text.replace(/[^\d.]/g, '').split('.');
  return rest.length > 0 ? `${whole}.${rest.join('').slice(0, 2)}` : whole;
}

/** One KPI item while it is edited: the amount is text, the order a number typed as text. */
export interface ItemDraft {
  rid: string;
  key: string | null;
  name: string;
  source: KpiSource;
  amount: string;
  sort: string;
}

export function draftsOf(items: readonly PayrollKpiItem[]): ItemDraft[] {
  return [...items]
    .sort((a, b) => a.sort - b.sort)
    .map((item) => ({
      rid: randomUuid(),
      key: item.key,
      name: item.name,
      source: item.source,
      amount: item.amount.replace(/\.00$/, ''),
      sort: String(item.sort),
    }));
}

/** An empty item; the order goes after the last one. */
export function newDraft(drafts: readonly ItemDraft[], source: KpiSource = 'MANUAL'): ItemDraft {
  const last = drafts.reduce((max, draft) => Math.max(max, Number(draft.sort) || 0), 0);
  return { rid: randomUuid(), key: null, name: '', source, amount: '', sort: String(last + 1) };
}

/** The first thing wrong with the items as an i18n key, or null. */
export function itemsProblem(drafts: readonly ItemDraft[]): string | null {
  if (drafts.length > PAYROLL_LIMITS.maxItems) return 'validation.tooLong';
  for (const draft of drafts) {
    if (draft.name.trim() === '') return 'validation.required';
    if (!PAYROLL_AMOUNT_PATTERN.test(draft.amount)) return 'validation.money';
  }
  return null;
}

export function requestOf(drafts: readonly ItemDraft[]): PayrollKpiItemRequest[] {
  return drafts.map((draft, index) => ({
    ...(draft.key ? { key: draft.key } : {}),
    name: draft.name.trim(),
    source: draft.source,
    amount: draft.amount,
    sort: /^\d+$/.test(draft.sort) ? Number(draft.sort) : index + 1,
  }));
}

/** The sum of the amounts typed so far, in tögrög. */
export function draftsTotal(drafts: readonly ItemDraft[]): string {
  let cents = 0n;
  for (const draft of drafts) {
    if (!PAYROLL_AMOUNT_PATTERN.test(draft.amount)) continue;
    const [whole = '0', fraction = ''] = draft.amount.split('.');
    cents += BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  }
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
}
