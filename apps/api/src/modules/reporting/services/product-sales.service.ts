import { Inject, Injectable } from '@nestjs/common';
import mn from '@tugeel/shared/i18n/mn.json';
import { type SQL, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import type { AuthContext } from '../../identity';
import { idsIn, inCategory } from './book-sql';
import type { SalesDocKind, SalesSource } from './profit.service';
import { ReportContext } from './report-context';
import { checkedRange, type DateRange } from './report-periods';
import {
  allOf,
  dateText,
  dec,
  int,
  intOrNull,
  marginPct,
  money,
  pct,
  rowsOf,
  textOrNull,
} from './report-sql';

/** «Гүйлгээний төрөл»: everything, the sales only or the returns only. */
export const PRODUCT_SALES_KINDS = ['ALL', 'SALES', 'RETURNS'] as const;
export type ProductSalesKind = (typeof PRODUCT_SALES_KINDS)[number];

/**
 * «Бүлэглэл»: the products under their category, brand (the main supplier, ADR-0098 #4),
 * hand-picked segment or the user who took the order (the cashier at the till).
 */
export const PRODUCT_SALES_GROUPINGS = ['none', 'category', 'brand', 'segment', 'user'] as const;
export type ProductSalesGrouping = (typeof PRODUCT_SALES_GROUPINGS)[number];

/** A group key: an id, `APP` (the customer app's orders) or `NONE`. */
const NO_GROUP = 'NONE';
const APP_GROUP = 'APP';

export interface ProductSalesFilter {
  from: string;
  to: string;
  source?: SalesSource;
  kind?: ProductSalesKind;
  /** The user who took the order, or the cashier of a till's sale. */
  repUserId?: number;
  customerCategoryId?: number;
  customerId?: number;
  productId?: number;
  /** A category and everything under it. */
  categoryId?: number;
  warehouseId?: number;
  /** Products whose main supplier is one of these. */
  brandIds?: number[];
  /** Products in one of these hand-picked product segments. */
  segmentIds?: number[];
  by?: ProductSalesGrouping;
  /** Split the sales by how they were paid. */
  payments?: boolean;
}

/** What a figure was paid with: «Авлага», a till's payment type or an older tender's kind. */
export interface ProductSalesPayment {
  key: string;
  name: string;
}

export interface PaidAmount {
  key: string;
  /** Net of VAT, like the sales it splits. */
  amount: string;
}

/** One product's sales; cost and profit null without `reports.margins.view`. */
export interface ProductSalesRow {
  productId: number;
  sku: string;
  name: string;
  unit: string | null;
  categoryId: number | null;
  categoryName: string | null;
  /** The group's key and name under a grouping, null without one. */
  group: string | null;
  groupName: string | null;
  /** Base units, returns subtracted. */
  qty: string;
  /** Net of VAT and city tax, returns subtracted. */
  sales: string;
  /** Of the sales above: what came back. */
  returns: string;
  /** Sales ÷ quantity, null without a quantity. */
  avgPrice: string | null;
  cost: string | null;
  profit: string | null;
  margin: string | null;
  /** With `payments`: the sales by payment, else empty. */
  paid: PaidAmount[];
}

export interface ProductSalesReport extends DateRange {
  by: ProductSalesGrouping;
  rows: ProductSalesRow[];
  /** With `payments`: the payment columns in their order. */
  payments: ProductSalesPayment[];
  /** Every line once, also when a product sits in two segments. */
  totals: {
    sales: string;
    returns: string;
    cost: string | null;
    profit: string | null;
    paid: PaidAmount[];
  };
  truncated: boolean;
}

/** One document behind a product's figure. */
export interface ProductSalesDocument {
  kind: SalesDocKind;
  id: number;
  number: string | null;
  date: string;
  /** The invoice a credit note corrects (its page shows the note). */
  invoiceId: number | null;
  customerId: number | null;
  customerName: string | null;
  qty: string;
  sales: string;
  cost: string | null;
  paid: PaidAmount[];
}

export interface ProductSalesDocuments extends DateRange {
  rows: ProductSalesDocument[];
  truncated: boolean;
}

const MAX_ROWS = 5_000;
const MAX_DOCUMENTS = 1_000;

/** Who took the order behind a line: the order's author, the till's cashier (alias `m`). */
const CREATOR = sql`CASE WHEN m.source = 'POS'
    THEN (SELECT ps.cashier_user_id FROM public.pos_sales ps WHERE ps.id = m.doc_id)
    ELSE m.rep_user_id END`;

/** The live hand-picked product segments (a rule segment needs the segments module). */
const LIST_SEGMENTS = sql`SELECT s.id FROM public.segments s
   WHERE s.entity = 'PRODUCT' AND s.kind = 'LIST' AND s.archived_at IS NULL`;

/** A line's group key under `by` (alias `m`; `sp` is the segment join). */
function groupSql(by: ProductSalesGrouping): SQL {
  switch (by) {
    case 'category':
      return sql`(SELECT p.category_id::text FROM public.products p WHERE p.id = m.product_id)`;
    case 'brand':
      return sql`(SELECT ps.supplier_id::text FROM public.product_suppliers ps
                   WHERE ps.product_id = m.product_id AND ps.is_main)`;
    case 'segment':
      return sql`sp.segment_id::text`;
    case 'user':
      return sql`coalesce((${CREATOR})::text,
                   CASE WHEN m.channel = 'CUSTOMER_APP' THEN ${APP_GROUP} END)`;
    case 'none':
      return sql`NULL::text`;
  }
}

/** The filter over `reporting.sales_lines` (alias `m`). */
function filterSql(filter: ProductSalesFilter, range: DateRange): SQL {
  const kinds: Record<ProductSalesKind, SQL | null> = {
    ALL: null,
    SALES: sql`m.doc_kind IN ('INVOICE', 'POS_SALE')`,
    RETURNS: sql`m.doc_kind IN ('CREDIT_NOTE', 'POS_RETURN')`,
  };
  const brands = idsIn(sql`ps.supplier_id`, filter.brandIds);
  const segments = idsIn(sql`sp.segment_id`, filter.segmentIds);
  return allOf([
    sql`m.day BETWEEN ${range.from}::date AND ${range.to}::date`,
    sql`m.product_id IS NOT NULL`,
    filter.source && filter.source !== 'ALL' ? sql`m.source = ${filter.source}` : null,
    kinds[filter.kind ?? 'ALL'],
    filter.customerId ? sql`m.customer_id = ${filter.customerId}` : null,
    filter.customerCategoryId
      ? sql`m.customer_id IN (SELECT c.id FROM public.customers c WHERE c.category_id = ${filter.customerCategoryId})`
      : null,
    filter.productId ? sql`m.product_id = ${filter.productId}` : null,
    filter.repUserId ? sql`(${CREATOR}) = ${filter.repUserId}` : null,
    filter.warehouseId ? sql`m.warehouse_id = ${filter.warehouseId}` : null,
    inCategory(sql`m.product_id`, filter.categoryId),
    brands
      ? sql`EXISTS (SELECT 1 FROM public.product_suppliers ps
                     WHERE ps.product_id = m.product_id AND ps.is_main AND ${brands})`
      : null,
    segments
      ? sql`EXISTS (SELECT 1 FROM public.segment_products sp
                     WHERE sp.product_id = m.product_id AND ${segments})`
      : null,
  ]);
}

/**
 * The filtered lines with their group key `grp` (`NONE` for none). Under `segment` a product in
 * two segments gives two lines; the totals read the lines without a grouping.
 */
function linesSql(filter: ProductSalesFilter, range: DateRange, by: ProductSalesGrouping): SQL {
  const segmentJoin =
    by === 'segment'
      ? sql`LEFT JOIN public.segment_products sp ON sp.product_id = m.product_id
              AND sp.segment_id IN (${LIST_SEGMENTS})
              ${filter.segmentIds?.length ? sql`AND ${idsIn(sql`sp.segment_id`, filter.segmentIds)}` : sql``}`
      : sql``;
  return sql`SELECT m.*, coalesce(${groupSql(by)}, ${NO_GROUP}) AS grp
               FROM reporting.sales_lines m ${segmentJoin}
              WHERE ${filterSql(filter, range)}`;
}

/**
 * Each till sale's share per payment (`pay_key`, `share` of 1): a CREDIT tender is «Авлага», a
 * tender with the admin's payment type `T<id>`, an older one its kind. Lines of `l`.
 */
const TILL_SHARES = sql`SELECT t.sale_id, t.pay_key,
         t.amount / nullif(sum(t.amount) OVER (PARTITION BY t.sale_id), 0) AS share
    FROM (SELECT t.sale_id,
                 CASE WHEN t.kind = 'CREDIT' THEN 'AR'
                      WHEN t.payment_type_id IS NOT NULL THEN 'T' || t.payment_type_id
                      ELSE t.kind END AS pay_key,
                 sum(t.amount) AS amount
            FROM public.pos_tenders t
           WHERE t.sale_id IN (SELECT l.doc_id FROM l WHERE l.source = 'POS')
           GROUP BY 1, 2) t`;

/** `l` joined to the payments: the wholesale lines are «Авлага» (the invoice is owed). */
const PAID_LINES = sql`FROM l LEFT JOIN s ON l.source = 'POS' AND s.sale_id = l.doc_id
   WHERE l.doc_kind <> 'COST_ADJ'`;
const PAY_KEY = sql`CASE WHEN l.source = 'POS' THEN coalesce(s.pay_key, 'NONE') ELSE 'AR' END`;
const PAID = sql`round(sum(l.net_sales * coalesce(s.share, 1)), 2)`;

const PAYMENT_NAMES: Record<string, string> = mn.reports.books.payments;
const NO_GROUP_NAMES: Record<Exclude<ProductSalesGrouping, 'none'>, string> = mn.reports.books
  .noGroup;

/**
 * Erkhet's «Борлуулалт /Бараагаар/» (ADR-0133, ADR-0134): every product sold in the period with
 * its quantity, net sales, returns, average price and — for `reports.margins.view` — cost, profit
 * and margin, live from `reporting.sales_lines` (invoices, credit notes, the till's sales and
 * returns, re-costing); grouped by category, brand, segment or the order's author; split by
 * payment; the documents behind a product. Re-costing rows count only towards the cost.
 */
@Injectable()
export class ProductSalesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly context: ReportContext,
  ) {}

  async report(ctx: AuthContext, filter: ProductSalesFilter): Promise<ProductSalesReport> {
    const scope = await this.context.scope(ctx);
    const range = checkedRange(filter.from, filter.to);
    const by = filter.by ?? 'none';
    const [rows, [sums]] = await Promise.all([
      rowsOf(
        this.db,
        sql`WITH l AS (${linesSql(filter, range, by)}),
            g AS (
              SELECT l.product_id, l.grp, sum(l.qty_base) AS qty, sum(l.net_sales) AS sales,
                     sum(l.returns) AS returns, sum(l.cost) AS cost
                FROM l GROUP BY l.product_id, l.grp)
            SELECT g.*, p.sku, p.name, p.category_id, c.name AS category_name, u.name AS unit
              FROM g
              JOIN public.products p ON p.id = g.product_id
              LEFT JOIN public.categories c ON c.id = p.category_id
              LEFT JOIN public.product_units pu
                ON pu.product_id = p.id AND pu.is_base AND pu.superseded_by IS NULL
              LEFT JOIN public.uoms u ON u.id = pu.uom_id
             ORDER BY g.sales DESC, p.sku, g.grp
             LIMIT ${MAX_ROWS + 1}`,
      ),
      rowsOf(
        this.db,
        sql`SELECT sum(m.net_sales) AS sales, sum(m.returns) AS returns, sum(m.cost) AS cost
              FROM reporting.sales_lines m WHERE ${filterSql(filter, range)}`,
      ),
    ]);
    const kept = rows.slice(0, MAX_ROWS);
    const names = await this.groupNames(
      by,
      kept.map((row) => textOrNull(row.grp) ?? NO_GROUP),
    );
    const paid = filter.payments
      ? await this.paidByRow(filter, range, by)
      : { rows: new Map<string, PaidAmount[]>(), totals: [], keys: [] };
    const out = kept.map((row): ProductSalesRow => {
      const qty = dec(row.qty);
      const rowSales = dec(row.sales);
      const profit = rowSales.minus(dec(row.cost));
      const group = textOrNull(row.grp) ?? NO_GROUP;
      return {
        productId: int(row.product_id),
        sku: textOrNull(row.sku) ?? '',
        name: textOrNull(row.name) ?? '',
        unit: textOrNull(row.unit),
        categoryId: intOrNull(row.category_id),
        categoryName: textOrNull(row.category_name),
        group: by === 'none' ? null : group,
        groupName: by === 'none' ? null : (names.get(group) ?? group),
        qty: qty.toFixed(),
        sales: money(rowSales),
        returns: money(dec(row.returns)),
        avgPrice: qty.isZero() ? null : money(rowSales.div(qty)),
        cost: scope.margins ? money(dec(row.cost)) : null,
        profit: scope.margins ? money(profit) : null,
        margin: scope.margins ? pct(marginPct(profit, rowSales)) : null,
        paid: paid.rows.get(`${int(row.product_id)}|${group}`) ?? [],
      };
    });
    const sales = dec(sums?.sales);
    const cost = dec(sums?.cost);
    return {
      ...range,
      by,
      rows: out,
      payments: await this.paymentColumns(paid.keys),
      totals: {
        sales: money(sales),
        returns: money(dec(sums?.returns)),
        cost: scope.margins ? money(cost) : null,
        profit: scope.margins ? money(sales.minus(cost)) : null,
        paid: paid.totals,
      },
      truncated: rows.length > MAX_ROWS,
    };
  }

  /** The documents behind one product's figure (in `group` under `by`), oldest first. */
  async documents(
    ctx: AuthContext,
    filter: ProductSalesFilter & { productId: number; group?: string },
  ): Promise<ProductSalesDocuments> {
    const scope = await this.context.scope(ctx);
    const range = checkedRange(filter.from, filter.to);
    const by = filter.group === undefined ? 'none' : (filter.by ?? 'none');
    const inGroup = by === 'none' ? sql`true` : sql`l.grp = ${filter.group}`;
    const rows = await rowsOf(
      this.db,
      sql`WITH l AS (${linesSql(filter, range, by)})
          SELECT l.doc_kind, l.doc_id, l.doc_number, l.day, l.customer_id, c.name AS customer_name,
                 CASE WHEN l.doc_kind = 'CREDIT_NOTE'
                      THEN (SELECT cn.invoice_id FROM public.credit_notes cn WHERE cn.id = l.doc_id)
                      WHEN l.doc_kind = 'INVOICE' THEN l.doc_id END AS invoice_id,
                 sum(l.qty_base) AS qty, sum(l.net_sales) AS sales, sum(l.cost) AS cost
            FROM l
            LEFT JOIN public.customers c ON c.id = l.customer_id
           WHERE ${inGroup}
           GROUP BY l.doc_kind, l.doc_id, l.doc_number, l.day, l.customer_id, c.name
           ORDER BY l.day, l.doc_kind, l.doc_id
           LIMIT ${MAX_DOCUMENTS + 1}`,
    );
    const paid = new Map<string, PaidAmount[]>();
    if (filter.payments) {
      const split = await rowsOf(
        this.db,
        sql`WITH l AS (${linesSql(filter, range, by)}), s AS (${TILL_SHARES})
            SELECT l.doc_kind, l.doc_id, ${PAY_KEY} AS pay_key, ${PAID} AS amount
              ${PAID_LINES} AND ${inGroup}
             GROUP BY 1, 2, 3`,
      );
      for (const row of split) push(paid, `${scalarText(row.doc_kind)}:${int(row.doc_id)}`, row);
    }
    return {
      ...range,
      truncated: rows.length > MAX_DOCUMENTS,
      rows: rows.slice(0, MAX_DOCUMENTS).map((row) => ({
        kind: row.doc_kind as SalesDocKind,
        id: int(row.doc_id),
        number: textOrNull(row.doc_number),
        date: dateText(row.day) ?? '',
        invoiceId: intOrNull(row.invoice_id),
        customerId: intOrNull(row.customer_id),
        customerName: textOrNull(row.customer_name),
        qty: dec(row.qty).toFixed(),
        sales: money(dec(row.sales)),
        cost: scope.margins ? money(dec(row.cost)) : null,
        paid: paid.get(`${scalarText(row.doc_kind)}:${int(row.doc_id)}`) ?? [],
      })),
    };
  }

  /** The sales by payment per product and group, the totals per payment and the keys used. */
  private async paidByRow(filter: ProductSalesFilter, range: DateRange, by: ProductSalesGrouping) {
    const [split, totals] = await Promise.all([
      rowsOf(
        this.db,
        sql`WITH l AS (${linesSql(filter, range, by)}), s AS (${TILL_SHARES})
            SELECT l.product_id, l.grp, ${PAY_KEY} AS pay_key, ${PAID} AS amount
              ${PAID_LINES}
             GROUP BY 1, 2, 3`,
      ),
      rowsOf(
        this.db,
        sql`WITH l AS (${linesSql(filter, range, 'none')}), s AS (${TILL_SHARES})
            SELECT ${PAY_KEY} AS pay_key, ${PAID} AS amount, bool_or(l.net_sales <> 0) AS used
              ${PAID_LINES} GROUP BY 1`,
      ),
    ]);
    const rows = new Map<string, PaidAmount[]>();
    for (const row of split) {
      push(rows, `${int(row.product_id)}|${textOrNull(row.grp) ?? NO_GROUP}`, row);
    }
    const sums: PaidAmount[] = [];
    for (const row of totals) {
      const amount = dec(row.amount);
      if (!amount.isZero()) sums.push({ key: scalarText(row.pay_key), amount: money(amount) });
    }
    // A payment some line used is a column, also when a sale and its return cancel out.
    const keys = totals.filter((row) => row.used === true).map((row) => scalarText(row.pay_key));
    return { rows, totals: sums, keys };
  }

  /** «Авлага» first, the till's payment types in their order, then the older tenders' kinds. */
  private async paymentColumns(keys: readonly string[]): Promise<ProductSalesPayment[]> {
    if (keys.length === 0) return [];
    const typeIds = keys.flatMap((key) => (/^T\d+$/.test(key) ? [int(key.slice(1))] : []));
    const types = typeIds.length
      ? await rowsOf(
          this.db,
          sql`SELECT id, name, sort FROM public.pos_payment_types WHERE ${idsIn(sql`id`, typeIds)}`,
        )
      : [];
    const typeOf = new Map(types.map((row) => [`T${int(row.id)}`, row]));
    const rank = (key: string) =>
      key === 'AR' ? -1 : typeOf.has(key) ? int(typeOf.get(key)?.sort) : 1_000;
    return [...keys]
      .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
      .map((key) => ({
        key,
        name: textOrNull(typeOf.get(key)?.name) ?? PAYMENT_NAMES[key] ?? key,
      }));
  }

  /** The names of the groups met (an id's record, the customer app, «… -гүй»). */
  private async groupNames(
    by: ProductSalesGrouping,
    keys: readonly string[],
  ): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    if (by === 'none') return names;
    names.set(NO_GROUP, NO_GROUP_NAMES[by]);
    names.set(APP_GROUP, mn.reports.books.appOrders);
    const ids = [...new Set(keys.filter((key) => /^\d+$/.test(key)).map((key) => int(key)))];
    if (ids.length === 0) return names;
    const table: Record<Exclude<ProductSalesGrouping, 'none'>, SQL> = {
      category: sql`SELECT id, name FROM public.categories`,
      brand: sql`SELECT id, name FROM public.suppliers`,
      segment: sql`SELECT id, name FROM public.segments`,
      user: sql`SELECT id, full_name AS name FROM public.users`,
    };
    const rows = await rowsOf(this.db, sql`${table[by]} WHERE ${idsIn(sql`id`, ids)}`);
    for (const row of rows) names.set(String(int(row.id)), textOrNull(row.name) ?? '');
    return names;
  }
}

function scalarText(value: unknown): string {
  return textOrNull(value) ?? '';
}

/** Adds a payment row's non-zero amount to `map[key]`. */
function push(map: Map<string, PaidAmount[]>, key: string, row: Record<string, unknown>): void {
  const amount = dec(row.amount);
  if (amount.isZero()) return;
  map.set(key, [...(map.get(key) ?? []), { key: scalarText(row.pay_key), amount: money(amount) }]);
}
