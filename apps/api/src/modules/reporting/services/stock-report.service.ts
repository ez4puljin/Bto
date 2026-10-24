import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from '@tugeel/shared/money';
import { addDays } from '@tugeel/shared/time';
import { sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import { invalid } from '../../../common/errors/app-error';
import type { AuthContext } from '../../identity';
import { ReportContext } from './report-context';
import { allOf, dateText, dec, int, money, rowsOf, searchSql, textOrNull } from './report-sql';

/** «Удаан эргэдэг»: in stock and not sold for this many days (owner 2026-10-24: 90 by default). */
export const SLOW_DAY_OPTIONS = [30, 60, 90, 180] as const;
export const DEFAULT_SLOW_DAYS = 90;

export const STOCK_FILTERS = ['ALL', 'SLOW', 'LOW'] as const;
export type StockFilter = (typeof STOCK_FILTERS)[number];

export interface StockQuery {
  slowDays?: number;
  filter?: StockFilter;
  warehouseId?: number;
  categoryId?: number;
  q?: string;
  /** Rows to skip (the «load more» cursor). */
  offset?: number;
  limit?: number;
}

export interface StockRow {
  productId: number;
  sku: string;
  name: string;
  categoryName: string | null;
  onHand: string;
  value: string | null;
  /** Base units sold (net of returns) in the last `slowDays` days. */
  soldQty: string;
  /** Days the stock lasts at that pace; null without sales. */
  coverDays: number | null;
  lastSaleDate: string | null;
  daysSinceSale: number | null;
  slow: boolean;
  low: boolean;
  minQty: string | null;
}

export interface StockReport {
  date: string;
  slowDays: number;
  rows: StockRow[];
  nextOffset: number | null;
  totals: {
    products: number;
    value: string | null;
    slowProducts: number;
    slowValue: string | null;
    lowProducts: number;
  };
}

const MAX_LIMIT = 500;

/**
 * Stock turnover and slow movers (ADR-0108 #4, #9): each product's stock today, its sales pace
 * over the last `slowDays` days from the daily totals, days of cover, the last sale and the
 * minimum levels. Values only for `reports.margins.view`.
 */
@Injectable()
export class StockReportService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly context: ReportContext,
  ) {}

  async stock(ctx: AuthContext, query: StockQuery): Promise<StockReport> {
    const scope = await this.context.scope(ctx);
    const slowDays = query.slowDays ?? DEFAULT_SLOW_DAYS;
    if (!(SLOW_DAY_OPTIONS as readonly number[]).includes(slowDays)) {
      throw invalid('slowDays', 'isIn', `one of ${SLOW_DAY_OPTIONS.join(', ')}`);
    }
    const since = addDays(scope.today, -slowDays + 1);
    const limit = Math.min(query.limit ?? 200, MAX_LIMIT);
    const offset = query.offset ?? 0;
    const warehouse = query.warehouseId ?? null;
    const filter = query.filter ?? 'ALL';
    const where = allOf([
      query.q ? (searchSql('p', query.q, 'sku') ?? sql`TRUE`) : null,
      query.categoryId
        ? sql`p.category_id IN (WITH RECURSIVE sub AS (
              SELECT id FROM public.categories WHERE id = ${query.categoryId}
              UNION ALL SELECT k.id FROM public.categories k JOIN sub ON k.parent_id = sub.id)
            SELECT id FROM sub)`
        : null,
    ]);
    const kept = filter === 'SLOW' ? sql`r.slow` : filter === 'LOW' ? sql`r.low` : sql`TRUE`;
    const order = scope.margins
      ? sql`r.value DESC, r.product_id`
      : sql`r.on_hand DESC, r.product_id`;
    const rows = await rowsOf(
      this.db,
      sql`WITH st AS (
            SELECT product_id, sum(on_hand) AS on_hand, sum(on_hand * avg_cost) AS value
              FROM public.warehouse_stock
             WHERE ${warehouse}::bigint IS NULL OR warehouse_id = ${warehouse}::bigint
             GROUP BY product_id),
          lv AS (
            SELECT pl.product_id, sum(pl.min_qty) AS min_qty,
                   bool_or(coalesce(ws.on_hand, 0) <= pl.min_qty) AS low
              FROM public.product_locations pl
              LEFT JOIN (SELECT warehouse_id, product_id, sum(on_hand) AS on_hand FROM public.warehouse_stock
                          GROUP BY warehouse_id, product_id) ws
                ON ws.warehouse_id = pl.warehouse_id AND ws.product_id = pl.product_id
             WHERE pl.min_qty IS NOT NULL
               AND (${warehouse}::bigint IS NULL OR pl.warehouse_id = ${warehouse}::bigint)
             GROUP BY pl.product_id),
          sold AS (
            SELECT product_id, sum(qty_base) AS qty
              FROM reporting.mv_sales_daily
             WHERE source IN ('WHOLESALE', 'POS') AND day BETWEEN ${since}::date AND ${scope.today}::date
               AND (${warehouse}::bigint IS NULL OR warehouse_id = ${warehouse}::bigint)
             GROUP BY product_id),
          last AS (
            SELECT product_id, max(day) AS last_sale
              FROM reporting.mv_sales_daily
             WHERE source IN ('WHOLESALE', 'POS') AND qty_base > 0
               AND (${warehouse}::bigint IS NULL OR warehouse_id = ${warehouse}::bigint)
             GROUP BY product_id),
          r AS (
            SELECT p.id AS product_id, p.sku, p.name, k.name AS category_name,
                   coalesce(st.on_hand, 0) AS on_hand, coalesce(st.value, 0) AS value,
                   coalesce(sold.qty, 0) AS sold_qty, last.last_sale, lv.min_qty,
                   coalesce(lv.low, false) AS low,
                   coalesce(st.on_hand, 0) > 0
                     AND (last.last_sale IS NULL OR last.last_sale < ${since}::date) AS slow
              FROM public.products p
              LEFT JOIN st ON st.product_id = p.id
              LEFT JOIN lv ON lv.product_id = p.id
              LEFT JOIN sold ON sold.product_id = p.id
              LEFT JOIN last ON last.product_id = p.id
              LEFT JOIN public.categories k ON k.id = p.category_id
             WHERE (coalesce(st.on_hand, 0) <> 0 OR coalesce(lv.low, false)) AND ${where})
          SELECT r.*, t.*
            FROM r
           CROSS JOIN (SELECT count(*) AS total_products, coalesce(sum(value), 0) AS total_value,
                              count(*) FILTER (WHERE slow) AS slow_products,
                              coalesce(sum(value) FILTER (WHERE slow), 0) AS slow_value,
                              count(*) FILTER (WHERE low) AS low_products
                         FROM r) t
           WHERE ${kept}
           ORDER BY ${order}
           LIMIT ${limit + 1} OFFSET ${offset}`,
    );
    const first = rows[0];
    const days = new Decimal(slowDays);
    return {
      date: scope.today,
      slowDays,
      nextOffset: rows.length > limit ? offset + limit : null,
      rows: rows.slice(0, limit).map((row) => {
        const onHand = dec(row.on_hand);
        const sold = dec(row.sold_qty);
        const lastSale = dateText(row.last_sale);
        return {
          productId: int(row.product_id),
          sku: String(row.sku),
          name: String(row.name),
          categoryName: textOrNull(row.category_name),
          onHand: onHand.toFixed(),
          value: scope.margins ? money(dec(row.value)) : null,
          soldQty: sold.toFixed(),
          coverDays: sold.gt(0) ? onHand.div(sold.div(days)).round().toNumber() : null,
          lastSaleDate: lastSale,
          daysSinceSale: lastSale
            ? Math.round(
                (Date.parse(`${scope.today}T00:00:00Z`) - Date.parse(`${lastSale}T00:00:00Z`)) /
                  86_400_000,
              )
            : null,
          slow: row.slow === true,
          low: row.low === true,
          minQty: row.min_qty === null ? null : dec(row.min_qty).toFixed(),
        };
      }),
      totals: {
        products: first ? int(first.total_products) : 0,
        value: scope.margins ? money(dec(first?.total_value)) : null,
        slowProducts: first ? int(first.slow_products) : 0,
        slowValue: scope.margins ? money(dec(first?.slow_value)) : null,
        lowProducts: first ? int(first.low_products) : 0,
      },
    };
  }
}
