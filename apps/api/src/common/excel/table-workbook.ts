import { PassThrough } from 'node:stream';
import ExcelJS from 'exceljs';

/** How a column's database text becomes a cell. */
export type ExcelColumnKind = 'number' | 'text' | 'date' | 'datetime' | 'boolean';

export interface ExcelColumn {
  name: string;
  kind: ExcelColumnKind;
}

/** One row as the database printed it (numbers keep their scale, booleans are t / f). */
export type ExcelRow = readonly (string | null)[];

export interface TableSheet {
  /** Adds rows under the header; the first call writes the header and the column widths. */
  addRows(columns: readonly ExcelColumn[], rows: readonly ExcelRow[]): void;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A one-sheet workbook of query results, written with the exceljs streaming writer so rows go
 * into the compressed file as they arrive (ADR-0045 #11). Numeric columns become number cells:
 * Excel stores doubles, which hold NUMERIC(14,2) amounts exactly. This conversion lives outside
 * the modules on purpose (ESLint G3 keeps Number() out of business code).
 */
export async function tableWorkbook(
  sheetName: string,
  booleans: { yes: string; no: string },
  fill: (sheet: TableSheet) => Promise<void>,
): Promise<Buffer> {
  const stream = new PassThrough();
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(chunk));
  const ended = new Promise<void>((resolve, reject) => {
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream, useStyles: true });
  const worksheet = workbook.addWorksheet(safeSheetName(sheetName));
  let started = false;
  await fill({
    addRows(columns, rows) {
      if (!started) {
        started = true;
        worksheet.columns = columns.map((column) => ({ width: widthOf(column.name) }));
        const header = worksheet.addRow(columns.map((column) => column.name));
        header.font = { bold: true };
        header.commit();
      }
      for (const values of rows) {
        const row = worksheet.addRow(
          values.map((value, index) => cellOf(value, columns[index]?.kind ?? 'text', booleans)),
        );
        columns.forEach((column, index) => {
          if (column.kind === 'date') row.getCell(index + 1).numFmt = 'yyyy-mm-dd';
        });
        row.commit();
      }
    },
  });
  worksheet.commit();
  await workbook.commit();
  await ended;
  return Buffer.concat(chunks);
}

function cellOf(
  value: string | null,
  kind: ExcelColumnKind,
  booleans: { yes: string; no: string },
): ExcelJS.CellValue {
  if (value === null) return null;
  switch (kind) {
    case 'number': {
      const number = Number(value);
      return Number.isFinite(number) ? number : value;
    }
    case 'boolean':
      return value === 't' ? booleans.yes : value === 'f' ? booleans.no : value;
    case 'date': {
      // A calendar date as Excel's day serial: built in UTC so no time zone can shift it.
      const match = DATE.exec(value);
      return match
        ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
        : value;
    }
    default:
      return value;
  }
}

/** Excel limits sheet names to 31 characters without []:*?/\. */
function safeSheetName(name: string): string {
  const cleaned = name.replace(/[[\]:*?/\\]/g, ' ').trim();
  return (cleaned || 'Sheet1').slice(0, 31);
}

function widthOf(header: string): number {
  return Math.min(60, Math.max(10, header.length + 2));
}
