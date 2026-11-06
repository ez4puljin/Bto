import type { Readable } from 'node:stream';
import {
  EBARIMT_LIMITS,
  normalizeTaxId,
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

/** How far down the head row may lie. */
const HEAD_SEARCH_ROWS = 10;

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

function dateOf(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** «2026-10-08», «2026/10/08», «2026.10.08», a date cell or Excel's day number. */
function readDate(value: ExcelJS.CellValue): string | null {
  if (value instanceof Date) return dateOf(value);
  if (typeof value === 'number' && value > 20_000 && value < 80_000) {
    return dateOf(new Date(Date.UTC(1899, 11, 30) + Math.trunc(value) * 86_400_000));
  }
  const text = cellText(value).slice(0, 10).replaceAll('/', '-').replaceAll('.', '-');
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function readAmount(value: ExcelJS.CellValue): Decimal | null {
  const text = cellText(value).replaceAll(/[\s,]/g, '');
  if (text === '') return new Decimal(0);
  try {
    const amount = new Decimal(text);
    return amount.isFinite() ? toMoney(amount) : null;
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
    if (columns.has('ttd') && columns.has('total')) return { row: rowNo, columns };
  }
  return null;
}

/**
 * Reads a month's export from e-Barimt: the head row by its words, then every line with a taxpayer
 * number (a line without one is a total or an empty row). Refused, with the reason, when it is not
 * such a file, a line cannot be read, or its lines fall in more than one month. The whole workbook
 * is loaded (at most 5 MiB), as the importer does (ADR-0036).
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
    throw new AppError('EBARIMT_FILE_COLUMNS', 'no head row with «ТТД» and «Нийт дүн»');
  }
  const cell = (row: ExcelJS.Row, key: HeadKey): ExcelJS.CellValue => {
    const column = heads.columns.get(key);
    return column === undefined ? null : row.getCell(column).value;
  };
  const rows: EbarimtSheetRow[] = [];
  const periods = new Set<number>();
  sheet.eachRow((row, rowNo) => {
    if (rowNo <= heads.row) return;
    const ttd = normalizeTaxId(cellText(cell(row, 'ttd')));
    if (ttd === '' || ttd.toLowerCase() === 'nan') return;
    if (rows.length >= EBARIMT_LIMITS.maxRows) {
      throw new AppError('EBARIMT_FILE_ROW', 'too many rows', { row: rowNo });
    }
    const docDate = readDate(cell(row, 'date'));
    const period = docDate === null ? null : periodOfDate(docDate);
    const total = readAmount(cell(row, 'total'));
    const vat = readAmount(cell(row, 'vat'));
    const net = readAmount(cell(row, 'net'));
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
  return {
    period,
    rows,
    vatAmount: rows.reduce((sum, row) => sum.plus(row.vatAmount), new Decimal(0)),
    totalAmount: rows.reduce((sum, row) => sum.plus(row.totalAmount), new Decimal(0)),
  };
}
