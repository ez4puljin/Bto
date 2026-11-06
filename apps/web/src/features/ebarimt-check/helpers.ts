import {
  EBARIMT_DIFF_TOLERANCE,
  nextPeriod,
  periodMonth,
  periodYear,
} from '@tugeel/shared/ebarimt-check';
import { Decimal } from '@tugeel/shared/money';
import { useTranslation } from 'react-i18next';
import { formatMnt } from '@/lib/money';

const TOLERANCE = new Decimal(EBARIMT_DIFF_TOLERANCE);

/** An amount in the table: whole tugriks read easier, nothing reads as a dash. */
export function amountText(value: string): string {
  const amount = new Decimal(value);
  return amount.isZero() ? '—' : formatMnt(amount.toDecimalPlaces(0).toFixed(0));
}

export type DiffState = 'missing' | 'ok' | 'over';

export function diffStateOf(value: string): DiffState {
  const diff = new Decimal(value);
  if (diff.greaterThan(TOLERANCE)) return 'missing';
  if (diff.lessThan(TOLERANCE.negated())) return 'over';
  return 'ok';
}

/** «3-р сар» within the year looked at, «2025/12» outside it. */
export function usePeriodLabels(baseYear?: number) {
  const { t } = useTranslation();
  const name = (period: number) =>
    periodYear(period) === baseYear
      ? t('ebarimtCheck.monthName', { month: periodMonth(period) })
      : t('ebarimtCheck.periodShort', { year: periodYear(period), month: periodMonth(period) });
  /** Several months in one phrase: «2026 · 1–3, 5-р сар» or «2025/12 – 2026/10». */
  const many = (periods: readonly number[]) => {
    const sorted = [...new Set(periods)].sort((a, b) => a - b);
    if (sorted.length === 0) return t('ebarimtCheck.noMonths');
    const parts: string[] = [];
    for (let i = 0; i < sorted.length; i += 1) {
      let j = i;
      while (j + 1 < sorted.length && sorted[j + 1] === nextPeriod(sorted[j] as number)) j += 1;
      const from = sorted[i] as number;
      const to = sorted[j] as number;
      parts.push(
        from === to
          ? t('ebarimtCheck.periodShort', { year: periodYear(from), month: periodMonth(from) })
          : `${t('ebarimtCheck.periodShort', { year: periodYear(from), month: periodMonth(from) })} – ${t('ebarimtCheck.periodShort', { year: periodYear(to), month: periodMonth(to) })}`,
      );
      i = j;
    }
    return parts.join(', ');
  };
  return { name, many };
}
