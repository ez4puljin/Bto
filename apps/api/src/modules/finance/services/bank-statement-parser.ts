import { createHash } from 'node:crypto';
import { BANK_STATEMENT_LIMITS, type BankLineKind } from '@tugeel/shared/finance';
import { Decimal } from '@tugeel/shared/money';
import { businessInstant, isIsoDate } from '@tugeel/shared/time';
import ExcelJS from 'exceljs';
import { AppError } from '../../../common/errors/app-error';

/** One line as the bank wrote it, ready for the table. */
export interface ParsedBankLine {
  lineNo: number;
  txnAt: Date;
  businessDate: string;
  debit: Decimal;
  credit: Decimal;
  bankDescription: string;
  bankCounterpart: string;
  kind: BankLineKind;
  dedupeKey: string;
}

export interface ParsedStatement {
  accountNumber: string;
  currency: string;
  /** The first and the last day of its lines. */
  statementDate: string;
  dateTo: string;
  lines: ParsedBankLine[];
}

interface Columns {
  date: number;
  debit: number;
  credit: number;
  description: number;
  counterpart: number;
  headerRow: number;
}

/** Khan Bank's layout when no header is recognised: the old tool's defaults (0-based, row 2 first). */
const DEFAULT_COLUMNS: Columns = {
  date: 0,
  debit: 3,
  credit: 4,
  description: 6,
  counterpart: 7,
  headerRow: 1,
};
const HEADER_SEARCH_ROWS = 4;

// The bank's own words, not screen text: read from the statement, never shown.
const FEE_WORDS = /хураамж|шимтгэл|commission|үйлчилгээний төлбөр|\bfee\b/iu;
const SETTLEMENT_WORD = /\bSETTLEMENT\b/i;
const FILE_NAME = /Statement_([A-Z]+)_(\d+)/;

/** A fee is money out; money in with the same words is a customer paying (ADR-0169 #3). */
export function kindOfLine(description: string, debit: Decimal, credit: Decimal): BankLineKind {
  if (debit.gt(0) && FEE_WORDS.test(description)) return 'FEE';
  if (credit.gt(0) && SETTLEMENT_WORD.test(description)) return 'SETTLEMENT';
  return 'NORMAL';
}

/** The account and currency in Khan Bank's file name, `Statement_MNT_5914103399 (40).xlsx`. */
export function accountOfFileName(fileName: string): { accountNumber: string; currency: string } {
  const match = FILE_NAME.exec(fileName);
  if (!match?.[1] || !match[2]) {
    throw new AppError('BANK_STATEMENT_NO_ACCOUNT', `no account number in ${fileName}`, {
      fileName,
    });
  }
  return { currency: match[1], accountNumber: match[2] };
}

const pad = (value: number) => String(value).padStart(2, '0');

/** Wall-clock `YYYY-MM-DD HH:mm:ss` of a real date, or null. */
function wallClock(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): string | null {
  const date = `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}`;
  if (!isIsoDate(date) || hour > 23 || minute > 59 || second > 59) return null;
  return `${date} ${pad(hour)}:${pad(minute)}:${pad(second)}`;
}

const toInt = (text: string | undefined): number => (text ? Number.parseInt(text, 10) : 0);

/**
 * A statement date cell as wall-clock time in Ulaanbaatar: ExcelJS hands a date cell over as a Date
 * whose UTC fields are what the sheet shows; a number is Excel's serial date; text comes as
 * `2026/11/05 09:05[:00]`, `2026-11-05 …` or the US order `11/05/2026 …`. Anything else (the totals
 * row) is no date.
 */
export function readBankDate(value: unknown): string | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return wallClock(
      value.getUTCFullYear(),
      value.getUTCMonth() + 1,
      value.getUTCDate(),
      value.getUTCHours(),
      value.getUTCMinutes(),
      value.getUTCSeconds(),
    );
  }
  if (typeof value === 'number') {
    // Excel's serial day: 25569 is 1970-01-01; statements are recent, so a small number is no date.
    if (value < 30000 || value > 80000) return null;
    return readBankDate(new Date(Math.round((value - 25569) * 86400) * 1000));
  }
  if (typeof value !== 'string') return null;
  const text = value.trim();
  const ymd = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(
    text,
  );
  if (ymd) {
    return wallClock(
      toInt(ymd[1]),
      toInt(ymd[2]),
      toInt(ymd[3]),
      toInt(ymd[4]),
      toInt(ymd[5]),
      toInt(ymd[6]),
    );
  }
  const mdy =
    /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?/i.exec(
      text,
    );
  if (!mdy) return null;
  let hour = toInt(mdy[4]);
  const meridiem = mdy[7]?.toUpperCase();
  if (meridiem === 'PM' && hour < 12) hour += 12;
  if (meridiem === 'AM' && hour === 12) hour = 0;
  return wallClock(toInt(mdy[3]), toInt(mdy[1]), toInt(mdy[2]), hour, toInt(mdy[5]), toInt(mdy[6]));
}

/** A money cell as its absolute amount: statements write money out as a negative or a positive. */
export function readBankAmount(value: unknown): Decimal {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? new Decimal(value).abs().toDecimalPlaces(2) : new Decimal(0);
  }
  if (typeof value === 'string') {
    const text = value.replace(/[\s,]/g, '');
    if (/^[-+]?\d+(\.\d+)?$/.test(text)) return new Decimal(text).abs().toDecimalPlaces(2);
    return new Decimal(0);
  }
  const result = (value as { result?: unknown } | null)?.result;
  return result === undefined ? new Decimal(0) : readBankAmount(result);
}

/** A cell's text: rich text, a formula's result and a hyperlink's text included. */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') {
    // An account number read as a number, 5303363476.0.
    return Number.isInteger(value) ? String(value) : new Decimal(value).toFixed();
  }
  if (typeof value === 'object') {
    const rich = (value as { richText?: { text?: string }[] }).richText;
    if (Array.isArray(rich))
      return rich
        .map((part) => part.text ?? '')
        .join('')
        .trim();
    const inner = value as { text?: unknown; result?: unknown };
    if (inner.text !== undefined) return cellText(inner.text);
    if (inner.result !== undefined) return cellText(inner.result);
  }
  return '';
}

/** The columns by the header's words, in the first rows; the old tool's defaults without a header. */
function findColumns(rows: readonly (readonly unknown[])[]): Columns {
  for (let index = 0; index < Math.min(HEADER_SEARCH_ROWS, rows.length); index += 1) {
    const found: Partial<Columns> = {};
    (rows[index] ?? []).forEach((value, column) => {
      if (typeof value !== 'string') return;
      const text = value.trim().toLowerCase();
      if (text === '') return;
      if (text.includes('дебит') || text.includes('debit')) found.debit = column;
      else if (text.includes('кредит') || text.includes('credit')) found.credit = column;
      else if (
        (text.includes('огноо') && (text.includes('гүйлгээ') || column <= 1)) ||
        text === 'date'
      ) {
        found.date ??= column;
      } else if (
        text.includes('утга') ||
        text.includes('тайлбар') ||
        text.includes('description')
      ) {
        found.description = column;
      } else if (
        (text.includes('харьцсан') && text.includes('данс')) ||
        text.includes('counterparty')
      ) {
        found.counterpart = column;
      }
    });
    if (found.debit !== undefined && found.credit !== undefined) {
      return { ...DEFAULT_COLUMNS, ...found, headerRow: index };
    }
  }
  return DEFAULT_COLUMNS;
}

/** The first sheet's rows, 0-based in both directions; empty rows keep their place. */
function sheetRows(worksheet: ExcelJS.Worksheet): unknown[][] {
  const rows: unknown[][] = [];
  for (let number = 1; number <= worksheet.rowCount; number += 1) {
    const values = worksheet.findRow(number)?.values;
    if (!Array.isArray(values)) {
      rows.push([]);
      continue;
    }
    const cells: readonly unknown[] = values;
    rows.push(Array.from({ length: Math.max(0, cells.length - 1) }, (_, at) => cells[at + 1]));
  }
  return rows;
}

function dedupeKey(accountNumber: string, parts: readonly string[], occurrence: number): string {
  return createHash('sha256')
    .update([accountNumber, ...parts, String(occurrence)].join('\u0001'))
    .digest('hex');
}

/**
 * Reads a Khan Bank statement in Excel (ADR-0169 #2): the account from the file name, the columns by
 * their header, every dated row with an amount; the totals row has no date and falls away. Two
 * identical rows of one file stay two lines (the occurrence is in the key), and a later upload of the
 * same rows is recognised by the key. The whole workbook is loaded (ADR-0036: ExcelJS's streaming
 * reader loses shared strings).
 */
export async function parseBankStatement(
  bytes: Buffer,
  fileName: string,
): Promise<ParsedStatement> {
  const { accountNumber, currency } = accountOfFileName(fileName);
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(bytes as unknown as ArrayBuffer);
  } catch {
    throw new AppError('BANK_STATEMENT_UNREADABLE', `${fileName} is not an Excel workbook`, {
      fileName,
    });
  }
  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new AppError('BANK_STATEMENT_UNREADABLE', `${fileName} has no sheet`, { fileName });
  }
  const rows = sheetRows(worksheet);
  const columns = findColumns(rows);
  const seen = new Map<string, number>();
  const lines: ParsedBankLine[] = [];
  for (const row of rows.slice(columns.headerRow + 1)) {
    const wall = readBankDate(row[columns.date]);
    if (wall === null) continue;
    const debit = readBankAmount(row[columns.debit]);
    const credit = readBankAmount(row[columns.credit]);
    if (debit.isZero() === credit.isZero()) continue;
    if (lines.length >= BANK_STATEMENT_LIMITS.maxLines) {
      throw new AppError('BANK_STATEMENT_UNREADABLE', `${fileName} has too many lines`, {
        fileName,
      });
    }
    const bankDescription = cellText(row[columns.description]);
    const bankCounterpart = cellText(row[columns.counterpart]);
    const parts = [wall, debit.toFixed(2), credit.toFixed(2), bankDescription, bankCounterpart];
    const signature = parts.join('\u0001');
    const occurrence = seen.get(signature) ?? 0;
    seen.set(signature, occurrence + 1);
    lines.push({
      lineNo: lines.length + 1,
      txnAt: businessInstant(wall),
      businessDate: wall.slice(0, 10),
      debit,
      credit,
      bankDescription,
      bankCounterpart,
      kind: kindOfLine(bankDescription, debit, credit),
      dedupeKey: dedupeKey(accountNumber, parts, occurrence),
    });
  }
  if (lines.length === 0) {
    throw new AppError('BANK_STATEMENT_EMPTY', `${fileName} has no lines`, { fileName });
  }
  const dates = lines.map((line) => line.businessDate).sort();
  return {
    accountNumber,
    currency,
    statementDate: dates[0] ?? '',
    dateTo: dates.at(-1) ?? '',
    lines,
  };
}

/** The date in a settlement's text (`29/04/2026 SETTLEMENT - …`): Erkhet's row takes it (ADR-0169 #6). */
export function dateInDescription(description: string): string | null {
  const ymd = /\b(\d{4})[-./](\d{1,2})[-./](\d{1,2})\b/.exec(description);
  if (ymd) {
    const date = `${ymd[1]}-${pad(toInt(ymd[2]))}-${pad(toInt(ymd[3]))}`;
    if (isIsoDate(date)) return date;
  }
  const dmy = /\b(\d{1,2})[-./](\d{1,2})[-./](\d{4})\b/.exec(description);
  if (dmy) {
    const date = `${dmy[3]}-${pad(toInt(dmy[2]))}-${pad(toInt(dmy[1]))}`;
    if (isIsoDate(date)) return date;
  }
  return null;
}
