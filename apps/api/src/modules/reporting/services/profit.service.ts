import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from '@tugeel/shared/money';
import { type SQL, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import type { AuthContext } from '../../identity';
import { ReportContext } from './report-context';
import { checkedRange, type DateRange } from './report-periods';
import {
  allOf,
  dateText,
  dec,
  intOrNull,
  marginPct,
  money,
  pct,
  rowsOf,
  textOrNull,
} from './report-sql';

export const PROFIT_GROUPINGS = ['customer', 'product', 'category', 'rep'] as const;
export type ProfitGrouping = (typeof PROFIT_GROUPINGS)[number];

export const SALES_SOURCES = ['ALL', 'WHOLESALE', 'POS'] as const;
export type SalesSource = (typeof SALES_SOURCES)[number];

/**
 * What a row stands for: a customer, product, category or order author (USER), «Bto300» orders
 * (APP), the supermarket (POS), re-costing differences (COST_ADJ) or nothing known (NONE).
 */
export const PROFIT_ROW_KINDS = [
  'CUSTOMER',
  'PRODUCT',
  'CATEGORY',
  'USER',
  'APP',
  'POS',
  'COST_ADJ',
  'NONE',
] as const;
export type ProfitRowKind = (typeof PROFIT_ROW_KINDS)[number];

export interface SalesFilter {
  from: string;
  to: string;
  source?: SalesSource;
  customerId?: number;
  productId?: number;
  /** A category and everything under it. */
  categoryId?: number;
  repUserId?: number;
  /** Only «Bto300» orders. */
  app?: boolean;
}

export interface ProfitRow {
  kind: ProfitRowKind;
  id: number | null;
  code: string | null;
  name: string | null;
  qty: string | null;
  sales: string;
  returns: string;
  cost: string;
  profit: string;
  margin: string | null;
  /** Margin under the threshold (or a loss). */
  flagged: boolean;
}

export interface ProfitTotals {
  sales: string;
  returns: string;
  cost: string;
  profit: string;
  margin: string | null;
}

export interface ProfitReport extends DateRange {
  by: ProfitGrouping;
  threshold: string;
  rows: ProfitRow[];
  totals: ProfitTotals;
  /** More rows than returned: the rest summed. */
  others: ProfitTotals | null;
}

export const SALES_DOC_KINDS = [
  'INVOICE',
  'CREDIT_NOTE',
  'POS_SALE',
  'POS_RETURN',
  'COST_ADJ',
] as const;
export type SalesDocKind = (typeof SALES_DOC_KINDS)[number];

export interface SalesDocument {
  kind: SalesDocKind;
  id: number;
  number: string | null;
  date: string;
  orderId: number | null;
  customerId: number | null;
  customerName: string | null;
  sales: string;
  cost: string | null;
  profit: string | null;
  margin: string | null;
}

export interface SalesDocuments extends DateRange {
  rows: SalesDocument[];
  /** More documents than returned (the newest are shown). */
  more: boolean;
}

const MAX_ROWS = 2_000;
const MAX_DOCUMENTS = 500;

/** The filter as SQL over a table with the columns of `reporting.sales_lines` (alias `m`). */
function filterSql(filter: SalesFilter, range: DateRange): SQL {
  return allOf([
    sql`m.day BETWEEN ${range.from}::date AND ${range.to}::date`,
    filter.source && filter.source !== 'ALL' ? sql`m.source = ${filter.source}` : null,
    filter.customerId ? sql`m.customer_id = ${filter.customerId}` : null,
    filter.productId ? sql`m.product_id = ${filter.productId}` : null,
    filter.repUserId ? sql`m.rep_user_id = ${filter.repUserId}` : null,
    filter.app ? sql`m.channel = 'CUSTOMER_APP'` : null,
    filter.categoryId
      ? sql`m.product_id IN (
          SELECT p.id FROM public.products p WHERE p.category_id IN (
            WITH RECURSIVE sub AS (
              SELECT id FROM public.categories WHERE id = ${filter.categoryId}
              UNION ALL SELECT k.id FROM public.categories k JOIN sub ON k.parent_id = sub.id)
            SELECT id FROM sub))`
      : null,
  ]);
}

function totalsOf(sales: Decimal, returns: Decimal, cost: Decimal): ProfitTotals {
  const profit = sales.minus(cost);
  return {
    sales: money(sales),
    returns: money(returns),
    cost: money(cost),
    profit: money(profit),
    margin: pct(marginPct(profit, sales)),
  };
}

/**
 * Profitability (ADR-0108 #3) by customer, product, category or order author from the daily
 * totals; a margin under the threshold is flagged. The documents behind any figure come live from
 * `reporting.sales_lines`. Only for `reports.margins.view`.
 */
@Injectable()
export class ProfitService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly context: ReportContext,
  ) {}

  async profit(ctx: AuthContext, by: ProfitGrouping, filter: SalesFilter): Promise<ProfitReport> {
    const scope = await this.context.scope(ctx);
    const range = checkedRange(filter.from, filter.to);
    const where = filterSql(filter, range);
    const grouping: Record<ProfitGrouping, { key: SQL; select: SQL; join: SQL }> = {
      customer: {
        key: sql`CASE WHEN m.customer_id IS NOT NULL THEN 'CUSTOMER' WHEN m.source = 'POS' THEN 'POS'
                      WHEN m.source = 'COST_ADJ' THEN 'COST_ADJ' ELSE 'NONE' END, m.customer_id`,
        select: sql`c.code::text AS code, c.name AS name`,
        join: sql`LEFT JOIN public.customers c ON c.id = g.id`,
      },
      product: {
        key: sql`'PRODUCT', m.product_id`,
        select: sql`p.sku::text AS code, p.name AS name`,
        join: sql`LEFT JOIN public.products p ON p.id = g.id`,
      },
      category: {
        key: sql`'CATEGORY', m.category_id`,
        select: sql`NULL::text AS code, (WITH RECURSIVE up AS (
                      SELECT id, parent_id, name::text AS path FROM public.categories WHERE id = g.id
                      UNION ALL SELECT k.id, k.parent_id, k.name || ' / ' || up.path
                        FROM public.categories k JOIN up ON k.id = up.parent_id)
                    SELECT path FROM up WHERE parent_id IS NULL) AS name`,
        join: sql``,
      },
      rep: {
        key: sql`CASE WHEN m.source = 'POS' THEN 'POS' WHEN m.source = 'COST_ADJ' THEN 'COST_ADJ'
                      WHEN m.channel = 'CUSTOMER_APP' THEN 'APP' WHEN m.rep_user_id IS NOT NULL THEN 'USER'
                      ELSE 'NONE' END,
                 CASE WHEN m.source = 'WHOLESALE' AND m.channel <> 'CUSTOMER_APP' THEN m.rep_user_id END`,
        select: sql`u.username::text AS code, u.full_name AS name`,
        join: sql`LEFT JOIN public.users u ON u.id = g.id AND g.kind = 'USER'`,
      },
    };
    const g = grouping[by];
    const grouped = await rowsOf(
      this.db,
      sql`WITH g AS (
            SELECT kind, id, sum(qty) AS qty, sum(sales) AS sales, sum(returns) AS returns, sum(cost) AS cost
              FROM (SELECT ${g.key}, m.qty_base AS qty, m.net_sales AS sales,
                           m.returns, m.cost
                      FROM reporting.mv_sales_daily m WHERE ${where}) AS x (kind, id, qty, sales, returns, cost)
             GROUP BY kind, id)
          SELECT g.*, ${g.select} FROM g ${g.join}
           ORDER BY g.sales DESC, g.kind, g.id`,
    );
    let sales = new Decimal(0);
    let returns = new Decimal(0);
    let cost = new Decimal(0);
    const out: ProfitRow[] = [];
    let other: { sales: Decimal; returns: Decimal; cost: Decimal } | null = null;
    for (const row of grouped) {
      const rowSales = dec(row.sales);
      const rowReturns = dec(row.returns);
      const rowCost = dec(row.cost);
      sales = sales.plus(rowSales);
      returns = returns.plus(rowReturns);
      cost = cost.plus(rowCost);
      if (out.length >= MAX_ROWS) {
        other ??= { sales: new Decimal(0), returns: new Decimal(0), cost: new Decimal(0) };
        other.sales = other.sales.plus(rowSales);
        other.returns = other.returns.plus(rowReturns);
        other.cost = other.cost.plus(rowCost);
        continue;
      }
      const profit = rowSales.minus(rowCost);
      const margin = marginPct(profit, rowSales);
      out.push({
        kind: row.kind as ProfitRowKind,
        id: intOrNull(row.id),
        code: textOrNull(row.code),
        name: textOrNull(row.name),
        qty: by === 'product' ? dec(row.qty).toFixed() : null,
        sales: money(rowSales),
        returns: money(rowReturns),
        cost: money(rowCost),
        profit: money(profit),
        margin: pct(margin),
        flagged: margin === null ? profit.lt(0) : margin.lt(scope.threshold),
      });
    }
    return {
      ...range,
      by,
      threshold: scope.threshold.toFixed(1),
      rows: out,
      totals: totalsOf(sales, returns, cost),
      others: other ? totalsOf(other.sales, other.returns, other.cost) : null,
    };
  }

  /** The documents behind a figure, newest first, live from `reporting.sales_lines`. */
  async documents(ctx: AuthContext, filter: SalesFilter): Promise<SalesDocuments> {
    const scope = await this.context.scope(ctx);
    const range = checkedRange(filter.from, filter.to);
    const rows = await rowsOf(
      this.db,
      sql`SELECT m.doc_kind, m.doc_id, m.doc_number, m.day, m.order_id, m.customer_id, c.name AS customer_name,
                 sum(m.net_sales) AS sales, sum(m.cost) AS cost
            FROM reporting.sales_lines m
            LEFT JOIN public.customers c ON c.id = m.customer_id
           WHERE ${filterSql(filter, range)}
           GROUP BY m.doc_kind, m.doc_id, m.doc_number, m.day, m.order_id, m.customer_id, c.name
           ORDER BY m.day DESC, m.doc_kind, m.doc_id DESC
           LIMIT ${MAX_DOCUMENTS + 1}`,
    );
    return {
      ...range,
      more: rows.length > MAX_DOCUMENTS,
      rows: rows.slice(0, MAX_DOCUMENTS).map((row) => {
        const sales = dec(row.sales);
        const cost = dec(row.cost);
        const profit = sales.minus(cost);
        return {
          kind: row.doc_kind as SalesDocKind,
          id: intOrNull(row.doc_id) ?? 0,
          number: textOrNull(row.doc_number),
          date: dateText(row.day) ?? '',
          orderId: intOrNull(row.order_id),
          customerId: intOrNull(row.customer_id),
          customerName: textOrNull(row.customer_name),
          sales: money(sales),
          cost: scope.margins ? money(cost) : null,
          profit: scope.margins ? money(profit) : null,
          margin: scope.margins ? pct(marginPct(profit, sales)) : null,
        };
      }),
    };
  }
}
