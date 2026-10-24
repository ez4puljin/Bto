import { Inject, Injectable } from '@nestjs/common';
import { AGING_BUCKETS, type AgingBucket, type SettlementGroup } from '@tugeel/shared/finance';
import { Decimal } from '@tugeel/shared/money';
import { sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import type { AuthContext } from '../../identity';
import { ReportContext } from './report-context';
import { allOf, dateText, dec, int, intOrNull, money, rowsOf, searchSql, textOrNull } from './report-sql';

export type AgingAmounts = Record<AgingBucket, string>;

export interface AgingRow {
  partyId: number;
  customerId: number | null;
  code: string | null;
  name: string;
  settlementGroup: SettlementGroup | null;
  buckets: AgingAmounts;
  /** Advances and unapplied payments (open credit items), shown apart and netted in `total`. */
  credit: string;
  total: string;
  overdue: string;
  oldestDueDate: string | null;
}

export interface Aging {
  date: string;
  rows: AgingRow[];
  totals: AgingAmounts;
  credit: string;
  total: string;
  overdue: string;
}

export interface AgingItem {
  itemId: number;
  side: 'DEBIT' | 'CREDIT';
  documentNumber: string;
  documentClass: string;
  /** The Bto invoice behind a sales-invoice item (the drill-down to the invoice). */
  invoiceId: number | null;
  itemDate: string;
  dueDate: string | null;
  daysOverdue: number | null;
  bucket: AgingBucket | null;
  amount: string;
  openAmount: string;
}

export interface AgingQuery {
  settlementGroup?: SettlementGroup;
  q?: string;
  overdueOnly?: boolean;
}

/** Days past due as SQL: «Хугацаа болоогүй», 1–30, 31–60, 61–90, 90+ (ADR-0108 #8). */
const bucketSql = (today: string) => {
  const late = sql`(${today}::date - coalesce(i.due_date, i.item_date))`;
  return sql`CASE WHEN ${late} <= 0 THEN 'NOT_DUE' WHEN ${late} <= 30 THEN 'D1_30'
                  WHEN ${late} <= 60 THEN 'D31_60' WHEN ${late} <= 90 THEN 'D61_90'
                  ELSE 'D90_PLUS' END`;
};

const MAX_ROWS = 5_000;

function zeroBuckets(): Record<AgingBucket, Decimal> {
  return Object.fromEntries(AGING_BUCKETS.map((b) => [b, new Decimal(0)])) as Record<AgingBucket, Decimal>;
}

function moneyBuckets(buckets: Record<AgingBucket, Decimal>): AgingAmounts {
  return Object.fromEntries(AGING_BUCKETS.map((b) => [b, money(buckets[b])])) as AgingAmounts;
}

/**
 * Receivables aging (ADR-0108 #2, #8), live from the Finance Core's open items: each customer's
 * open debit items by days past their due date (the settlement days of ADR-0101 set it), the
 * open credit items apart.
 */
@Injectable()
export class AgingService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly context: ReportContext,
  ) {}

  async aging(ctx: AuthContext, query: AgingQuery): Promise<Aging> {
    const scope = await this.context.scope(ctx);
    const filters = allOf([
      query.settlementGroup ? sql`c.settlement_group = ${query.settlementGroup}` : null,
      query.q ? (searchSql('c', query.q) ?? sql`TRUE`) : null,
    ]);
    const rows = await rowsOf(
      this.db,
      sql`SELECT i.party_id, i.customer_id, c.code, coalesce(c.name, i.party_name) AS name,
                 c.settlement_group, ${bucketSql(scope.today)} AS bucket, i.side,
                 sum(i.open_amount) AS amount, min(i.due_date) FILTER (WHERE i.side = 'DEBIT') AS oldest
            FROM reporting.ar_open_items i
            LEFT JOIN public.customers c ON c.id = i.customer_id
           WHERE i.company_code = ${scope.company} AND ${filters}
           GROUP BY i.party_id, i.customer_id, c.code, c.name, i.party_name, c.settlement_group, 6, i.side`,
    );
    const byParty = new Map<
      number,
      { row: Omit<AgingRow, 'buckets' | 'credit' | 'total' | 'overdue'>; buckets: Record<AgingBucket, Decimal>; credit: Decimal }
    >();
    for (const row of rows) {
      const partyId = int(row.party_id);
      let entry = byParty.get(partyId);
      if (!entry) {
        entry = {
          row: {
            partyId,
            customerId: intOrNull(row.customer_id),
            code: textOrNull(row.code),
            name: String(row.name),
            settlementGroup: textOrNull(row.settlement_group) as SettlementGroup | null,
            oldestDueDate: null,
          },
          buckets: zeroBuckets(),
          credit: new Decimal(0),
        };
        byParty.set(partyId, entry);
      }
      const amount = dec(row.amount);
      if (row.side === 'CREDIT') {
        entry.credit = entry.credit.plus(amount);
      } else {
        const bucket = row.bucket as AgingBucket;
        entry.buckets[bucket] = entry.buckets[bucket].plus(amount);
        const oldest = dateText(row.oldest);
        if (oldest && (!entry.row.oldestDueDate || oldest < entry.row.oldestDueDate)) {
          entry.row.oldestDueDate = oldest;
        }
      }
    }
    const totals = zeroBuckets();
    let credit = new Decimal(0);
    let overdueAll = new Decimal(0);
    const out: (AgingRow & { sort: Decimal })[] = [];
    for (const entry of byParty.values()) {
      const debit = AGING_BUCKETS.reduce((sum, b) => sum.plus(entry.buckets[b]), new Decimal(0));
      const overdue = debit.minus(entry.buckets.NOT_DUE);
      if (query.overdueOnly && overdue.lte(0)) continue;
      for (const b of AGING_BUCKETS) totals[b] = totals[b].plus(entry.buckets[b]);
      credit = credit.plus(entry.credit);
      overdueAll = overdueAll.plus(overdue);
      const total = debit.minus(entry.credit);
      out.push({
        ...entry.row,
        buckets: moneyBuckets(entry.buckets),
        credit: money(entry.credit),
        total: money(total),
        overdue: money(overdue),
        sort: overdue,
      });
    }
    out.sort((a, b) => b.sort.cmp(a.sort) || new Decimal(b.total).cmp(new Decimal(a.total)) || a.partyId - b.partyId);
    const debitAll = AGING_BUCKETS.reduce((sum, b) => sum.plus(totals[b]), new Decimal(0));
    return {
      date: scope.today,
      rows: out.slice(0, MAX_ROWS).map(({ sort: _sort, ...row }) => row),
      totals: moneyBuckets(totals),
      credit: money(credit),
      total: money(debitAll.minus(credit)),
      overdue: money(overdueAll),
    };
  }

  /** One party's open items, oldest due first, with the invoice behind each sales invoice. */
  async items(ctx: AuthContext, partyId: number): Promise<AgingItem[]> {
    const scope = await this.context.scope(ctx);
    const rows = await rowsOf(
      this.db,
      sql`SELECT i.item_id, i.side, i.document_number, i.document_class, i.source_doc_type,
                 i.source_doc_id, i.item_date, i.due_date, i.amount, i.open_amount,
                 ${scope.today}::date - i.due_date AS late, ${bucketSql(scope.today)} AS bucket
            FROM reporting.ar_open_items i
           WHERE i.company_code = ${scope.company} AND i.party_id = ${partyId}
           ORDER BY coalesce(i.due_date, i.item_date), i.item_id`,
    );
    return rows.map((row) => {
      const late = intOrNull(row.late);
      const sourceId = textOrNull(row.source_doc_id);
      return {
        itemId: int(row.item_id),
        side: row.side as 'DEBIT' | 'CREDIT',
        documentNumber: String(row.document_number),
        documentClass: String(row.document_class),
        invoiceId:
          row.source_doc_type === 'SALES_INVOICE' && sourceId && /^\d+$/.test(sourceId)
            ? Number.parseInt(sourceId, 10)
            : null,
        itemDate: dateText(row.item_date) ?? '',
        dueDate: dateText(row.due_date),
        daysOverdue: row.side === 'DEBIT' && late !== null && late > 0 ? late : null,
        bucket: row.side === 'DEBIT' ? (row.bucket as AgingBucket) : null,
        amount: money(dec(row.amount)),
        openAmount: money(dec(row.open_amount)),
      };
    });
  }
}
