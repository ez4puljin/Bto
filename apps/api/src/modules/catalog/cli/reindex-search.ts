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
import { products } from '../schema';

const BATCH = 500;

/**
 * Recomputes product search keys written by an older SEARCH_KEYS_VERSION (every product with `all`),
 * in batches by id (ADR-0028 #4). Keys are derived data, so nothing is audited. Returns the count.
 */
export async function reindexSearch(db: Db, options: { all?: boolean } = {}): Promise<number> {
  let lastId = 0;
  let updated = 0;
  for (;;) {
    const rows = await db
      .select({ id: products.id, sku: products.sku, name: products.name })
      .from(products)
      .where(
        and(
          gt(products.id, lastId),
          options.all ? undefined : lt(products.searchVersion, SEARCH_KEYS_VERSION),
        ),
      )
      .orderBy(asc(products.id))
      .limit(BATCH);
    const last = rows.at(-1);
    if (!last) return updated;
    for (const row of rows) {
      const keys = searchKeys(row.name, [row.sku]);
      await db
        .update(products)
        .set({
          searchText: keys.strict,
          searchPhonetic: keys.phonetic,
          searchVersion: keys.version,
        })
        .where(eq(products.id, row.id));
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
    const count = await reindexSearch(createDb(pool), { all: values.all });
    console.log(`Search keys recomputed for ${count} product(s) (version ${SEARCH_KEYS_VERSION}).`);
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
