import 'reflect-metadata';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { Pool } from 'pg';
import { loadDotEnvIfPresent } from '../../../common/config/dotenv';
import { parseEnv } from '../../../common/config/env.schema';
import { createDb } from '../../../common/db/db.module';
import { configurePgTypeParsers } from '../../../common/db/pg-types';
import { postingKeyBalances } from '../../../finance-core';
import { NumberingService } from '../../identity';
import { StockPostingService } from '../../inventory';
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
    const db = createDb(pool);
    const run = await reconcileReceivables(db, 'MANUAL');
    for (const line of describeRun(run)) console.log(line);
    // The stock's value against the INVENTORY account (F4, ADR-0097): information, never an exit 2;
    // the averages' four decimals leave cents. Receipts confirmed and not yet priced are in the
    // stock's value and not yet in the books (ADR-0233), so their value is shown beside it.
    // A receipt confirmed before ADR-0233 and still unpriced was booked at its confirmation, so it
    // is in the books already and the difference shows its value until it is priced (the CLI has
    // no call context to read the core's documents with).
    const posting = new StockPostingService(db, new NumberingService());
    const stock = await posting.stockValue();
    const unpriced = await posting.unpricedReceiptValue();
    for (const books of await postingKeyBalances(db, 'INVENTORY')) {
      console.log(
        `Stock value ${stock.toFixed(2)} (receipts waiting for prices went in at ${unpriced.toFixed(2)}, taken off; one confirmed before ADR-0233 is in the books already); ${books.company} ${books.accountCode ?? '—'} ${books.balance.toFixed(2)}; difference ${stock.minus(unpriced).minus(books.balance).toFixed(2)}.`,
      );
    }
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
