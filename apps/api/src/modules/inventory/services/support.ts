import { sql } from 'drizzle-orm';
import type { Tx } from '../../../common/db/db.types';

/** pg_advisory_xact_lock keys of the inventory module (catalog 72_026_1xx, partners 72_027_xxx). */
export const LOCKS = {
  systemBins: 72_028_001,
  /** Two-key form (this, product id): one home warehouse per product. */
  productHome: 72_028_002,
} as const;

export async function advisoryLock(tx: Tx, key: number, id?: number): Promise<void> {
  await tx.execute(
    id === undefined
      ? sql`SELECT pg_advisory_xact_lock(${key})`
      : sql`SELECT pg_advisory_xact_lock(${key}::int, ${id}::int)`,
  );
}

/** Trimmed text or null; an empty string clears the field. */
export function optionalText(value: string | null | undefined): string | null | undefined {
  if (value === undefined || value === null) return value;
  const text = value.trim();
  return text === '' ? null : text;
}
