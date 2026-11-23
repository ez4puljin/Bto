import { Inject, Injectable } from '@nestjs/common';
import {
  FINANCE_LIMITS,
  VAT_WAIVER_BLOCKING_RECEIPT_STATUSES,
  type VatWaiverBlock,
  type VatWaiverStatus,
  vatWaiverAmount,
} from '@tugeel/shared/finance';
import mn from '@tugeel/shared/i18n/mn.json';
import type { WholesaleReceiptStatus } from '@tugeel/shared/mn';
import { Decimal } from '@tugeel/shared/money';
import { businessDate } from '@tugeel/shared/time';
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { BTO_SOURCE, FIN_DOC_TYPES, FinPartiesBridge } from '../../fin-bridge';
import { type AuthContext, AuditService, UserNamesService } from '../../identity';
import { CustomersService } from '../../partners';
import { creditNotes, invoices, vatWaivers } from '../schema';
import { CustomerCounterAccountsService } from './customer-counter-accounts.service';
import { FinBooks } from './fin-books';
import { FinPosting } from './fin-posting';
import { FinanceSettingsService } from './finance-settings.service';
import { controlTotal, intakeLines, type RoleLine } from './intake-lines';
import { InvoiceEbarimtService } from './invoice-ebarimt.service';
import { entryIdOf } from './invoicing.service';

type WaiverRow = typeof vatWaivers.$inferSelect;

/** An invoice's waiver as its lists and panel show it. */
export interface VatWaiverView {
  id: number;
  invoiceId: number;
  status: VatWaiverStatus;
  waiverDate: string;
  pct: Decimal;
  baseAmount: Decimal;
  amount: Decimal;
  accountCode: string;
  description: string;
  documentNumber: string | null;
  journalEntryId: number | null;
  createdAt: Date;
  createdByName: string | null;
  reversedAt: Date | null;
  reversedByName: string | null;
  reverseReason: string | null;
}

/** What «НӨАТ хасуулах» would do to an invoice now, and why it would be refused. */
export interface VatWaiverPreview {
  pct: Decimal;
  baseAmount: Decimal;
  amount: Decimal;
  blockedBy: VatWaiverBlock | null;
}

/** An invoice's e-Barimt receipt in the words a list needs. */
export interface InvoiceReceiptRef {
  id: number;
  receiptType: string;
  status: WholesaleReceiptStatus;
}

/** The VAT side of an invoice: its live waiver, what a waiver would take, its receipt. */
export interface InvoiceVatFacts {
  vatWaiver: VatWaiverView | null;
  vatWaiverPreview: VatWaiverPreview;
  receipt: InvoiceReceiptRef | null;
}

/** One side of a customer's sales: the invoices that take the VAT receipt, or those that do not. */
export interface VatTotalsSide {
  count: number;
  total: Decimal;
  vatTotal: Decimal;
  openAmount: Decimal;
  waiverAmount: Decimal;
}

export interface CustomerVatTotals {
  customerId: number;
  from: string | null;
  to: string | null;
  takesVat: VatTotalsSide;
  waived: VatTotalsSide;
}

const ZERO = new Decimal(0);

/** The first reason an invoice cannot be waived, in the order a person would fix them. */
function blockOf(input: {
  status: string;
  waived: boolean;
  amount: Decimal;
  receipt: { receiptType: string; status: string } | null;
}): VatWaiverBlock | null {
  if (input.status !== 'ISSUED') return 'VOID';
  if (input.waived) return 'VAT_WAIVED';
  if (!input.amount.gt(0)) return 'NOTHING_LEFT';
  if (
    input.receipt?.receiptType === 'B2B' &&
    (VAT_WAIVER_BLOCKING_RECEIPT_STATUSES as readonly string[]).includes(input.receipt.status)
  ) {
    return 'B2B_RECEIPT';
  }
  return null;
}

/**
 * «НӨАТ хасуулах» (ADR-0240): a customer who takes no VAT receipt for a sale has the receivable
 * reduced by a percent of that sale. The waiver is one entry — Dr the customer's counter account
 * (the sales discount's by default), Cr receivables on the customer — posted through the intake
 * as `BTO / VAT_WAIVER / <waiver id>`; its credit settles the invoice's own item up to what is
 * open and the rest stays the customer's open credit, exactly as a credit note's would. The
 * invoice's own entry, its VAT and the VAT report are untouched. Taking it back is the core's
 * reversal of that document; the row stays as REVERSED and the invoice may be waived again.
 */
@Injectable()
export class VatWaiversService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly names: UserNamesService,
    private readonly customers: CustomersService,
    private readonly settings: FinanceSettingsService,
    private readonly counterAccounts: CustomerCounterAccountsService,
    private readonly receipts: InvoiceEbarimtService,
    private readonly intake: FinPosting,
    private readonly books: FinBooks,
    private readonly parties: FinPartiesBridge,
  ) {}

  /** Waives the VAT receipt of an invoice (`finance.vat_waiver.manage`). */
  async waive(ctx: AuthContext, invoiceId: number): Promise<VatWaiverView> {
    const id = await inTransaction(this.db, async (tx) => {
      // Lock order as a credit note's (docs/modules/finance.md §5): the customer, then the invoice.
      const invoice = await this.lockInvoiceInTx(tx, invoiceId);
      const [live] = await tx
        .select({ id: vatWaivers.id })
        .from(vatWaivers)
        .where(and(eq(vatWaivers.invoiceId, invoice.id), eq(vatWaivers.status, 'POSTED')));
      const settings = await this.settings.vatWaiver(tx);
      const credited = (await this.creditedOf([invoice.id], tx)).get(invoice.id) ?? ZERO;
      const { base, amount } = vatWaiverAmount(invoice.total, credited, settings.pct);
      const receipt = await this.receipts.stateOf(invoice.id, tx);
      const block = blockOf({
        status: invoice.status,
        waived: live !== undefined,
        amount,
        receipt,
      });
      if (block) {
        throw new AppError(
          'INVOICE_STATE_INVALID',
          `invoice ${invoice.number} cannot be waived: ${block}`,
          { number: invoice.number, status: block },
        );
      }
      const counter = await this.counterAccounts.resolveInTx(tx, invoice.customerId);
      const today = businessDate();
      const [waiver] = await tx
        .insert(vatWaivers)
        .values({
          invoiceId: invoice.id,
          customerId: invoice.customerId,
          waiverDate: today,
          pct: settings.pct,
          baseAmount: base,
          amount,
          accountId: counter.accountId,
          accountCode: counter.accountCode,
          description: settings.description,
          createdBy: ctx.userId,
        })
        .returning({ id: vatWaivers.id });
      if (!waiver) throw new Error('vat_waivers insert returned no row');
      // The credit settles its own invoice up to what is open; the rest stays the customer's credit.
      const settles = Decimal.min(amount, invoice.openAmount);
      const party = await this.parties.customerPartyIn(tx, invoice.customerId);
      const lines = vatWaiverEntryLines({
        key: counter.key,
        invoiceId: invoice.id,
        amount,
        settles,
      });
      const result = await this.intake.submitInTx(
        tx,
        this.books.source(ctx),
        {
          source: {
            system: BTO_SOURCE,
            docType: FIN_DOC_TYPES.VAT_WAIVER.docType,
            docId: String(waiver.id),
          },
          body: {
            action: 'POST',
            documentType: FIN_DOC_TYPES.VAT_WAIVER.code,
            documentDate: today,
            currency: 'MNT',
            party,
            description: settings.description,
            controlTotal: controlTotal(lines),
            lines: intakeLines(lines),
          },
        },
        invoice.branchId,
      );
      const document = result.document;
      if (!document) throw new Error('the VAT waiver posted no document');
      await tx
        .update(vatWaivers)
        .set({
          documentId: Number.parseInt(document.id, 10),
          documentNumber: document.number,
          journalEntryId: entryIdOf(result),
        })
        .where(eq(vatWaivers.id, waiver.id));
      await this.audit.record(tx, ctx, {
        action: 'CREATE',
        entity: 'vat_waivers',
        entityId: waiver.id,
        after: {
          invoiceNumber: invoice.number,
          number: document.number,
          pct: settings.pct.toFixed(2),
          baseAmount: base.toFixed(2),
          amount: amount.toFixed(2),
          settled: settles.toFixed(2),
          accountCode: counter.accountCode,
          description: settings.description,
        },
      });
      return waiver.id;
    });
    return this.get(id);
  }

  /**
   * «Буцаах» (`finance.vat_waiver.manage`): the core reverses the waiver's document, which undoes
   * its allocation and gives the amount back to the invoice; the row stays as REVERSED. Refused by
   * the core while another allocation sits on the waiver's own credit (409 `FIN_REVERSAL_BLOCKED`)
   * and in a closed month.
   */
  async reverse(
    ctx: AuthContext,
    invoiceId: number,
    reason: string | null,
  ): Promise<VatWaiverView> {
    const trimmed = reason?.trim() ?? '';
    if (trimmed.length > FINANCE_LIMITS.maxReason) {
      throw invalid('reason', 'length', `at most ${FINANCE_LIMITS.maxReason} characters`);
    }
    const id = await inTransaction(this.db, async (tx) => {
      const invoice = await this.lockInvoiceInTx(tx, invoiceId);
      const [waiver] = await tx
        .select()
        .from(vatWaivers)
        .where(and(eq(vatWaivers.invoiceId, invoice.id), eq(vatWaivers.status, 'POSTED')))
        .for('update');
      if (!waiver) {
        throw new AppError('INVOICE_STATE_INVALID', `invoice ${invoice.number} is not waived`, {
          number: invoice.number,
          status: 'NOT_VAT_WAIVED',
        });
      }
      const result = await this.intake.submitInTx(tx, this.books.source(ctx), {
        source: {
          system: BTO_SOURCE,
          docType: FIN_DOC_TYPES.VAT_WAIVER.docType,
          docId: String(waiver.id),
        },
        body: {
          action: 'REVERSE',
          accountingDate: businessDate(),
          reason: trimmed || mn.finance.vatWaiver.reverseDefaultReason,
        },
      });
      await tx
        .update(vatWaivers)
        .set({
          status: 'REVERSED',
          reversedAt: sql`now()`,
          reversedBy: ctx.userId,
          reverseReason: trimmed || null,
          reverseJournalEntryId: entryIdOf(result),
        })
        .where(eq(vatWaivers.id, waiver.id));
      await this.audit.record(tx, ctx, {
        action: 'REVERSE',
        entity: 'vat_waivers',
        entityId: waiver.id,
        before: { status: 'POSTED' },
        after: {
          status: 'REVERSED',
          invoiceNumber: invoice.number,
          amount: waiver.amount.toFixed(2),
          reason: trimmed || null,
          reversal: result.document?.journalNo ?? null,
        },
      });
      return waiver.id;
    });
    return this.get(id);
  }

  async get(id: number): Promise<VatWaiverView> {
    const [row] = await this.db.select().from(vatWaivers).where(eq(vatWaivers.id, id));
    if (!row) throw notFound('vat_waiver', id);
    const [view] = await this.views([row]);
    if (!view) throw notFound('vat_waiver', id);
    return view;
  }

  /**
   * The VAT side of these invoices for a list or a panel: the live waiver, what a waiver would
   * take today and what would refuse it. The receipts are read one invoice at a time through the
   * ebarimt module (it has no read of many), so call this for a page, not for a whole book.
   */
  async factsOf(
    rows: readonly { id: number; status: string; total: Decimal }[],
  ): Promise<Map<number, InvoiceVatFacts>> {
    const facts = new Map<number, InvoiceVatFacts>();
    if (rows.length === 0) return facts;
    const ids = rows.map((row) => row.id);
    const live = await this.db
      .select()
      .from(vatWaivers)
      .where(and(inArray(vatWaivers.invoiceId, ids), eq(vatWaivers.status, 'POSTED')));
    const waivers = new Map((await this.views(live)).map((view) => [view.invoiceId, view]));
    const credited = await this.creditedOf(ids, this.db);
    const { pct } = await this.settings.vatWaiver();
    for (const row of rows) {
      const state = await this.receipts.stateOf(row.id);
      const receipt = state && {
        id: state.id,
        receiptType: state.receiptType,
        status: state.status,
      };
      const waiver = waivers.get(row.id) ?? null;
      const { base, amount } = vatWaiverAmount(row.total, credited.get(row.id) ?? ZERO, pct);
      facts.set(row.id, {
        vatWaiver: waiver,
        vatWaiverPreview: {
          pct,
          baseAmount: base,
          amount,
          blockedBy: blockOf({ status: row.status, waived: waiver !== null, amount, receipt }),
        },
        receipt,
      });
    }
    return facts;
  }

  /**
   * A customer's issued invoices of a date range (by invoice date, both ends included; open on a
   * side left out), split into those that take the VAT receipt and those waived.
   */
  async totalsOf(
    customerId: number,
    range: { from?: string; to?: string },
  ): Promise<CustomerVatTotals> {
    const filters: SQL[] = [eq(invoices.customerId, customerId), eq(invoices.status, 'ISSUED')];
    if (range.from) filters.push(sql`${invoices.invoiceDate} >= ${range.from}`);
    if (range.to) filters.push(sql`${invoices.invoiceDate} <= ${range.to}`);
    const rows = await this.db
      .select({
        waived: sql<boolean>`(${vatWaivers.id} IS NOT NULL)`,
        count: sql<string>`count(*)`,
        total: sql<string>`coalesce(sum(${invoices.total}), 0)`,
        vatTotal: sql<string>`coalesce(sum(${invoices.vatTotal}), 0)`,
        openAmount: sql<string>`coalesce(sum(${invoices.openAmount}), 0)`,
        waiverAmount: sql<string>`coalesce(sum(${vatWaivers.amount}), 0)`,
      })
      .from(invoices)
      .leftJoin(
        vatWaivers,
        and(eq(vatWaivers.invoiceId, invoices.id), eq(vatWaivers.status, 'POSTED')),
      )
      .where(and(...filters))
      .groupBy(sql`(${vatWaivers.id} IS NOT NULL)`);
    const side = (waived: boolean): VatTotalsSide => {
      const row = rows.find((own) => own.waived === waived);
      return {
        count: Number.parseInt(row?.count ?? '0', 10),
        total: new Decimal(row?.total ?? 0),
        vatTotal: new Decimal(row?.vatTotal ?? 0),
        openAmount: new Decimal(row?.openAmount ?? 0),
        waiverAmount: new Decimal(row?.waiverAmount ?? 0),
      };
    };
    return {
      customerId,
      from: range.from ?? null,
      to: range.to ?? null,
      takesVat: side(false),
      waived: side(true),
    };
  }

  /** The customer, then the invoice FOR UPDATE: the order every receivable document takes. */
  private async lockInvoiceInTx(tx: Tx, invoiceId: number): Promise<typeof invoices.$inferSelect> {
    const [head] = await tx
      .select({ customerId: invoices.customerId })
      .from(invoices)
      .where(eq(invoices.id, invoiceId));
    if (!head) throw notFound('invoice', invoiceId);
    await this.customers.lockForUpdate(tx, head.customerId);
    const [invoice] = await tx
      .select()
      .from(invoices)
      .where(eq(invoices.id, invoiceId))
      .for('update');
    if (!invoice) throw notFound('invoice', invoiceId);
    return invoice;
  }

  /** Σ of the credit notes' totals per invoice (what its returns took back). */
  private async creditedOf(
    invoiceIds: readonly number[],
    executor: Db | Tx,
  ): Promise<Map<number, Decimal>> {
    if (invoiceIds.length === 0) return new Map();
    const rows = await executor
      .select({
        invoiceId: creditNotes.invoiceId,
        total: sql<string>`coalesce(sum(${creditNotes.total}), 0)`,
      })
      .from(creditNotes)
      .where(inArray(creditNotes.invoiceId, [...invoiceIds]))
      .groupBy(creditNotes.invoiceId);
    return new Map(rows.map((row) => [row.invoiceId, new Decimal(row.total)]));
  }

  private async views(rows: readonly WaiverRow[]): Promise<VatWaiverView[]> {
    if (rows.length === 0) return [];
    const names = await this.names.namesOf(
      rows.flatMap((row) => [row.createdBy, row.reversedBy].filter((id) => id !== null)),
    );
    return rows.map((row) => ({
      id: row.id,
      invoiceId: row.invoiceId,
      status: row.status,
      waiverDate: row.waiverDate,
      pct: row.pct,
      baseAmount: row.baseAmount,
      amount: row.amount,
      accountCode: row.accountCode,
      description: row.description,
      documentNumber: row.documentNumber,
      journalEntryId: row.journalEntryId,
      createdAt: row.createdAt,
      createdByName: row.createdBy === null ? null : (names.get(row.createdBy) ?? null),
      reversedAt: row.reversedAt,
      reversedByName: row.reversedBy === null ? null : (names.get(row.reversedBy) ?? null),
      reverseReason: row.reverseReason,
    }));
  }
}

/**
 * A waiver's two lines (ADR-0240 #4): Dr the counter account by its key, Cr receivables settling
 * the invoice for `settles` (none when nothing is open). No VAT or city-tax line: the invoice's
 * taxes stay as posted.
 */
export function vatWaiverEntryLines(waiver: {
  key: string;
  invoiceId: number;
  amount: Decimal;
  settles: Decimal;
}): RoleLine[] {
  return [
    { role: 'SALES_DISCOUNT', key: waiver.key, debit: waiver.amount, credit: ZERO },
    {
      role: 'AR',
      debit: ZERO,
      credit: waiver.amount,
      ...(waiver.settles.gt(0)
        ? {
            extra: {
              settles: [
                {
                  target: {
                    system: BTO_SOURCE,
                    docType: FIN_DOC_TYPES.SALES_INVOICE.docType,
                    docId: String(waiver.invoiceId),
                  },
                  amount: waiver.settles.toFixed(2),
                },
              ],
            },
          }
        : {}),
    },
  ];
}
