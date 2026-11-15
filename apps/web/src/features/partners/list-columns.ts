import type { TFunction } from 'i18next';
import type { ReactNode } from 'react';
import type { ColumnKind, ColumnSpec } from '@/lib/column-layout';

/** A column of a partner list (`customer-columns`, `supplier-columns`) as its cells read it. */
export interface ListColumn<Row> {
  key: string;
  /**
   * How the column is sized in the list's layout (ADR-0119, `lib/column-layout.ts`); a numeric
   * column without a kind is `money`, any other `text`.
   */
  kind?: ColumnKind;
  /** A text column's share of the spare width (default 1). */
  weight?: number;
  /** A text column's narrowest width in rem (default 8). */
  min?: number;
  /** A fixed column's width in rem when the kind's default does not fit its values. */
  width?: number;
  /** Money and counts: right-aligned in the head and the cells. */
  numeric?: boolean;
  /** Long text on one line with «…» and the whole text on hover; `fill` takes the spare width. */
  truncate?: { text: (row: Row, t: TFunction) => string; fill?: boolean };
  className?: string;
  cell: (row: Row, t: TFunction) => ReactNode;
}

/**
 * The layout of a list's shown columns (`ListTable`): one spec per column, in their order.
 * `leaving` names the columns that leave a table too narrow for all of them, the least needed
 * first and one at a time (ADR-0201). Pass it for a default set only (`isDefaultSet`): what a user
 * chose in «Баганууд» is shown as chosen and scrolls in its card when it is too wide, as it did.
 */
export function columnSpecs<Row>(
  columns: readonly ListColumn<Row>[],
  leaving: readonly string[] = [],
): ColumnSpec[] {
  return columns.map<ColumnSpec>((column) => {
    const place = leaving.indexOf(column.key);
    return {
      key: column.key,
      kind: column.kind ?? (column.numeric ? 'money' : 'text'),
      ...(column.weight === undefined ? {} : { weight: column.weight }),
      ...(column.min === undefined ? {} : { min: column.min }),
      ...(column.width === undefined ? {} : { width: column.width }),
      ...(place < 0 ? {} : { drop: place + 1 }),
    };
  });
}

/**
 * Whether the hidden columns are exactly one of a list's default sets: the user never chose, or
 * chose it back.
 */
export function isDefaultSet(
  hidden: ReadonlySet<string>,
  ...defaults: readonly (readonly string[])[]
): boolean {
  return defaults.some(
    (keys) => hidden.size === keys.length && keys.every((key) => hidden.has(key)),
  );
}
