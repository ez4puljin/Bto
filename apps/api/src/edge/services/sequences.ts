import { sql } from 'drizzle-orm';
import type { EdgeTx } from '../db/edge-db';
import { edgeSequences } from '../db/schema';

/**
 * The next number of a till's series on a business day, inside the transaction that uses it, so a
 * rolled-back sale leaves no gap (`posSaleNumber`, `posShiftNumber` print it).
 */
export async function nextSequence(tx: EdgeTx, key: string, day: string): Promise<number> {
  const [row] = await tx
    .insert(edgeSequences)
    .values({ key, day, last: 1 })
    .onConflictDoUpdate({
      target: [edgeSequences.key, edgeSequences.day],
      set: { last: sql`${edgeSequences.last} + 1` },
    })
    .returning({ last: edgeSequences.last });
  if (!row) throw new Error(`no sequence for ${key} ${day}`);
  return row.last;
}
