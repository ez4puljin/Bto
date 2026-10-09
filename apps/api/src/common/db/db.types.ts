import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import type * as schema from '../../db/schema';

export type Schema = typeof schema;
export type Db = NodePgDatabase<Schema> & { $client: Pool };
/** The transaction object Drizzle passes to `db.transaction(async (tx) => …)`. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
