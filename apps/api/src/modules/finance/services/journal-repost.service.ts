import { Inject, Injectable } from '@nestjs/common';
import { businessDate } from '@tugeel/shared/time';
import { and, asc, eq, gt, isNotNull, isNull } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { type Actor } from '../../identity';
import { CustomersService } from '../../partners';
import { creditNotes, invoices, payments } from '../schema';
import { creditNoteEntryLines } from './credit-notes.service';
import { invoiceEntryLines } from './invoicing.service';
import { JournalService } from './journal.service';
import { MoneyAccountsService } from './money-accounts.service';
import { paymentEntryLines, paymentLabel } from './payments.service';

export interface RepostCounts {
  invoices: number;
  invoiceVoids: number;
  creditNotes: number;
  payments: number;
  paymentVoids: number;
}

/**
 * The one-off development re-post of F1's ledger (ADR-0089, ADR-0083 #2): migration 0033 dropped
 * Finance I's journal without a copy and cleared the documents' entry ids; this posts each
 * document's entry again through today's path, dated as the document (a void on the day it was
 * voided), and writes the new ids back. Idempotent: a document that has its entry is skipped.
 * Never part of a request; `pnpm finance:repost-journal` runs it with the POS shifts.
 */
@Injectable()
export class JournalRepostService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly journal: JournalService,
    private readonly customers: CustomersService,
    private readonly moneyAccounts: MoneyAccountsService,
  ) {}

  async repost(actor: Actor): Promise<RepostCounts> {
    const counts: RepostCounts = {
      invoices: 0,
      invoiceVoids: 0,
      creditNotes: 0,
      payments: 0,
      paymentVoids: 0,
    };
    const names = new Map(
      (
        await this.customers.getMany(
          (await this.db.select({ id: invoices.customerId }).from(invoices))
            .map((row) => row.id)
            .concat(
              (
                await this.db
                  .select({ id: payments.customerId })
                  .from(payments)
                  .where(isNotNull(payments.customerId))
              ).flatMap((row) => (row.id === null ? [] : [row.id])),
            ),
        )
      ).map((customer) => [customer.id, customer.name]),
    );
    const label = (number: string, who: string | null | undefined) => paymentLabel(number, who);

    for (const invoice of await this.db
      .select()
      .from(invoices)
      .where(and(isNull(invoices.journalEntryId), gt(invoices.subtotal, invoices.discountTotal)))
      .orderBy(asc(invoices.invoiceDate), asc(invoices.id))) {
      if (!invoice.subtotal.gt(0)) continue;
      await inTransaction(this.db, async (tx) => {
        const entry = await this.journal.post(tx, actor, {
          entryDate: invoice.invoiceDate,
          description: label(invoice.number, names.get(invoice.customerId)),
          source: 'AUTO_INVOICE',
          sourceType: 'INVOICE',
          sourceId: invoice.id,
          lines: invoiceEntryLines(invoice.customerId, invoice),
        });
        await tx
          .update(invoices)
          .set({ journalEntryId: entry.id })
          .where(eq(invoices.id, invoice.id));
      });
      counts.invoices += 1;
    }

    for (const note of await this.db
      .select()
      .from(creditNotes)
      .where(isNull(creditNotes.journalEntryId))
      .orderBy(asc(creditNotes.noteDate), asc(creditNotes.id))) {
      await inTransaction(this.db, async (tx) => {
        const entry = await this.journal.post(tx, actor, {
          entryDate: note.noteDate,
          description: label(note.number, names.get(note.customerId)),
          source: 'AUTO_CREDIT_NOTE',
          sourceType: 'CREDIT_NOTE',
          sourceId: note.id,
          lines: creditNoteEntryLines(note.customerId, note),
        });
        await tx
          .update(creditNotes)
          .set({ journalEntryId: entry.id })
          .where(eq(creditNotes.id, note.id));
      });
      counts.creditNotes += 1;
    }

    const accounts = new Map((await this.moneyAccounts.list()).map((row) => [row.id, row]));
    for (const payment of await this.db
      .select()
      .from(payments)
      .where(isNull(payments.journalEntryId))
      .orderBy(asc(payments.paidOn), asc(payments.id))) {
      const account = accounts.get(payment.moneyAccountId);
      if (!account) throw new Error(`payment ${payment.number}: money account is missing`);
      await inTransaction(this.db, async (tx) => {
        const who =
          payment.customerId === null
            ? (payment.counterpartyName ?? payment.description)
            : names.get(payment.customerId);
        const entry = await this.journal.post(tx, actor, {
          entryDate: payment.paidOn,
          description: label(payment.number, who),
          source: 'AUTO_PAYMENT',
          sourceType: 'PAYMENT',
          sourceId: payment.id,
          lines: paymentEntryLines({
            kind: payment.kind,
            amount: payment.amount,
            moneyAccount: { id: account.id, glAccountId: account.glAccountId },
            customerId: payment.customerId,
            glAccountId: payment.glAccountId,
          }),
        });
        await tx
          .update(payments)
          .set({ journalEntryId: entry.id })
          .where(eq(payments.id, payment.id));
      });
      counts.payments += 1;
    }

    for (const invoice of await this.db
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.status, 'VOID'),
          isNotNull(invoices.journalEntryId),
          isNull(invoices.voidJournalEntryId),
        ),
      )
      .orderBy(asc(invoices.voidedAt), asc(invoices.id))) {
      const entryId = invoice.journalEntryId;
      if (entryId === null) continue;
      await inTransaction(this.db, async (tx) => {
        const reversal = await this.journal.reverse(tx, actor, entryId, {
          entryDate: businessDate(invoice.voidedAt ?? undefined),
          description: label(invoice.number, names.get(invoice.customerId)),
          source: 'AUTO_VOID',
        });
        await tx
          .update(invoices)
          .set({ voidJournalEntryId: reversal.id })
          .where(eq(invoices.id, invoice.id));
      });
      counts.invoiceVoids += 1;
    }

    for (const payment of await this.db
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.status, 'VOID'),
          isNotNull(payments.journalEntryId),
          isNull(payments.voidJournalEntryId),
        ),
      )
      .orderBy(asc(payments.voidedAt), asc(payments.id))) {
      const entryId = payment.journalEntryId;
      if (entryId === null) continue;
      await inTransaction(this.db, async (tx) => {
        const who =
          payment.customerId === null ? payment.counterpartyName : names.get(payment.customerId);
        const reversal = await this.journal.reverse(tx, actor, entryId, {
          entryDate: businessDate(payment.voidedAt ?? undefined),
          description: label(payment.number, who),
          source: 'AUTO_VOID',
        });
        await tx
          .update(payments)
          .set({ voidJournalEntryId: reversal.id })
          .where(eq(payments.id, payment.id));
      });
      counts.paymentVoids += 1;
    }
    return counts;
  }
}
