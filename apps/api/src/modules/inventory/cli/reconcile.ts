import 'reflect-metadata';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { Pool } from 'pg';
import { loadDotEnvIfPresent } from '../../../common/config/dotenv';
import { parseEnv } from '../../../common/config/env.schema';
import { createDb } from '../../../common/db/db.module';
import { configurePgTypeParsers } from '../../../common/db/pg-types';
import { NumberingService } from '../../identity';
import { type ReconciliationRun, StockPostingService } from '../services/stock-posting.service';

const SHOWN = 20;

/** One line per difference, the first SHOWN of them. */
export function describeRun(run: ReconciliationRun): string[] {
  if (run.status === 'OK') {
    return [`Stock reconciliation OK (run ${run.id}, snapshot ${run.snapshotDate}).`];
  }
  return [
    `Stock reconciliation DRIFT: ${run.diffCount} difference(s) (run ${run.id}).`,
    ...run.diffs
      .slice(0, SHOWN)
      .map(
        (diff) =>
          `  ${diff.level} warehouse ${diff.warehouseId}${diff.binId === null ? '' : ` bin ${diff.binId}`} product ${diff.productId}${diff.lotId === null ? '' : ` lot ${diff.lotId}`}: ledger ${diff.ledger}, cache ${diff.cache}`,
      ),
    ...(run.diffCount > SHOWN ? [`  … and ${run.diffCount - SHOWN} more`] : []),
    'Fix the cause, then `pnpm inventory:rebuild-balances` recomputes the caches from the ledger.',
  ];
}

/**
 * `pnpm inventory:reconcile`: checks both balance caches against the ledger (§5.3 D10), writes the
 * day's snapshot and a reconciliation run. Exits with 2 on drift so a scheduler notices.
 */
async function main(): Promise<void> {
  loadDotEnvIfPresent(join(__dirname, '..', '..', '..', '..', '.env'));
  // pnpm 11 forwards a `--` separator to the script verbatim; options never start with one.
  const args = process.argv.slice(2);
  while (args[0] === '--') args.shift();
  parseArgs({ args, options: {} });
  const env = parseEnv(process.env, 'api');
  configurePgTypeParsers();
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: 1,
    application_name: 'tugeel-cli',
  });
  try {
    const run = await new StockPostingService(createDb(pool), new NumberingService()).reconcile(
      'CLI',
    );
    for (const line of describeRun(run)) console.log(line);
    if (run.status === 'DRIFT') process.exitCode = 2;
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
