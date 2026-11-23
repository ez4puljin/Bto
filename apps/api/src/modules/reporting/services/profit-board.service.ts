import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from '@tugeel/shared/money';
import { type BoardPeriodKind, boardPeriodOf } from '@tugeel/shared/reports';
import { type SQL, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import { invalid } from '../../../common/errors/app-error';
import type { AuthContext } from '../../identity';
import type { SalesSource } from './profit.service';
import { receiptDiscountEntries } from './receipt-discount-entries';
import { RefreshService } from './refresh.service';
import { ReportContext } from './report-context';
import { type BoardPeriods, boardPeriods, boardTrend, type DateRange } from './report-periods';
import {
  allOf,
  dec,
  int,
  intOrNull,
  marginPct,
  money,
  pct,
  rowsOf,
  scalar,
  textOrNull,
} from './report-sql';

/** The five ways the gross profit is broken down on «Ашгийн самбар» (ADR-0237). */
export const BOARD_DIMENSIONS = ['supplier', 'category', 'location', 'rep', 'branch'] as const;
export type BoardDimension = (typeof BOARD_DIMENSIONS)[number];

/**
 * What a breakdown row stands for: a supplier (the products' main supplier), a category, a
 * warehouse, an order author (USER), «Bto300» orders (APP), the supermarket (POS), re-costing
 * differences (COST_ADJ), a branch, or nothing (NONE: products without a main supplier, without a
 * category, a row without a warehouse or a branch, a wholesale sale without an author).
 */
export const BOARD_ROW_KINDS = [
  'SUPPLIER',
  'CATEGORY',
  'WAREHOUSE',
  'USER',
  'APP',
  'POS',
  'COST_ADJ',
  'BRANCH',
  'NONE',
] as const;
export type BoardRowKind = (typeof BOARD_ROW_KINDS)[number];

/** Which kinds a dimension's rows can be. */
const DIMENSION_KINDS: Record<BoardDimension, readonly BoardRowKind[]> = {
  supplier: ['SUPPLIER', 'NONE'],
  category: ['CATEGORY', 'NONE'],
  location: ['WAREHOUSE', 'NONE'],
  rep: ['USER', 'APP', 'POS', 'COST_ADJ', 'NONE'],
  branch: ['BRANCH', 'NONE'],
};

export interface BoardFilter {
  kind: BoardPeriodKind;
  /** `2026-11`, `2026-Q4` or `2026`; the current period by default. */
  period?: string;
  branchId?: number;
  source?: SalesSource;
}

export interface BoardFigures {
  sales: string;
  cost: string;
  profit: string;
  margin: string | null;
}

export interface BoardRow extends BoardFigures {
  kind: BoardRowKind;
  id: number | null;
  name: string | null;
  /** The row's part of the whole gross profit in percent; null when that is not above zero. */
  share: string | null;
  /** Margin under the threshold (or a loss). */
  flagged: boolean;
  /** Supplier rows: the supplier's receipt discounts of the period (ADR-0236 income); else null. */
  discount: string | null;
  /** Supplier rows: gross profit + discount. */
  profitWithDiscount: string | null;
  /** Category rows: a top-level category's children (a row `own` for products right on it). */
  children: BoardRow[];
  /** A category row standing for the products right on the category, not its subtree. */
  own: boolean;
}

export interface BoardOthers extends BoardFigures {
  /** How many rows are summed here. */
  count: number;
  share: string | null;
  discount: string | null;
  profitWithDiscount: string | null;
}

export interface BoardBreakdown {
  rows: BoardRow[];
  /** Rows past the first `BOARD_MAX_ROWS`, summed («Бусад»). */
  others: BoardOthers | null;
}

export interface BoardTrendPoint extends BoardFigures {
  period: string;
  from: string;
  to: string;
}

export interface BoardBonus {
  /** Receipt lines of free goods received in the period. */
  lines: number;
  /** Their quantity in base units. */
  qty: string;
  /** Their value at the priced line's unit cost (else the average before them), information only. */
  value: string;
  /** Lines that have no value yet (not costed, no average). */
  unvalued: number;
}

export interface ProfitBoard extends BoardPeriods {
  today: string;
  refreshedAt: Date | null;
  threshold: string;
  source: SalesSource;
  branchId: number | null;
  totals: { current: BoardFigures; previous: BoardFigures; lastYear: BoardFigures };
  /** The suppliers' receipt discounts booked as income in each period; null under a source filter. */
  discounts: { current: string; previous: string; lastYear: string } | null;
  bonus: BoardBonus | null;
  trend: BoardTrendPoint[];
  breakdowns: Record<BoardDimension, BoardBreakdown>;
  branches: { id: number; name: string }[];
}

export interface BoardProductsQuery extends BoardFilter {
  dimension: BoardDimension;
  rowKind: BoardRowKind;
  id?: number;
  /** Category rows: only the products right on the category, not its subtree. */
  own?: boolean;
}

export interface BoardProductRow extends BoardFigures {
  productId: number;
  sku: string;
  name: string;
  unit: string | null;
  /** Base units. */
  qty: string;
  flagged: boolean;
}

export interface BoardProducts extends DateRange {
  rows: BoardProductRow[];
  /** Products past the first `BOARD_MAX_PRODUCTS`, summed. */
  others: (BoardFigures & { count: number }) | null;
}

/** Rows of a breakdown before the rest are summed into «Бусад». */
export const BOARD_MAX_ROWS = 100;
/** Products of a row before the rest are summed. */
export const BOARD_MAX_PRODUCTS = 500;

const ZERO = new Decimal(0);

interface Grouped {
  kind: BoardRowKind;
  id: number | null;
  name: string | null;
  sales: Decimal;
  cost: Decimal;
}

const between = (column: string, range: DateRange) =>
  sql`${sql.raw(column)} BETWEEN ${range.from}::date AND ${range.to}::date`;

const PERIOD_LABEL: Record<BoardPeriodKind, string> = {
  month: 'YYYY-MM',
  quarter: 'YYYY-"Q"Q',
  year: 'YYYY',
};

/** Categories with their top-level ancestor and the ancestor right under it (NULL on the top). */
const CATEGORY_TREE = sql`WITH RECURSIVE tree AS (
    SELECT c.id, c.id AS top_id, NULL::bigint AS child_id, 0 AS depth
      FROM public.categories c WHERE c.parent_id IS NULL
    UNION ALL
    SELECT k.id, t.top_id, CASE WHEN t.depth = 0 THEN k.id ELSE t.child_id END, t.depth + 1
      FROM public.categories k JOIN tree t ON k.parent_id = t.id)`;

function figures(sales: Decimal, cost: Decimal): BoardFigures {
  const profit = sales.minus(cost);
  return {
    sales: money(sales),
    cost: money(cost),
    profit: money(profit),
    margin: pct(marginPct(profit, sales)),
  };
}

/**
 * «Тайлан → Ашгийн самбар» (ADR-0237): net sales, cost of goods sold, gross profit and margin of a
 * month, quarter or year against the period before and the same one a year earlier, the trend, and
 * the gross profit by main supplier, category, warehouse, order author and branch with the
 * products behind each row. Sales and cost come from `reporting.mv_sales_daily` exactly as
 * `reports/profit` reads them; the suppliers' receipt discounts are the books' income of the
 * receipts dated in the period; free goods are shown, never added. Only `reports.margins.view`.
 */
@Injectable()
export class ProfitBoardService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly context: ReportContext,
    private readonly refresh: RefreshService,
  ) {}

  async board(ctx: AuthContext, filter: BoardFilter): Promise<ProfitBoard> {
    const scope = await this.context.scope(ctx);
    const periods = this.periodsOf(filter, scope.today);
    const source = filter.source ?? 'ALL';
    const branchId = filter.branchId ?? null;
    const withDiscounts = source === 'ALL';
    const [
      totals,
      trend,
      groups,
      discounts,
      previousDiscounts,
      lastYearDiscounts,
      bonus,
      branches,
      state,
    ] = await Promise.all([
      this.totals(periods, filter),
      this.trend(periods, filter, scope.today),
      this.groups(periods.current, filter),
      withDiscounts ? this.discounts(scope.company, periods.current, branchId) : null,
      withDiscounts ? this.discounts(scope.company, periods.previous, branchId) : null,
      withDiscounts ? this.discounts(scope.company, periods.lastYear, branchId) : null,
      withDiscounts ? this.bonus(periods.current, branchId) : null,
      this.branches(branchId),
      this.refresh.state(),
    ]);
    const totalProfit = totals.current.sales.minus(totals.current.cost);
    const flag = (sales: Decimal, cost: Decimal) => {
      const margin = marginPct(sales.minus(cost), sales);
      return margin === null ? sales.minus(cost).lt(0) : margin.lt(scope.threshold);
    };
    const share = (profit: Decimal) =>
      totalProfit.gt(0) ? pct(profit.div(totalProfit).times(100).toDecimalPlaces(1)) : null;
    const row = (
      group: Grouped,
      extra: { discount?: Decimal | null; children?: BoardRow[]; own?: boolean } = {},
    ): BoardRow => {
      const profit = group.sales.minus(group.cost);
      const discount = extra.discount ?? null;
      return {
        kind: group.kind,
        id: group.id,
        name: group.name,
        ...figures(group.sales, group.cost),
        share: share(profit),
        flagged: flag(group.sales, group.cost),
        discount: discount === null ? null : money(discount),
        profitWithDiscount: discount === null ? null : money(profit.plus(discount)),
        children: extra.children ?? [],
        own: extra.own ?? false,
      };
    };
    const bounded = (rows: BoardRow[]): BoardBreakdown => {
      rows.sort(
        (a, b) =>
          new Decimal(b.profit).cmp(new Decimal(a.profit)) ||
          new Decimal(b.sales).cmp(new Decimal(a.sales)) ||
          (a.id ?? 0) - (b.id ?? 0),
      );
      if (rows.length <= BOARD_MAX_ROWS) return { rows, others: null };
      const rest = rows.slice(BOARD_MAX_ROWS);
      const sum = (pick: (r: BoardRow) => string | null) =>
        rest.reduce((total, r) => total.plus(pick(r) ?? 0), ZERO);
      const sales = sum((r) => r.sales);
      const cost = sum((r) => r.cost);
      const hasDiscount = rest.some((r) => r.discount !== null);
      const discount = sum((r) => r.discount);
      return {
        rows: rows.slice(0, BOARD_MAX_ROWS),
        others: {
          ...figures(sales, cost),
          count: rest.length,
          share: share(sales.minus(cost)),
          discount: hasDiscount ? money(discount) : null,
          profitWithDiscount: hasDiscount ? money(sales.minus(cost).plus(discount)) : null,
        },
      };
    };

    // Suppliers: the sales of their main products and the discounts of their receipts.
    const bySupplier = new Map<number | null, Decimal>();
    for (const item of discounts ?? []) {
      if (!item.inRange) continue;
      bySupplier.set(
        item.supplierId,
        (bySupplier.get(item.supplierId) ?? ZERO).plus(item.discount),
      );
    }
    const supplierRows = groups.supplier.map((group) => {
      const discount = withDiscounts ? (bySupplier.get(group.id) ?? ZERO) : null;
      bySupplier.delete(group.id);
      return row(group, { discount });
    });
    if (withDiscounts && bySupplier.size > 0) {
      const names = await this.supplierNames([...bySupplier.keys()].filter((id) => id !== null));
      for (const [id, discount] of bySupplier) {
        if (discount.isZero()) continue;
        supplierRows.push(
          row(
            {
              kind: id === null ? 'NONE' : 'SUPPLIER',
              id,
              name: id === null ? null : (names.get(id) ?? null),
              sales: ZERO,
              cost: ZERO,
            },
            { discount },
          ),
        );
      }
    }

    const categoryRows = groups.category.map(({ top, children }) =>
      row(top, {
        children: children
          .map((child) => row(child.group, { own: child.own }))
          .sort((a, b) => new Decimal(b.profit).cmp(new Decimal(a.profit))),
      }),
    );

    const discountTotal = (list: typeof discounts) =>
      money(
        (list ?? []).reduce((sum, item) => (item.inRange ? sum.plus(item.discount) : sum), ZERO),
      );

    return {
      ...periods,
      today: scope.today,
      refreshedAt: state.refreshedAt,
      threshold: scope.threshold.toFixed(1),
      source,
      branchId,
      totals: {
        current: figures(totals.current.sales, totals.current.cost),
        previous: figures(totals.previous.sales, totals.previous.cost),
        lastYear: figures(totals.lastYear.sales, totals.lastYear.cost),
      },
      discounts: withDiscounts
        ? {
            current: discountTotal(discounts),
            previous: discountTotal(previousDiscounts),
            lastYear: discountTotal(lastYearDiscounts),
          }
        : null,
      bonus,
      trend,
      breakdowns: {
        supplier: bounded(supplierRows),
        category: bounded(categoryRows),
        location: bounded(groups.location.map((group) => row(group))),
        rep: bounded(groups.rep.map((group) => row(group))),
        branch: bounded(groups.branch.map((group) => row(group))),
      },
      branches,
    };
  }

  /** The products behind one breakdown row in the period, the most profit first. */
  async products(ctx: AuthContext, query: BoardProductsQuery): Promise<BoardProducts> {
    const scope = await this.context.scope(ctx);
    const periods = this.periodsOf(query, scope.today);
    const range = periods.current;
    if (!DIMENSION_KINDS[query.dimension].includes(query.rowKind)) {
      throw invalid('rowKind', 'oneOf', DIMENSION_KINDS[query.dimension].join(', '));
    }
    const needsId = !['NONE', 'APP', 'POS', 'COST_ADJ'].includes(query.rowKind);
    if (needsId && query.id === undefined) throw invalid('id', 'required', 'the row’s id');
    const rows = await rowsOf(
      this.db,
      sql`SELECT m.product_id, p.sku, p.name,
                 (SELECT u.name FROM public.product_units pu JOIN public.uoms u ON u.id = pu.uom_id
                   WHERE pu.product_id = p.id AND pu.is_base ORDER BY pu.id LIMIT 1) AS unit,
                 sum(m.qty_base) AS qty, sum(m.net_sales) AS sales, sum(m.cost) AS cost
            FROM reporting.mv_sales_daily m
            JOIN public.products p ON p.id = m.product_id
           WHERE ${this.where(range, query)} AND ${this.rowCondition(query)}
           GROUP BY m.product_id, p.id, p.sku, p.name
           ORDER BY sum(m.net_sales) - sum(m.cost) DESC, sum(m.net_sales) DESC, m.product_id`,
    );
    const flag = (sales: Decimal, cost: Decimal) => {
      const margin = marginPct(sales.minus(cost), sales);
      return margin === null ? sales.minus(cost).lt(0) : margin.lt(scope.threshold);
    };
    const rest = rows.slice(BOARD_MAX_PRODUCTS);
    const restSales = rest.reduce((sum, r) => sum.plus(dec(r.sales)), ZERO);
    const restCost = rest.reduce((sum, r) => sum.plus(dec(r.cost)), ZERO);
    return {
      ...range,
      rows: rows.slice(0, BOARD_MAX_PRODUCTS).map((r) => {
        const sales = dec(r.sales);
        const cost = dec(r.cost);
        return {
          productId: int(r.product_id),
          sku: scalar(r.sku),
          name: scalar(r.name),
          unit: textOrNull(r.unit),
          qty: dec(r.qty).toFixed(),
          ...figures(sales, cost),
          flagged: flag(sales, cost),
        };
      }),
      others: rest.length > 0 ? { ...figures(restSales, restCost), count: rest.length } : null,
    };
  }

  private periodsOf(filter: BoardFilter, today: string): BoardPeriods {
    return boardPeriods(filter.kind, filter.period ?? boardPeriodOf(filter.kind, today), today);
  }

  /** The source and branch over `reporting.mv_sales_daily` (alias `m`): the source as `reports/profit`. */
  private narrowed(filter: BoardFilter): SQL {
    return allOf([
      filter.source && filter.source !== 'ALL' ? sql`m.source = ${filter.source}` : null,
      filter.branchId ? sql`m.branch_id = ${filter.branchId}` : null,
    ]);
  }

  /** The filter in a range. */
  private where(range: DateRange, filter: BoardFilter): SQL {
    return allOf([between('m.day', range), this.narrowed(filter)]);
  }

  /** The rows of `mv_sales_daily` (alias `m`) one breakdown row stands for. */
  private rowCondition(query: BoardProductsQuery): SQL {
    const id = query.id ?? 0;
    const wholesaleOwn = sql`m.source = 'WHOLESALE' AND m.channel <> 'CUSTOMER_APP'`;
    switch (query.dimension) {
      case 'supplier':
        return query.rowKind === 'NONE'
          ? sql`NOT EXISTS (SELECT 1 FROM public.product_suppliers ps
                             WHERE ps.product_id = m.product_id AND ps.is_main)`
          : sql`m.product_id IN (SELECT ps.product_id FROM public.product_suppliers ps
                                  WHERE ps.is_main AND ps.supplier_id = ${id})`;
      case 'category':
        if (query.rowKind === 'NONE') return sql`m.category_id IS NULL`;
        if (query.own) return sql`m.category_id = ${id}`;
        return sql`m.category_id IN (
                     WITH RECURSIVE sub AS (
                       SELECT c.id FROM public.categories c WHERE c.id = ${id}
                       UNION ALL SELECT k.id FROM public.categories k JOIN sub ON k.parent_id = sub.id)
                     SELECT sub.id FROM sub)`;
      case 'location':
        return query.rowKind === 'NONE' ? sql`m.warehouse_id IS NULL` : sql`m.warehouse_id = ${id}`;
      case 'branch':
        return query.rowKind === 'NONE' ? sql`m.branch_id IS NULL` : sql`m.branch_id = ${id}`;
      case 'rep':
        switch (query.rowKind) {
          case 'POS':
            return sql`m.source = 'POS'`;
          case 'COST_ADJ':
            return sql`m.source = 'COST_ADJ'`;
          case 'APP':
            return sql`m.source = 'WHOLESALE' AND m.channel = 'CUSTOMER_APP'`;
          case 'NONE':
            return sql`${wholesaleOwn} AND m.rep_user_id IS NULL`;
          default:
            return sql`${wholesaleOwn} AND m.rep_user_id = ${id}`;
        }
    }
  }

  private async totals(periods: BoardPeriods, filter: BoardFilter) {
    const { current: c, previous: p, lastYear: y } = periods;
    const [row] = await rowsOf(
      this.db,
      sql`SELECT
            sum(m.net_sales) FILTER (WHERE ${between('m.day', c)}) AS c_sales,
            sum(m.cost) FILTER (WHERE ${between('m.day', c)}) AS c_cost,
            sum(m.net_sales) FILTER (WHERE ${between('m.day', p)}) AS p_sales,
            sum(m.cost) FILTER (WHERE ${between('m.day', p)}) AS p_cost,
            sum(m.net_sales) FILTER (WHERE ${between('m.day', y)}) AS y_sales,
            sum(m.cost) FILTER (WHERE ${between('m.day', y)}) AS y_cost
          FROM reporting.mv_sales_daily m
         WHERE (${between('m.day', c)} OR ${between('m.day', p)} OR ${between('m.day', y)})
           AND ${this.narrowed(filter)}`,
    );
    return {
      current: { sales: dec(row?.c_sales), cost: dec(row?.c_cost) },
      previous: { sales: dec(row?.p_sales), cost: dec(row?.p_cost) },
      lastYear: { sales: dec(row?.y_sales), cost: dec(row?.y_cost) },
    };
  }

  private async trend(
    periods: BoardPeriods,
    filter: BoardFilter,
    today: string,
  ): Promise<BoardTrendPoint[]> {
    const points = boardTrend(periods.kind, periods.period, today);
    const first = points[0]?.range.from ?? periods.current.from;
    const last = points.at(-1)?.range.to ?? periods.current.to;
    const rows = await rowsOf(
      this.db,
      sql`SELECT to_char(m.day, ${PERIOD_LABEL[periods.kind]}) AS period,
                 sum(m.net_sales) AS sales, sum(m.cost) AS cost
            FROM reporting.mv_sales_daily m
           WHERE ${this.where({ from: first, to: last }, filter)}
           GROUP BY 1`,
    );
    const byPeriod = new Map(rows.map((r) => [scalar(r.period), r]));
    return points.map((point) => {
      const found = byPeriod.get(point.period);
      return {
        period: point.period,
        from: point.range.from,
        to: point.range.to,
        ...figures(dec(found?.sales), dec(found?.cost)),
      };
    });
  }

  /** The current period's sales and cost by each of the five dimensions. */
  private async groups(range: DateRange, filter: BoardFilter) {
    const where = this.where(range, filter);
    const grouped = (kind: SQL, id: SQL, name: SQL, join: SQL = sql``) =>
      rowsOf(
        this.db,
        sql`WITH g AS (
              SELECT ${kind} AS kind, ${id} AS id, sum(m.net_sales) AS sales, sum(m.cost) AS cost
                FROM reporting.mv_sales_daily m ${join}
               WHERE ${where}
               GROUP BY 1, 2)
            SELECT g.*, ${name} AS name FROM g`,
      );
    const toGroup = (r: Record<string, unknown>): Grouped => ({
      kind: scalar(r.kind) as BoardRowKind,
      id: intOrNull(r.id),
      name: textOrNull(r.name),
      sales: dec(r.sales),
      cost: dec(r.cost),
    });
    const [supplier, location, rep, branch, category] = await Promise.all([
      grouped(
        sql`CASE WHEN ps.supplier_id IS NULL THEN 'NONE' ELSE 'SUPPLIER' END`,
        sql`ps.supplier_id`,
        sql`(SELECT s.name FROM public.suppliers s WHERE s.id = g.id)`,
        sql`LEFT JOIN public.product_suppliers ps ON ps.product_id = m.product_id AND ps.is_main`,
      ),
      grouped(
        sql`CASE WHEN m.warehouse_id IS NULL THEN 'NONE' ELSE 'WAREHOUSE' END`,
        sql`m.warehouse_id`,
        sql`(SELECT w.name FROM public.warehouses w WHERE w.id = g.id)`,
      ),
      grouped(
        sql`CASE WHEN m.source = 'POS' THEN 'POS' WHEN m.source = 'COST_ADJ' THEN 'COST_ADJ'
                 WHEN m.channel = 'CUSTOMER_APP' THEN 'APP' WHEN m.rep_user_id IS NOT NULL THEN 'USER'
                 ELSE 'NONE' END`,
        sql`CASE WHEN m.source = 'WHOLESALE' AND m.channel <> 'CUSTOMER_APP' THEN m.rep_user_id END`,
        sql`(SELECT u.full_name FROM public.users u WHERE u.id = g.id AND g.kind = 'USER')`,
      ),
      grouped(
        sql`CASE WHEN m.branch_id IS NULL THEN 'NONE' ELSE 'BRANCH' END`,
        sql`m.branch_id`,
        sql`(SELECT b.name FROM public.branches b WHERE b.id = g.id)`,
      ),
      rowsOf(
        this.db,
        sql`${CATEGORY_TREE}
            SELECT t.top_id, t.child_id, top.name AS top_name, child.name AS child_name,
                   sum(m.net_sales) AS sales, sum(m.cost) AS cost
              FROM reporting.mv_sales_daily m
              LEFT JOIN tree t ON t.id = m.category_id
              LEFT JOIN public.categories top ON top.id = t.top_id
              LEFT JOIN public.categories child ON child.id = t.child_id
             WHERE ${where}
             GROUP BY t.top_id, t.child_id, top.name, child.name`,
      ),
    ]);
    const tops = new Map<
      number | null,
      { top: Grouped; children: { group: Grouped; own: boolean }[] }
    >();
    for (const r of category) {
      const topId = intOrNull(r.top_id);
      const childId = intOrNull(r.child_id);
      const sales = dec(r.sales);
      const cost = dec(r.cost);
      const entry = tops.get(topId) ?? {
        top: {
          kind: topId === null ? ('NONE' as const) : ('CATEGORY' as const),
          id: topId,
          name: textOrNull(r.top_name),
          sales: ZERO,
          cost: ZERO,
        },
        children: [],
      };
      entry.top.sales = entry.top.sales.plus(sales);
      entry.top.cost = entry.top.cost.plus(cost);
      if (topId !== null) {
        entry.children.push({
          group: {
            kind: 'CATEGORY',
            id: childId ?? topId,
            name: childId === null ? textOrNull(r.top_name) : textOrNull(r.child_name),
            sales,
            cost,
          },
          own: childId === null,
        });
      }
      tops.set(topId, entry);
    }
    return {
      supplier: supplier.map(toGroup),
      location: location.map(toGroup),
      rep: rep.map(toGroup),
      branch: branch.map(toGroup),
      category: [...tops.values()],
    };
  }

  /** The suppliers' receipt discounts booked as income (ADR-0236) by entry, for the period. */
  private discounts(company: string, range: DateRange, branchId: number | null) {
    return receiptDiscountEntries(this.db, company, range, { measure: 'income', branchId });
  }

  /**
   * Free goods received in the period (posted receipts by their date): the lines, the base
   * quantity and a value at the unit cost of the same product's priced line in the same receipt,
   * else at the free line's own costing average before it; neither: no value.
   */
  private async bonus(range: DateRange, branchId: number | null): Promise<BoardBonus> {
    const [row] = await rowsOf(
      this.db,
      sql`WITH free AS (
            SELECT l.id, l.qty_base,
                   (SELECT s.amount / nullif(s.qty_base, 0)
                      FROM public.goods_receipt_lines pl
                      JOIN LATERAL (
                        SELECT v.amount, v.qty_base FROM public.stock_valuation_adjustments v
                         WHERE v.doc_type = 'GR' AND v.doc_id = pl.receipt_id AND v.doc_line_id = pl.id
                         ORDER BY v.version DESC LIMIT 1) s ON true
                     WHERE pl.receipt_id = l.receipt_id AND pl.product_id = l.product_id
                       AND NOT pl.free_goods AND s.qty_base > 0
                     ORDER BY pl.id LIMIT 1) AS priced,
                   (SELECT v.avg_before FROM public.stock_valuation_adjustments v
                     WHERE v.doc_type = 'GR' AND v.doc_id = l.receipt_id AND v.doc_line_id = l.id
                     ORDER BY v.version DESC LIMIT 1) AS average
              FROM public.goods_receipt_lines l
              JOIN public.goods_receipts r ON r.id = l.receipt_id
             WHERE r.status = 'POSTED' AND l.free_goods AND ${between('r.effective_date', range)}
               AND ${branchId === null ? sql`TRUE` : sql`l.warehouse_id IN (SELECT w.id FROM public.warehouses w WHERE w.branch_id = ${branchId})`})
          SELECT count(*) AS lines, coalesce(sum(qty_base), 0) AS qty,
                 coalesce(sum(round(qty_base * coalesce(priced, average), 2)), 0) AS value,
                 count(*) FILTER (WHERE coalesce(priced, average) IS NULL) AS unvalued
            FROM free`,
    );
    return {
      lines: row ? int(row.lines) : 0,
      qty: dec(row?.qty).toFixed(),
      value: money(dec(row?.value)),
      unvalued: row ? int(row.unvalued) : 0,
    };
  }

  /** The branches for the filter: the active ones and the chosen one. */
  private async branches(chosen: number | null): Promise<{ id: number; name: string }[]> {
    const rows = await rowsOf(
      this.db,
      sql`SELECT b.id, b.name FROM public.branches b
           WHERE b.status = 'ACTIVE' OR b.id = ${chosen ?? 0}
           ORDER BY b.name, b.id`,
    );
    return rows.map((r) => ({ id: int(r.id), name: scalar(r.name) }));
  }

  private async supplierNames(ids: (number | null)[]): Promise<Map<number, string>> {
    const known = ids.filter((id): id is number => id !== null);
    if (known.length === 0) return new Map();
    const rows = await rowsOf(
      this.db,
      sql`SELECT s.id, s.name FROM public.suppliers s WHERE s.id = ANY(${`{${known.join(',')}}`}::bigint[])`,
    );
    return new Map(rows.map((r) => [int(r.id), scalar(r.name)]));
  }
}
