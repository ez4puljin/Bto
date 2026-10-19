import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
  allocateFifo,
  FINANCE_LIMITS,
  type MoneyAccountKind,
  PAYMENT_KIND_DIRECTION,
  type PaymentDirection,
  type PaymentKind,
  type PaymentStatus,
} from '@tugeel/shared/finance';
import { Decimal } from '@tugeel/shared/money';
import { businessDate } from '@tugeel/shared/time';
import { and, asc, desc, eq, gt, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { DEFAULT_PAGE_LIMIT, decodeCursor, toPage } from '../../../common/pagination/page';
import { AuditService, type AuthContext, UserNamesService } from '../../identity';
import { CustomersService } from '../../partners';
import {
  allocations,
  glAccounts,
  invoices,
  journalEntries,
  moneyAccounts,
  payments,
} from '../schema';
import { PAYMENT_LISTENER, type PaymentListener } from '../hooks';
import { ArLedgerService } from './ar-ledger.service';
import { FinanceSettingsService } from './finance-settings.service';
import { GlAccountsService } from './gl-accounts.service';
import { assertNotFuture, type JournalLineInput, JournalService } from './journal.service';
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

type PaymentRow = typeof payments.$inferSelect;

const MONEY_SCALE = 2;

/**
 * The vouchers of the cash and bank books (ADR-0060 #5): a customer's payment settles the open
 * invoices oldest due first unless the accountant chooses, what is left is an advance (the
 * balance goes negative); a refund, an expense or any other income hit a journal account. A
 * voucher is voided by a reversing entry that also undoes its allocations.
 */
@Injectable()
export class PaymentsService implements OnModuleInit {
  private listener: PaymentListener | null = null;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly customers: CustomersService,
    private readonly names: UserNamesService,
    private readonly settings: FinanceSettingsService,
    private readonly journal: JournalService,
    private readonly accounts: GlAccountsService,
    private readonly moneyAccounts: MoneyAccountsService,
    private readonly ledger: ArLedgerService,
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
   * the same checks and postings as `record`; the new payment’s id and number.
   */
  async recordInTx(
    tx: Tx,
    ctx: AuthContext,
    input: PaymentInput,
  ): Promise<{ id: number; number: string }> {
    const direction = PAYMENT_KIND_DIRECTION[input.kind];
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
    if (glAccountId !== null) {
      await this.accounts.activeByIds([glAccountId], () => 'glAccountId', tx);
    }
    const customerId = customerKind ? input.customerId : null;
    let customerName: string | null = null;
    if (customerId !== null) {
      await this.customers.lockForUpdate(tx, customerId);
      customerName = (await this.customers.getMany([customerId], tx))[0]?.name ?? null;
    }
    const number = await this.settings.allocateNumber(tx, 'PAYMENT', input.paidOn);
    const [payment] = await tx
      .insert(payments)
      .values({
        number,
        kind: input.kind,
        direction,
        moneyAccountId: account.id,
        customerId,
        glAccountId,
        amount: input.amount,
        paidOn: input.paidOn,
        description: input.description?.trim() || null,
        reference: input.reference?.trim() || null,
        counterpartyName: input.counterpartyName?.trim() || null,
        collectedBy: input.collectedBy,
        createdBy: ctx.userId,
      })
      .returning({ id: payments.id });
    if (!payment) throw new Error('payments insert returned no row');
    let allocated = new Decimal(0);
    let settled: SettledInvoice[] = [];
    if (input.kind === 'CUSTOMER_PAYMENT' && customerId !== null) {
      settled = await this.allocate(tx, payment.id, customerId, input);
      allocated = settled.reduce((sum, own) => sum.plus(own.amount), new Decimal(0));
    }
    const zero = new Decimal(0);
    const cash = { accountId: account.glAccountId, moneyAccountId: account.id };
    const ar = async () => ({ accountId: (await this.accounts.byRole('AR', tx)).id, customerId });
    const other = { accountId: glAccountId ?? 0 };
    const lines: JournalLineInput[] =
      input.kind === 'CUSTOMER_PAYMENT'
        ? [
            { ...cash, debit: input.amount, credit: zero },
            { ...(await ar()), debit: zero, credit: input.amount },
          ]
        : input.kind === 'CUSTOMER_REFUND'
          ? [
              { ...(await ar()), debit: input.amount, credit: zero },
              { ...cash, debit: zero, credit: input.amount },
            ]
          : input.kind === 'OTHER_IN'
            ? [
                { ...cash, debit: input.amount, credit: zero },
                { ...other, debit: zero, credit: input.amount },
              ]
            : [
                { ...other, debit: input.amount, credit: zero },
                { ...cash, debit: zero, credit: input.amount },
              ];
    const entry = await this.journal.post(tx, ctx, {
      entryDate: input.paidOn,
      description: label(number, customerName ?? input.counterpartyName ?? input.description),
      source: 'AUTO_PAYMENT',
      sourceType: 'PAYMENT',
      sourceId: payment.id,
      lines,
    });
    await tx.update(payments).set({ journalEntryId: entry.id }).where(eq(payments.id, payment.id));
    if (customerId !== null) {
      await this.ledger.record(tx, {
        customerId,
        entryDate: input.paidOn,
        kind: input.kind === 'CUSTOMER_PAYMENT' ? 'PAYMENT' : 'REFUND',
        docType: 'PAYMENT',
        docId: payment.id,
        docNumber: number,
        debit: input.kind === 'CUSTOMER_REFUND' ? input.amount : zero,
        credit: input.kind === 'CUSTOMER_PAYMENT' ? input.amount : zero,
      });
    }
    await this.audit.record(tx, ctx, {
      action: 'CREATE',
      entity: 'payments',
      entityId: payment.id,
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
        paymentId: payment.id,
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
    return { id: payment.id, number };
  }

  /** Voids a posted voucher: its allocations come back onto the invoices, the entry is reversed. */
  async void(ctx: AuthContext, id: number, reason: string): Promise<PaymentDetail> {
    const trimmed = reason.trim();
    if (trimmed.length === 0 || trimmed.length > FINANCE_LIMITS.maxReason) {
      throw invalid('reason', 'length', `1 to ${FINANCE_LIMITS.maxReason} characters`);
    }
    await inTransaction(this.db, async (tx) => {
      const [head] = await tx
        .select({ customerId: payments.customerId })
        .from(payments)
        .where(eq(payments.id, id));
      if (!head) throw notFound('payment', id);
      if (head.customerId !== null) await this.customers.lockForUpdate(tx, head.customerId);
      const [payment] = await tx.select().from(payments).where(eq(payments.id, id)).for('update');
      if (!payment) throw notFound('payment', id);
      if (payment.status !== 'POSTED') {
        throw new AppError(
          'PAYMENT_STATE_INVALID',
          `payment ${payment.number} is ${payment.status}`,
          {
            number: payment.number,
            status: payment.status,
          },
        );
      }
      const live = await tx
        .select()
        .from(allocations)
        .where(
          and(
            eq(allocations.sourceType, 'PAYMENT'),
            eq(allocations.sourceId, id),
            isNull(allocations.voidedAt),
          ),
        )
        .orderBy(asc(allocations.invoiceId));
      if (live.length > 0) {
        await tx
          .select({ id: invoices.id })
          .from(invoices)
          .where(
            inArray(
              invoices.id,
              live.map((row) => row.invoiceId),
            ),
          )
          .orderBy(asc(invoices.id))
          .for('update');
        for (const row of live) {
          await tx
            .update(invoices)
            .set({ openAmount: sql`${invoices.openAmount} + ${row.amount.toFixed(2)}::numeric` })
            .where(eq(invoices.id, row.invoiceId));
        }
        await tx
          .update(allocations)
          .set({ voidedAt: sql`now()` })
          .where(
            inArray(
              allocations.id,
              live.map((row) => row.id),
            ),
          );
      }
      const today = businessDate();
      const customerName =
        payment.customerId === null
          ? null
          : ((await this.customers.getMany([payment.customerId], tx))[0]?.name ?? null);
      const reversal =
        payment.journalEntryId === null
          ? null
          : await this.journal.reverse(tx, ctx, payment.journalEntryId, {
              entryDate: today,
              description: label(payment.number, customerName ?? payment.counterpartyName),
              source: 'AUTO_VOID',
            });
      await tx
        .update(payments)
        .set({
          status: 'VOID',
          voidedAt: sql`now()`,
          voidedBy: ctx.userId,
          voidReason: trimmed,
          voidJournalEntryId: reversal?.id ?? null,
        })
        .where(eq(payments.id, id));
      if (payment.customerId !== null) {
        const zero = new Decimal(0);
        await this.ledger.record(tx, {
          customerId: payment.customerId,
          entryDate: today,
          kind: 'VOID',
          docType: 'PAYMENT',
          docId: id,
          docNumber: payment.number,
          debit: payment.kind === 'CUSTOMER_PAYMENT' ? payment.amount : zero,
          credit: payment.kind === 'CUSTOMER_REFUND' ? payment.amount : zero,
        });
      }
      await this.audit.record(tx, ctx, {
        action: 'VOID',
        entity: 'payments',
        entityId: id,
        before: { status: 'POSTED' },
        after: { status: 'VOID', reason: trimmed, reversal: reversal?.number ?? null },
      });
    });
    return this.get(id);
  }

  async list(
    ctx: AuthContext,
    query: PaymentQuery,
  ): Promise<{ data: PaymentSummary[]; nextCursor: string | null; total: number | null }> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const filters: SQL[] = [];
    if (query.moneyAccountId) filters.push(eq(payments.moneyAccountId, query.moneyAccountId));
    if (query.customerId) filters.push(eq(payments.customerId, query.customerId));
    if (query.kind) filters.push(eq(payments.kind, query.kind));
    if (query.direction) filters.push(eq(payments.direction, query.direction));
    if (query.status) filters.push(eq(payments.status, query.status));
    if (query.from) filters.push(sql`${payments.paidOn} >= ${query.from}`);
    if (query.to) filters.push(sql`${payments.paidOn} <= ${query.to}`);
    const q = query.q?.trim();
    if (q) {
      const customerIds = (await this.customers.list(ctx, { q, limit: 200 })).data.map(
        (customer) => customer.id,
      );
      const pattern = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
      filters.push(
        or(
          sql`${payments.number} ILIKE ${pattern}`,
          sql`${payments.reference} ILIKE ${pattern}`,
          sql`${payments.counterpartyName} ILIKE ${pattern}`,
          sql`${payments.description} ILIKE ${pattern}`,
          ...(customerIds.length ? [inArray(payments.customerId, customerIds)] : []),
        ) as SQL,
      );
    }
    const after = decodeCursor(query.cursor);
    const paged =
      typeof after?.date === 'string' && typeof after?.id === 'number'
        ? [sql`(${payments.paidOn}, ${payments.id}) < (${after.date}::date, ${after.id}::bigint)`]
        : [];
    const rows = await this.db
      .select(this.summaryColumns())
      .from(payments)
      .where(and(...filters, ...paged))
      .orderBy(desc(payments.paidOn), desc(payments.id))
      .limit(limit + 1);
    const page = toPage(rows, limit, (row) => ({ date: row.payment.paidOn, id: row.payment.id }));
    let total: number | null = null;
    if (!query.cursor) {
      const [counted] = await this.db
        .select({ count: sql<string>`count(*)` })
        .from(payments)
        .where(and(...filters));
      total = Number.parseInt(counted?.count ?? '0', 10);
    }
    return { data: await this.summaries(page.data), nextCursor: page.nextCursor, total };
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
    const scope = and(
      eq(payments.customerId, customerId),
      eq(payments.status, 'POSTED'),
      inArray(payments.kind, ['CUSTOMER_PAYMENT', 'CUSTOMER_REFUND']),
    );
    const after = decodeCursor(query.cursor);
    const paged =
      typeof after?.date === 'string' && typeof after?.id === 'number'
        ? sql`(${payments.paidOn}, ${payments.id}) < (${after.date}::date, ${after.id}::bigint)`
        : undefined;
    const rows = await this.db
      .select({
        id: payments.id,
        number: payments.number,
        kind: payments.kind,
        method: moneyAccounts.kind,
        amount: payments.amount,
        paidOn: payments.paidOn,
      })
      .from(payments)
      .innerJoin(moneyAccounts, eq(moneyAccounts.id, payments.moneyAccountId))
      .where(and(scope, paged))
      .orderBy(desc(payments.paidOn), desc(payments.id))
      .limit(limit + 1);
    const page = toPage(rows, limit, (row) => ({ date: row.paidOn, id: row.id }));
    const settled =
      page.data.length === 0
        ? []
        : await this.db
            .select({
              paymentId: allocations.sourceId,
              invoiceId: allocations.invoiceId,
              number: invoices.number,
              amount: allocations.amount,
            })
            .from(allocations)
            .innerJoin(invoices, eq(invoices.id, allocations.invoiceId))
            .where(
              and(
                eq(allocations.sourceType, 'PAYMENT'),
                inArray(
                  allocations.sourceId,
                  page.data.map((row) => row.id),
                ),
                isNull(allocations.voidedAt),
              ),
            )
            .orderBy(asc(invoices.dueDate), asc(invoices.id));
    let total: number | null = null;
    if (!query.cursor) {
      const [counted] = await this.db
        .select({ count: sql<string>`count(*)` })
        .from(payments)
        .where(scope);
      total = Number.parseInt(counted?.count ?? '0', 10);
    }
    return {
      data: page.data.map((row) => ({
        id: row.id,
        number: row.number,
        kind: row.kind === 'CUSTOMER_REFUND' ? 'CUSTOMER_REFUND' : 'CUSTOMER_PAYMENT',
        method: row.method,
        amount: row.amount,
        paidOn: row.paidOn,
        invoices: settled
          .filter((own) => own.paymentId === row.id)
          .map((own) => ({ invoiceId: own.invoiceId, number: own.number, amount: own.amount })),
      })),
      nextCursor: page.nextCursor,
      total,
    };
  }

  async get(id: number): Promise<PaymentDetail> {
    const [row] = await this.db
      .select({ ...this.summaryColumns(), journalNumber: journalEntries.number })
      .from(payments)
      .leftJoin(journalEntries, eq(journalEntries.id, payments.journalEntryId))
      .where(eq(payments.id, id));
    if (!row) throw notFound('payment', id);
    const [summary] = await this.summaries([row]);
    if (!summary) throw notFound('payment', id);
    const allocationRows = await this.db
      .select({
        allocation: allocations,
        invoiceNumber: invoices.number,
        invoiceDueDate: invoices.dueDate,
      })
      .from(allocations)
      .innerJoin(invoices, eq(invoices.id, allocations.invoiceId))
      .where(and(eq(allocations.sourceType, 'PAYMENT'), eq(allocations.sourceId, id)))
      .orderBy(asc(allocations.id));
    const voidedByName =
      row.payment.voidedBy === null
        ? null
        : ((await this.names.namesOf([row.payment.voidedBy])).get(row.payment.voidedBy) ?? null);
    return {
      ...summary,
      journalEntryId: row.payment.journalEntryId,
      journalNumber: row.journalNumber,
      voidedAt: row.payment.voidedAt,
      voidedByName,
      voidReason: row.payment.voidReason,
      voidJournalEntryId: row.payment.voidJournalEntryId,
      allocations: allocationRows.map(({ allocation, invoiceNumber, invoiceDueDate }) => ({
        id: allocation.id,
        invoiceId: allocation.invoiceId,
        invoiceNumber,
        invoiceDueDate,
        amount: allocation.amount,
        voidedAt: allocation.voidedAt,
      })),
    };
  }

  /** A money account's posted vouchers newest first with the balance after each. */
  async book(moneyAccountId: number, query: BookQuery): Promise<BookPage> {
    await this.moneyAccounts.get(moneyAccountId);
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const after = decodeCursor(query.cursor);
    const signed = sql`CASE ${payments.direction} WHEN 'IN' THEN ${payments.amount} ELSE -${payments.amount} END`;
    const running = this.db
      .select({
        id: payments.id,
        paidOn: payments.paidOn,
        balanceAfter:
          sql<string>`sum(${signed}) OVER (ORDER BY ${payments.paidOn}, ${payments.id})`.as(
            'balance_after',
          ),
      })
      .from(payments)
      .where(and(eq(payments.moneyAccountId, moneyAccountId), eq(payments.status, 'POSTED')))
      .as('running');
    const filters: SQL[] = [];
    if (query.from) filters.push(sql`${running.paidOn} >= ${query.from}`);
    if (query.to) filters.push(sql`${running.paidOn} <= ${query.to}`);
    if (typeof after?.date === 'string' && typeof after?.id === 'number') {
      filters.push(
        sql`(${running.paidOn}, ${running.id}) < (${after.date}::date, ${after.id}::bigint)`,
      );
    }
    const rows = await this.db
      .select({ ...this.summaryColumns(), balanceAfter: running.balanceAfter })
      .from(running)
      .innerJoin(payments, eq(payments.id, running.id))
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(running.paidOn), desc(running.id))
      .limit(limit + 1);
    const page = toPage(rows, limit, (row) => ({ date: row.payment.paidOn, id: row.payment.id }));
    let opening = new Decimal(0);
    if (query.from) {
      const [before] = await this.db
        .select({ balance: sql<string>`coalesce(sum(${signed}), 0)` })
        .from(payments)
        .where(
          and(
            eq(payments.moneyAccountId, moneyAccountId),
            eq(payments.status, 'POSTED'),
            sql`${payments.paidOn} < ${query.from}`,
          ),
        );
      opening = new Decimal(before?.balance ?? 0);
    }
    const summaries = await this.summaries(page.data);
    return {
      data: summaries.map((summary, index) => ({
        ...summary,
        balanceAfter: new Decimal(page.data[index]?.balanceAfter ?? 0),
      })),
      nextCursor: page.nextCursor,
      opening,
    };
  }

  /**
   * Settles the customer's open invoices with a payment: the accountant's allocations when given
   * (each within the invoice's open amount, together within the payment), else oldest due first.
   * Returns the invoices it settled; the rest stays an advance.
   */
  private async allocate(
    tx: Tx,
    paymentId: number,
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
    const settled: SettledInvoice[] = [];
    for (const allocation of chosen) {
      await tx.insert(allocations).values({
        sourceType: 'PAYMENT',
        sourceId: paymentId,
        invoiceId: allocation.invoiceId,
        amount: allocation.amount,
      });
      await tx
        .update(invoices)
        .set({ openAmount: sql`${invoices.openAmount} - ${allocation.amount.toFixed(2)}::numeric` })
        .where(eq(invoices.id, allocation.invoiceId));
      settled.push({
        invoiceId: allocation.invoiceId,
        number: numbers.get(allocation.invoiceId) ?? '',
        amount: allocation.amount,
      });
    }
    return settled;
  }

  private summaryColumns() {
    return {
      payment: payments,
      allocatedAmount: sql<string>`(SELECT coalesce(sum(a.amount), 0) FROM allocations a
        WHERE a.source_type = 'PAYMENT' AND a.source_id = payments.id AND a.voided_at IS NULL)`,
    };
  }

  private async summaries(
    rows: { payment: PaymentRow; allocatedAmount: string }[],
  ): Promise<PaymentSummary[]> {
    if (rows.length === 0) return [];
    const accounts = new Map(
      (await this.db.select().from(moneyAccounts)).map((account) => [account.id, account]),
    );
    const gl = new Map((await this.db.select().from(glAccounts)).map((row) => [row.id, row]));
    const customers = new Map(
      (
        await this.customers.getMany(
          rows.flatMap((row) => (row.payment.customerId === null ? [] : [row.payment.customerId])),
        )
      ).map((customer) => [customer.id, customer]),
    );
    const names = await this.names.namesOf(
      rows.flatMap((row) => [
        ...(row.payment.createdBy === null ? [] : [row.payment.createdBy]),
        ...(row.payment.collectedBy === null ? [] : [row.payment.collectedBy]),
      ]),
    );
    return rows.map(({ payment, allocatedAmount }) => {
      const account = accounts.get(payment.moneyAccountId);
      const customer = payment.customerId === null ? null : customers.get(payment.customerId);
      const other = payment.glAccountId === null ? null : gl.get(payment.glAccountId);
      return {
        id: payment.id,
        number: payment.number,
        status: payment.status,
        kind: payment.kind,
        direction: payment.direction,
        moneyAccountId: payment.moneyAccountId,
        moneyAccountCode: account?.code ?? '',
        moneyAccountName: account?.name ?? '',
        customerId: payment.customerId,
        customerCode: customer?.code ?? null,
        customerName: customer?.name ?? null,
        glAccountId: payment.glAccountId,
        glAccountCode: other?.code ?? null,
        glAccountName: other?.name ?? null,
        amount: payment.amount,
        allocatedAmount: new Decimal(allocatedAmount),
        paidOn: payment.paidOn,
        description: payment.description,
        reference: payment.reference,
        counterpartyName: payment.counterpartyName,
        collectedBy: payment.collectedBy,
        collectedByName:
          payment.collectedBy === null ? null : (names.get(payment.collectedBy) ?? null),
        createdAt: payment.createdAt,
        createdByName: payment.createdBy === null ? null : (names.get(payment.createdBy) ?? null),
      };
    });
  }
}

/** The automatic entry's description: the voucher's number and whom it concerns. */
function label(number: string, who: string | null | undefined): string {
  const name = who?.trim();
  return name ? `${number} — ${name}`.slice(0, FINANCE_LIMITS.maxDescription) : number;
}
