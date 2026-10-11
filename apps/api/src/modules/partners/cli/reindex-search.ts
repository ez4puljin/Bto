import 'reflect-metadata';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { SEARCH_KEYS_VERSION, searchKeys } from '@tugeel/shared/text';
import { and, asc, eq, gt, lt } from 'drizzle-orm';
import { Pool } from 'pg';
import { loadDotEnvIfPresent } from '../../../common/config/dotenv';
import { parseEnv } from '../../../common/config/env.schema';
import { createDb } from '../../../common/db/db.module';
import type { Db } from '../../../common/db/db.types';
import { configurePgTypeParsers } from '../../../common/db/pg-types';
import { customers, suppliers } from '../schema';

const BATCH = 500;

/**
 * Recomputes customer and supplier search keys written by an older SEARCH_KEYS_VERSION (every row
 * with `all`), in batches by id (ADR-0028 #4). Keys are derived data, so nothing is audited.
 */
export async function reindexSearch(
  db: Db,
  options: { all?: boolean } = {},
): Promise<{ customers: number; suppliers: number }> {
  return {
    customers: await reindexTable(db, customers, options),
    suppliers: await reindexTable(db, suppliers, options),
  };
}

async function reindexTable(
  db: Db,
  table: typeof customers | typeof suppliers,
  options: { all?: boolean },
): Promise<number> {
  let lastId = 0;
  let updated = 0;
  for (;;) {
    const rows = await db
      .select({ id: table.id, code: table.code, name: table.name })
      .from(table)
      .where(
        and(
          gt(table.id, lastId),
          options.all ? undefined : lt(table.searchVersion, SEARCH_KEYS_VERSION),
        ),
      )
      .orderBy(asc(table.id))
      .limit(BATCH);
    const last = rows.at(-1);
    if (!last) return updated;
    for (const row of rows) {
      const keys = searchKeys(row.name, [row.code]);
      await db
        .update(table)
        .set({
          searchText: keys.strict,
          searchPhonetic: keys.phonetic,
          searchVersion: keys.version,
        })
        .where(eq(table.id, row.id));
      updated += 1;
    }
    lastId = last.id;
  }
}

async function main(): Promise<void> {
  loadDotEnvIfPresent(join(__dirname, '..', '..', '..', '..', '.env'));
  // pnpm 11 forwards a `--` separator to the script verbatim; options never start with one.
  const args = process.argv.slice(2);
  while (args[0] === '--') args.shift();
  const { values } = parseArgs({ args, options: { all: { type: 'boolean', default: false } } });
  const env = parseEnv(process.env, 'api');
  configurePgTypeParsers();
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: 1,
    application_name: 'tugeel-cli',
  });
  try {
    const counts = await reindexSearch(createDb(pool), { all: values.all });
    console.log(
      `Search keys recomputed for ${counts.customers} customer(s) and ${counts.suppliers} supplier(s) (version ${SEARCH_KEYS_VERSION}).`,
    );
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
