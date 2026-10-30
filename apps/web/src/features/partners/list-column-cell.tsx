import type { TFunction } from 'i18next';
import type { ReactNode } from 'react';
import { TruncateCell } from '@/components/list';
import { TableCell, TableHead } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type { ListColumn } from './list-columns';

// The column descriptor and its layout helper live in `list-columns.ts` (no components there).
export type { ListColumn } from './list-columns';

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
