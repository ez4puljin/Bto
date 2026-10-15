import mn from '@tugeel/shared/i18n/mn.json';
import { IMPORT_COLUMNS, type ImportKind } from '@tugeel/shared/imports';
import ExcelJS from 'exceljs';
import { columnLabel } from './sheet-reader';

type Cell = string | number | null;

/** What a template is filled with (the price sheet, ADR-0054 #2). */
export interface TemplateFill {
  /** Data rows by column key. */
  rows: readonly Record<string, Cell>[];
  /** Sheets between the data sheet and the instructions, for reference. */
  sheets?: readonly { name: string; header: readonly string[]; rows: readonly Cell[][] }[];
}

/**
 * The template of a kind (ADR-0036): one sheet with the Mongolian column labels (required ones
 * marked with *), code, barcode and day columns formatted as text so leading zeros and the typed
 * day survive, and an instructions sheet. A kind that starts from the system's data (prices) is
 * filled with its rows and reference sheets.
 */
export async function buildTemplate(kind: ImportKind, fill?: TemplateFill): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Tugeel';
  const sheet = workbook.addWorksheet(mn.imports.kinds[kind], {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  sheet.columns = IMPORT_COLUMNS[kind].map((column) => {
    const label = columnLabel(kind, column.key);
    return {
      header: column.required ? `${label} *` : label,
      key: column.key,
      width: Math.min(40, Math.max(14, label.length + 6)),
      ...(column.type === 'code' || column.type === 'list' || column.type === 'day'
        ? { style: { numFmt: '@' } }
        : {}),
    };
  });
  sheet.getRow(1).font = { bold: true };
  for (const row of fill?.rows ?? []) sheet.addRow(row);
  for (const extra of fill?.sheets ?? []) {
    const reference = workbook.addWorksheet(extra.name, {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    reference.columns = extra.header.map((header) => ({
      header,
      width: Math.min(40, Math.max(14, header.length + 6)),
    }));
    reference.getRow(1).font = { bold: true };
    for (const row of extra.rows) reference.addRow([...row]);
  }
  const help = workbook.addWorksheet(mn.imports.template.sheet);
  help.columns = [{ width: 110 }];
  for (const line of [...mn.imports.template.common, ...mn.imports.template.notes[kind]]) {
    help.addRow([line]);
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** The file name of a template download without the extension, e.g. «tugeel-products». */
export function templateFileName(kind: ImportKind): string {
  return `tugeel-${kind.toLowerCase().replace(/_/g, '-')}`;
}
