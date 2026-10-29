import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from '@tugeel/shared/money';
import { businessDate } from '@tugeel/shared/time';
import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { FinJournalReader, FinReader } from '../../../finance-core';
import { BTO_SOURCE, FIN_DOC_TYPES } from '../../fin-bridge';
import { type Actor } from '../../identity';
import { GoodsIssuesService, ReceiptsService, StockPostingService } from '../../inventory';
import { creditNotes, invoices } from '../schema';
import { CreditNotesService } from './credit-notes.service';
import { FinBooks } from './fin-books';
import { FinPosting } from './fin-posting';
import { GlAccountsService } from './gl-accounts.service';
import { StockBooksService } from './stock-books.service';
import { InvoicingService } from './invoicing.service';
import { SupplierBillsService } from './supplier-bills.service';

export interface RepostCounts {
  invoices: number;
  invoiceVoids: number;
  creditNotes: number;
  /** F3 (ADR-0091): the bills of posted, costed receipts and the credits of supplier returns. */
  supplierBills: number;
  supplierReturns: number;
  /** F4 (ADR-0097): F3 bills booked again on goods received, stock postings, receipt costings. */
  billsRebooked: number;
  stockPostings: number;
  stockRevaluations: number;
}

/**
 * The one-off development re-post (ADR-0089 #8, ADR-0090; ADR-0083 #2): migrations 0033 and 0034
 * dropped Finance I's journal and receivables without a copy; this posts each invoice, credit note
 * and invoice void again through the Finance Core's intake (since F3, ADR-0091, also the bills of
 * the receipts and the credits of the supplier returns made before payables existed), dated as the document (a void on the
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
    private readonly receipts: ReceiptsService,
    private readonly issues: GoodsIssuesService,
    private readonly bills: SupplierBillsService,
    private readonly reader: FinReader,
    private readonly books: FinBooks,
    private readonly accounts: GlAccountsService,
    private readonly journal: FinJournalReader,
    private readonly posting: FinPosting,
    private readonly stock: StockPostingService,
    private readonly stockBooks: StockBooksService,
  ) {}

  async repost(actor: Actor): Promise<RepostCounts> {
    const counts: RepostCounts = {
      invoices: 0,
      invoiceVoids: 0,
      creditNotes: 0,
      supplierBills: 0,
      supplierReturns: 0,
      billsRebooked: 0,
      stockPostings: 0,
      stockRevaluations: 0,
    };

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
          .select({ openAmount: invoices.openAmount, branchId: invoices.branchId })
          .from(invoices)
          .where(eq(invoices.id, note.invoiceId))
          .for('update');
        const entryId = await this.creditNotes.postCreditNoteInTx(tx, actor, {
          ...note,
          settles: Decimal.min(note.total, invoice?.openAmount ?? new Decimal(0)),
          branchId: invoice?.branchId ?? null,
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

    // F3 (ADR-0091): each costed receipt's bill at its latest costing, each supplier return's
    // credit; a receipt or an issue the books already hold is skipped.
    const receiptIds = await this.receipts.postedCostedIds();
    const billed = await this.booked(FIN_DOC_TYPES.SUPPLIER_BILL.docType, receiptIds);
    for (const id of receiptIds) {
      if (billed.has(String(id))) continue;
      await inTransaction(this.db, async (tx) => {
        await this.bills.receiptCostedInTx(tx, actor, await this.receipts.bookFacts(id, tx));
      });
      counts.supplierBills += 1;
    }
    // Since ADR-0117 a return posts per confirmed warehouse (`<issue>:<warehouse>`); an issue
    // posted in one step before keeps its plain id.
    const parts = await this.issues.postedSupplierReturnParts();
    const returned = await this.booked(
      FIN_DOC_TYPES.SUPPLIER_RETURN.docType,
      parts.map((part) =>
        part.warehouseId === null ? String(part.issueId) : `${part.issueId}:${part.warehouseId}`,
      ),
    );
    for (const part of parts) {
      const key =
        part.warehouseId === null ? String(part.issueId) : `${part.issueId}:${part.warehouseId}`;
      if (returned.has(key)) continue;
      await inTransaction(this.db, async (tx) => {
        await this.bills.supplierReturnPostedInTx(
          tx,
          actor,
          await this.issues.supplierReturnFacts(part.issueId, part.warehouseId, tx),
        );
      });
      counts.supplierReturns += 1;
    }

    // F4 (ADR-0097): an F3 bill debited the stock itself; the receipt's posting now does, so the
    // bill is reversed and booked again (revision 2) on goods received.
    const inventoryCodes = new Set(
      (await this.accounts.list())
        .filter((account) => account.role === 'INVENTORY')
        .map((account) => account.code),
    );
    const bills = await this.reader.documentsOfSource(this.books.source(), {
      company: await this.books.company(),
      system: BTO_SOURCE,
      docType: FIN_DOC_TYPES.SUPPLIER_BILL.docType,
      docIds: receiptIds.map(String),
    });
    for (const [docId, bill] of bills) {
      if (bill.reversal !== null || bill.entryId === null) continue;
      const entry = await this.journal.entry(this.books.source(), {
        company: await this.books.company(),
        id: bill.entryId,
      });
      if (!entry?.lines.some((line) => inventoryCodes.has(line.accountCode))) continue;
      await inTransaction(this.db, async (tx) => {
        await this.posting.submitInTx(tx, this.books.source(actor), {
          source: { system: BTO_SOURCE, docType: FIN_DOC_TYPES.SUPPLIER_BILL.docType, docId },
          body: { action: 'REVERSE', accountingDate: businessDate(), reason: 'F4: goods received' },
        });
        const facts = await this.receipts.bookFacts(Number.parseInt(docId, 10), tx);
        await this.bills.receiptCostedInTx(tx, actor, facts, 2);
      });
      counts.billsRebooked += 1;
    }

    // The stock's history, one posting at a time, and the receipts' costings (F4).
    const history = await this.stock.historyFacts();
    const posted = await this.booked(
      FIN_DOC_TYPES.STOCK_VALUE.docType,
      history.map((facts) => `${facts.docType}:${facts.docId}:${facts.firstLedgerId}`),
    );
    for (const facts of history) {
      if (posted.has(`${facts.docType}:${facts.docId}:${facts.firstLedgerId}`)) continue;
      await inTransaction(this.db, (tx) => this.stockBooks.stockPostedInTx(tx, actor, facts));
      counts.stockPostings += 1;
    }
    const costings = await this.stock.revaluationHistory();
    const revalued = await this.booked(
      FIN_DOC_TYPES.STOCK_REVALUE.docType,
      costings.map((facts) => `${facts.receiptId}:${facts.version}`),
    );
    for (const facts of costings) {
      if (revalued.has(`${facts.receiptId}:${facts.version}`)) continue;
      await inTransaction(this.db, (tx) => this.stockBooks.stockRevaluedInTx(tx, actor, facts));
      counts.stockRevaluations += 1;
    }
    return counts;
  }

  /** The source ids of Bto's documents of this kind that the books already hold. */
  private async booked(docType: string, ids: readonly (number | string)[]): Promise<Set<string>> {
    const found = new Set<string>();
    // In slices: the development ledger may hold thousands of postings.
    for (let start = 0; start < ids.length; start += 1000) {
      const slice = await this.reader.documentsOfSource(this.books.source(), {
        company: await this.books.company(),
        system: BTO_SOURCE,
        docType,
        docIds: ids.slice(start, start + 1000).map(String),
      });
      for (const key of slice.keys()) found.add(key);
    }
    return found;
  }
}
