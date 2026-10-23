import { and, eq, gte, sql } from 'drizzle-orm';
import type { FinTx } from '../db/fin-db';
import { FinError } from '../errors';
import { finFiscalPeriods } from '../schema';

/**
 * pg_advisory_xact_lock key per company between postings (shared) and a close or reopen (exclusive,
 * ADR-0102 #2): a posting that creates an earlier month's row never interleaves with a close.
 */
export const PERIOD_LOCK = 72_026_133;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The month of a business date, `YYYY-MM`, with its first and last day (calendar arithmetic only). */
export function monthOf(date: string): { code: string; startsOn: string; endsOn: string } {
  const match = ISO_DATE.exec(date);
  if (!match) throw new FinError('FIN_PAYLOAD_INVALID', undefined, { path: 'entryDate' });
  const [, year = '', month = ''] = match;
  const y = Number.parseInt(year, 10);
  const m = Number.parseInt(month, 10);
  if (m < 1 || m > 12) throw new FinError('FIN_PAYLOAD_INVALID', undefined, { path: 'entryDate' });
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const lastDay = m === 2 ? (leap ? 29 : 28) : [4, 6, 9, 11].includes(m) ? 30 : 31;
  const code = `${year}-${month}`;
  return { code, startsOn: `${code}-01`, endsOn: `${code}-${String(lastDay).padStart(2, '0')}` };
}

/**
 * The OPEN period a posting dated `date` lands in, share-locked for the rest of the transaction (a
 * close takes the company's period lock exclusively and the row FOR UPDATE, ADR-0102 #2). A month without a row is created OPEN, unless the company has
 * closed that month or a later one (ADR-0075, docs/modules/finance-core.md §4): a document dated
 * in a closed month, or in an earlier month that has no row, is refused with FIN_PERIOD_CLOSED.
 */
export async function openPeriodInTx(tx: FinTx, companyId: number, date: string): Promise<number> {
  const month = monthOf(date);
  await tx.execute(sql`SELECT pg_advisory_xact_lock_shared(${PERIOD_LOCK}, ${companyId})`);
  const [closedLater] = await tx
    .select({ code: finFiscalPeriods.code })
    .from(finFiscalPeriods)
    .where(
      and(
        eq(finFiscalPeriods.companyId, companyId),
        eq(finFiscalPeriods.status, 'CLOSED'),
        gte(finFiscalPeriods.code, month.code),
      ),
    )
    .limit(1);
  if (!closedLater) {
    await tx
      .insert(finFiscalPeriods)
      .values({ companyId, ...month })
      .onConflictDoNothing({ target: [finFiscalPeriods.companyId, finFiscalPeriods.code] });
  }
  const [period] = await tx
    .select({ id: finFiscalPeriods.id, status: finFiscalPeriods.status })
    .from(finFiscalPeriods)
    .where(and(eq(finFiscalPeriods.companyId, companyId), eq(finFiscalPeriods.code, month.code)))
    .for('share');
  if (!period || period.status !== 'OPEN') {
    throw new FinError('FIN_PERIOD_CLOSED', undefined, { period: month.code });
  }
  return period.id;
}
