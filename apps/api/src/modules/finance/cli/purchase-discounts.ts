import 'reflect-metadata';
import { parseArgs } from 'node:util';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DbModule } from '../../../common/db/db.module';
import { JobsModule } from '../../../common/jobs/jobs.module';
import { CoreModule } from '../../../core.module';
import { FinBridgeModule } from '../../fin-bridge';
import { systemActor } from '../../identity';
import { ReceiptsService } from '../../inventory';
import { FinanceModule } from '../finance.module';
import {
  describeConversion,
  PurchaseDiscountsService,
} from '../services/purchase-discounts.service';

/** Just what the conversion needs: finance (with inventory) and the Finance Core's boot step. */
@Module({
  imports: [CoreModule.forRoot('api'), DbModule, JobsModule, FinBridgeModule, FinanceModule],
})
class PurchaseDiscountsModule {}

/**
 * `pnpm finance:purchase-discounts -- --receipt GR-2026-000001 [--apply]` (ADR-0236): brings a
 * receipt costed before that decision to it. Its discount leaves the products' cost (the stock on
 * hand and the cost of goods sold rise to the price before the discount) and is booked as income
 * on «Худалдан авалтын хөнгөлөлт» against the payable, which stays as it was. Without `--apply` it
 * is a dry run: everything is worked out in a transaction that is rolled back, and the product cost
 * changes and the entry are printed. Run once per such receipt; a receipt already brought over
 * answers that it has nothing to do.
 */
async function main(): Promise<void> {
  // pnpm 11 forwards a `--` separator to the script verbatim; options never start with one.
  const args = process.argv.slice(2);
  while (args[0] === '--') args.shift();
  const { values } = parseArgs({
    args,
    options: { receipt: { type: 'string' }, apply: { type: 'boolean', default: false } },
  });
  if (!values.receipt) {
    throw new Error('usage: finance:purchase-discounts -- --receipt <GR-number> [--apply]');
  }
  const app = await NestFactory.createApplicationContext(PurchaseDiscountsModule, {
    logger: ['error'],
  });
  try {
    const receiptId = await app.get(ReceiptsService).idOfNumber(values.receipt);
    if (receiptId === null) throw new Error(`no goods receipt ${values.receipt}`);
    const outcome = await app
      .get(PurchaseDiscountsService)
      .convert(systemActor('cli:purchase-discounts'), receiptId, { dryRun: !values.apply });
    if (outcome === null) {
      console.log(`${values.receipt}: no discount inside its cost; nothing to do.`);
      return;
    }
    for (const line of describeConversion(outcome)) console.log(line);
    if (!outcome.applied) console.log('Run again with --apply to write it.');
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
