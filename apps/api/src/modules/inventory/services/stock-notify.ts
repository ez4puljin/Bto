import { sql } from 'drizzle-orm';
import type { Tx } from '../../../common/db/db.types';

/**
 * The live stock notice (ADR-0173 #4): every write that can change what an app shows as a
 * product's stock — a posting, a reservation, a home warehouse moved — calls one of these inside
 * its transaction. PostgreSQL delivers a NOTIFY only when that transaction commits (a rollback
 * sends nothing) and to every listening connection of the database, so a write made by the worker
 * or a CLI reaches the api's `LiveStockHub` too. Nothing here waits on a listener: a notice nobody
 * hears is dropped by the server.
 */
export const STOCK_NOTICE_CHANNEL = 'bto_stock';

/** The payload that says "everything may have changed" (a setting, a balance rebuild). */
export const STOCK_NOTICE_RESYNC = '*';

/**
 * A NOTIFY payload must stay under 8,000 bytes; ids are comma-joined and cut into chunks below
 * this many characters (ASCII, so characters are bytes).
 */
const MAX_PAYLOAD = 7_000;

/** Announces that these products' stock changed, at commit; duplicates are sent once. */
export async function notifyStockChanged(tx: Tx, productIds: Iterable<number>): Promise<void> {
  const unique = [...new Set(productIds)].sort((a, b) => a - b);
  if (unique.length === 0) return;
  const payloads: string[] = [];
  let current = '';
  for (const id of unique) {
    const piece = String(id);
    if (current.length > 0 && current.length + 1 + piece.length > MAX_PAYLOAD) {
      payloads.push(current);
      current = '';
    }
    current = current.length === 0 ? piece : `${current},${piece}`;
  }
  payloads.push(current);
  await tx.execute(
    sql`SELECT pg_notify(${STOCK_NOTICE_CHANNEL}, p) FROM unnest(${sql.param(payloads)}::text[]) p`,
  );
}

/** Announces that every product's stock may have changed, at commit. */
export async function notifyStockResync(tx: Tx): Promise<void> {
  await tx.execute(sql`SELECT pg_notify(${STOCK_NOTICE_CHANNEL}, ${STOCK_NOTICE_RESYNC})`);
}

/** A received payload: the product ids, or RESYNC (also for anything that does not parse). */
export function parseStockNotice(payload: string | undefined): number[] | 'RESYNC' {
  if (payload === undefined || payload === STOCK_NOTICE_RESYNC) return 'RESYNC';
  const ids: number[] = [];
  for (const piece of payload.split(',')) {
    if (!/^[1-9][0-9]{0,15}$/.test(piece)) return 'RESYNC';
    ids.push(Number.parseInt(piece, 10));
  }
  return ids;
}
