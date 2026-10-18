import type { TFunction } from 'i18next';
import type { ReactNode } from 'react';
import { TruncateCell } from '@/components/list';
import { TableCell, TableHead } from '@/components/ui/table';
import { cn } from '@/lib/utils';

/** A column of a partner list (`customer-columns`, `supplier-columns`) as its cells read it. */
export interface ListColumn<Row> {
  key: string;
  /** Money and counts: right-aligned in the head and the cells. */
  numeric?: boolean;
  /** Long text on one line with «…» and the whole text on hover; `fill` takes the spare width. */
  truncate?: { text: (row: Row, t: TFunction) => string; fill?: boolean };
  className?: string;
  cell: (row: Row, t: TFunction) => ReactNode;
}

/** A column's head, aligned like its cells. */
export function ListColumnHead(props: { numeric?: boolean | undefined; children: ReactNode }) {
  return (
    <TableHead className={props.numeric ? 'text-right' : undefined}>{props.children}</TableHead>
  );
}

/** One cell of a partner list: cut to one line with «…», or right-aligned for numbers (ADR-0066). */
export function ListColumnCell<Row>(props: { column: ListColumn<Row>; row: Row; t: TFunction }) {
  const { column, row, t } = props;
  return column.truncate ? (
    <TruncateCell
      text={column.truncate.text(row, t)}
      fill={column.truncate.fill}
      className={column.className}
    >
      {column.cell(row, t)}
    </TruncateCell>
  ) : (
    <TableCell className={cn(column.numeric && 'text-right font-mono', column.className)}>
      {column.cell(row, t)}
    </TableCell>
  );
}
