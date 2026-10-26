import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from '@tugeel/shared/money';
import { addDays } from '@tugeel/shared/time';
import { sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import type { AuthContext } from '../../identity';
import { ReportContext, type ReportScope } from './report-context';
import {
  type DateRange,
  daysIn,
  type MonthPeriods,
  monthPeriods,
  trailingMonths,
} from './report-periods';
import {
  dateText,
  dec,
  decOrNull,
  int,
  intOrNull,
  marginPct,
  money,
  moneyOrNull,
  pct,
  rowsOf,
  textOrNull,
  scalar,
} from './report-sql';
import { RefreshService } from './refresh.service';

/** Three values of one figure: this period, the same days a month earlier and a year earlier. */
export interface Compared {
  current: string;
  previous: string;
  lastYear: string;
}

export interface ComparedOrNull {
  current: string | null;
  previous: string | null;
  lastYear: string | null;
}

export interface DashboardTrendPoint {
  month: string;
  sales: string;
  lastYearSales: string;
  grossProfit: string | null;
}

export interface DashboardCategory {
  categoryId: number | null;
  name: string | null;
  sales: string;
  grossProfit: string | null;
  margin: string | null;
  previousMargin: string | null;
}

export interface DashboardOverdueCustomer {
  partyId: number;
  customerId: number | null;
  name: string;
  overdue: string;
  oldestDueDate: string | null;
}

export interface DashboardLowStock {
  productId: number;
  sku: string;
  name: string;
  warehouseId: number;
  warehouseName: string;
  onHand: string;
  minQty: string;
}

export interface DashboardTopRep {
  userId: number;
  name: string;
  sales: string;
  share: string | null;
}

export interface Dashboard {
  month: string;
  running: boolean;
  current: DateRange;
  previous: DateRange;
  lastYear: DateRange;
  today: string;
  refreshedAt: Date | null;
  margins: boolean;
  threshold: string;
  sales: Compared;
  wholesale: string;
  pos: string;
  returns: string;
  grossProfit: ComparedOrNull | null;
  margin: ComparedOrNull | null;
  receivables: Compared;
  overdue: string;
  overdueCustomers: number;
  stockValue: ComparedOrNull | null;
  turnoverDays: number | null;
  trend: DashboardTrendPoint[];
  categories: DashboardCategory[];
  alerts: {
    overdue: DashboardOverdueCustomer[];
    lowStock: DashboardLowStock[];
    lowStockCount: number;
    fallingCategories: DashboardCategory[];
    topRep: DashboardTopRep | null;
  };
}

/** A category's margin fell by this many points against the month before (ADR-0108 #12). */
export const FALLING_MARGIN_POINTS = new Decimal(3);
const ALERT_ROWS = 5;

const between = (column: string, range: DateRange) =>
  sql`${sql.raw(column)} BETWEEN ${range.from}::date AND ${range.to}::date`;

/**
 * «Захирлын самбар» (ADR-0108 #1): sales, gross profit and margin, receivables with the overdue
 * part, stock value and turnover days, each against the same days a month and a year earlier;
 * the twelve-month trend, the top-level categories and the alerts.
 */
@Injectable()
export class DashboardService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly context: ReportContext,
    private readonly refresh: RefreshService,
  ) {}

  async dashboard(ctx: AuthContext, month?: string): Promise<Dashboard> {
    const scope = await this.context.scope(ctx);
    const periods = monthPeriods(month ?? scope.today.slice(0, 7), scope.today);
    const [totals, trend, categories, receivables, overdue, stock, lowStock, topRep, state] =
      await Promise.all([
        this.salesTotals(periods),
        this.trend(periods),
        this.categories(periods),
        this.receivables(periods, scope),
        this.overdue(scope),
        this.stock(periods, scope),
        this.lowStock(),
        this.topRep(periods.current),
        this.refresh.state(),
      ]);
    const profit = (sales: Decimal, cost: Decimal) => sales.minus(cost);
    const cur = profit(totals.current.sales, totals.current.cost);
    const prev = profit(totals.previous.sales, totals.previous.cost);
    const ly = profit(totals.lastYear.sales, totals.lastYear.cost);
    const days = daysIn(periods.current);
    const turnoverDays =
      stock.average && totals.current.cost.gt(0)
        ? stock.average.times(days).div(totals.current.cost).round().toNumber()
        : null;
    const falling = scope.margins
      ? categories.filter((row) => {
          if (row.margin === null) return false;
          const now = new Decimal(row.margin);
          if (now.lt(scope.threshold)) return true;
          return (
            row.previousMargin !== null &&
            new Decimal(row.previousMargin).minus(now).gte(FALLING_MARGIN_POINTS)
          );
        })
      : [];
    falling.sort((a, b) => new Decimal(a.margin ?? 0).cmp(new Decimal(b.margin ?? 0)));
    return {
      month: periods.month,
      running: periods.running,
      current: periods.current,
      previous: periods.previous,
      lastYear: periods.lastYear,
      today: scope.today,
      refreshedAt: state.refreshedAt,
      margins: scope.margins,
      threshold: scope.threshold.toFixed(1),
      sales: {
        current: money(totals.current.sales),
        previous: money(totals.previous.sales),
        lastYear: money(totals.lastYear.sales),
      },
      wholesale: money(totals.current.wholesale),
      pos: money(totals.current.pos),
      returns: money(totals.current.returns),
      grossProfit: scope.margins
        ? { current: money(cur), previous: money(prev), lastYear: money(ly) }
        : null,
      margin: scope.margins
        ? {
            current: pct(marginPct(cur, totals.current.sales)),
            previous: pct(marginPct(prev, totals.previous.sales)),
            lastYear: pct(marginPct(ly, totals.lastYear.sales)),
          }
        : null,
      receivables,
      overdue: overdue.total,
      overdueCustomers: overdue.parties,
      stockValue: scope.margins ? stock.values : null,
      turnoverDays,
      trend: trend.map((point) => (scope.margins ? point : { ...point, grossProfit: null })),
      categories: categories.map((row) =>
        scope.margins ? row : { ...row, grossProfit: null, margin: null, previousMargin: null },
      ),
      alerts: {
        overdue: overdue.top,
        lowStock: lowStock.rows,
        lowStockCount: lowStock.count,
        fallingCategories: falling.slice(0, ALERT_ROWS),
        topRep,
      },
    };
  }

  private async salesTotals(periods: MonthPeriods) {
    const { current: c, previous: p, lastYear: y } = periods;
    const [row] = await rowsOf(
      this.db,
      sql`SELECT
            sum(net_sales) FILTER (WHERE ${between('day', c)}) AS c_sales,
            sum(cost) FILTER (WHERE ${between('day', c)}) AS c_cost,
            sum(net_sales) FILTER (WHERE ${between('day', c)} AND source = 'WHOLESALE') AS c_wholesale,
            sum(net_sales) FILTER (WHERE ${between('day', c)} AND source = 'POS') AS c_pos,
            sum(returns) FILTER (WHERE ${between('day', c)}) AS c_returns,
            sum(net_sales) FILTER (WHERE ${between('day', p)}) AS p_sales,
            sum(cost) FILTER (WHERE ${between('day', p)}) AS p_cost,
            sum(net_sales) FILTER (WHERE ${between('day', y)}) AS y_sales,
            sum(cost) FILTER (WHERE ${between('day', y)}) AS y_cost
          FROM reporting.mv_sales_daily
         WHERE ${between('day', c)} OR ${between('day', p)} OR ${between('day', y)}`,
    );
    return {
      current: {
        sales: dec(row?.c_sales),
        cost: dec(row?.c_cost),
        wholesale: dec(row?.c_wholesale),
        pos: dec(row?.c_pos),
        returns: dec(row?.c_returns),
      },
      previous: { sales: dec(row?.p_sales), cost: dec(row?.p_cost) },
      lastYear: { sales: dec(row?.y_sales), cost: dec(row?.y_cost) },
    };
  }

  /** The twelve months ending with the period's month (a running month to today) and a year before. */
  private async trend(periods: MonthPeriods): Promise<DashboardTrendPoint[]> {
    const months = trailingMonths(periods.month);
    const first = months[0] ?? periods.month;
    const start = `${trailingMonths(first, 13)[0] ?? first}-01`;
    const rows = await rowsOf(
      this.db,
      sql`SELECT to_char(day, 'YYYY-MM') AS month, sum(net_sales) AS sales, sum(cost) AS cost
            FROM reporting.mv_sales_daily
           WHERE day BETWEEN ${start}::date AND ${periods.current.to}::date
           GROUP BY 1`,
    );
    const byMonth = new Map(rows.map((row) => [scalar(row.month), row]));
    return months.map((m) => {
      const row = byMonth.get(m);
      const lastYearMonth = `${Number.parseInt(m.slice(0, 4), 10) - 1}${m.slice(4)}`;
      const sales = dec(row?.sales);
      return {
        month: m,
        sales: money(sales),
        lastYearSales: money(dec(byMonth.get(lastYearMonth)?.sales)),
        grossProfit: money(sales.minus(dec(row?.cost))),
      };
    });
  }

  /** Sales by top-level category this period, with this and last month's margins. */
  private async categories(periods: MonthPeriods): Promise<DashboardCategory[]> {
    const { current: c, previous: p } = periods;
    const rows = await rowsOf(
      this.db,
      sql`WITH RECURSIVE tree AS (
            SELECT id, id AS top_id FROM public.categories WHERE parent_id IS NULL
            UNION ALL
            SELECT k.id, t.top_id FROM public.categories k JOIN tree t ON k.parent_id = t.id
          ), agg AS (
            SELECT t.top_id,
                   sum(m.net_sales) FILTER (WHERE ${between('m.day', c)}) AS c_sales,
                   sum(m.cost) FILTER (WHERE ${between('m.day', c)}) AS c_cost,
                   sum(m.net_sales) FILTER (WHERE ${between('m.day', p)}) AS p_sales,
                   sum(m.cost) FILTER (WHERE ${between('m.day', p)}) AS p_cost
              FROM reporting.mv_sales_daily m
              LEFT JOIN tree t ON t.id = m.category_id
             WHERE ${between('m.day', c)} OR ${between('m.day', p)}
             GROUP BY t.top_id)
          SELECT agg.*, k.name FROM agg LEFT JOIN public.categories k ON k.id = agg.top_id
           ORDER BY coalesce(agg.c_sales, 0) DESC, k.name`,
    );
    return rows
      .filter((row) => dec(row.c_sales).gt(0) || dec(row.c_cost).gt(0))
      .map((row) => {
        const sales = dec(row.c_sales);
        const profit = sales.minus(dec(row.c_cost));
        const previousSales = dec(row.p_sales);
        return {
          categoryId: intOrNull(row.top_id),
          name: textOrNull(row.name),
          sales: money(sales),
          grossProfit: money(profit),
          margin: pct(marginPct(profit, sales)),
          previousMargin: pct(marginPct(previousSales.minus(dec(row.p_cost)), previousSales)),
        };
      });
  }

  /** The receivables' balance at the end of each period (the control accounts' journal). */
  private async receivables(periods: MonthPeriods, scope: ReportScope): Promise<Compared> {
    const [row] = await rowsOf(
      this.db,
      sql`SELECT sum(net_debit) FILTER (WHERE entry_date <= ${periods.current.to}::date) AS c,
                 sum(net_debit) FILTER (WHERE entry_date <= ${periods.previous.to}::date) AS p,
                 sum(net_debit) FILTER (WHERE entry_date <= ${periods.lastYear.to}::date) AS y
            FROM reporting.control_daily
           WHERE company_code = ${scope.company} AND control = 'RECEIVABLE'`,
    );
    return {
      current: money(dec(row?.c)),
      previous: money(dec(row?.p)),
      lastYear: money(dec(row?.y)),
    };
  }

  /** Overdue today: the open debit items due before today, the customers and the five largest. */
  private async overdue(scope: ReportScope) {
    const rows = await rowsOf(
      this.db,
      sql`SELECT party_id, customer_id, party_name, sum(open_amount) AS overdue, min(due_date) AS oldest,
                 count(*) OVER () AS parties, sum(sum(open_amount)) OVER () AS total
            FROM reporting.ar_open_items
           WHERE company_code = ${scope.company} AND side = 'DEBIT' AND due_date < ${scope.today}::date
           GROUP BY party_id, customer_id, party_name
           ORDER BY overdue DESC, party_id
           LIMIT ${ALERT_ROWS}`,
    );
    return {
      total: money(dec(rows[0]?.total)),
      parties: rows[0] ? int(rows[0].parties) : 0,
      top: rows.map((row) => ({
        partyId: int(row.party_id),
        customerId: intOrNull(row.customer_id),
        name: scalar(row.party_name),
        overdue: money(dec(row.overdue)),
        oldestDueDate: dateText(row.oldest),
      })),
    };
  }

  /**
   * The stock value today (or at an ended month's end) and a month and a year earlier from the
   * nightly snapshot (`stock_snapshot_daily`, ADR-0040; none older than 13 months), and the
   * period's average value for the turnover days.
   */
  private async stock(periods: MonthPeriods, scope: ReportScope) {
    const at = async (date: string): Promise<Decimal | null> => {
      const [row] = await rowsOf(
        this.db,
        sql`SELECT sum(s.on_hand * s.avg_cost) AS value
              FROM public.stock_snapshot_daily s
             WHERE s.snapshot_date = (SELECT max(snapshot_date) FROM public.stock_snapshot_daily
                                       WHERE snapshot_date BETWEEN ${addDays(date, -7)}::date AND ${date}::date)`,
      );
      return decOrNull(row?.value);
    };
    const [live] = await rowsOf(
      this.db,
      sql`SELECT coalesce(sum(on_hand * avg_cost), 0) AS value FROM public.warehouse_stock`,
    );
    const now = dec(live?.value);
    const current =
      periods.running || periods.current.to >= scope.today ? now : await at(periods.current.to);
    const [previous, lastYear] = await Promise.all([
      at(periods.previous.to),
      at(periods.lastYear.to),
    ]);
    const [avg] = await rowsOf(
      this.db,
      sql`SELECT avg(v) AS value FROM (
            SELECT snapshot_date, sum(on_hand * avg_cost) AS v FROM public.stock_snapshot_daily
             WHERE ${between('snapshot_date', periods.current)} GROUP BY snapshot_date) x`,
    );
    return {
      values: {
        current: moneyOrNull(current),
        previous: moneyOrNull(previous),
        lastYear: moneyOrNull(lastYear),
      },
      average: decOrNull(avg?.value) ?? current,
    };
  }

  /** Locations at or under their minimum (as `ai.low_stock`): the count and the five lowest. */
  private async lowStock() {
    const rows = await rowsOf(
      this.db,
      sql`WITH s AS (SELECT warehouse_id, product_id, sum(on_hand) AS on_hand
                       FROM public.warehouse_stock GROUP BY warehouse_id, product_id)
          SELECT pl.product_id, p.sku, p.name, pl.warehouse_id, w.name AS warehouse_name,
                 coalesce(s.on_hand, 0) AS on_hand, pl.min_qty, count(*) OVER () AS total
            FROM public.product_locations pl
            JOIN public.products p ON p.id = pl.product_id AND p.status = 'ACTIVE'
            JOIN public.warehouses w ON w.id = pl.warehouse_id
            LEFT JOIN s ON s.warehouse_id = pl.warehouse_id AND s.product_id = pl.product_id
           WHERE pl.min_qty IS NOT NULL AND coalesce(s.on_hand, 0) <= pl.min_qty
           ORDER BY coalesce(s.on_hand, 0) - pl.min_qty, p.sku
           LIMIT ${ALERT_ROWS}`,
    );
    return {
      count: rows[0] ? int(rows[0].total) : 0,
      rows: rows.map((row) => ({
        productId: int(row.product_id),
        sku: scalar(row.sku),
        name: scalar(row.name),
        warehouseId: int(row.warehouse_id),
        warehouseName: scalar(row.warehouse_name),
        onHand: dec(row.on_hand).toFixed(),
        minQty: dec(row.min_qty).toFixed(),
      })),
    };
  }

  /** The order author with the most wholesale sales this period, and their share. */
  private async topRep(range: DateRange): Promise<DashboardTopRep | null> {
    const [row] = await rowsOf(
      this.db,
      sql`SELECT m.rep_user_id, u.full_name, sum(m.net_sales) AS sales,
                 (SELECT sum(net_sales) FROM reporting.mv_sales_daily
                   WHERE source = 'WHOLESALE' AND ${between('day', range)}) AS total
            FROM reporting.mv_sales_daily m
            JOIN public.users u ON u.id = m.rep_user_id
           WHERE m.source = 'WHOLESALE' AND ${between('m.day', range)}
           GROUP BY m.rep_user_id, u.full_name
          HAVING sum(m.net_sales) > 0
           ORDER BY sales DESC, m.rep_user_id
           LIMIT 1`,
    );
    if (!row) return null;
    const sales = dec(row.sales);
    const total = dec(row.total);
    return {
      userId: int(row.rep_user_id),
      name: scalar(row.full_name),
      sales: money(sales),
      share: total.gt(0) ? pct(sales.div(total).times(100)) : null,
    };
  }
}
