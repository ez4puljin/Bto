import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from '@tugeel/shared/money';
import { type SQL, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import type { AuthContext } from '../../identity';
import { docNumberSql, idsIn, inCategory, warehouseMovement } from './book-sql';
import { ReportContext } from './report-context';
import { checkedRange, type DateRange } from './report-periods';
import { allOf, dateText, dec, int, intOrNull, money, rowsOf, textOrNull } from './report-sql';

/** «Бараагаар» one row per product; «Байршил-Бараа» one per warehouse × product. */
export const STOCK_BALANCE_GROUPINGS = ['product', 'warehouse'] as const;
export type StockBalanceGrouping = (typeof STOCK_BALANCE_GROUPINGS)[number];

export interface StockBalanceFilter {
  from: string;
  to: string;
  by: StockBalanceGrouping;
  warehouseIds?: readonly number[];
  /** A category and everything under it. */
  categoryId?: number;
  productId?: number;
}

/** Quantities in the base unit; values at cost, null without `reports.margins.view`. */
export interface StockBalanceRow {
  productId: number;
  sku: string;
  name: string;
  unit: string | null;
  categoryId: number | null;
  categoryName: string | null;
  warehouseId: number | null;
  warehouseName: string | null;
  openingQty: string;
  openingValue: string | null;
  inQty: string;
  inValue: string | null;
  outQty: string;
  outValue: string | null;
  closingQty: string;
  closingValue: string | null;
}

export interface StockBalanceTotals {
  openingValue: string | null;
  inValue: string | null;
  outValue: string | null;
  closingValue: string | null;
}

export interface StockBalanceReport extends DateRange {
  by: StockBalanceGrouping;
  rows: StockBalanceRow[];
  totals: StockBalanceTotals;
  /** More rows than returned (the first by category and SKU are shown). */
  truncated: boolean;
}

/** One document's movement of a product in a warehouse. */
export interface StockBalanceLine {
  date: string;
  docType: string;
  docId: number;
  docNumber: string | null;
  warehouseId: number;
  warehouseName: string;
  inQty: string;
  outQty: string;
  value: string | null;
  /** The quantity after this movement, from the opening. */
  balanceQty: string;
}

export interface StockBalanceLines extends DateRange {
  openingQty: string;
  rows: StockBalanceLine[];
  truncated: boolean;
}

const MAX_ROWS = 5_000;
const MAX_LINES = 2_000;

/**
 * Erkhet's «Бараа материалын үлдэгдлийн тайлан» on Bto's stock ledger (ADR-0133): per product —
 * or per warehouse × product — the stock before `from`, what came in and went out in the period
 * and the stock at `to`, in base units and at cost (the ledger's unit cost plus the re-costing of
 * stock on hand), with the movements behind a row. Values only for `reports.margins.view`.
 */
@Injectable()
export class StockBalanceService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly context: ReportContext,
  ) {}

  async report(ctx: AuthContext, filter: StockBalanceFilter): Promise<StockBalanceReport> {
    const scope = await this.context.scope(ctx);
    const range = checkedRange(filter.from, filter.to);
    const byWarehouse = filter.by === 'warehouse';
    const where = allOf([
      idsIn(sql`m.warehouse_id`, filter.warehouseIds),
      filter.productId ? sql`m.product_id = ${filter.productId}` : null,
      inCategory(sql`m.product_id`, filter.categoryId),
    ]);
    const rows = await rowsOf(
      this.db,
      sql`WITH m AS (${movementsUpTo(range.to)}),
          g AS (
            SELECT m.product_id, ${byWarehouse ? sql`m.warehouse_id` : sql`NULL::bigint`} AS warehouse_id,
                   ${sums(range.from)}
              FROM m WHERE ${where}
             GROUP BY 1, 2)
          SELECT g.*, p.sku, p.name, p.category_id, c.name AS category_name, w.name AS warehouse_name,
                 u.name AS unit
            FROM g
            JOIN public.products p ON p.id = g.product_id
            LEFT JOIN public.categories c ON c.id = p.category_id
            LEFT JOIN public.warehouses w ON w.id = g.warehouse_id
            LEFT JOIN public.product_units pu ON pu.product_id = p.id AND pu.is_base AND pu.superseded_by IS NULL
            LEFT JOIN public.uoms u ON u.id = pu.uom_id
           WHERE g.open_qty <> 0 OR g.open_value <> 0 OR g.in_qty <> 0 OR g.out_qty <> 0
              OR g.in_value <> 0 OR g.out_value <> 0
           ORDER BY c.name NULLS LAST, p.sku, w.name NULLS FIRST
           LIMIT ${MAX_ROWS + 1}`,
    );
    const totals = {
      opening: new Decimal(0),
      in: new Decimal(0),
      out: new Decimal(0),
      closing: new Decimal(0),
    };
    const value = (amount: Decimal) => (scope.margins ? money(amount) : null);
    const out = rows.slice(0, MAX_ROWS).map((row): StockBalanceRow => {
      const openQty = dec(row.open_qty);
      const openValue = dec(row.open_value);
      const inValue = dec(row.in_value);
      const outValue = dec(row.out_value);
      const closeValue = openValue.plus(inValue).minus(outValue);
      totals.opening = totals.opening.plus(openValue);
      totals.in = totals.in.plus(inValue);
      totals.out = totals.out.plus(outValue);
      totals.closing = totals.closing.plus(closeValue);
      return {
        productId: int(row.product_id),
        sku: textOrNull(row.sku) ?? '',
        name: textOrNull(row.name) ?? '',
        unit: textOrNull(row.unit),
        categoryId: intOrNull(row.category_id),
        categoryName: textOrNull(row.category_name),
        warehouseId: intOrNull(row.warehouse_id),
        warehouseName: textOrNull(row.warehouse_name),
        openingQty: openQty.toFixed(),
        openingValue: value(openValue),
        inQty: dec(row.in_qty).toFixed(),
        inValue: value(inValue),
        outQty: dec(row.out_qty).toFixed(),
        outValue: value(outValue),
        closingQty: openQty.plus(dec(row.in_qty)).minus(dec(row.out_qty)).toFixed(),
        closingValue: value(closeValue),
      };
    });
    return {
      ...range,
      by: filter.by,
      rows: out,
      totals: {
        openingValue: value(totals.opening),
        inValue: value(totals.in),
        outValue: value(totals.out),
        closingValue: value(totals.closing),
      },
      truncated: rows.length > MAX_ROWS,
    };
  }

  /** The movements behind one row: a product, in one warehouse or in the filter's warehouses. */
  async lines(
    ctx: AuthContext,
    filter: { from: string; to: string; productId: number; warehouseIds?: readonly number[] },
  ): Promise<StockBalanceLines> {
    const scope = await this.context.scope(ctx);
    const range = checkedRange(filter.from, filter.to);
    const where = allOf([
      sql`l.product_id = ${filter.productId}`,
      warehouseMovement,
      idsIn(sql`l.warehouse_id`, filter.warehouseIds),
    ]);
    const [opening] = await rowsOf(
      this.db,
      sql`SELECT coalesce(sum(l.qty_base), 0) AS qty FROM public.stock_ledger l
           WHERE ${where} AND l.effective_date < ${range.from}::date`,
    );
    const rows = await rowsOf(
      this.db,
      sql`SELECT l.effective_date AS day, l.doc_type, l.doc_id, l.warehouse_id, w.name AS warehouse_name,
                 ${docNumberSql(sql`l.doc_type`, sql`l.doc_id`)} AS doc_number,
                 sum(l.qty_base) FILTER (WHERE l.qty_base > 0) AS in_qty,
                 sum(-l.qty_base) FILTER (WHERE l.qty_base < 0) AS out_qty,
                 sum(l.qty_base * l.unit_cost) AS value, min(l.id) AS first_id
            FROM public.stock_ledger l
            JOIN public.warehouses w ON w.id = l.warehouse_id
           WHERE ${where} AND l.effective_date BETWEEN ${range.from}::date AND ${range.to}::date
           GROUP BY l.effective_date, l.doc_type, l.doc_id, l.warehouse_id, w.name
           ORDER BY l.effective_date, first_id
           LIMIT ${MAX_LINES + 1}`,
    );
    let balance = dec(opening?.qty);
    const openingQty = balance.toFixed();
    return {
      ...range,
      openingQty,
      truncated: rows.length > MAX_LINES,
      rows: rows.slice(0, MAX_LINES).map((row) => {
        const inQty = dec(row.in_qty);
        const outQty = dec(row.out_qty);
        balance = balance.plus(inQty).minus(outQty);
        return {
          date: dateText(row.day) ?? '',
          docType: textOrNull(row.doc_type) ?? '',
          docId: int(row.doc_id),
          docNumber: textOrNull(row.doc_number),
          warehouseId: int(row.warehouse_id),
          warehouseName: textOrNull(row.warehouse_name) ?? '',
          inQty: inQty.toFixed(),
          outQty: outQty.toFixed(),
          value: scope.margins ? money(dec(row.value).abs()) : null,
          balanceQty: balance.toFixed(),
        };
      }),
    };
  }
}

/**
 * Every quantity and value change up to `to` (alias `m`: product, warehouse, day, qty, value): the
 * warehouse movements at their unit cost, and the re-costing of stock on hand (value only).
 */
function movementsUpTo(to: string): SQL {
  return sql`
    SELECT l.product_id, l.warehouse_id, l.effective_date AS day, l.qty_base AS qty,
           l.qty_base * l.unit_cost AS value
      FROM public.stock_ledger l
     WHERE ${warehouseMovement} AND l.effective_date <= ${to}::date
    UNION ALL
    SELECT a.product_id, a.warehouse_id, a.effective_date, 0, a.value_delta
      FROM public.stock_valuation_adjustments a
     WHERE a.value_delta <> 0 AND a.effective_date <= ${to}::date`;
}

/** The opening, in and out sums of `m` around `from` (a value-only change counts by its sign). */
function sums(from: string): SQL {
  return sql`
    coalesce(sum(m.qty) FILTER (WHERE m.day < ${from}::date), 0) AS open_qty,
    coalesce(sum(m.value) FILTER (WHERE m.day < ${from}::date), 0) AS open_value,
    coalesce(sum(m.qty) FILTER (WHERE m.day >= ${from}::date AND m.qty > 0), 0) AS in_qty,
    coalesce(sum(m.value) FILTER (WHERE m.day >= ${from}::date
      AND (m.qty > 0 OR (m.qty = 0 AND m.value > 0))), 0) AS in_value,
    coalesce(sum(-m.qty) FILTER (WHERE m.day >= ${from}::date AND m.qty < 0), 0) AS out_qty,
    coalesce(sum(-m.value) FILTER (WHERE m.day >= ${from}::date
      AND (m.qty < 0 OR (m.qty = 0 AND m.value < 0))), 0) AS out_value`;
}
