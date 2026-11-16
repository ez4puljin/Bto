import { ERKHET_CUSTOMER_COLUMNS, ERKHET_ITEM_COLUMNS, ERKHET_LIMITS } from '@tugeel/shared/erkhet';
import { Decimal } from '@tugeel/shared/money';
import { normalizeName } from '@tugeel/shared/text';
import ExcelJS from 'exceljs';

/** A row of Erkhet's item list, as far as a check reads it. */
export interface ErkhetItemRow {
  code: string;
  name: string;
  category: string;
  /** The «Баркод» cell split at its commas. */
  barcodes: string[];
  /** «Нэгж үнэ»; null when the cell is empty or not a price. */
  price: Decimal | null;
}

/** A row of Erkhet's customer list. */
export interface ErkhetCustomerRow {
  code: string;
  name: string;
  groupCode: string;
  groupName: string;
  phone: string;
}

/** The file is not the list it should be: a missing column, no rows, too many rows. */
export class ErkhetFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErkhetFileError';
  }
}

/** Prices are NUMERIC(14,2): anything from here up is not a price. */
const PRICE_LIMIT = new Decimal('1000000000000');
const TEXT_PRICE = /^\d+(\.\d+)?$/;

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if ('result' in value) return cellText(value.result);
    if ('richText' in value) return value.richText.map((part) => part.text).join('');
    if ('text' in value) return cellText(value.text);
    return '';
  }
  return String(value).trim();
}

function priceOf(value: ExcelJS.CellValue): Decimal | null {
  const text = typeof value === 'number' ? String(value) : cellText(value).replace(/,/g, '');
  if (!TEXT_PRICE.test(text)) return null;
  const price = new Decimal(text);
  return price.isFinite() && price.lt(PRICE_LIMIT) ? price : null;
}

/** «a, b,c» → [a, b, c]: commas and semicolons part the codes; a dash stands for none. */
export function splitBarcodes(cell: string): string[] {
  const codes = cell
    .split(/[,;]/)
    .map((code) => code.replace(/\s+/g, ''))
    .filter((code) => code !== '' && code !== '-');
  return [...new Set(codes)];
}

/** The first sheet as rows keyed by the heads named in `columns`. */
async function readList<K extends string>(
  data: Buffer,
  columns: Readonly<Record<K, string>>,
  required: readonly NoInfer<K>[],
): Promise<Record<K, ExcelJS.CellValue>[]> {
  const workbook = new ExcelJS.Workbook();
  try {
    // exceljs types `load` for its own Buffer; a Node Buffer is what it reads.
    await workbook.xlsx.load(data as unknown as ArrayBuffer);
  } catch {
    throw new ErkhetFileError('the file is not an Excel workbook');
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new ErkhetFileError('the workbook has no sheet');
  const at = new Map<string, number>();
  sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, column) => {
    const head = normalizeName(cellText(cell.value));
    if (head && !at.has(head)) at.set(head, column);
  });
  const keys = Object.keys(columns) as K[];
  for (const key of required) {
    if (!at.has(columns[key])) throw new ErkhetFileError(`the column «${columns[key]}» is missing`);
  }
  if (sheet.rowCount - 1 > ERKHET_LIMITS.maxRows) {
    throw new ErkhetFileError(`more than ${ERKHET_LIMITS.maxRows} rows`);
  }
  const rows: Record<K, ExcelJS.CellValue>[] = [];
  for (let number = 2; number <= sheet.rowCount; number += 1) {
    const row = sheet.getRow(number);
    const values = {} as Record<K, ExcelJS.CellValue>;
    for (const key of keys) {
      const column = at.get(columns[key]);
      values[key] = column === undefined ? null : row.getCell(column).value;
    }
    rows.push(values);
  }
  return rows;
}

/** Erkhet's «Бараа материалын жагсаалт». A row without a code is skipped; none at all is refused. */
export async function readErkhetItems(data: Buffer): Promise<ErkhetItemRow[]> {
  const rows = await readList(data, ERKHET_ITEM_COLUMNS, ['code', 'name', 'barcodes', 'price']);
  const items: ErkhetItemRow[] = [];
  for (const row of rows) {
    const code = cellText(row.code);
    if (!code) continue;
    items.push({
      code,
      name: normalizeName(cellText(row.name)),
      category: normalizeName(cellText(row.category)),
      barcodes: splitBarcodes(cellText(row.barcodes)),
      price: priceOf(row.price),
    });
  }
  if (items.length === 0) throw new ErkhetFileError('the item list is empty');
  return items;
}

/** Erkhet's «Харилцагч» list. */
export async function readErkhetCustomers(data: Buffer): Promise<ErkhetCustomerRow[]> {
  const rows = await readList(data, ERKHET_CUSTOMER_COLUMNS, ['code', 'name', 'groupName']);
  const customers: ErkhetCustomerRow[] = [];
  for (const row of rows) {
    const code = cellText(row.code);
    if (!code) continue;
    customers.push({
      code,
      name: normalizeName(cellText(row.name)),
      groupCode: cellText(row.groupCode),
      groupName: normalizeName(cellText(row.groupName)),
      phone: cellText(row.phone),
    });
  }
  if (customers.length === 0) throw new ErkhetFileError('the customer list is empty');
  return customers;
}
