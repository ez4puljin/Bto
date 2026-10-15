import type { Readable } from 'node:stream';
import { fileKind } from '@tugeel/shared/files';
import mn from '@tugeel/shared/i18n/mn.json';
import {
  type FileIssueCode,
  IMPORT_COLUMNS,
  IMPORT_LIMITS,
  maxRowsOf,
  type ImportKind,
  matchHeaders,
  readCell,
  type RowIssue,
} from '@tugeel/shared/imports';
import ExcelJS from 'exceljs';

/** A data row as read from the sheet: cell texts by column key and the problems of its cells. */
export interface SheetRow {
  rowNo: number;
  values: Record<string, string | null>;
  issues: RowIssue[];
}

export interface FileIssue {
  code: FileIssueCode;
  params?: Record<string, string | number>;
}

export type SheetResult =
  | { ok: true; headerRow: number; columns: string[]; rows: SheetRow[] }
  | { ok: false; issue: FileIssue };

/** Every accepted label of a column: the template label first, then its aliases (mn.json). */
export function columnLabels(kind: ImportKind, key: string): string[] {
  const label = (mn.imports.columns[kind] as Record<string, string>)[key];
  const aliases = (mn.imports.aliases as Record<string, Record<string, string> | undefined>)[
    kind
  ]?.[key];
  return [
    ...(label ? [label] : []),
    ...(aliases ? aliases.split('|').map((alias) => alias.trim()) : []),
  ].filter((value) => value !== '');
}

/** The template label of a column, for messages. */
export function columnLabel(kind: ImportKind, key: string): string {
  return columnLabels(kind, key)[0] ?? key;
}

/**
 * Reads the first worksheet of an .xlsx file (ADR-0036 #1): finds the header row in the first rows
 * by the column labels, then reads every data row's cells by the column types of the kind; empty
 * rows are skipped. The whole workbook is loaded (the upload is at most 5 MiB): ExcelJS 4.4's
 * streaming reader loses shared strings in some files and never sees hyperlink targets.
 */
export async function readSheet(body: Readable, kind: ImportKind): Promise<SheetResult> {
  const workbook = new ExcelJS.Workbook();
  try {
    const bytes = await readAll(body, fileKind('imports.source').maxBytes);
    await workbook.xlsx.load(bytes as unknown as ArrayBuffer);
  } catch {
    return issue('UNREADABLE');
  }
  const worksheet = workbook.worksheets[0];
  if (!worksheet) return issue('NO_SHEET');
  const types = new Map(IMPORT_COLUMNS[kind].map((column) => [column.key, column.type]));
  let columns: Map<string, number> | null = null;
  let headerRow = 0;
  let best: { matched: number; missing: string[] } | null = null;
  const rows: SheetRow[] = [];
  for (let number = 1; number <= worksheet.rowCount; number += 1) {
    const row = worksheet.findRow(number);
    if (!row) continue;
    const cells = cellValues(row.values);
    if (columns === null) {
      if (number > IMPORT_LIMITS.headerSearchRows) break;
      const texts = cells.map((value) => readCell(value, 'text').text);
      const match = matchHeaders(texts, kind, (key) => columnLabels(kind, key));
      if (match.columns.size > 0 && match.duplicates.length > 0) {
        return issue('DUPLICATE_COLUMNS', {
          columns: match.duplicates.map((key) => columnLabel(kind, key)).join(', '),
        });
      }
      if (match.columns.size > 0 && match.missing.length === 0) {
        if (cells.length > IMPORT_LIMITS.maxColumns) {
          return issue('TOO_MANY_COLUMNS', { max: IMPORT_LIMITS.maxColumns });
        }
        columns = match.columns;
        headerRow = number;
      } else if (match.columns.size > (best?.matched ?? 0)) {
        best = { matched: match.columns.size, missing: match.missing };
      }
      continue;
    }
    const values: Record<string, string | null> = {};
    const issues: RowIssue[] = [];
    let filled = false;
    for (const [key, index] of columns) {
      const cell = readCell(cells[index], types.get(key) ?? 'text');
      values[key] = cell.text;
      if (cell.text !== null || cell.problem) filled = true;
      if (cell.problem) issues.push({ column: key, code: cell.problem });
      if (cell.warning) issues.push({ column: key, code: cell.warning });
    }
    if (!filled) continue;
    if (rows.length >= maxRowsOf(kind)) {
      return issue('TOO_MANY_ROWS', { max: maxRowsOf(kind) });
    }
    rows.push({ rowNo: number, values, issues });
  }
  if (columns === null) {
    return best
      ? issue('MISSING_COLUMNS', {
          columns: best.missing.map((key) => columnLabel(kind, key)).join(', '),
        })
      : issue('NO_HEADER', { rows: IMPORT_LIMITS.headerSearchRows });
  }
  if (rows.length === 0) return issue('EMPTY');
  return { ok: true, headerRow, columns: [...columns.keys()], rows };
}

function issue(code: FileIssueCode, params?: Record<string, string | number>): SheetResult {
  return { ok: false, issue: params ? { code, params } : { code } };
}

/** The bytes of a stream, refusing more than `maxBytes`. */
async function readAll(body: Readable, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of body) {
      const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      size += part.length;
      if (size > maxBytes) throw new Error('the sheet is larger than an import may be');
      chunks.push(part);
    }
  } finally {
    body.destroy();
  }
  return Buffer.concat(chunks);
}

/** ExcelJS row values are 1-based and sparse: cell values by zero-based column index. */
function cellValues(values: unknown): unknown[] {
  if (!Array.isArray(values)) return [];
  const cells: readonly unknown[] = values;
  return Array.from({ length: Math.max(0, cells.length - 1) }, (_, index) => cells[index + 1]);
}
