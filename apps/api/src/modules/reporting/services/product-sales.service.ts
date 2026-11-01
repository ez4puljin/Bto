import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from '@tugeel/shared/money';
import { type SQL, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import type { AuthContext } from '../../identity';
import { inCategory } from './book-sql';
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

export interface ProductSalesFilter {
  from: string;
  to: string;
  source?: SalesSource;
  kind?: ProductSalesKind;
  repUserId?: number;
  customerCategoryId?: number;
  customerId?: number;
  productId?: number;
  /** A category and everything under it. */
  categoryId?: number;
  warehouseId?: number;
}

/** One product's sales; cost and profit null without `reports.margins.view`. */
export interface ProductSalesRow {
  productId: number;
  sku: string;
  name: string;
  unit: string | null;
  categoryId: number | null;
  categoryName: string | null;
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
}

export interface ProductSalesReport extends DateRange {
  rows: ProductSalesRow[];
  totals: { sales: string; returns: string; cost: string | null; profit: string | null };
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
}

export interface ProductSalesDocuments extends DateRange {
  rows: ProductSalesDocument[];
  truncated: boolean;
}

const MAX_ROWS = 5_000;
const MAX_DOCUMENTS = 1_000;

/** The filter over `reporting.sales_lines` (alias `m`). */
function filterSql(filter: ProductSalesFilter, range: DateRange): SQL {
  const kinds: Record<ProductSalesKind, SQL | null> = {
    ALL: null,
    SALES: sql`m.doc_kind IN ('INVOICE', 'POS_SALE')`,
    RETURNS: sql`m.doc_kind IN ('CREDIT_NOTE', 'POS_RETURN')`,
  };
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
    filter.repUserId ? sql`m.rep_user_id = ${filter.repUserId}` : null,
    filter.warehouseId ? sql`m.warehouse_id = ${filter.warehouseId}` : null,
    inCategory(sql`m.product_id`, filter.categoryId),
  ]);
}

/**
 * Erkhet's «Борлуулалт /Бараагаар/» (ADR-0133): every product sold in the period with its
 * quantity, net sales, returns, average price and — for `reports.margins.view` — cost, profit and
 * margin, live from `reporting.sales_lines` (invoices, credit notes, the till's sales and returns,
 * re-costing); the documents behind a product. Re-costing rows count only towards the cost.
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
    const rows = await rowsOf(
      this.db,
      sql`WITH g AS (
            SELECT m.product_id, sum(m.qty_base) AS qty, sum(m.net_sales) AS sales,
                   sum(m.returns) AS returns, sum(m.cost) AS cost
              FROM reporting.sales_lines m WHERE ${filterSql(filter, range)}
             GROUP BY m.product_id)
          SELECT g.*, p.sku, p.name, p.category_id, c.name AS category_name, u.name AS unit
            FROM g
            JOIN public.products p ON p.id = g.product_id
            LEFT JOIN public.categories c ON c.id = p.category_id
            LEFT JOIN public.product_units pu ON pu.product_id = p.id AND pu.is_base AND pu.superseded_by IS NULL
            LEFT JOIN public.uoms u ON u.id = pu.uom_id
           ORDER BY g.sales DESC, p.sku
           LIMIT ${MAX_ROWS + 1}`,
    );
    let sales = new Decimal(0);
    let returns = new Decimal(0);
    let cost = new Decimal(0);
    const out = rows.slice(0, MAX_ROWS).map((row): ProductSalesRow => {
      const qty = dec(row.qty);
      const rowSales = dec(row.sales);
      const rowCost = dec(row.cost);
      const profit = rowSales.minus(rowCost);
      sales = sales.plus(rowSales);
      returns = returns.plus(dec(row.returns));
      cost = cost.plus(rowCost);
      return {
        productId: int(row.product_id),
        sku: textOrNull(row.sku) ?? '',
        name: textOrNull(row.name) ?? '',
        unit: textOrNull(row.unit),
        categoryId: intOrNull(row.category_id),
        categoryName: textOrNull(row.category_name),
        qty: qty.toFixed(),
        sales: money(rowSales),
        returns: money(dec(row.returns)),
        avgPrice: qty.isZero() ? null : money(rowSales.div(qty)),
        cost: scope.margins ? money(rowCost) : null,
        profit: scope.margins ? money(profit) : null,
        margin: scope.margins ? pct(marginPct(profit, rowSales)) : null,
      };
    });
    return {
      ...range,
      rows: out,
      totals: {
        sales: money(sales),
        returns: money(returns),
        cost: scope.margins ? money(cost) : null,
        profit: scope.margins ? money(sales.minus(cost)) : null,
      },
      truncated: rows.length > MAX_ROWS,
    };
  }

  /** The documents behind one product's figure, oldest first. */
  async documents(
    ctx: AuthContext,
    filter: ProductSalesFilter & { productId: number },
  ): Promise<ProductSalesDocuments> {
    const scope = await this.context.scope(ctx);
    const range = checkedRange(filter.from, filter.to);
    const rows = await rowsOf(
      this.db,
      sql`SELECT m.doc_kind, m.doc_id, m.doc_number, m.day, m.customer_id, c.name AS customer_name,
                 CASE WHEN m.doc_kind = 'CREDIT_NOTE'
                      THEN (SELECT cn.invoice_id FROM public.credit_notes cn WHERE cn.id = m.doc_id)
                      WHEN m.doc_kind = 'INVOICE' THEN m.doc_id END AS invoice_id,
                 sum(m.qty_base) AS qty, sum(m.net_sales) AS sales, sum(m.cost) AS cost
            FROM reporting.sales_lines m
            LEFT JOIN public.customers c ON c.id = m.customer_id
           WHERE ${filterSql(filter, range)}
           GROUP BY m.doc_kind, m.doc_id, m.doc_number, m.day, m.customer_id, c.name
           ORDER BY m.day, m.doc_kind, m.doc_id
           LIMIT ${MAX_DOCUMENTS + 1}`,
    );
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
      })),
    };
  }
}
