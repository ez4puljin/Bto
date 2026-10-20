import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from '@tugeel/shared/money';
import { businessDate } from '@tugeel/shared/time';
import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { type Actor } from '../../identity';
import { creditNotes, invoices } from '../schema';
import { CreditNotesService } from './credit-notes.service';
import { InvoicingService } from './invoicing.service';

export interface RepostCounts {
  invoices: number;
  invoiceVoids: number;
  creditNotes: number;
}

/**
 * The one-off development re-post (ADR-0089 #8, ADR-0090; ADR-0083 #2): migrations 0033 and 0034
 * dropped Finance I's journal and receivables without a copy; this posts each invoice, credit note
 * and invoice void again through the Finance Core's intake, dated as the document (a void on the
 * day it was voided), and writes the entry ids back; the invoices' open amounts follow their items.
 * Idempotent: a document with its entry is skipped (and the intake answers a resend DUPLICATE).
 * Never part of a request; `pnpm finance:repost-journal` runs it with the POS shifts.
 */
@Injectable()
export class JournalRepostService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly invoicing: InvoicingService,
    private readonly creditNotes: CreditNotesService,
  ) {}

  async repost(actor: Actor): Promise<RepostCounts> {
    const counts: RepostCounts = { invoices: 0, invoiceVoids: 0, creditNotes: 0 };

    for (const invoice of await this.db
      .select()
      .from(invoices)
      .where(isNull(invoices.journalEntryId))
      .orderBy(asc(invoices.invoiceDate), asc(invoices.id))) {
      if (!invoice.subtotal.gt(0)) continue;
      await inTransaction(this.db, async (tx) => {
        const entryId = await this.invoicing.postInvoiceInTx(tx, actor, invoice);
        await tx
          .update(invoices)
          .set({ journalEntryId: entryId })
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
        const [invoice] = await tx
          .select({ openAmount: invoices.openAmount })
          .from(invoices)
          .where(eq(invoices.id, note.invoiceId))
          .for('update');
        const entryId = await this.creditNotes.postCreditNoteInTx(tx, actor, {
          ...note,
          settles: Decimal.min(note.total, invoice?.openAmount ?? new Decimal(0)),
        });
        await tx
          .update(creditNotes)
          .set({ journalEntryId: entryId })
          .where(eq(creditNotes.id, note.id));
      });
      counts.creditNotes += 1;
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
      await inTransaction(this.db, async (tx) => {
        const reversal = await this.invoicing.reverseInvoiceInTx(
          tx,
          actor,
          invoice.id,
          businessDate(invoice.voidedAt ?? undefined),
          invoice.voidReason ?? 'void',
        );
        await tx
          .update(invoices)
          .set({ voidJournalEntryId: reversal.entryId, openAmount: new Decimal(0) })
          .where(eq(invoices.id, invoice.id));
      });
      counts.invoiceVoids += 1;
    }
    return counts;
  }
}
