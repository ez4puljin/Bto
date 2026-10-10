import mn from '@tugeel/shared/i18n/mn.json';
import { nameKey } from '@tugeel/shared/text';
import { sql } from 'drizzle-orm';
import type { Tx } from '../../common/db/db.types';
import { SYSTEM_UOMS, uoms } from './schema';

/** pg_advisory_xact_lock key of the catalog's boot sync (identity uses 72_026_102). */
const CATALOG_REFERENCE_LOCK = 72_026_103;

/**
 * Inserts the system units of measure that are missing, named from mn.json. Never overwrites a row:
 * the admin may rename a unit or set its e-Barimt measure unit. Runs at api boot, like identity's
 * catalog sync, so test truncation is repaired by booting the app.
 */
export async function syncSystemUoms(tx: Tx): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${CATALOG_REFERENCE_LOCK})`);
  for (const uom of SYSTEM_UOMS) {
    const name = mn.uoms.system[uom.code];
    await tx
      .insert(uoms)
      .values({ code: uom.code, name, nameKey: nameKey(name), fractional: uom.fractional })
      .onConflictDoNothing();
  }
}
