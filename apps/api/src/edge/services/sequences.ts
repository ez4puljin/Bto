import { and, eq, sql } from 'drizzle-orm';
import type { EdgeDb, EdgeTx } from '../db/edge-db';
import { edgeSequences } from '../db/schema';

/**
 * The next number of a till's series on a business day, inside the transaction that uses it, so a
 * rolled-back sale leaves no gap (`posSaleNumber`, `posShiftNumber` print it).
 */
/**
 * The number the series will give next, without taking it: what the till shows while a sale is
 * being rung up (owner 2026-11-04). Another PC on the same POS may take it first.
 */
export async function peekSequence(db: EdgeDb, key: string, day: string): Promise<number> {
  const [row] = await db
    .select({ last: edgeSequences.last })
    .from(edgeSequences)
    .where(and(eq(edgeSequences.key, key), eq(edgeSequences.day, day)));
  return (row?.last ?? 0) + 1;
}

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
