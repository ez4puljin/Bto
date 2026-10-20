import { randomUUID } from 'node:crypto';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { LineV1 } from '@tugeel/fin-contract';
import {
  allocateFifo,
  FINANCE_LIMITS,
  type MoneyAccountKind,
  PAYMENT_KIND_DIRECTION,
  type PaymentDirection,
  type PaymentKind,
  type PaymentStatus,
} from '@tugeel/shared/finance';
import mn from '@tugeel/shared/i18n/mn.json';
import { Decimal } from '@tugeel/shared/money';
import { businessDate } from '@tugeel/shared/time';
import { and, asc, eq, gt } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { DEFAULT_PAGE_LIMIT, decodeCursor, encodeCursor } from '../../../common/pagination/page';
import { type FinDocumentRow, FinReader } from '../../../finance-core';
import { FIN_DOC_TYPES, FIN_SOURCE, FinPartiesBridge } from '../../fin-bridge';
import { AuditService, type AuthContext, UserNamesService } from '../../identity';
import { CustomersService } from '../../partners';
import { PAYMENT_LISTENER, type PaymentListener } from '../hooks';
import { invoices } from '../schema';
import { FinBooks } from './fin-books';
import { FinPosting } from './fin-posting';
import { GlAccountsService } from './gl-accounts.service';
import { documentLabel } from './invoicing.service';
import { assertNotFuture } from './journal.service';
import { MoneyAccountsService } from './money-accounts.service';

/** An invoice a payment settled, with the amount it took. */
interface SettledInvoice {
  invoiceId: number;
  number: string;
  amount: Decimal;
}

export interface AllocationInput {
  invoiceId: number;
  amount: Decimal;
}

export interface PaymentInput {
  kind: PaymentKind;
  moneyAccountId: number;
  customerId: number | null;
  glAccountId: number | null;
  amount: Decimal;
  paidOn: string;
  description: string | null;
  reference: string | null;
  counterpartyName: string | null;
  /** The driver or staff member who handed the money in. */
  collectedBy: number | null;
  /** What a customer payment settles; omitted = the open invoices, oldest due first. */
  allocations?: readonly AllocationInput[] | null;
  /**
   * The voucher's identity in the Finance Core (its source key, ADR-0071 #10): the request's
   * Idempotency-Key, so a resend of the same voucher is the same document; a new one when absent.
   */
  key?: string | null;
}

export interface PaymentSummary {
  id: number;
  number: string;
  status: PaymentStatus;
  kind: PaymentKind;
  direction: PaymentDirection;
  moneyAccountId: number;
  moneyAccountCode: string;
  moneyAccountName: string;
  customerId: number | null;
  customerCode: string | null;
  customerName: string | null;
  glAccountId: number | null;
  glAccountCode: string | null;
  glAccountName: string | null;
  amount: Decimal;
  /** Of a customer payment: what its live allocations settle; the rest is an advance. */
  allocatedAmount: Decimal;
  paidOn: string;
  description: string | null;
  reference: string | null;
  counterpartyName: string | null;
  collectedBy: number | null;
  collectedByName: string | null;
  createdAt: Date;
  createdByName: string | null;
}

export interface PaymentAllocationView {
  id: number;
  invoiceId: number;
  invoiceNumber: string;
  invoiceDueDate: string;
  amount: Decimal;
  voidedAt: Date | null;
}

export interface PaymentDetail extends PaymentSummary {
  journalEntryId: number | null;
  journalNumber: string | null;
  voidedAt: Date | null;
  voidedByName: string | null;
  voidReason: string | null;
  voidJournalEntryId: number | null;
  allocations: PaymentAllocationView[];
}

/** A store's payment as the customer app shows it (ADR-0079 #7). */
export interface CustomerPayment {
  id: number;
  number: string;
  kind: 'CUSTOMER_PAYMENT' | 'CUSTOMER_REFUND';
  method: MoneyAccountKind;
  amount: Decimal;
  paidOn: string;
  invoices: { invoiceId: number; number: string; amount: Decimal }[];
}

export interface PaymentQuery {
  /** Part of the number, the reference, a counterparty or a customer's name or code. */
  q?: string;
  moneyAccountId?: number;
  customerId?: number;
  kind?: PaymentKind;
  direction?: PaymentDirection;
  status?: PaymentStatus;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
}

export interface BookQuery {
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
}

export interface BookRow extends PaymentSummary {
  /** The account's balance after this voucher, oldest first. */
  balanceAfter: Decimal;
}

export interface BookPage {
  data: BookRow[];
  nextCursor: string | null;
  /** The balance before `from` (0 without `from`). */
  opening: Decimal;
}

const MONEY_SCALE = 2;

/** Each voucher kind's document type in the Finance Core (ADR-0090). */
export const VOUCHER_TYPE_OF_KIND = {
  CUSTOMER_PAYMENT: FIN_DOC_TYPES.CUSTOMER_RECEIPT,
  CUSTOMER_REFUND: FIN_DOC_TYPES.CUSTOMER_REFUND,
  OTHER_IN: FIN_DOC_TYPES.OTHER_RECEIPT,
  OTHER_OUT: FIN_DOC_TYPES.OTHER_PAYMENT,
} as const satisfies Record<PaymentKind, { code: string; docType: string }>;

export const VOUCHER_TYPE_CODES: readonly string[] = Object.values(VOUCHER_TYPE_OF_KIND).map(
  (type) => type.code,
);

const KIND_OF_TYPE = new Map<string, PaymentKind>(
  (Object.entries(VOUCHER_TYPE_OF_KIND) as [PaymentKind, { code: string }][]).map(
    ([kind, type]) => [type.code, kind],
  ),
);

/** A voucher's own texts and who handed the money in, kept as the document's attributes. */
const ATTRIBUTE = {
  memo: 'memo',
  reference: 'reference',
  counterparty: 'counterparty',
  collectedBy: 'collectedBy',
} as const;

/**
 * The vouchers of the cash and bank books (ADR-0060 #5), kept by the Finance Core since F2
 * (ADR-0090): a RECEIPT or PAYMENT document of the core's own screens (source FIN), typed by the
 * accountant and posted as that user. A customer's payment settles the open invoices oldest due
 * first unless the accountant chooses (Bto picks them, the core books and checks them); what is
 * left stays the customer's open credit. A refund, an expense or any other income hit a journal
 * account. A voucher is voided by the core's REVERSE, which also undoes its allocations.
 */
@Injectable()
export class PaymentsService implements OnModuleInit {
  private listener: PaymentListener | null = null;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly customers: CustomersService,
    private readonly names: UserNamesService,
    private readonly accounts: GlAccountsService,
    private readonly moneyAccounts: MoneyAccountsService,
    private readonly posting: FinPosting,
    private readonly reader: FinReader,
    private readonly books: FinBooks,
    private readonly parties: FinPartiesBridge,
    private readonly moduleRef: ModuleRef,
  ) {}

  /** The payment listener (ADR-0079 #8), or none when notifications is not loaded. */
  onModuleInit(): void {
    try {
      this.listener = this.moduleRef.get<PaymentListener>(PAYMENT_LISTENER, { strict: false });
    } catch {
      this.listener = null;
    }
  }

  async record(ctx: AuthContext, input: PaymentInput): Promise<PaymentDetail> {
    const { id } = await inTransaction(this.db, (tx) => this.recordInTx(tx, ctx, input));
    return this.get(id);
  }

  /**
   * Records a voucher inside the caller's transaction (the POS shift hand-over, ADR-0064 #3):
   * the same checks and postings as `record`; the new voucher's id and number.
   */
  async recordInTx(
    tx: Tx,
    ctx: AuthContext,
    input: PaymentInput,
  ): Promise<{ id: number; number: string }> {
    const customerKind = input.kind === 'CUSTOMER_PAYMENT' || input.kind === 'CUSTOMER_REFUND';
    if (!input.amount.gt(0) || input.amount.decimalPlaces() > MONEY_SCALE) {
      throw invalid('amount', 'money', 'a positive amount with 2 decimals');
    }
    assertNotFuture(input.paidOn, 'paidOn');
    if (customerKind && input.customerId === null) {
      throw invalid('customerId', 'required', 'a customer payment names the customer');
    }
    if (!customerKind && input.glAccountId === null) {
      throw invalid('glAccountId', 'required', 'another income or expense names its account');
    }
    if (input.allocations?.length && input.kind !== 'CUSTOMER_PAYMENT') {
      throw invalid('allocations', 'kind', 'only a customer payment is allocated');
    }
    if (input.collectedBy !== null && !(await this.names.namesOf([input.collectedBy])).size) {
      throw invalid('collectedBy', 'exists', `user ${input.collectedBy} does not exist`);
    }
    const account = await this.moneyAccounts.lockActive(tx, input.moneyAccountId);
    const glAccountId = customerKind ? null : input.glAccountId;
    const other =
      glAccountId === null
        ? null
        : ((await this.accounts.activeByIds([glAccountId], () => 'glAccountId', tx)).get(
            glAccountId,
          ) ?? null);
    const customerId = customerKind ? input.customerId : null;
    let customerName: string | null = null;
    if (customerId !== null) {
      await this.customers.lockForUpdate(tx, customerId);
      customerName = (await this.customers.getMany([customerId], tx))[0]?.name ?? null;
      // The customer's party exists before the core's screens name it (a USER never creates one).
      await this.parties.customerPartyInTx(tx, ctx, customerId);
    }
    let settled: SettledInvoice[] = [];
    if (input.kind === 'CUSTOMER_PAYMENT' && customerId !== null) {
      settled = await this.chooseInvoices(tx, customerId, input);
    }

    const type = VOUCHER_TYPE_OF_KIND[input.kind];
    const moneyKey = account.kind === 'BANK' ? 'BANK' : 'CASH';
    const money: LineV1 = {
      lineNo: 0,
      key: moneyKey,
      side: 'DEBIT',
      amount: input.amount.toFixed(2),
      moneyAccount: account.code,
    };
    const amount = input.amount.toFixed(2);
    let lines: LineV1[];
    switch (input.kind) {
      case 'CUSTOMER_PAYMENT':
        lines = [
          { ...money, side: 'DEBIT' },
          {
            lineNo: 0,
            key: 'AR',
            side: 'CREDIT',
            amount,
            ...(settled.length
              ? {
                  settles: settled.map((own) => ({
                    target: {
                      system: 'BTO',
                      docType: FIN_DOC_TYPES.SALES_INVOICE.docType,
                      docId: String(own.invoiceId),
                    },
                    amount: own.amount.toFixed(2),
                  })),
                }
              : {}),
          },
        ];
        break;
      case 'CUSTOMER_REFUND':
        // The refund opens a debit item; the accountant pairs it with the credit it paid back (D7).
        lines = [
          { lineNo: 0, key: 'AR', side: 'DEBIT', amount },
          { ...money, side: 'CREDIT' },
        ];
        break;
      case 'OTHER_IN':
        lines = [
          { ...money, side: 'DEBIT' },
          { lineNo: 0, key: 'OTHER_INCOME', side: 'CREDIT', amount, accountCode: other?.code ?? '' },
        ];
        break;
      case 'OTHER_OUT':
        lines = [
          { lineNo: 0, key: 'OTHER_EXPENSE', side: 'DEBIT', amount, accountCode: other?.code ?? '' },
          { ...money, side: 'CREDIT' },
        ];
        break;
    }
    lines = lines.map((line, index) => ({ ...line, lineNo: index + 1 }));
    const memo = input.description?.trim() || null;
    const reference = input.reference?.trim() || null;
    const counterparty = input.counterpartyName?.trim() || null;
    const attributes: Record<string, string> = {};
    if (memo) attributes[ATTRIBUTE.memo] = memo;
    if (reference) attributes[ATTRIBUTE.reference] = reference;
    if (counterparty) attributes[ATTRIBUTE.counterparty] = counterparty;
    if (input.collectedBy !== null) attributes[ATTRIBUTE.collectedBy] = String(input.collectedBy);
    const who =
      customerName ?? counterparty ?? memo ?? mn.finance.paymentKinds[input.kind] ?? input.kind;
    const result = await this.posting.submitInTx(tx, this.books.user(ctx), {
      source: { system: FIN_SOURCE, docType: type.docType, docId: input.key ?? randomUUID() },
      body: {
        action: 'POST',
        documentType: type.code,
        documentDate: input.paidOn,
        currency: 'MNT',
        ...(customerId !== null ? { party: await this.parties.customerPartyIn(tx, customerId) } : {}),
        description: who.slice(0, FINANCE_LIMITS.maxDescription),
        controlTotal: amount,
        lines,
        ...(Object.keys(attributes).length ? { attributes } : {}),
      },
    });
    const document = result.document;
    if (!document) throw new Error('the voucher was not posted');
    const id = Number.parseInt(document.id, 10);
    const number = document.number;
    const allocated = settled.reduce((sum, own) => sum.plus(own.amount), new Decimal(0));
    await this.audit.record(tx, ctx, {
      action: 'CREATE',
      entity: 'payments',
      entityId: id,
      after: {
        number,
        kind: input.kind,
        moneyAccountId: account.id,
        customerId,
        glAccountId,
        amount: input.amount.toFixed(MONEY_SCALE),
        allocated: allocated.toFixed(MONEY_SCALE),
        paidOn: input.paidOn,
      },
    });
    if (this.listener && input.kind === 'CUSTOMER_PAYMENT' && customerId !== null) {
      await this.listener.onPaymentRecorded(tx, {
        paymentId: id,
        paymentNumber: number,
        customerId,
        amount: input.amount.toFixed(MONEY_SCALE),
        paidOn: input.paidOn,
        method: account.kind,
        invoices: settled.map((own) => ({
          invoiceId: own.invoiceId,
          number: own.number,
          amount: own.amount.toFixed(MONEY_SCALE),
        })),
      });
    }
    return { id, number };
  }

  /** Voids a posted voucher: the core reverses it and gives its allocations back to the invoices. */
  async void(ctx: AuthContext, id: number, reason: string): Promise<PaymentDetail> {
    const trimmed = reason.trim();
    if (trimmed.length === 0 || trimmed.length > FINANCE_LIMITS.maxReason) {
      throw invalid('reason', 'length', `1 to ${FINANCE_LIMITS.maxReason} characters`);
    }
    await inTransaction(this.db, async (tx) => {
      const voucher = await this.voucher(id);
      if (voucher.reversal) {
        throw new AppError('PAYMENT_STATE_INVALID', `payment ${voucher.number} is VOID`, {
          number: voucher.number,
          status: 'VOID',
        });
      }
      const customerId = await this.customerOf(voucher.partyId);
      if (customerId !== null) await this.customers.lockForUpdate(tx, customerId);
      const result = await this.posting.submitInTx(tx, this.books.user(ctx), {
        source: { system: FIN_SOURCE, docType: voucher.sourceDocType, docId: voucher.sourceDocId },
        body: { action: 'REVERSE', accountingDate: businessDate(), reason: trimmed },
      });
      await this.audit.record(tx, ctx, {
        action: 'VOID',
        entity: 'payments',
        entityId: id,
        before: { status: 'POSTED' },
        after: { status: 'VOID', reason: trimmed, reversal: result.document?.journalNo ?? null },
      });
    });
    return this.get(id);
  }

  async list(
    ctx: AuthContext,
    query: PaymentQuery,
  ): Promise<{ data: PaymentSummary[]; nextCursor: string | null; total: number | null }> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const company = await this.books.company();
    let partyIds: number[] | undefined;
    if (query.customerId) {
      const party = (await this.parties.partiesOfCustomers([query.customerId])).get(
        query.customerId,
      );
      if (party === undefined) return { data: [], nextCursor: null, total: query.cursor ? null : 0 };
      partyIds = [Number.parseInt(party, 10)];
    }
    let text: { pattern: string; partyIds: number[] } | undefined;
    const q = query.q?.trim();
    if (q) {
      const customerIds = (await this.customers.list(ctx, { q, limit: 200 })).data.map(
        (customer) => customer.id,
      );
      const parties = await this.parties.partiesOfCustomers(customerIds);
      text = {
        pattern: `%${q.replace(/[%_\\]/g, '\\$&')}%`,
        partyIds: [...parties.values()].map((id) => Number.parseInt(id, 10)),
      };
    }
    const after = decodeCursor(query.cursor);
    const { rows, total } = await this.reader.documents(this.books.source(), {
      company,
      typeCodes: query.kind ? [VOUCHER_TYPE_OF_KIND[query.kind].code] : VOUCHER_TYPE_CODES,
      ...(partyIds ? { partyIds } : {}),
      ...(query.moneyAccountId ? { moneyAccountId: query.moneyAccountId } : {}),
      ...(query.direction ? { classes: [query.direction === 'IN' ? 'RECEIPT' : 'PAYMENT'] } : {}),
      ...(query.status ? { reversed: query.status === 'VOID' } : {}),
      ...(query.from ? { from: query.from } : {}),
      ...(query.to ? { to: query.to } : {}),
      ...(text ? { text } : {}),
      ...(typeof after?.date === 'string' && typeof after?.id === 'number'
        ? { after: { date: after.date, id: after.id } }
        : {}),
      limit,
      count: !query.cursor,
    });
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      data: await this.summaries(page),
      nextCursor:
        rows.length > limit && last ? encodeCursor({ date: last.documentDate, id: last.id }) : null,
      total,
    };
  }

  /**
   * The customer app's «Төлбөр» tab (ADR-0079 #7): the store's posted payments and refunds,
   * newest first, each with the cash box or bank it came through and the invoices it settled.
   * Nothing internal (accounts, journal, who collected or typed it) leaves finance here.
   */
  async ofCustomer(
    customerId: number,
    query: { cursor?: string; limit?: number } = {},
  ): Promise<{ data: CustomerPayment[]; nextCursor: string | null; total: number | null }> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const party = (await this.parties.partiesOfCustomers([customerId])).get(customerId);
    if (party === undefined) return { data: [], nextCursor: null, total: query.cursor ? null : 0 };
    const company = await this.books.company();
    const after = decodeCursor(query.cursor);
    const { rows, total } = await this.reader.documents(this.books.source(), {
      company,
      typeCodes: [
        VOUCHER_TYPE_OF_KIND.CUSTOMER_PAYMENT.code,
        VOUCHER_TYPE_OF_KIND.CUSTOMER_REFUND.code,
      ],
      partyIds: [Number.parseInt(party, 10)],
      reversed: false,
      ...(typeof after?.date === 'string' && typeof after?.id === 'number'
        ? { after: { date: after.date, id: after.id } }
        : {}),
      limit,
      count: !query.cursor,
    });
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    const kinds = new Map(
      (await this.moneyAccounts.list()).map((account) => [account.id, account.kind]),
    );
    const settled = await this.settledInvoices(page.map((row) => row.id));
    return {
      data: page.map((row) => ({
        id: row.id,
        number: row.number,
        kind:
          KIND_OF_TYPE.get(row.typeCode) === 'CUSTOMER_REFUND'
            ? 'CUSTOMER_REFUND'
            : 'CUSTOMER_PAYMENT',
        method: (row.moneyAccountId === null ? undefined : kinds.get(row.moneyAccountId)) ?? 'CASH',
        amount: row.amount,
        paidOn: row.documentDate,
        invoices: (settled.get(row.id) ?? [])
          .filter((own) => own.voidedAt === null)
          .map((own) => ({ invoiceId: own.invoiceId, number: own.invoiceNumber, amount: own.amount })),
      })),
      nextCursor:
        rows.length > limit && last ? encodeCursor({ date: last.documentDate, id: last.id }) : null,
      total,
    };
  }

  async get(id: number): Promise<PaymentDetail> {
    const voucher = await this.voucher(id);
    const [summary] = await this.summaries([voucher]);
    if (!summary) throw notFound('payment', id);
    const allocations = (await this.settledInvoices([id])).get(id) ?? [];
    const reversal = voucher.reversal;
    const voidedBy = reversal ? userIdOf(reversal.actorRef) : null;
    return {
      ...summary,
      journalEntryId: voucher.entryId,
      journalNumber: voucher.journalNo,
      voidedAt: reversal?.postedAt ?? null,
      voidedByName:
        voidedBy === null ? null : ((await this.names.namesOf([voidedBy])).get(voidedBy) ?? null),
      voidReason: reversal?.reason ?? null,
      voidJournalEntryId: reversal?.entryId ?? null,
      allocations: summary.kind === 'CUSTOMER_PAYMENT' ? allocations : [],
    };
  }

  /** A money account's posted vouchers newest first with the balance after each. */
  async book(moneyAccountId: number, query: BookQuery): Promise<BookPage> {
    await this.moneyAccounts.get(moneyAccountId);
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const after = decodeCursor(query.cursor);
    const { rows, opening } = await this.reader.moneyBook(this.books.source(), {
      company: await this.books.company(),
      moneyAccountId,
      typeCodes: VOUCHER_TYPE_CODES,
      ...(query.from ? { from: query.from } : {}),
      ...(query.to ? { to: query.to } : {}),
      ...(typeof after?.date === 'string' && typeof after?.id === 'number'
        ? { after: { date: after.date, id: after.id } }
        : {}),
      limit,
    });
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    const summaries = await this.summaries(page);
    return {
      data: summaries.map((summary, index) => ({
        ...summary,
        balanceAfter: page[index]?.balanceAfter ?? new Decimal(0),
      })),
      nextCursor:
        rows.length > limit && last ? encodeCursor({ date: last.documentDate, id: last.id }) : null,
      opening,
    };
  }

  /**
   * The open invoices a customer payment settles: the accountant's choice when given (each within
   * the invoice's open amount, together within the payment), else oldest due first. Locks the
   * invoices FOR UPDATE (Bto's own rows come first in the lock order, ADR-0071 #6).
   */
  private async chooseInvoices(
    tx: Tx,
    customerId: number,
    input: PaymentInput,
  ): Promise<SettledInvoice[]> {
    const open = await tx
      .select({
        id: invoices.id,
        number: invoices.number,
        dueDate: invoices.dueDate,
        openAmount: invoices.openAmount,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.customerId, customerId),
          eq(invoices.status, 'ISSUED'),
          gt(invoices.openAmount, new Decimal(0)),
        ),
      )
      .orderBy(asc(invoices.dueDate), asc(invoices.id))
      .for('update');
    let chosen: { invoiceId: number; amount: Decimal }[];
    if (input.allocations && input.allocations.length > 0) {
      if (input.allocations.length > FINANCE_LIMITS.maxAllocations) {
        throw invalid('allocations', 'max', `at most ${FINANCE_LIMITS.maxAllocations}`);
      }
      const byId = new Map(open.map((invoice) => [invoice.id, invoice]));
      const seen = new Set<number>();
      let sum = new Decimal(0);
      chosen = input.allocations.map((allocation, index) => {
        const path = `allocations[${index}]`;
        const invoice = byId.get(allocation.invoiceId);
        if (!invoice) throw invalid(`${path}.invoiceId`, 'open', 'an open invoice of the customer');
        if (seen.has(invoice.id)) throw invalid(`${path}.invoiceId`, 'unique', 'listed once');
        seen.add(invoice.id);
        if (!allocation.amount.gt(0) || allocation.amount.decimalPlaces() > MONEY_SCALE) {
          throw invalid(`${path}.amount`, 'money', 'a positive amount with 2 decimals');
        }
        if (allocation.amount.gt(invoice.openAmount)) {
          throw new AppError(
            'ALLOCATION_EXCEEDS',
            `more than invoice ${invoice.number} is open for`,
            {
              invoiceNumber: invoice.number,
              openAmount: invoice.openAmount.toFixed(MONEY_SCALE),
              amount: allocation.amount.toFixed(MONEY_SCALE),
            },
          );
        }
        sum = sum.plus(allocation.amount);
        return { invoiceId: invoice.id, amount: allocation.amount };
      });
      if (sum.gt(input.amount)) {
        throw new AppError('ALLOCATION_EXCEEDS', 'the allocations exceed the payment', {
          amount: input.amount.toFixed(MONEY_SCALE),
          allocated: sum.toFixed(MONEY_SCALE),
        });
      }
    } else {
      chosen = allocateFifo(input.amount, open);
    }
    const numbers = new Map(open.map((invoice) => [invoice.id, invoice.number]));
    return chosen.map((allocation) => ({
      invoiceId: allocation.invoiceId,
      number: numbers.get(allocation.invoiceId) ?? '',
      amount: allocation.amount,
    }));
  }

  /** One voucher by its document id, or 404. */
  private async voucher(id: number): Promise<FinDocumentRow> {
    const { rows } = await this.reader.documents(this.books.source(), {
      company: await this.books.company(),
      typeCodes: VOUCHER_TYPE_CODES,
      ids: [id],
    });
    const [row] = rows;
    if (!row) throw notFound('payment', id);
    return row;
  }

  private async customerOf(partyId: number | null): Promise<number | null> {
    if (partyId === null) return null;
    return (await this.parties.customersOfParties([String(partyId)])).get(String(partyId)) ?? null;
  }

  /** The invoices these vouchers settled (live and undone allocations), by voucher id. */
  private async settledInvoices(ids: readonly number[]): Promise<Map<number, PaymentAllocationView[]>> {
    const result = new Map<number, PaymentAllocationView[]>();
    if (ids.length === 0) return result;
    const rows = await this.reader.allocationsOf(this.books.source(), {
      company: await this.books.company(),
      documentIds: ids,
    });
    for (const row of rows) {
      if (
        row.counterpart.sourceDocType !== FIN_DOC_TYPES.SALES_INVOICE.docType ||
        !/^\d+$/.test(row.counterpart.sourceDocId)
      ) {
        continue;
      }
      const list = result.get(row.ownDocumentId) ?? [];
      list.push({
        id: row.id,
        invoiceId: Number.parseInt(row.counterpart.sourceDocId, 10),
        invoiceNumber: row.counterpart.number,
        invoiceDueDate: row.counterpart.dueDate ?? row.counterpart.documentDate,
        amount: row.amount,
        voidedAt: row.undoneAt,
      });
      result.set(row.ownDocumentId, list);
    }
    return result;
  }

  private async summaries(rows: readonly FinDocumentRow[]): Promise<PaymentSummary[]> {
    if (rows.length === 0) return [];
    const accounts = new Map(
      (await this.moneyAccounts.list()).map((account) => [account.id, account]),
    );
    const gl = new Map((await this.accounts.list()).map((row) => [row.id, row]));
    const customerOf = await this.parties.customersOfParties(
      rows.flatMap((row) => (row.partyId === null ? [] : [String(row.partyId)])),
    );
    const customers = new Map(
      (await this.customers.getMany([...new Set(customerOf.values())])).map((customer) => [
        customer.id,
        customer,
      ]),
    );
    const collected = (row: FinDocumentRow) => {
      const value = row.attributes[ATTRIBUTE.collectedBy];
      return value && /^\d+$/.test(value) ? Number.parseInt(value, 10) : null;
    };
    const names = await this.names.namesOf(
      rows.flatMap((row) => {
        const ids: number[] = [];
        const creator = userIdOf(row.actorRef);
        if (creator !== null) ids.push(creator);
        const collector = collected(row);
        if (collector !== null) ids.push(collector);
        return ids;
      }),
    );
    return rows.map((row) => {
      const kind = KIND_OF_TYPE.get(row.typeCode) ?? 'OTHER_IN';
      const account = row.moneyAccountId === null ? undefined : accounts.get(row.moneyAccountId);
      const customerId =
        row.partyId === null ? null : (customerOf.get(String(row.partyId)) ?? null);
      const customer = customerId === null ? undefined : customers.get(customerId);
      const customerKind = kind === 'CUSTOMER_PAYMENT' || kind === 'CUSTOMER_REFUND';
      const glAccountId = customerKind ? null : row.counterAccountId;
      const other = glAccountId === null ? undefined : gl.get(glAccountId);
      const creator = userIdOf(row.actorRef);
      const collector = collected(row);
      return {
        id: row.id,
        number: row.number,
        status: row.reversal ? 'VOID' : 'POSTED',
        kind,
        direction: PAYMENT_KIND_DIRECTION[kind],
        moneyAccountId: row.moneyAccountId ?? 0,
        moneyAccountCode: account?.code ?? '',
        moneyAccountName: account?.name ?? '',
        customerId,
        customerCode: customer?.code ?? null,
        customerName: customer?.name ?? null,
        glAccountId,
        glAccountCode: other?.code ?? null,
        glAccountName: other?.name ?? null,
        amount: row.amount,
        allocatedAmount: kind === 'CUSTOMER_PAYMENT' ? row.settled : new Decimal(0),
        paidOn: row.documentDate,
        description: row.attributes[ATTRIBUTE.memo] ?? null,
        reference: row.attributes[ATTRIBUTE.reference] ?? null,
        counterpartyName: row.attributes[ATTRIBUTE.counterparty] ?? null,
        collectedBy: collector,
        collectedByName: collector === null ? null : (names.get(collector) ?? null),
        createdAt: row.postedAt,
        createdByName: creator === null ? null : (names.get(creator) ?? null),
      };
    });
  }
}

/** The users.id of a `user:<id>` actor ref, or null for Bto itself or a job. */
function userIdOf(ref: string): number | null {
  const match = /^user:(\d+)$/.exec(ref);
  return match?.[1] === undefined ? null : Number.parseInt(match[1], 10);
}

/** The automatic entry's description: the voucher's number and whom it concerns. */
export function paymentLabel(number: string, who: string | null | undefined): string {
  return documentLabel(number, who);
}
