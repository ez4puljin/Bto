/**
 * How a list's columns share the table's width (ADR-0119). Columns of a fixed kind (codes, dates,
 * numbers, money, counts, status pills, checkboxes, pictures, actions, the chevron) get a width
 * in rem; text columns get their `min` and share what is left by weight (a name 3 : a category
 * 2 : a note 2 …). The table is `table-layout: fixed` with these widths, so a long text truncates
 * inside its column instead of stretching it, and at 1920px nothing that fits is cut. A table
 * narrower than its minimum (every text column at its `min`) keeps the browser's own layout, as
 * before this rule.
 */
export type ColumnKind =
  | 'check'
  | 'image'
  | 'icon'
  | 'code'
  | 'number'
  | 'date'
  | 'datetime'
  | 'money'
  | 'qty'
  | 'count'
  | 'percent'
  | 'status'
  | 'actions'
  | 'chevron'
  | 'spacer'
  | 'text';

export interface ColumnSpec {
  /** The column's key (its header's i18n key, usually); only for React keys and reading. */
  key: string;
  kind: ColumnKind;
  /** A fixed kind: its width in rem when the default does not fit the column's values. */
  width?: number;
  /** A text column's share of what is left after every column has its width (default 1). */
  weight?: number;
  /** A text column's narrowest width in rem (default 7; a spacer 0). */
  min?: number;
  /** An `actions` column: how many icon buttons it holds (default 2). */
  actions?: number;
}

/** The default width in rem of every fixed kind, for 13px Inter (8.3px a mono glyph) and the cells' 12px padding. */
export const COLUMN_WIDTHS: Record<Exclude<ColumnKind, 'text' | 'spacer' | 'actions'>, number> = {
  check: 2.5,
  image: 3,
  icon: 3,
  code: 7,
  number: 10.5,
  date: 7.25,
  datetime: 10.75,
  money: 8.5,
  qty: 6,
  count: 4.5,
  percent: 6,
  status: 8.5,
  chevron: 2.25,
};

const TEXT_MIN = 7;
const ACTION_WIDTH = 1.75;
const ACTIONS_PADDING = 1.5;

export interface ColumnLayout {
  /** One width in rem per column, in the order given, summing to `available` (or `minWidth`). */
  widths: number[];
  /** The table's narrowest width in rem: every fixed column plus every text column at its min. */
  minWidth: number;
}

/** The width in rem of a fixed column. */
export function fixedWidth(column: ColumnSpec): number {
  if (column.width !== undefined) return column.width;
  if (column.kind === 'actions') return ACTIONS_PADDING + ACTION_WIDTH * (column.actions ?? 2);
  if (column.kind === 'text' || column.kind === 'spacer') {
    throw new Error(`column ${column.key} has no fixed width`);
  }
  return COLUMN_WIDTHS[column.kind];
}

function isText(column: ColumnSpec): boolean {
  return column.kind === 'text' || column.kind === 'spacer';
}

function textMin(column: ColumnSpec): number {
  return column.min ?? (column.kind === 'spacer' ? 0 : TEXT_MIN);
}

function textWeight(column: ColumnSpec): number {
  return column.weight ?? 1;
}

const round = (value: number) => Math.round(value * 1000) / 1000;

/**
 * The widths of a table's columns for `available` rem of room: fixed ones as given, text ones
 * their `min` plus a share by weight of what is left; below the minimum (or without a width) every
 * text column is at its `min`.
 */
export function columnLayout(columns: readonly ColumnSpec[], available?: number): ColumnLayout {
  const fixed = columns
    .filter((column) => !isText(column))
    .reduce((sum, column) => sum + fixedWidth(column), 0);
  const texts = columns.filter(isText);
  const mins = texts.reduce((sum, column) => sum + textMin(column), 0);
  const weights = texts.reduce((sum, column) => sum + textWeight(column), 0);
  const minWidth = fixed + mins;
  const spare = available === undefined ? 0 : Math.max(0, available - minWidth);
  const widths = columns.map((column) =>
    isText(column)
      ? round(textMin(column) + (weights === 0 ? 0 : (spare * textWeight(column)) / weights))
      : round(fixedWidth(column)),
  );
  return { widths, minWidth: round(minWidth) };
}
