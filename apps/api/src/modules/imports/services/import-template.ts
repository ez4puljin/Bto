import mn from '@tugeel/shared/i18n/mn.json';
import { IMPORT_COLUMNS, type ImportKind } from '@tugeel/shared/imports';
import ExcelJS from 'exceljs';
import { columnLabel } from './sheet-reader';

/**
 * The template of a kind (ADR-0036): one sheet with the Mongolian column labels (required ones
 * marked with *), code and barcode columns formatted as text so leading zeros survive, and an
 * instructions sheet.
 */
export async function buildTemplate(kind: ImportKind): Promise<Buffer> {
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
      ...(column.type === 'code' || column.type === 'list' ? { style: { numFmt: '@' } } : {}),
    };
  });
  sheet.getRow(1).font = { bold: true };
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
