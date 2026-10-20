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

/** One line per drift, the first SHOWN of them: the core's runs, then the invoices' mirror. */
export function describeRun(run: FinanceReconcileRun): string[] {
  const core = run.core.map(
    (own) =>
      `  core ${own.kind}: ${own.status} (${own.drifted} of ${own.checked}, run ${own.id})` +
      own.details
        .slice(0, SHOWN)
        .map(
          (drift) =>
            `\n    party ${drift.partyId}, account ${drift.accountId}${drift.itemId ? `, item ${drift.itemId}` : ''}: expected ${drift.expected}, found ${drift.found}`,
        )
        .join(''),
  );
  if (run.status === 'OK') {
    return [`Receivables reconciliation OK (run ${run.id}, ${run.checked} invoice(s)).`, ...core];
  }
  return [
    `Receivables reconciliation DRIFT: ${run.drifted} drift(s) (run ${run.id}).`,
    ...core,
    ...run.details
      .slice(0, SHOWN)
      .map(
        (drift) =>
          `  invoice ${drift.number}: open ${drift.mirrorOpen} on the invoice, ${drift.itemOpen} in the Finance Core`,
      ),
    ...(run.details.length > SHOWN ? [`  … and ${run.details.length - SHOWN} more`] : []),
    'The invoices and the cache were rewritten from the items; find what wrote them wrong (docs/modules/finance.md §7).',
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
