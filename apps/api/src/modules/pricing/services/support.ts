import { businessDate, isIsoDate } from '@tugeel/shared/time';
import { sql } from 'drizzle-orm';
import type { Tx } from '../../../common/db/db.types';
import { invalid } from '../../../common/errors/app-error';

/**
 * pg_advisory_xact_lock keys of the pricing module (catalog 72_026_1xx, partners 72_027_xxx,
 * inventory 72_028_xxx, imports 72_029_xxx).
 */
export const LOCKS = {
  /** Two-key form (this, product unit id): one change of a unit's prices at a time. */
  unitPrice: 72_030_001,
} as const;

export async function advisoryLock(tx: Tx, key: number, id: number): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${key}::int, ${id}::int)`);
}

/** A row in force on `date`: started, and not ended (a row closed on its first day never was). */
export function inForceOn(
  row: { validFrom: string; validTo: string | null },
  date: string,
): boolean {
  return row.validFrom <= date && (row.validTo === null || row.validTo > date);
}

/** A row that ever applied: not closed on its first day. */
export function applied(row: { validFrom: string; validTo: string | null }): boolean {
  return row.validTo === null || row.validTo > row.validFrom;
}

/** Prices and programs change from today on: history is never rewritten (ADR-0041). */
export function assertNotPast(path: string, date: string, today = businessDate()): void {
  if (!isIsoDate(date)) throw invalid(path, 'isDate', `${path} must be a date`);
  if (date < today) throw invalid(path, 'notPast', `${path} must be today or later`);
}
