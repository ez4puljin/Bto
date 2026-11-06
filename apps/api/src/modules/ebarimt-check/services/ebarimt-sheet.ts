import type { Readable } from 'node:stream';
import {
  EBARIMT_LIMITS,
  normalizeTaxId,
  periodDays,
  periodMonth,
  periodOfDate,
  periodYear,
} from '@tugeel/shared/ebarimt-check';
import { fileKind } from '@tugeel/shared/files';
import { Decimal, toMoney } from '@tugeel/shared/money';
import ExcelJS from 'exceljs';
import { AppError } from '../../../common/errors/app-error';

/** One line of e-Barimt's export, as stored. */
export interface EbarimtSheetRow {
  rowNo: number;
  receiptKey: string;
  ddtd: string | null;
  deliveryNoteNo: string | null;
  docDate: string;
  partnerName: string | null;
  ttd: string;
  vatAmount: Decimal;
  netAmount: Decimal;
  totalAmount: Decimal;
  kind: string | null;
}

export interface EbarimtSheet {
  /** The month every line belongs to: a file is one month's. */
  period: number;
  rows: EbarimtSheetRow[];
  vatAmount: Decimal;
  totalAmount: Decimal;
}

/** The export's heads, found by what they hold: «Харилцагчийн ТТД», «Нийт дүн»… */
const HEADS = {
  ttd: 'ттд',
  total: 'нийт дүн',
  ddtd: 'ддтд',
  deliveryNote: 'падаан',
  date: 'огноо',
  name: 'нэр',
  vat: 'нөат',
  net: 'цэвэр дүн',
  kind: 'төрөл',
} as const;

type HeadKey = keyof typeof HEADS;

/** Without these a line cannot be placed: whose it is, which month, how much. */
const REQUIRED_HEADS: readonly HeadKey[] = ['ttd', 'date', 'total'];

/** How far down the head row may lie. */
const HEAD_SEARCH_ROWS = 10;

/** The money columns hold NUMERIC(14,2): anything from here up does not fit. */
const AMOUNT_LIMIT = new Decimal('1000000000000');

/**
 * An amount written as text: a comma only groups thousands and at most two decimals follow. «1234,56»
 * and «1.234» are someone's own notation, never 123456 or 1.23. e-Barimt's export holds number cells.
 */
const TEXT_AMOUNT = /^-?(\d+|\d{1,3}(,\d{3})+)(\.\d{1,2})?$/;

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return dateOf(value);
  if (typeof value === 'object') {
    if ('result' in value) return cellText(value.result);
    if ('richText' in value) return value.richText.map((part) => part.text).join('');
    if ('text' in value) return String(value.text);
    return '';
  }
  return String(value).trim();
}

/** An error cell, or a formula Excel never worked out: there is no value to read. */
function isUnreadable(value: ExcelJS.CellValue): boolean {
  if (value === null || value === undefined) return false;
  if (value instanceof Date) return Number.isNaN(value.getTime());
  if (typeof value !== 'object') return false;
  if ('error' in value) return true;
  if ('formula' in value || 'sharedFormula' in value) {
    const { result } = value as { result?: ExcelJS.CellValue };
    return result === null || result === undefined || isUnreadable(result);
  }
  return false;
}

/** Empty for a date past what a date can hold: a date cell's number can be anything. */
function dateOf(value: Date): string {
  return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
}

/** «2026-10-08», «2026/10/08», «2026.10.08», a date cell or Excel's day number; only a real day. */
function readDate(value: ExcelJS.CellValue): string | null {
  let text: string;
  if (value instanceof Date) text = dateOf(value);
  else if (typeof value === 'number' && value > 20_000 && value < 80_000) {
    text = dateOf(new Date(Date.UTC(1899, 11, 30) + Math.trunc(value) * 86_400_000));
  } else {
    text = cellText(value).slice(0, 10).replaceAll('/', '-').replaceAll('.', '-');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const period = periodOfDate(text);
  if (period === null) return null;
  const { from, to } = periodDays(period);
  return text >= from && text <= to ? text : null;
}

/** A number cell, or a formula Excel worked out to a number. */
function holdsNumber(value: ExcelJS.CellValue): boolean {
  if (typeof value === 'number') return true;
  if (typeof value !== 'object' || value === null || !('result' in value)) return false;
  return typeof value.result === 'number';
}

/** An amount of a line; blank only where the column may be blank. Null: it cannot be read. */
function readAmount(value: ExcelJS.CellValue, required: boolean): Decimal | null {
  if (isUnreadable(value)) return null;
  const text = cellText(value).replaceAll(/\s/g, '');
  if (text === '') return required ? null : new Decimal(0);
  if (!holdsNumber(value) && !TEXT_AMOUNT.test(text)) return null;
  try {
    const amount = toMoney(new Decimal(text.replaceAll(',', '')));
    if (!amount.isFinite() || amount.abs().greaterThanOrEqualTo(AMOUNT_LIMIT)) return null;
    return amount;
  } catch {
    return null;
  }
}

async function readAll(body: Readable, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of body) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += part.length;
    if (size > limit) throw new RangeError('the file is larger than its kind allows');
    chunks.push(part);
  }
  return Buffer.concat(chunks);
}

function findHeads(
  sheet: ExcelJS.Worksheet,
): { row: number; columns: Map<HeadKey, number> } | null {
  for (let rowNo = 1; rowNo <= Math.min(HEAD_SEARCH_ROWS, sheet.rowCount); rowNo += 1) {
    const columns = new Map<HeadKey, number>();
    sheet.getRow(rowNo).eachCell((cell, column) => {
      const head = cellText(cell.value).toLowerCase();
      for (const key of Object.keys(HEADS) as HeadKey[]) {
        if (head.includes(HEADS[key]) && !columns.has(key)) columns.set(key, column);
      }
    });
    if (REQUIRED_HEADS.every((key) => columns.has(key))) return { row: rowNo, columns };
  }
  return null;
}

/**
 * Reads a month's export from e-Barimt: the head row by its words, then every line with a taxpayer
 * number (a line without one is a total or an empty row). Refused, with the reason, when it is not
 * such a file, a line cannot be read, or its lines fall in more than one month. The whole workbook
 * is loaded, at most 5 MiB, as the importer does; unlike the importer it runs in the API request,
 * since it is one small file a month whose answer the user waits for (ADR-0170).
 */
export async function readEbarimtSheet(body: Readable): Promise<EbarimtSheet> {
  const workbook = new ExcelJS.Workbook();
  try {
    const bytes = await readAll(body, fileKind('ebarimt.source').maxBytes);
    await workbook.xlsx.load(bytes as unknown as ArrayBuffer);
  } catch {
    throw new AppError('EBARIMT_FILE_UNREADABLE', 'not an .xlsx file this reader can open');
  }
  const sheet = workbook.worksheets[0];
  const heads = sheet ? findHeads(sheet) : null;
  if (!sheet || !heads) {
    throw new AppError('EBARIMT_FILE_COLUMNS', 'no head row with «ТТД», «Огноо» and «Нийт дүн»');
  }
  const cell = (row: ExcelJS.Row, key: HeadKey): ExcelJS.CellValue => {
    const column = heads.columns.get(key);
    if (column === undefined) return null;
    const found = row.getCell(column);
    if (found.type !== ExcelJS.ValueType.Formula) return found.value;
    // A formula's value drops a result of 0; the cell itself keeps it.
    return { ...(found.value as object), result: found.result } as ExcelJS.CellValue;
  };
  const rows: EbarimtSheetRow[] = [];
  const periods = new Set<number>();
  sheet.eachRow((row, rowNo) => {
    if (rowNo <= heads.row) return;
    const ttdCell = cell(row, 'ttd');
    if (isUnreadable(ttdCell)) {
      throw new AppError('EBARIMT_FILE_ROW', `row ${rowNo} cannot be read`, { row: rowNo });
    }
    const ttd = normalizeTaxId(cellText(ttdCell));
    if (ttd === '' || ttd.toLowerCase() === 'nan') return;
    if (rows.length >= EBARIMT_LIMITS.maxRows) {
      throw new AppError('EBARIMT_FILE_LIMIT', 'too many rows', { max: EBARIMT_LIMITS.maxRows });
    }
    const docDate = readDate(cell(row, 'date'));
    const period = docDate === null ? null : periodOfDate(docDate);
    const total = readAmount(cell(row, 'total'), true);
    const vat = readAmount(cell(row, 'vat'), false);
    const net = readAmount(cell(row, 'net'), false);
    if (docDate === null || period === null || !total || !vat || !net) {
      throw new AppError('EBARIMT_FILE_ROW', `row ${rowNo} cannot be read`, { row: rowNo });
    }
    periods.add(period);
    const ddtd = cellText(cell(row, 'ddtd')) || null;
    const deliveryNoteNo = cellText(cell(row, 'deliveryNote')) || null;
    rows.push({
      rowNo,
      receiptKey: ddtd ?? `P${deliveryNoteNo ?? ''}|${docDate}|${ttd}|${total.toFixed(2)}`,
      ddtd,
      deliveryNoteNo,
      docDate,
      partnerName: cellText(cell(row, 'name')) || null,
      ttd,
      vatAmount: vat,
      netAmount: net,
      totalAmount: total,
      kind: cellText(cell(row, 'kind')) || null,
    });
  });
  const [period, ...others] = [...periods].sort((a, b) => a - b);
  if (period === undefined) {
    throw new AppError('EBARIMT_FILE_EMPTY', 'no receipts in the file');
  }
  if (others.length > 0) {
    const months = [period, ...others]
      .map((p) => `${periodYear(p)}-${String(periodMonth(p)).padStart(2, '0')}`)
      .join(', ');
    throw new AppError('EBARIMT_FILE_MONTHS', 'a file holds one month', { months });
  }
  const vatAmount = rows.reduce((sum, row) => sum.plus(row.vatAmount), new Decimal(0));
  const totalAmount = rows.reduce((sum, row) => sum.plus(row.totalAmount), new Decimal(0));
  if (
    vatAmount.abs().greaterThanOrEqualTo(AMOUNT_LIMIT) ||
    totalAmount.abs().greaterThanOrEqualTo(AMOUNT_LIMIT)
  ) {
    throw new AppError('EBARIMT_FILE_LIMIT', 'the file’s total does not fit', {
      max: EBARIMT_LIMITS.maxRows,
    });
  }
  return { period, rows, vatAmount, totalAmount };
}
