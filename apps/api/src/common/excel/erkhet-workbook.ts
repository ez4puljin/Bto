import ExcelJS from 'exceljs';

/** A row of an Erkhet import file: a `YYYY-MM-DD` date first, then cells, then the amount last. */
export interface ErkhetRow {
  date: string;
  cells: readonly (string | number | null)[];
  amount: string;
}

/**
 * Excel's BUILT-IN Short Date (numFmtId 14). Erkhet's importer takes only a built-in date format for a
 * date, on the cells, the header and the column alike; a custom format reads as a plain number there
 * (found by hand on the old tool, 2026-07-14). ExcelJS writes it with `applyNumberFormat`.
 */
const SHORT_DATE = 'mm-dd-yy';

/**
 * A file for Erkhet's own import (ADR-0169 #6): one sheet, the header, the date in column A and the
 * amount in the last column as a number cell. Text goes to shared strings, as Excel itself writes
 * them. The number conversion lives here on purpose (ESLint G3 keeps Number() out of the modules).
 */
export async function erkhetWorkbook(
  sheetName: string,
  headers: readonly string[],
  rows: readonly ErkhetRow[],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  sheet.addRow([...headers]);
  sheet.getColumn(1).numFmt = SHORT_DATE;
  for (const row of rows) {
    const [year = 0, month = 1, day = 1] = row.date
      .split('-')
      .map((part) => Number.parseInt(part, 10));
    const added = sheet.addRow([
      new Date(Date.UTC(year, month - 1, day)),
      ...row.cells,
      Number(row.amount),
    ]);
    added.getCell(1).numFmt = SHORT_DATE;
  }
  sheet.getCell(1, 1).numFmt = SHORT_DATE;
  const buffer = await workbook.xlsx.writeBuffer({ useSharedStrings: true, useStyles: true });
  return Buffer.from(buffer);
}
