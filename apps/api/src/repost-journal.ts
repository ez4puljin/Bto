import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DbModule } from './common/db/db.module';
import { DB } from './common/db/db.tokens';
import type { Db } from './common/db/db.types';
import { inTransaction } from './common/db/transaction';
import { JobsModule } from './common/jobs/jobs.module';
import { CoreModule } from './core.module';
import { FinBridgeModule } from './modules/fin-bridge';
import { FinanceModule, JournalRepostService } from './modules/finance';
import { systemActor } from './modules/identity';
import { PosModule, PosShiftsService } from './modules/pos';

/** Just what the re-post needs: finance and pos, with the Finance Core's boot step (fin-bridge). */
@Module({
  imports: [
    CoreModule.forRoot('api'),
    DbModule,
    JobsModule,
    FinBridgeModule,
    FinanceModule,
    PosModule,
  ],
})
class RepostJournalModule {}

/**
 * `pnpm finance:repost-journal` (development only, ADR-0089, ADR-0083 #2): migration 0033 dropped
 * Finance I's journal without a copy; this posts the entries of the database's invoices, credit
 * notes, vouchers, voids and closed POS shifts again through the Finance Core and writes the new
 * entry ids back. Run once after `pnpm db:migrate`, with `pnpm dev` stopped; idempotent.
 */
async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('finance:repost-journal is a development tool; production books start empty');
  }
  const app = await NestFactory.createApplicationContext(RepostJournalModule, {
    logger: ['error'],
  });
  try {
    const actor = systemActor('cli:repost-journal');
    const counts = await app.get(JournalRepostService).repost(actor);
    const shifts = app.get(PosShiftsService);
    const db = app.get<Db>(DB);
    let shiftCount = 0;
    for (const shiftId of await shifts.closedWithoutEntry()) {
      const entry = await inTransaction(db, (tx) => shifts.repostCloseInTx(tx, actor, shiftId));
      if (entry) shiftCount += 1;
    }
    console.log(
      `Re-posted: ${counts.invoices} invoice(s), ${counts.invoiceVoids} invoice void(s), ` +
        `${counts.creditNotes} credit note(s), ${counts.payments} voucher(s), ` +
        `${counts.paymentVoids} voucher void(s), ${shiftCount} POS shift close(s).`,
    );
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
