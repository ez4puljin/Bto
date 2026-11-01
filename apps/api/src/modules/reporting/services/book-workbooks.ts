import mn from '@tugeel/shared/i18n/mn.json';
import {
  type ExcelColumn,
  type ExcelRow,
  tableWorkbook,
} from '../../../common/excel/table-workbook';
import type { ProductSalesReport } from './product-sales.service';
import type { StockBalanceReport } from './stock-balance.service';
import type { StockDocumentsReport } from './stock-documents.service';

const L = mn.reports.books.columns;
const NO_BOOLEANS = { yes: '', no: '' };
const text = (name: string): ExcelColumn => ({ name, kind: 'text' });
const number = (name: string): ExcelColumn => ({ name, kind: 'number' });
const date = (name: string): ExcelColumn => ({ name, kind: 'date' });

/** «Бараа материалын үлдэгдлийн тайлан» as an Excel sheet (values only with the cost right). */
export function stockBalanceWorkbook(report: StockBalanceReport): Promise<Buffer> {
  const values = report.totals.closingValue !== null;
  const byWarehouse = report.by === 'warehouse';
  const columns: ExcelColumn[] = [
    ...(byWarehouse ? [text(L.warehouse)] : []),
    text(L.sku),
    text(L.name),
    text(L.unit),
    text(L.category),
    number(L.openingQty),
    ...(values ? [number(L.openingValue)] : []),
    number(L.inQty),
    ...(values ? [number(L.inValue)] : []),
    number(L.outQty),
    ...(values ? [number(L.outValue)] : []),
    number(L.closingQty),
    ...(values ? [number(L.closingValue)] : []),
  ];
  const rows: ExcelRow[] = report.rows.map((row) => [
    ...(byWarehouse ? [row.warehouseName] : []),
    row.sku,
    row.name,
    row.unit,
    row.categoryName,
    row.openingQty,
    ...(values ? [row.openingValue] : []),
    row.inQty,
    ...(values ? [row.inValue] : []),
    row.outQty,
    ...(values ? [row.outValue] : []),
    row.closingQty,
    ...(values ? [row.closingValue] : []),
  ]);
  return tableWorkbook(
    `${mn.reports.books.titles.stockBalance} ${report.from} – ${report.to}`,
    NO_BOOLEANS,
    (sheet) => Promise.resolve(sheet.addRows(columns, rows)),
  );
}

/** «Борлуулалт /Бараагаар/» as an Excel sheet. */
export function productSalesWorkbook(report: ProductSalesReport): Promise<Buffer> {
  const costs = report.totals.cost !== null;
  const columns: ExcelColumn[] = [
    text(L.sku),
    text(L.name),
    text(L.unit),
    text(L.category),
    number(L.qty),
    number(L.avgPrice),
    number(L.sales),
    number(L.returns),
    ...(costs ? [number(L.cost), number(L.profit), number(L.margin)] : []),
  ];
  const rows: ExcelRow[] = report.rows.map((row) => [
    row.sku,
    row.name,
    row.unit,
    row.categoryName,
    row.qty,
    row.avgPrice,
    row.sales,
    row.returns,
    ...(costs ? [row.cost, row.profit, row.margin] : []),
  ]);
  return tableWorkbook(
    `${mn.reports.books.titles.productSales} ${report.from} – ${report.to}`,
    NO_BOOLEANS,
    (sheet) => Promise.resolve(sheet.addRows(columns, rows)),
  );
}

/** «Бараа материалын тайлан /баримтаар/» as an Excel sheet. */
export function stockDocumentsWorkbook(report: StockDocumentsReport): Promise<Buffer> {
  const values = report.totals.inValue !== null;
  const types = mn.reports.books.docTypes;
  const columns: ExcelColumn[] = [
    text(L.number),
    date(L.date),
    text(L.docType),
    text(L.description),
    text(L.author),
    text(L.party),
    number(L.inQty),
    number(L.outQty),
    ...(values ? [number(L.inValue), number(L.outValue)] : []),
    number(L.total),
    number(L.net),
  ];
  const rows: ExcelRow[] = report.rows.map((row) => [
    row.number,
    row.date,
    types[row.docType],
    [
      row.sourceWarehouse && row.destWarehouse
        ? `${row.sourceWarehouse} → ${row.destWarehouse}`
        : null,
      row.note,
    ]
      .filter(Boolean)
      .join(' · ') || null,
    row.authorName,
    row.partyName,
    row.inQty,
    row.outQty,
    ...(values ? [row.inValue, row.outValue] : []),
    row.total,
    row.net,
  ]);
  return tableWorkbook(
    `${mn.reports.books.titles.stockDocuments} ${report.from} – ${report.to}`,
    NO_BOOLEANS,
    (sheet) => Promise.resolve(sheet.addRows(columns, rows)),
  );
}
