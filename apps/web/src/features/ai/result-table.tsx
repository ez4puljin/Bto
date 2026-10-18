import { useTranslation } from 'react-i18next';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type { AiResult } from './api';
import { cellText } from './result-format';

/**
 * The frame is the table's only scroller, both ways (as in a scrolling ListCard): the table's own
 * sideways box stops scrolling, so the header cells stick to the frame's top.
 */
const FRAME =
  'overflow-auto rounded-lg border [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin] [&_[data-slot=table-container]]:overflow-visible [&_[data-slot=table-head]]:sticky [&_[data-slot=table-head]]:top-0 [&_[data-slot=table-head]]:z-10 [&_[data-slot=table-head]]:bg-card [&_[data-slot=table-head]]:shadow-[inset_0_-1px_0_var(--color-border)]';

/**
 * The rows of an answer or a report: the column names as the query labelled them, numbers to the
 * right with grouped thousands, a note when only the first rows are shown. Scrolls inside its own
 * frame, header kept in view; `tall` (a report's side panel) lets the frame take the window's
 * height.
 */
export function ResultTable({
  result,
  label,
  tall,
}: {
  result: AiResult;
  label: string;
  tall?: boolean;
}) {
  const { t } = useTranslation();
  if (result.rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('ai.answer.noRows')}</p>;
  }
  return (
    <div className="space-y-2">
      <div className={cn(FRAME, tall ? 'max-h-[max(20rem,calc(100svh-15rem))]' : 'max-h-[28rem]')}>
        <Table aria-label={label}>
          <TableHeader>
            <TableRow>
              {result.columns.map((column, index) => (
                <TableHead
                  key={`${column.name}-${index}`}
                  className={cn('whitespace-nowrap', column.kind === 'number' && 'text-right')}
                >
                  {column.name}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.rows.map((row, rowIndex) => (
              <TableRow key={rowIndex}>
                {row.map((value, index) => {
                  const kind = result.columns[index]?.kind ?? 'text';
                  return (
                    <TableCell
                      key={index}
                      className={cn(
                        'max-w-[24rem] truncate',
                        kind === 'number' && 'text-right tabular-nums',
                      )}
                      title={value ?? undefined}
                    >
                      {cellText(value, kind, t)}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">
        {result.truncated
          ? t('ai.answer.truncated', { count: result.rows.length })
          : t('ai.answer.rows', { count: result.rows.length })}
      </p>
    </div>
  );
}
