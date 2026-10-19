import { Inject, Injectable } from '@nestjs/common';
import {
  AGING_BUCKETS,
  type AgingBucket,
  type ArEntryKind,
  type FinanceDocKind,
} from '@tugeel/shared/finance';
import { Decimal } from '@tugeel/shared/money';
import { businessDate } from '@tugeel/shared/time';
import { and, asc, desc, eq, gt, gte, inArray, lt, lte, sql, type SQL } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { notFound } from '../../../common/errors/app-error';
import { DEFAULT_PAGE_LIMIT, decodeCursor, toPage } from '../../../common/pagination/page';
import type { AuthContext } from '../../identity';
import { CustomersService } from '../../partners';
import { arEntries, customerBalances, financeReconcileRuns, invoices } from '../schema';

export interface ArEntryInput {
  customerId: number;
  entryDate: string;
  kind: ArEntryKind;
  docType: FinanceDocKind;
  docId: number;
  docNumber: string;
  debit: Decimal;
  credit: Decimal;
}

export interface CustomerBalance {
  customerId: number;
  /** Σ debit − Σ credit of the ledger; negative = the customer is in advance. */
  balance: Decimal;
  openInvoices: number;
  overdueAmount: Decimal;
  oldestDueDate: string | null;
  updatedAt: Date | null;
}

export interface Overdue {
  amount: Decimal;
  oldestDueDate: string | null;
}

export interface LedgerEntry {
  id: number;
  entryDate: string;
  kind: ArEntryKind;
  docType: FinanceDocKind;
  docId: number;
  docNumber: string;
  debit: Decimal;
  credit: Decimal;
  /** The balance after this entry, oldest first. */
  balanceAfter: Decimal;
  createdAt: Date;
}

export interface LedgerQuery {
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
}

export interface LedgerPage {
  data: LedgerEntry[];
  nextCursor: string | null;
  /** The balance before `from` (0 without `from`). */
  opening: Decimal;
}

/** A statement's entry: its own debit or credit and the balance after it, by date. */
export interface StatementEntry {
  id: number;
  entryDate: string;
  kind: ArEntryKind;
  docType: FinanceDocKind;
  docId: number;
  docNumber: string;
  debit: Decimal;
  credit: Decimal;
  /** The opening balance plus every entry up to this one, oldest first. */
  balance: Decimal;
  /** The sales order of an invoice's entry (a purchase, its void); null otherwise. */
  orderId: number | null;
}

/**
 * A customer's statement for a period (ADR-0085): the balance before `from`, every entry dated
 * `from` … `to` oldest first (by date, then as recorded), the totals and the balance after `to`.
 */
export interface CustomerStatement {
  from: string;
  to: string;
  opening: Decimal;
  entries: StatementEntry[];
  totalDebit: Decimal;
  totalCredit: Decimal;
  closing: Decimal;
}

export interface CustomerBalanceRow extends CustomerBalance {
  code: string;
  name: string;
  status: string;
  creditLimit: Decimal | null;
  creditHold: boolean;
  aging: Record<AgingBucket, Decimal>;
}

export interface BalancesQuery {
  q?: string;
  /** Only customers with an overdue amount. */
  overdue?: boolean;
  cursor?: string;
  limit?: number;
}

export interface ReconcileDrift {
  customerId: number;
  cachedBalance: string;
  ledgerBalance: string;
  cachedOpenInvoices: number;
  ledgerOpenInvoices: number;
}

export interface FinanceReconcileRun {
  id: number;
  kind: 'NIGHTLY' | 'MANUAL';
  status: 'OK' | 'DRIFT';
  checked: number;
  drifted: number;
  details: ReconcileDrift[];
}

export interface Attention {
  overdueAmount: Decimal;
  overdueCustomers: number;
  openAmount: Decimal;
  openInvoices: number;
}

const MAX_DRIFT_DETAILS = 200;

/**
 * The receivables ledger (ADR-0060 #4): append-only entries per customer and a cache of each
 * customer's balance, open invoices and overdue amount, rewritten in the transaction of every
 * entry and checked every night. Callers write an entry under the customer lock
 * (`CustomersService.lockForUpdate`), after any stock posting and before locking invoices.
 */
@Injectable()
export class ArLedgerService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly customers: CustomersService,
  ) {}

  /** Appends an entry and refreshes the customer's cache; the caller holds the customer lock. */
  async record(tx: Tx, entry: ArEntryInput): Promise<CustomerBalance> {
    await tx.insert(arEntries).values(entry);
    return upsertBalance(tx, entry.customerId, businessDate());
  }

  /** Recomputes a customer's cache from the ledger and the open invoices, as of `today`. */
  refresh(tx: Tx, customerId: number, today: string = businessDate()): Promise<CustomerBalance> {
    return upsertBalance(tx, customerId, today);
  }

  /** The cached balance; zeros for a customer without entries. */
  async balanceOf(customerId: number, executor: Db | Tx = this.db): Promise<CustomerBalance> {
    const [row] = await executor
      .select()
      .from(customerBalances)
      .where(eq(customerBalances.customerId, customerId));
    return (
      row ?? {
        customerId,
        balance: new Decimal(0),
        openInvoices: 0,
        overdueAmount: new Decimal(0),
        oldestDueDate: null,
        updatedAt: null,
      }
    );
  }

  /** The open amount past due as of `today`, read live from the invoices (the credit check). */
  async overdueOf(
    customerId: number,
    today: string = businessDate(),
    executor: Db | Tx = this.db,
  ): Promise<Overdue> {
    const [row] = await executor
      .select({
        amount: sql<string>`coalesce(sum(${invoices.openAmount}), 0)`,
        oldest: sql<string | null>`min(${invoices.dueDate})::text`,
      })
      .from(invoices)
      .where(and(openInvoiceSql(customerId), lt(invoices.dueDate, today)));
    return { amount: new Decimal(row?.amount ?? 0), oldestDueDate: row?.oldest ?? null };
  }

  /** One customer's balance with the credit terms and the aging, as the balances list shows it. */
  async rowOf(customerId: number): Promise<CustomerBalanceRow> {
    const [customer] = await this.customers.findByIds([customerId]);
    if (!customer) throw notFound('customer', customerId);
    const balance = await this.balanceOf(customerId);
    const aging = await this.agingOf([customerId], businessDate());
    return {
      ...balance,
      code: customer.code,
      name: customer.name,
      status: customer.status,
      creditLimit: customer.creditLimit,
      creditHold: customer.creditHold,
      aging: aging.get(customerId) ?? emptyAging(),
    };
  }

  /** The customer's entries newest first with the balance after each, and the opening balance. */
  async ledger(customerId: number, query: LedgerQuery): Promise<LedgerPage> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const after = decodeCursor(query.cursor);
    const running = this.db
      .select({
        id: arEntries.id,
        entryDate: arEntries.entryDate,
        kind: arEntries.kind,
        docType: arEntries.docType,
        docId: arEntries.docId,
        docNumber: arEntries.docNumber,
        debit: arEntries.debit,
        credit: arEntries.credit,
        createdAt: arEntries.createdAt,
        balanceAfter:
          sql<string>`sum(${arEntries.debit} - ${arEntries.credit}) OVER (ORDER BY ${arEntries.id})`.as(
            'balance_after',
          ),
      })
      .from(arEntries)
      .where(eq(arEntries.customerId, customerId))
      .as('running');
    const filters: SQL[] = [];
    if (query.from) filters.push(sql`${running.entryDate} >= ${query.from}`);
    if (query.to) filters.push(sql`${running.entryDate} <= ${query.to}`);
    if (typeof after?.id === 'number') filters.push(sql`${running.id} < ${after.id}`);
    const rows = await this.db
      .select()
      .from(running)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(running.id))
      .limit(limit + 1);
    const page = toPage(rows, limit, (row) => ({ id: row.id }));
    let opening = new Decimal(0);
    if (query.from) {
      const [before] = await this.db
        .select({
          balance: sql<string>`coalesce(sum(${arEntries.debit} - ${arEntries.credit}), 0)`,
        })
        .from(arEntries)
        .where(and(eq(arEntries.customerId, customerId), lt(arEntries.entryDate, query.from)));
      opening = new Decimal(before?.balance ?? 0);
    }
    return {
      data: page.data.map((row) => ({ ...row, balanceAfter: new Decimal(row.balanceAfter) })),
      nextCursor: page.nextCursor,
      opening,
    };
  }

  /** The customer's statement for `from` … `to` (inclusive business dates, ADR-0085). */
  async statement(customerId: number, from: string, to: string): Promise<CustomerStatement> {
    const [before] = await this.db
      .select({
        balance: sql<string>`coalesce(sum(${arEntries.debit} - ${arEntries.credit}), 0)`,
      })
      .from(arEntries)
      .where(and(eq(arEntries.customerId, customerId), lt(arEntries.entryDate, from)));
    const rows = await this.db
      .select({
        id: arEntries.id,
        entryDate: arEntries.entryDate,
        kind: arEntries.kind,
        docType: arEntries.docType,
        docId: arEntries.docId,
        docNumber: arEntries.docNumber,
        debit: arEntries.debit,
        credit: arEntries.credit,
        orderId: invoices.orderId,
      })
      .from(arEntries)
      .leftJoin(invoices, and(eq(arEntries.docType, 'INVOICE'), eq(invoices.id, arEntries.docId)))
      .where(
        and(
          eq(arEntries.customerId, customerId),
          gte(arEntries.entryDate, from),
          lte(arEntries.entryDate, to),
        ),
      )
      .orderBy(asc(arEntries.entryDate), asc(arEntries.id));
    const opening = new Decimal(before?.balance ?? 0);
    let balance = opening;
    let totalDebit = new Decimal(0);
    let totalCredit = new Decimal(0);
    const entries = rows.map((row) => {
      const debit = new Decimal(row.debit);
      const credit = new Decimal(row.credit);
      totalDebit = totalDebit.plus(debit);
      totalCredit = totalCredit.plus(credit);
      balance = balance.plus(debit).minus(credit);
      return { ...row, debit, credit, balance };
    });
    return { from, to, opening, entries, totalDebit, totalCredit, closing: balance };
  }

  /**
   * The customers with a ledger, largest balance first, with their credit terms and the aging of
   * their open invoices as of today.
   */
  async balances(
    ctx: AuthContext,
    query: BalancesQuery,
  ): Promise<{ data: CustomerBalanceRow[]; nextCursor: string | null }> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const after = decodeCursor(query.cursor);
    const filters: SQL[] = [];
    if (query.overdue) filters.push(gt(customerBalances.overdueAmount, new Decimal(0)));
    if (query.q?.trim()) {
      const ids = (await this.customers.list(ctx, { q: query.q.trim(), limit: 200 })).data.map(
        (customer) => customer.id,
      );
      if (ids.length === 0) return { data: [], nextCursor: null };
      filters.push(inArray(customerBalances.customerId, ids));
    }
    if (typeof after?.balance === 'string' && typeof after?.id === 'number') {
      filters.push(
        sql`(${customerBalances.balance} < ${after.balance}::numeric OR (${customerBalances.balance} = ${after.balance}::numeric AND ${customerBalances.customerId} > ${after.id}))`,
      );
    }
    const rows = await this.db
      .select()
      .from(customerBalances)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(customerBalances.balance), customerBalances.customerId)
      .limit(limit + 1);
    const page = toPage(rows, limit, (row) => ({
      balance: row.balance.toFixed(2),
      id: row.customerId,
    }));
    const ids = page.data.map((row) => row.customerId);
    const customers = new Map(
      (await this.customers.findByIds(ids)).map((customer) => [customer.id, customer]),
    );
    const aging = await this.agingOf(ids, businessDate());
    return {
      data: page.data.map((row) => {
        const customer = customers.get(row.customerId);
        return {
          ...row,
          code: customer?.code ?? '',
          name: customer?.name ?? '',
          status: customer?.status ?? 'ACTIVE',
          creditLimit: customer?.creditLimit ?? null,
          creditHold: customer?.creditHold ?? false,
          aging: aging.get(row.customerId) ?? emptyAging(),
        };
      }),
      nextCursor: page.nextCursor,
    };
  }

  /** What the home page shows (ADR-0060 #11): overdue and open receivables as of today. */
  async attention(today: string = businessDate()): Promise<Attention> {
    const [row] = await this.db
      .select({
        overdueAmount: sql<string>`coalesce(sum(${invoices.openAmount}) FILTER (WHERE ${invoices.dueDate} < ${today}), 0)`,
        overdueCustomers: sql<string>`count(DISTINCT ${invoices.customerId}) FILTER (WHERE ${invoices.dueDate} < ${today})`,
        openAmount: sql<string>`coalesce(sum(${invoices.openAmount}), 0)`,
        openInvoices: sql<string>`count(*)`,
      })
      .from(invoices)
      .where(and(eq(invoices.status, 'ISSUED'), gt(invoices.openAmount, new Decimal(0))));
    return {
      overdueAmount: new Decimal(row?.overdueAmount ?? 0),
      overdueCustomers: Number.parseInt(row?.overdueCustomers ?? '0', 10),
      openAmount: new Decimal(row?.openAmount ?? 0),
      openInvoices: Number.parseInt(row?.openInvoices ?? '0', 10),
    };
  }

  /** The nightly job's and the CLI's check of the cache (`reconcileReceivables`). */
  reconcile(kind: 'NIGHTLY' | 'MANUAL'): Promise<FinanceReconcileRun> {
    return reconcileReceivables(this.db, kind);
  }

  /** The open amounts of these customers by days past due, as of `today`. */
  private async agingOf(
    customerIds: readonly number[],
    today: string,
  ): Promise<Map<number, Record<AgingBucket, Decimal>>> {
    const result = new Map<number, Record<AgingBucket, Decimal>>();
    if (customerIds.length === 0) return result;
    const late = sql`(${today}::date - ${invoices.dueDate})`;
    const bucket = sql<AgingBucket>`CASE WHEN ${late} <= 0 THEN 'NOT_DUE' WHEN ${late} <= 30 THEN 'D1_30'
          WHEN ${late} <= 60 THEN 'D31_60' WHEN ${late} <= 90 THEN 'D61_90' ELSE 'D90_PLUS' END`;
    const rows = await this.db
      .select({
        customerId: invoices.customerId,
        bucket,
        amount: sql<string>`sum(${invoices.openAmount})`,
      })
      .from(invoices)
      .where(
        and(
          inArray(invoices.customerId, [...customerIds]),
          eq(invoices.status, 'ISSUED'),
          gt(invoices.openAmount, new Decimal(0)),
        ),
      )
      .groupBy(invoices.customerId, sql`2`);
    for (const row of rows) {
      const aging = result.get(row.customerId) ?? emptyAging();
      aging[row.bucket] = new Decimal(row.amount);
      result.set(row.customerId, aging);
    }
    return result;
  }
}

function emptyAging(): Record<AgingBucket, Decimal> {
  return Object.fromEntries(AGING_BUCKETS.map((bucket) => [bucket, new Decimal(0)])) as Record<
    AgingBucket,
    Decimal
  >;
}

function openInvoiceSql(customerId: number): SQL {
  return and(
    eq(invoices.customerId, customerId),
    eq(invoices.status, 'ISSUED'),
    gt(invoices.openAmount, new Decimal(0)),
  ) as SQL;
}

/** A customer's balance, open invoices and overdue amount from the ledger and the invoices. */
export async function computeBalance(
  executor: Db | Tx,
  customerId: number,
  today: string,
): Promise<Omit<CustomerBalance, 'updatedAt'>> {
  const [ledger] = await executor
    .select({
      balance: sql<string>`coalesce(sum(${arEntries.debit} - ${arEntries.credit}), 0)`,
    })
    .from(arEntries)
    .where(eq(arEntries.customerId, customerId));
  const [open] = await executor
    .select({
      count: sql<string>`count(*)`,
      overdue: sql<string>`coalesce(sum(${invoices.openAmount}) FILTER (WHERE ${invoices.dueDate} < ${today}), 0)`,
      oldest: sql<string | null>`min(${invoices.dueDate})::text`,
    })
    .from(invoices)
    .where(openInvoiceSql(customerId));
  return {
    customerId,
    balance: new Decimal(ledger?.balance ?? 0),
    openInvoices: Number.parseInt(open?.count ?? '0', 10),
    overdueAmount: new Decimal(open?.overdue ?? 0),
    oldestDueDate: open?.oldest ?? null,
  };
}

/** Rewrites a customer's cache row from `computeBalance`. */
export async function upsertBalance(
  tx: Tx,
  customerId: number,
  today: string,
): Promise<CustomerBalance> {
  const computed = await computeBalance(tx, customerId, today);
  const values = {
    balance: computed.balance,
    openInvoices: computed.openInvoices,
    overdueAmount: computed.overdueAmount,
    oldestDueDate: computed.oldestDueDate,
  };
  const [row] = await tx
    .insert(customerBalances)
    .values({ customerId, ...values })
    .onConflictDoUpdate({
      target: customerBalances.customerId,
      set: { ...values, updatedAt: sql`now()` },
    })
    .returning();
  if (!row) throw new Error('customer_balances upsert returned no row');
  return row;
}

/**
 * Every cached row against the ledger and the invoices (the nightly job, `pnpm finance:reconcile`):
 * a balance or an open-invoice count the cache got wrong is recorded as drift (the evidence stays
 * in the run), then every row is rewritten, which also moves the overdue amounts along with the
 * calendar. Plain functions so the CLI runs it without the Nest container.
 */
export async function reconcileReceivables(
  db: Db,
  kind: 'NIGHTLY' | 'MANUAL',
): Promise<FinanceReconcileRun> {
  const today = businessDate();
  return inTransaction(db, async (tx) => {
    const startedAt = new Date();
    const ids = await tx
      .select({ customerId: sql<number>`customer_id::int` })
      .from(
        sql`(SELECT customer_id FROM ar_entries UNION SELECT customer_id FROM customer_balances) ids`,
      )
      .orderBy(sql`customer_id`);
    const drifts: ReconcileDrift[] = [];
    for (const { customerId } of ids) {
      const [cached] = await tx
        .select()
        .from(customerBalances)
        .where(eq(customerBalances.customerId, customerId));
      const computed = await computeBalance(tx, customerId, today);
      const cachedBalance = cached?.balance ?? new Decimal(0);
      const cachedOpen = cached?.openInvoices ?? 0;
      if (!cachedBalance.eq(computed.balance) || cachedOpen !== computed.openInvoices) {
        drifts.push({
          customerId,
          cachedBalance: cachedBalance.toFixed(2),
          ledgerBalance: computed.balance.toFixed(2),
          cachedOpenInvoices: cachedOpen,
          ledgerOpenInvoices: computed.openInvoices,
        });
      }
      await upsertBalance(tx, customerId, today);
    }
    const status = drifts.length === 0 ? 'OK' : 'DRIFT';
    const [run] = await tx
      .insert(financeReconcileRuns)
      .values({
        kind,
        status,
        checked: ids.length,
        drifted: drifts.length,
        details: drifts.slice(0, MAX_DRIFT_DETAILS),
        startedAt,
      })
      .returning({ id: financeReconcileRuns.id });
    if (!run) throw new Error('finance_reconcile_runs insert returned no row');
    return {
      id: run.id,
      kind,
      status,
      checked: ids.length,
      drifted: drifts.length,
      details: drifts,
    };
  });
}
