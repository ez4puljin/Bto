import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgTransaction } from 'drizzle-orm/pg-core';

/**
 * A node-postgres Drizzle transaction over any schema (ADR-0069 #7). Code that must not know Bto's
 * aggregated schema (the Finance Core, the job enqueue) takes this type, so Bto's `Tx` and the core's
 * own transactions both fit; `any-tx.spec.ts` proves Bto's `Tx` is assignable.
 */
export type AnyTx = PgTransaction<NodePgQueryResultHKT, any, any>;
