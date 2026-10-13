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
 * The rows of an answer or a report: the column names as the query labelled them, numbers to the
 * right with grouped thousands, a note when only the first rows are shown. Scrolls inside its own
 * frame, header kept in view.
 */
export function ResultTable({ result, label }: { result: AiResult; label: string }) {
  const { t } = useTranslation();
  if (result.rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('ai.answer.noRows')}</p>;
  }
  return (
    <div className="space-y-2">
      <div className="max-h-[28rem] overflow-auto rounded-lg border">
        <Table aria-label={label}>
          <TableHeader className="sticky top-0 z-10 bg-card">
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
