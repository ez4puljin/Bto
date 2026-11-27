import { isPayrollMonth } from '@tugeel/shared/payroll';
import { sql } from 'drizzle-orm';
import type { Tx } from '../../common/db/db.types';
import { invalid } from '../../common/errors/app-error';

/** All payroll writers acquire month locks in ascending month order. */
export async function lockMonth(tx: Tx, month: string): Promise<void> {
  const key = Number.parseInt(month.replace('-', ''), 10);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${72_026_235}, ${key})`);
}

export function assertMonth(month: string, path = 'month'): void {
  if (!isPayrollMonth(month)) throw invalid(path, 'isMonth', 'YYYY-MM');
}
