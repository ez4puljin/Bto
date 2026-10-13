import { Decimal } from '../money';
import { type CustomerKind, cleanTaxNumber, normalizeRegNo, regNoShape } from '../taxpayer';

/**
 * Excel imports (ADR-0015, ADR-0036): the kinds, the columns of each template and the pure rules
 * the worker uses to read cells. Column labels and their aliases live in `mn.json`
 * (`imports.columns.<KIND>.<key>`, `imports.aliases.<KIND>.<key>` with `|` between aliases); the
 * header row of an uploaded sheet is matched against them, so the column order does not matter.
 */
export const IMPORT_KINDS = [
  'PRODUCTS',
  'CUSTOMERS',
  'SUPPLIERS',
  'OPENING_STOCK',
  'LEVELS',
] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

export function isImportKind(value: unknown): value is ImportKind {
  return typeof value === 'string' && (IMPORT_KINDS as readonly string[]).includes(value);
}

/**
 * How a column's cells are read: `code` keeps digits as written (SKUs, customer codes, TINs,
 * phones), `list` holds several codes in one cell (barcodes), `decimal` is a number, `link` takes a
 * hyperlink's address (Google Maps links), `text` anything else.
 */
export type ColumnType = 'text' | 'code' | 'list' | 'decimal' | 'link';

export interface ImportColumn {
  key: string;
  required: boolean;
  type: ColumnType;
}

const column = (key: string, type: ColumnType, required = false): ImportColumn => ({
  key,
  type,
  required,
});

/** The template columns in their template order. */
export const IMPORT_COLUMNS: Readonly<Record<ImportKind, readonly ImportColumn[]>> = {
  PRODUCTS: [
    column('sku', 'code', true),
    column('name', 'text', true),
    column('category', 'text', true),
    column('baseUnit', 'text'),
    column('barcodes', 'list'),
    column('boxQty', 'decimal'),
    column('boxBarcodes', 'list'),
    column('vatType', 'text'),
    column('weightKg', 'decimal'),
    column('homeWarehouse', 'text'),
    column('fixedBin', 'text'),
    column('supplier', 'text'),
  ],
  CUSTOMERS: [
    column('code', 'code', true),
    column('name', 'text', true),
    column('regNo', 'text'),
    column('tin', 'code'),
    column('consumerNo', 'code'),
    column('phone', 'code'),
    column('address', 'text'),
    column('gps', 'link'),
    column('creditLimit', 'decimal'),
    column('paymentTermDays', 'decimal'),
    column('note', 'text'),
  ],
  SUPPLIERS: [
    column('code', 'code'),
    column('name', 'text', true),
    column('regNo', 'text'),
    column('tin', 'code'),
    column('phone', 'code'),
    column('email', 'text'),
    column('address', 'text'),
    column('bankName', 'text'),
    column('bankAccount', 'text'),
    column('paymentTermDays', 'decimal'),
    column('contactName', 'text'),
    column('contactPhone', 'code'),
    column('note', 'text'),
  ],
  OPENING_STOCK: [
    column('warehouse', 'text', true),
    column('bin', 'text'),
    column('sku', 'code', true),
    column('unit', 'text'),
    column('qty', 'decimal', true),
    column('unitCost', 'decimal'),
  ],
  // Low-stock levels per warehouse (ADR-0039), in the row's unit.
  LEVELS: [
    column('warehouse', 'text', true),
    column('sku', 'code', true),
    column('unit', 'text'),
    column('minQty', 'decimal'),
    column('maxQty', 'decimal'),
  ],
};

export const IMPORT_LIMITS = {
  /** Data rows per file. */
  maxRows: 20_000,
  maxColumns: 60,
  maxCellLength: 1_000,
  /** The header row is looked for in this many rows from the top. */
  headerSearchRows: 10,
} as const;

/** Problems in one row; every code has a message `imports.issues.<code>` in mn.json. */
export const ROW_ERROR_CODES = [
  'REQUIRED',
  'FORMAT',
  'TOO_LONG',
  'DATE_IN_CELL',
  'FORMULA_WITHOUT_RESULT',
  'ERROR_VALUE',
  'NOT_FOUND',
  'AMBIGUOUS',
  'DUPLICATE_IN_FILE',
  'TAKEN',
  'NOT_ALLOWED',
  'MISMATCH',
  'INEXACT',
  'NOT_POSITIVE',
  'OUT_OF_RANGE',
  'ALREADY_IMPORTED',
  'MIN_ABOVE_MAX',
] as const;
export type RowErrorCode = (typeof ROW_ERROR_CODES)[number];

/** Notes that do not stop an import. */
export const ROW_WARNING_CODES = [
  'NUMERIC_CODE',
  'KIND_GUESSED',
  'NO_COST',
  'NO_SHELF',
  'NOT_SELLABLE',
  'REACTIVATED',
] as const;
export type RowWarningCode = (typeof ROW_WARNING_CODES)[number];

/** Why a whole sheet cannot be imported; each code has a message `imports.fileIssues.<code>`. */
export const FILE_ISSUE_CODES = [
  'UNREADABLE',
  'NO_SHEET',
  'NO_HEADER',
  'MISSING_COLUMNS',
  'DUPLICATE_COLUMNS',
  'TOO_MANY_COLUMNS',
  'TOO_MANY_ROWS',
  'EMPTY',
] as const;
export type FileIssueCode = (typeof FILE_ISSUE_CODES)[number];

export interface RowIssue<C extends string = RowErrorCode | RowWarningCode> {
  /** The column key, or null for the whole row. */
  column: string | null;
  code: C;
  params?: Record<string, string | number>;
}

// ---------------------------------------------------------------------------------------------
// Header row

/** A header label for comparison: NFKC, lower case, no `*` markers, single spaces, no colon. */
export function normalizeHeader(label: string): string {
  return label
    .normalize('NFKC')
    .replace(/\*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s*:$/, '')
    .toLowerCase();
}

export interface HeaderMatch {
  /** Column key → zero-based cell index in the header row. */
  columns: Map<string, number>;
  /** Required keys without a column. */
  missing: string[];
  /** Keys matched by more than one column. */
  duplicates: string[];
}

/**
 * Matches the cells of one row against the labels of a kind's columns. `labels(key)` returns every
 * accepted label (the template label first, then aliases).
 */
export function matchHeaders(
  cells: readonly (string | null)[],
  kind: ImportKind,
  labels: (key: string) => readonly string[],
): HeaderMatch {
  const byLabel = new Map<string, string>();
  for (const { key } of IMPORT_COLUMNS[kind]) {
    for (const label of labels(key)) {
      const normal = normalizeHeader(label);
      if (normal) byLabel.set(normal, key);
    }
  }
  const columns = new Map<string, number>();
  const duplicates = new Set<string>();
  cells.forEach((cell, index) => {
    const key = cell === null ? undefined : byLabel.get(normalizeHeader(cell));
    if (key === undefined) return;
    if (columns.has(key)) duplicates.add(key);
    else columns.set(key, index);
  });
  const missing = IMPORT_COLUMNS[kind]
    .filter((spec) => spec.required && !columns.has(spec.key))
    .map((spec) => spec.key);
  return { columns, missing, duplicates: [...duplicates] };
}

// ---------------------------------------------------------------------------------------------
// Cells

export type CellProblem =
  'DATE_IN_CELL' | 'FORMULA_WITHOUT_RESULT' | 'ERROR_VALUE' | 'FORMAT' | 'TOO_LONG';

export interface CellResult {
  text: string | null;
  problem?: CellProblem;
  /** A code written as a number: leading zeros may have been lost. */
  warning?: 'NUMERIC_CODE';
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** A number exactly as Excel shows it (15 significant digits), without float noise. */
function numberText(value: number): string {
  return Number.isInteger(value) && Number.isSafeInteger(value)
    ? String(value)
    : new Decimal(value.toPrecision(15)).toFixed();
}

/**
 * The text of a cell as the importer reads it. `value` is what the spreadsheet reader gives: a
 * string, number, boolean, Date, or an object for rich text (`richText`), formulas (`result`),
 * hyperlinks (`text` + `hyperlink`) and error values (`error`).
 */
export function readCell(
  value: unknown,
  type: ColumnType,
  maxLength: number = IMPORT_LIMITS.maxCellLength,
): CellResult {
  const result = cellText(value, type);
  if (result.text !== null && result.text.length > maxLength) {
    return { text: null, problem: 'TOO_LONG' };
  }
  return result;
}

function cellText(value: unknown, type: ColumnType): CellResult {
  if (value === null || value === undefined) return { text: null };
  if (typeof value === 'string') {
    const text = value.trim();
    return { text: text === '' ? null : text };
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return { text: null, problem: 'FORMAT' };
    if (type === 'code' || type === 'list') {
      if (!Number.isSafeInteger(value) || value < 0) return { text: null, problem: 'FORMAT' };
      return type === 'code'
        ? { text: String(value), warning: 'NUMERIC_CODE' }
        : { text: String(value) };
    }
    return { text: numberText(value) };
  }
  if (typeof value === 'boolean') return { text: value ? 'TRUE' : 'FALSE' };
  if (value instanceof Date) return { text: null, problem: 'DATE_IN_CELL' };
  if (isRecord(value)) {
    if ('error' in value) return { text: null, problem: 'ERROR_VALUE' };
    if (Array.isArray(value.richText)) {
      const text = value.richText
        .map((part: unknown) => (isRecord(part) && typeof part.text === 'string' ? part.text : ''))
        .join('');
      return cellText(text, type);
    }
    if ('formula' in value || 'sharedFormula' in value) {
      return value.result === undefined || value.result === null
        ? { text: null, problem: 'FORMULA_WITHOUT_RESULT' }
        : cellText(value.result, type);
    }
    if ('hyperlink' in value) {
      const link = typeof value.hyperlink === 'string' ? value.hyperlink : null;
      if (type === 'link' && link && /^https?:\/\//i.test(link)) return { text: link };
      return cellText(value.text, type);
    }
    if ('text' in value) return cellText(value.text, type);
  }
  return { text: null, problem: 'FORMAT' };
}

/** Several codes in one cell, separated by commas, semicolons, spaces or line breaks. */
export function splitList(text: string | null): string[] {
  if (text === null) return [];
  return [...new Set(text.split(/[\s,;]+/).filter((part) => part !== ''))];
}

/** A non-negative decimal from a cell's text, or null when it is not one. */
export function parseDecimal(text: string): Decimal | null {
  const normal = text.replace(/\s+/g, '').replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(normal)) return null;
  return new Decimal(normal);
}

// ---------------------------------------------------------------------------------------------
// Customers

export interface KindGuess {
  kind: CustomerKind;
  /** What decided it: the registration number, the TIN length or nothing (the default). */
  source: 'REG_NO' | 'TIN' | 'DEFAULT';
}

/**
 * The owner's customer sheet has no company/individual column (2026-10-11): a 7-digit registration
 * number is a company, 2 letters + 8 digits a citizen; else an 11-digit TIN is a company and 12–14
 * digits a citizen; else a company, flagged in the preview.
 */
export function guessCustomerKind(regNo: string | null, tin: string | null): KindGuess {
  const shape = regNo ? regNoShape(normalizeRegNo(regNo)) : null;
  if (shape) return { kind: shape, source: 'REG_NO' };
  const digits = tin ? cleanTaxNumber(tin) : '';
  if (/^[0-9]{11}$/.test(digits)) return { kind: 'COMPANY', source: 'TIN' };
  if (/^[0-9]{12,14}$/.test(digits)) return { kind: 'INDIVIDUAL', source: 'TIN' };
  return { kind: 'COMPANY', source: 'DEFAULT' };
}
