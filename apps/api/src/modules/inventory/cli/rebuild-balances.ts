import 'reflect-metadata';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { Pool } from 'pg';
import { loadDotEnvIfPresent } from '../../../common/config/dotenv';
import { parseEnv } from '../../../common/config/env.schema';
import { createDb } from '../../../common/db/db.module';
import { configurePgTypeParsers } from '../../../common/db/pg-types';
import { NumberingService } from '../../identity';
import { StockPostingService } from '../services/stock-posting.service';
import { describeRun } from './reconcile';

/**
 * `pnpm inventory:rebuild-balances`: recomputes bin_stock and warehouse_stock quantities from the
 * ledger with both tables locked against postings (averages are kept), then reconciles.
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
    const posting = new StockPostingService(createDb(pool), new NumberingService());
    const result = await posting.rebuildBalances();
    console.log(
      `Balances rebuilt from the ledger: ${result.binRows} bin row(s) and ${result.warehouseRows} warehouse row(s) corrected, ${result.newWarehouseRows} warehouse row(s) added.`,
    );
    const run = await posting.reconcile('CLI_REBUILD');
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
