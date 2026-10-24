import { AGING_BUCKETS } from '@tugeel/shared/finance';
import mn from '@tugeel/shared/i18n/mn.json';
import {
  type ExcelColumn,
  type ExcelRow,
  tableWorkbook,
} from '../../../common/excel/table-workbook';
import type { Aging } from './aging.service';
import type { Dashboard } from './dashboard.service';
import type { ProfitReport, ProfitRow } from './profit.service';
import type { StockReport } from './stock-report.service';
import type { SupplierReport } from './supplier-report.service';

const L = mn.reports.excel;
const booleans = { yes: L.yes, no: L.no };
const text = (name: string): ExcelColumn => ({ name, kind: 'text' });
const num = (name: string): ExcelColumn => ({ name, kind: 'number' });
const date = (name: string): ExcelColumn => ({ name, kind: 'date' });

function sheet(title: string, columns: ExcelColumn[], rows: ExcelRow[]): Promise<Buffer> {
  return tableWorkbook(title, booleans, (s) => Promise.resolve(s.addRows(columns, rows)));
}

/** The dashboard as one sheet: the figures with their comparisons, the months, the categories. */
export function dashboardWorkbook(report: Dashboard): Promise<Buffer> {
  const d = L.dashboard;
  const columns = [text(d.metric), num(d.current), num(d.previous), num(d.lastYear)];
  const rows: ExcelRow[] = [
    [d.sales, report.sales.current, report.sales.previous, report.sales.lastYear],
    [d.wholesale, report.wholesale, null, null],
    [d.pos, report.pos, null, null],
    [d.returns, report.returns, null, null],
  ];
  if (report.grossProfit && report.margin) {
    rows.push([
      d.grossProfit,
      report.grossProfit.current,
      report.grossProfit.previous,
      report.grossProfit.lastYear,
    ]);
    rows.push([d.margin, report.margin.current, report.margin.previous, report.margin.lastYear]);
  }
  rows.push([
    d.receivables,
    report.receivables.current,
    report.receivables.previous,
    report.receivables.lastYear,
  ]);
  rows.push([d.overdue, report.overdue, null, null]);
  if (report.stockValue) {
    rows.push([
      d.stockValue,
      report.stockValue.current,
      report.stockValue.previous,
      report.stockValue.lastYear,
    ]);
  }
  rows.push([
    d.turnoverDays,
    report.turnoverDays === null ? null : String(report.turnoverDays),
    null,
    null,
  ]);
  for (const point of report.trend) {
    rows.push([`${d.monthSales} ${point.month}`, point.sales, null, point.lastYearSales]);
  }
  for (const category of report.categories) {
    rows.push([`${d.category}: ${category.name ?? '—'}`, category.sales, null, null]);
  }
  return sheet(`${d.title} ${report.month}`, columns, rows);
}

export function agingWorkbook(report: Aging): Promise<Buffer> {
  const a = L.aging;
  const columns = [
    text(a.code),
    text(a.name),
    text(a.group),
    ...AGING_BUCKETS.map((b) => num(mn.finance.aging[b])),
    num(a.credit),
    num(a.total),
    date(a.oldest),
  ];
  const rows: ExcelRow[] = report.rows.map((row) => [
    row.code,
    row.name,
    row.settlementGroup ? mn.partners.settlement.groups[row.settlementGroup] : null,
    ...AGING_BUCKETS.map((b) => row.buckets[b]),
    row.credit,
    row.total,
    row.oldestDueDate,
  ]);
  rows.push([
    null,
    a.total,
    null,
    ...AGING_BUCKETS.map((b) => report.totals[b]),
    report.credit,
    report.total,
    null,
  ]);
  return sheet(`${a.title} ${report.date}`, columns, rows);
}

function profitName(row: ProfitRow): string | null {
  if (row.kind === 'POS' || row.kind === 'APP' || row.kind === 'COST_ADJ' || row.kind === 'NONE') {
    return L.kinds[row.kind];
  }
  return row.name;
}

export function profitWorkbook(report: ProfitReport): Promise<Buffer> {
  const p = L.profit;
  const withQty = report.by === 'product';
  const columns = [
    text(p.code),
    text(p.name),
    ...(withQty ? [num(p.qty)] : []),
    num(p.sales),
    num(p.returns),
    num(p.cost),
    num(p.profit),
    num(p.margin),
  ];
  const line = (
    code: string | null,
    name: string | null,
    qty: string | null,
    t: ProfitReport['totals'],
  ): ExcelRow => [
    code,
    name,
    ...(withQty ? [qty] : []),
    t.sales,
    t.returns,
    t.cost,
    t.profit,
    t.margin,
  ];
  const rows: ExcelRow[] = report.rows.map((row) => line(row.code, profitName(row), row.qty, row));
  if (report.others) rows.push(line(null, p.others, null, report.others));
  rows.push(line(null, p.total, null, report.totals));
  return sheet(`${p.title} ${report.from} – ${report.to}`, columns, rows);
}

export function stockWorkbook(report: StockReport, margins: boolean): Promise<Buffer> {
  const s = L.stock;
  const columns = [
    text(s.sku),
    text(s.name),
    text(s.category),
    num(s.onHand),
    ...(margins ? [num(s.value)] : []),
    num(s.soldQty),
    num(s.coverDays),
    date(s.lastSale),
    num(s.daysSinceSale),
    { name: s.slow, kind: 'boolean' as const },
    { name: s.low, kind: 'boolean' as const },
    num(s.minQty),
  ];
  const rows: ExcelRow[] = report.rows.map((row) => [
    row.sku,
    row.name,
    row.categoryName,
    row.onHand,
    ...(margins ? [row.value] : []),
    row.soldQty,
    row.coverDays === null ? null : String(row.coverDays),
    row.lastSaleDate,
    row.daysSinceSale === null ? null : String(row.daysSinceSale),
    row.slow ? 't' : 'f',
    row.low ? 't' : 'f',
    row.minQty,
  ]);
  return sheet(`${s.title} ${report.date}`, columns, rows);
}

export function supplierWorkbook(report: SupplierReport): Promise<Buffer> {
  const s = L.suppliers;
  const columns = [
    text(s.code),
    text(s.name),
    num(s.purchases),
    num(s.purchasesExVat),
    num(s.otherBills),
    num(s.payments),
    num(s.balance),
  ];
  const rows: ExcelRow[] = report.rows.map((row) => [
    row.code,
    row.name,
    row.purchases,
    row.purchasesExVat,
    row.otherBills,
    row.payments,
    row.balance,
  ]);
  const t = report.totals;
  rows.push([null, s.total, t.purchases, t.purchasesExVat, t.otherBills, t.payments, t.balance]);
  return sheet(`${s.title} ${report.from} – ${report.to}`, columns, rows);
}
