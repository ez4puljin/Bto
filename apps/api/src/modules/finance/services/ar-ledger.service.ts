import { Inject, Injectable } from '@nestjs/common';
import {
  AGING_BUCKETS,
  type AgingBucket,
  type ArEntryKind,
  type FinanceDocKind,
  type SettlementGroup,
} from '@tugeel/shared/finance';
import { Decimal } from '@tugeel/shared/money';
import { businessDate } from '@tugeel/shared/time';
import { and, eq, gt, inArray, lt, sql, type SQL } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { notFound } from '../../../common/errors/app-error';
import { DEFAULT_PAGE_LIMIT, decodeCursor, encodeCursor } from '../../../common/pagination/page';
import {
  type FinPartyLedgerRow,
  FinReader,
  type FinReconcileRun,
  reconcileBooks,
  sourceOpenAmounts,
} from '../../../finance-core';
import { BTO_SOURCE, FIN_DOC_TYPES, FinPartiesBridge } from '../../fin-bridge';
import type { AuthContext } from '../../identity';
import { CustomersService } from '../../partners';
import { financeReconcileRuns, invoices } from '../schema';
import { FinBooks } from './fin-books';

export interface CustomerBalance {
  customerId: number;
  /** Σ debit − Σ credit of the receivable lines; negative = the customer is in advance. */
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
 * A customer's statement for a period (ADR-0086): the balance before `from`, every entry dated
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
  /** The due dates follow it (ADR-0101); the card shows the settlement day from it. */
  settlementGroup: SettlementGroup;
  aging: Record<AgingBucket, Decimal>;
}

export interface BalancesQuery {
  q?: string;
  /** Only customers with an overdue amount. */
  overdue?: boolean;
  cursor?: string;
  limit?: number;
}

/** An invoice whose open amount (the mirror) differs from its item in the Finance Core. */
export interface ReconcileDrift {
  invoiceId: number;
  number: string;
  mirrorOpen: string;
  itemOpen: string;
}

export interface FinanceReconcileRun {
  id: number;
  kind: 'NIGHTLY' | 'MANUAL';
  status: 'OK' | 'DRIFT';
  checked: number;
  drifted: number;
  details: ReconcileDrift[];
  /** The Finance Core's own runs (cache, items, sub-ledger against the journal). */
  core: FinReconcileRun[];
}

export interface Attention {
  overdueAmount: Decimal;
  overdueCustomers: number;
  openAmount: Decimal;
  openInvoices: number;
}

const MAX_DRIFT_DETAILS = 200;

/** A ledger line's document in today's terms (ADR-0060 #4 kinds; F2 reads them from the core). */
const KIND_OF_TYPE: Readonly<Record<string, { kind: ArEntryKind; docType: FinanceDocKind }>> = {
  [FIN_DOC_TYPES.SALES_INVOICE.code]: { kind: 'INVOICE', docType: 'INVOICE' },
  [FIN_DOC_TYPES.SALES_RETURN.code]: { kind: 'CREDIT_NOTE', docType: 'CREDIT_NOTE' },
  [FIN_DOC_TYPES.CUSTOMER_RECEIPT.code]: { kind: 'PAYMENT', docType: 'PAYMENT' },
  [FIN_DOC_TYPES.CUSTOMER_REFUND.code]: { kind: 'REFUND', docType: 'PAYMENT' },
  [FIN_DOC_TYPES.OTHER_RECEIPT.code]: { kind: 'PAYMENT', docType: 'PAYMENT' },
  [FIN_DOC_TYPES.OTHER_PAYMENT.code]: { kind: 'REFUND', docType: 'PAYMENT' },
};

/**
 * The receivables, read from the Finance Core since F2 (ADR-0090): a customer's balance is the open
 * items of its party on the receivable accounts, its ledger and statement the receivable lines with
 * their documents; the open invoices, their aging and the overdue amount of the home tile read the
 * invoices' open amounts, which the postings keep as a mirror of their items. Nothing is written
 * here; `reconcile` checks the core and the mirror.
 */
@Injectable()
export class ArLedgerService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly customers: CustomersService,
    private readonly reader: FinReader,
    private readonly books: FinBooks,
    private readonly parties: FinPartiesBridge,
  ) {}

  /** The customer's balance (zeros for a customer without receivable lines). */
  async balanceOf(customerId: number): Promise<CustomerBalance> {
    const party = await this.partyOf(customerId);
    const open = await this.openInvoiceCounts([customerId]);
    if (party === null) {
      return {
        customerId,
        balance: new Decimal(0),
        openInvoices: open.get(customerId) ?? 0,
        overdueAmount: new Decimal(0),
        oldestDueDate: null,
        updatedAt: null,
      };
    }
    const row = await this.reader.partyBalance(this.books.source(), {
      company: await this.books.company(),
      partyId: party,
    });
    return {
      customerId,
      balance: row.net,
      openInvoices: open.get(customerId) ?? 0,
      overdueAmount: row.overdue,
      oldestDueDate: row.oldestDueDate,
      updatedAt: row.updatedAt,
    };
  }

  /** The open amount past due as of `today`, read live from the invoices. */
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
      .where(and(openInvoiceSql([customerId]), lt(invoices.dueDate, today)));
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
      settlementGroup: customer.settlementGroup,
      aging: aging.get(customerId) ?? emptyAging(),
    };
  }

  /** The customer's entries newest first with the balance after each, and the opening balance. */
  async ledger(customerId: number, query: LedgerQuery): Promise<LedgerPage> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const party = await this.partyOf(customerId);
    if (party === null) return { data: [], nextCursor: null, opening: new Decimal(0) };
    const after = decodeCursor(query.cursor);
    const { rows, opening } = await this.reader.partyLedger(this.books.source(), {
      company: await this.books.company(),
      partyId: party,
      ...(query.from ? { from: query.from } : {}),
      ...(query.to ? { to: query.to } : {}),
      ...(typeof after?.id === 'number' ? { beforeLineId: after.id } : {}),
      limit,
    });
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      data: page.map((row) => ({
        id: row.lineId,
        entryDate: row.entryDate,
        ...documentOf(row),
        debit: row.debit,
        credit: row.credit,
        balanceAfter: row.balanceAfter,
        createdAt: row.postedAt,
      })),
      nextCursor: rows.length > limit && last ? encodeCursor({ id: last.lineId }) : null,
      opening,
    };
  }

  /** The customer's statement for `from` … `to` (inclusive business dates, ADR-0086). */
  async statement(customerId: number, from: string, to: string): Promise<CustomerStatement> {
    const party = await this.partyOf(customerId);
    const zero = new Decimal(0);
    if (party === null) {
      return {
        from,
        to,
        opening: zero,
        entries: [],
        totalDebit: zero,
        totalCredit: zero,
        closing: zero,
      };
    }
    const { opening, rows } = await this.reader.partyStatement(this.books.source(), {
      company: await this.books.company(),
      partyId: party,
      from,
      to,
    });
    const mapped = rows.map((row) => ({ row, doc: documentOf(row) }));
    const invoiceIds = mapped.flatMap(({ doc }) => (doc.docType === 'INVOICE' ? [doc.docId] : []));
    const orders = new Map(
      invoiceIds.length === 0
        ? []
        : (
            await this.db
              .select({ id: invoices.id, orderId: invoices.orderId })
              .from(invoices)
              .where(inArray(invoices.id, invoiceIds))
          ).map((row) => [row.id, row.orderId]),
    );
    let totalDebit = zero;
    let totalCredit = zero;
    const entries = mapped.map(({ row, doc }) => {
      totalDebit = totalDebit.plus(row.debit);
      totalCredit = totalCredit.plus(row.credit);
      return {
        id: row.lineId,
        entryDate: row.entryDate,
        ...doc,
        debit: row.debit,
        credit: row.credit,
        balance: row.balanceAfter,
        orderId: doc.docType === 'INVOICE' ? (orders.get(doc.docId) ?? null) : null,
      };
    });
    const closing = opening.plus(totalDebit).minus(totalCredit);
    return { from, to, opening, entries, totalDebit, totalCredit, closing };
  }

  /**
   * The customers with receivables, largest balance first, with their credit terms and the aging
   * of their open invoices as of today.
   */
  async balances(
    ctx: AuthContext,
    query: BalancesQuery,
  ): Promise<{ data: CustomerBalanceRow[]; nextCursor: string | null }> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const after = decodeCursor(query.cursor);
    let partyIds: number[] | undefined;
    if (query.q?.trim()) {
      const ids = (await this.customers.list(ctx, { q: query.q.trim(), limit: 200 })).data.map(
        (customer) => customer.id,
      );
      if (ids.length === 0) return { data: [], nextCursor: null };
      partyIds = [...(await this.parties.partiesOfCustomers(ids)).values()].map((id) =>
        Number.parseInt(id, 10),
      );
      if (partyIds.length === 0) return { data: [], nextCursor: null };
    }
    const rows = await this.reader.partyBalances(this.books.source(), {
      company: await this.books.company(),
      ...(partyIds ? { partyIds } : {}),
      ...(query.overdue ? { overdueOnly: true } : {}),
      ...(typeof after?.balance === 'string' && typeof after?.id === 'number'
        ? { after: { net: after.balance, partyId: after.id } }
        : {}),
      limit,
    });
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    const customerOf = await this.parties.customersOfParties(
      page.map((row) => String(row.partyId)),
    );
    const ids = [...new Set(customerOf.values())];
    const customers = new Map(
      (await this.customers.findByIds(ids)).map((customer) => [customer.id, customer]),
    );
    const aging = await this.agingOf(ids, businessDate());
    const open = await this.openInvoiceCounts(ids);
    return {
      data: page.flatMap((row) => {
        const customerId = customerOf.get(String(row.partyId));
        if (customerId === undefined) return [];
        const customer = customers.get(customerId);
        return [
          {
            customerId,
            balance: row.net,
            openInvoices: open.get(customerId) ?? 0,
            overdueAmount: row.overdue,
            oldestDueDate: row.oldestDueDate,
            updatedAt: row.updatedAt,
            code: customer?.code ?? '',
            name: customer?.name ?? '',
            status: customer?.status ?? 'ACTIVE',
            creditLimit: customer?.creditLimit ?? null,
            creditHold: customer?.creditHold ?? false,
            settlementGroup: customer?.settlementGroup ?? 'DAY_20',
            aging: aging.get(customerId) ?? emptyAging(),
          },
        ];
      }),
      nextCursor:
        rows.length > limit && last
          ? encodeCursor({ balance: last.net.toFixed(2), id: last.partyId })
          : null,
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

  /** The nightly job's and the CLI's check (`reconcileReceivables`). */
  reconcile(kind: 'NIGHTLY' | 'MANUAL'): Promise<FinanceReconcileRun> {
    return reconcileReceivables(this.db, kind);
  }

  private async partyOf(customerId: number): Promise<number | null> {
    const party = (await this.parties.partiesOfCustomers([customerId])).get(customerId);
    return party === undefined ? null : Number.parseInt(party, 10);
  }

  private async openInvoiceCounts(customerIds: readonly number[]): Promise<Map<number, number>> {
    if (customerIds.length === 0) return new Map();
    const rows = await this.db
      .select({ customerId: invoices.customerId, count: sql<string>`count(*)` })
      .from(invoices)
      .where(openInvoiceSql(customerIds))
      .groupBy(invoices.customerId);
    return new Map(rows.map((row) => [row.customerId, Number.parseInt(row.count, 10)]));
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
      .where(openInvoiceSql(customerIds))
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

function openInvoiceSql(customerIds: readonly number[]): SQL {
  return and(
    inArray(invoices.customerId, [...customerIds]),
    eq(invoices.status, 'ISSUED'),
    gt(invoices.openAmount, new Decimal(0)),
  ) as SQL;
}

/** A receivable line's document as today's ledger names it: kind, type, id and number. */
function documentOf(row: FinPartyLedgerRow): {
  kind: ArEntryKind;
  docType: FinanceDocKind;
  docId: number;
  docNumber: string;
} {
  const target = row.reverses ?? row.document;
  if (target === null) {
    return { kind: 'ADJUSTMENT', docType: 'JOURNAL', docId: row.entryId, docNumber: '' };
  }
  const known = KIND_OF_TYPE[target.typeCode];
  if (!known) {
    // A manual entry (and its reversal) on the receivables: the journal entry is the document.
    return {
      kind: row.reverses ? 'VOID' : 'ADJUSTMENT',
      docType: 'JOURNAL',
      docId: row.entryId,
      docNumber: row.document?.number ?? '',
    };
  }
  const bto = target.sourceSystem === BTO_SOURCE && /^\d+$/.test(target.sourceDocId);
  return {
    kind: row.reverses ? 'VOID' : known.kind,
    docType: known.docType,
    docId: bto ? Number.parseInt(target.sourceDocId, 10) : target.id,
    docNumber: target.number,
  };
}

/**
 * The receivables check (the nightly job, `pnpm finance:reconcile`): the Finance Core's own runs
 * (each party balance against its items, each item against its allocations, the items against the
 * receivable lines) and Bto's mirror — every issued invoice's open amount against its item. A drift
 * of the mirror is recorded with its evidence and the mirror rewritten from the item. Plain
 * functions so the CLI runs them without the Nest container.
 */
export async function reconcileReceivables(
  db: Db,
  kind: 'NIGHTLY' | 'MANUAL',
): Promise<FinanceReconcileRun> {
  const core = await reconcileBooks(db, kind);
  return inTransaction(db, async (tx) => {
    const startedAt = new Date();
    const items = await sourceOpenAmounts(tx, {
      system: BTO_SOURCE,
      docType: FIN_DOC_TYPES.SALES_INVOICE.docType,
    });
    const issued = await tx
      .select({ id: invoices.id, number: invoices.number, openAmount: invoices.openAmount })
      .from(invoices)
      .where(eq(invoices.status, 'ISSUED'))
      .orderBy(invoices.id);
    const drifts: ReconcileDrift[] = [];
    for (const row of issued) {
      // An invoice with nothing to post (a zero total) has no item: its mirror is zero.
      const item = items.get(String(row.id)) ?? new Decimal(0);
      if (!row.openAmount.eq(item)) {
        drifts.push({
          invoiceId: row.id,
          number: row.number,
          mirrorOpen: row.openAmount.toFixed(2),
          itemOpen: item.toFixed(2),
        });
        await tx.update(invoices).set({ openAmount: item }).where(eq(invoices.id, row.id));
      }
    }
    const result = { rows: issued };
    const coreDrifted = core.reduce((sum, run) => sum + run.drifted, 0);
    const status = drifts.length === 0 && coreDrifted === 0 ? 'OK' : 'DRIFT';
    const [run] = await tx
      .insert(financeReconcileRuns)
      .values({
        kind,
        status,
        checked: result.rows.length,
        drifted: drifts.length + coreDrifted,
        details: drifts.slice(0, MAX_DRIFT_DETAILS),
        startedAt,
      })
      .returning({ id: financeReconcileRuns.id });
    if (!run) throw new Error('finance_reconcile_runs insert returned no row');
    return {
      id: run.id,
      kind,
      status,
      checked: result.rows.length,
      drifted: drifts.length + coreDrifted,
      details: drifts,
      core,
    };
  });
}
