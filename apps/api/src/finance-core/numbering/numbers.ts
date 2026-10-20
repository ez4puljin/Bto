import { and, eq } from 'drizzle-orm';
import { nextCounterValue } from '../../common/db/counters';
import type { FinTx } from '../db/fin-db';
import type { FinExecutor } from '../context/authorize';
import { FinError } from '../errors';
import { finNumberCounters, finNumberSeries } from '../schema';

/** The series every company has: vouchers, journal entries, allocations (ADR-0090). */
export const FIN_SERIES = { PAYMENT: 'PAYMENT', JOURNAL: 'JOURNAL', ALLOCATION: 'ALLOCATION' } as const;

export interface FinNumberFormat {
  pattern: string;
  digits: number;
}

const TOKEN = /\{([a-z]+)\}/g;

/**
 * The prefix a pattern gives on a business date: `{year}`, `{month}` and `{day}` replaced by its
 * parts (the owner's format of ADR-0057 #3, which Bto's `orderNumberPrefix` renders the same way).
 */
export function seriesPrefix(pattern: string, isoDate: string): string {
  const parts: Record<string, string> = {
    year: isoDate.slice(0, 4),
    month: isoDate.slice(5, 7),
    day: isoDate.slice(8, 10),
  };
  return pattern.replace(TOKEN, (whole, token: string) => parts[token] ?? whole);
}

/** The prefix and the counter padded to `digits` (never cut when it grows longer). */
export function seriesNumber(prefix: string, digits: number, value: number): string {
  return `${prefix}${String(value).padStart(digits, '0')}`;
}

/** A company's series, or null. */
export async function seriesOf(
  executor: FinExecutor,
  companyId: number,
  code: string,
): Promise<FinNumberFormat | null> {
  const [row] = await executor
    .select({ pattern: finNumberSeries.pattern, digits: finNumberSeries.digits })
    .from(finNumberSeries)
    .where(and(eq(finNumberSeries.companyId, companyId), eq(finNumberSeries.code, code)));
  return row ?? null;
}

/**
 * The next number of a series on a business date, gap-free (the counter row is locked until the
 * transaction ends and a rollback gives the number back). Taken last in a posting (ADR-0071 #6).
 */
export async function nextNumberInTx(
  tx: FinTx,
  companyId: number,
  code: string,
  isoDate: string,
): Promise<string> {
  const format = await seriesOf(tx, companyId, code);
  if (!format) throw new FinError('FIN_DOCTYPE_UNKNOWN', undefined, { series: code });
  const prefix = seriesPrefix(format.pattern, isoDate);
  const value = await nextCounterValue(
    tx,
    {
      table: finNumberCounters,
      key: [finNumberCounters.companyId, finNumberCounters.scope, finNumberCounters.period],
      value: finNumberCounters.value,
      valueProperty: 'value',
    },
    { companyId, scope: code, period: prefix },
  );
  return seriesNumber(prefix, format.digits, value);
}
