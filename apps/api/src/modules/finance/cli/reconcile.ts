import 'reflect-metadata';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { Pool } from 'pg';
import { loadDotEnvIfPresent } from '../../../common/config/dotenv';
import { parseEnv } from '../../../common/config/env.schema';
import { createDb } from '../../../common/db/db.module';
import { configurePgTypeParsers } from '../../../common/db/pg-types';
import { type FinanceReconcileRun, reconcileReceivables } from '../services/ar-ledger.service';

const SHOWN = 20;

/** One line per drifted customer, the first SHOWN of them. */
export function describeRun(run: FinanceReconcileRun): string[] {
  if (run.status === 'OK') {
    return [`Receivables reconciliation OK (run ${run.id}, ${run.checked} customer(s)).`];
  }
  return [
    `Receivables reconciliation DRIFT: ${run.drifted} of ${run.checked} customer(s) (run ${run.id}).`,
    ...run.details
      .slice(0, SHOWN)
      .map(
        (drift) =>
          `  customer ${drift.customerId}: cache ${drift.cachedBalance} / ${drift.cachedOpenInvoices} open, ledger ${drift.ledgerBalance} / ${drift.ledgerOpenInvoices} open`,
      ),
    ...(run.drifted > SHOWN ? [`  … and ${run.drifted - SHOWN} more`] : []),
    'The cache was rewritten from the ledger; find what wrote it wrong (docs/modules/finance.md §7).',
  ];
}

/**
 * `pnpm finance:reconcile`: checks the receivables cache against the ledger and the invoices,
 * rewrites it and records a run. Exits with 2 on drift so a scheduler notices.
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
    const run = await reconcileReceivables(createDb(pool), 'MANUAL');
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
