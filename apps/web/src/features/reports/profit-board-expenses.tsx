import { Decimal } from '@tugeel/shared/money';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState, SkeletonRows } from '@/components/list';
import { ProblemAlert } from '@/components/problem-alert';
import { FactChips, PanelSection, RecordSheet } from '@/components/record-sheet';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatTugrik } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { cn } from '@/lib/utils';
import {
  type ProfitBoardExpenseRow,
  type ProfitBoardExpenses,
  type ProfitBoardExpenseTarget,
  type ProfitBoardFilter,
  useProfitBoardExpenseEntries,
} from './api';
import { ExpenseShareChart } from './profit-board-charts';
import { NONE, percentChange } from './report-helpers';
import { AmountCell, ROW_NAME } from './report-kit';

/** A row the entries sheet is opened for. */
export interface OpenExpense {
  target: ProfitBoardExpenseTarget;
  label: string;
  amount: string;
}

/** A level of the tree further in (group → sub-group → account). */
const INDENT = ['', 'pl-5', 'pl-10', 'pl-15'] as const;

const rowKey = (row: ProfitBoardExpenseRow) => `${row.kind}:${row.id ?? ''}`;

/** What a row of the expense tree reads as: «701004 Түрээсийн зардал», a group, «Бүлэггүй данс». */
function useExpenseLabel() {
  const { t } = useTranslation();
  return (row: ProfitBoardExpenseRow): string => {
    if (row.kind === 'NONE') return t('reports.board.expenses.noGroup');
    if (row.kind === 'ACCOUNT') return [row.code, row.name].filter(Boolean).join(' ');
    return row.name ?? row.code ?? t('reports.common.noName');
  };
}

/** The change against the period before: «▲ 12.5%», muted (a rise of costs is neither good nor bad). */
function Change(props: { current: string; previous: string }) {
  const { t } = useTranslation();
  const change = percentChange(props.current, props.previous);
  const sign = change === null || change.isZero() ? 0 : change.gt(0) ? 1 : -1;
  return (
    <TableCell className="text-right font-mono whitespace-nowrap text-muted-foreground">
      {sign > 0 ? (
        <span aria-hidden>{'▲ '}</span>
      ) : sign < 0 ? (
        <span aria-hidden>{'▼ '}</span>
      ) : null}
      {sign !== 0 ? (
        <span className="sr-only">{`${t(sign > 0 ? 'reports.common.up' : 'reports.common.down')} `}</span>
      ) : null}
      {change === null ? NONE : `${change.abs().toFixed(1)}%`}
    </TableCell>
  );
}

function ExpenseTable(props: {
  expenses: ProfitBoardExpenses;
  onOpen: (open: OpenExpense) => void;
}) {
  const { t } = useTranslation();
  const labelOf = useExpenseLabel();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const columns = 'reports.board.expenses.columns';
  const { expenses } = props;
  const toggle = (key: string) =>
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const lines = (row: ProfitBoardExpenseRow, depth: number): ReactNode[] => {
    const key = rowKey(row);
    const label = labelOf(row);
    const open = expanded.has(key);
    const line = (
      <TableRow key={key} className={depth > 0 ? 'bg-accent/40' : undefined}>
        <TableCell className="max-w-80">
          <div className={cn('flex min-w-0 items-center gap-1', INDENT[Math.min(depth, 3)])}>
            {row.children.length > 0 ? (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-expanded={open}
                aria-label={`${open ? t('reports.board.expenses.collapse') : t('reports.board.expenses.expand')}: ${label}`}
                onClick={() => toggle(key)}
              >
                {open ? <ChevronDown /> : <ChevronRight />}
              </Button>
            ) : (
              <span className="inline-block w-7 shrink-0" aria-hidden />
            )}
            <button
              type="button"
              className={cn(
                ROW_NAME,
                'min-w-0 touch:min-h-11',
                row.kind !== 'ACCOUNT' && 'font-semibold',
              )}
              title={label}
              onClick={() =>
                props.onOpen({ target: { kind: row.kind, id: row.id }, label, amount: row.amount })
              }
            >
              {label}
            </button>
          </div>
        </TableCell>
        <AmountCell value={row.amount} />
        <TableCell className="text-right font-mono whitespace-nowrap">
          {row.share === null ? NONE : `${row.share}%`}
        </TableCell>
        <AmountCell value={row.previous} />
        <Change current={row.amount} previous={row.previous} />
      </TableRow>
    );
    return [line, ...(open ? row.children.flatMap((child) => lines(child, depth + 1)) : [])];
  };
  return (
    <div className="min-w-0 overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t(`${columns}.name`)}</TableHead>
            <TableHead className="text-right">{t(`${columns}.amount`)}</TableHead>
            <TableHead className="text-right">{t('reports.board.columns.share')}</TableHead>
            <TableHead className="text-right">{t(`${columns}.previous`)}</TableHead>
            <TableHead className="text-right">{t(`${columns}.change`)}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>{expenses.rows.flatMap((row) => lines(row, 0))}</TableBody>
        <TableFooter>
          <TableRow>
            <TableCell className="font-semibold">{t('reports.common.total')}</TableCell>
            <AmountCell value={expenses.total.current} className="font-semibold" />
            <TableCell />
            <AmountCell value={expenses.total.previous} className="font-semibold" />
            <Change current={expenses.total.current} previous={expenses.total.previous} />
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}

/**
 * «Урсгал зардал» (ADR-0238): the period's operating expenses from the books by the chart's groups,
 * a ring of the top-level groups beside the tree; a row opens its entries. With a branch chosen, the
 * branch-less expenses stand apart as «Нийтлэг зардал».
 */
export function ExpensesCard(props: {
  expenses: ProfitBoardExpenses;
  onOpen: (open: OpenExpense) => void;
}) {
  const { t } = useTranslation();
  const labelOf = useExpenseLabel();
  const { expenses } = props;
  const title = t('reports.board.expenses.title');
  const common = expenses.common;
  return (
    <Card role="region" aria-label={title} className="min-w-0 gap-3">
      <CardHeader className="gap-1">
        <CardTitle>{title}</CardTitle>
        <p className="text-[0.75rem] text-muted-foreground">{t('reports.board.expenses.hint')}</p>
      </CardHeader>
      <CardContent className="@container min-w-0 space-y-3">
        {expenses.rows.length === 0 ? (
          <EmptyState title={t('reports.board.expenses.empty')} />
        ) : (
          <div className="grid gap-4 @5xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <ExpenseShareChart
              label={`${title}: ${t('reports.board.expenses.chart')}`}
              slices={expenses.rows.map((row) => ({
                key: rowKey(row),
                label: labelOf(row),
                amount: row.amount,
                share: row.share,
              }))}
            />
            <ExpenseTable expenses={expenses} onOpen={props.onOpen} />
          </div>
        )}
        {common ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-fill px-3 py-2">
            <div className="min-w-0">
              <button
                type="button"
                className={cn(ROW_NAME, 'touch:min-h-11')}
                onClick={() =>
                  props.onOpen({
                    target: { kind: 'COMMON', id: null },
                    label: t('reports.board.expenses.common'),
                    amount: common.current,
                  })
                }
              >
                {t('reports.board.expenses.common')}
              </button>
              <p className="text-[0.75rem] text-muted-foreground">
                {t('reports.board.expenses.commonHint')}
              </p>
            </div>
            <span className="font-mono font-semibold">{formatTugrik(common.current)}</span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** The journal lines behind a row of the expenses, newest first. */
export function ExpenseEntriesSheet(props: {
  open: OpenExpense | null;
  filter: ProfitBoardFilter;
  range: { from: string; to: string } | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { open } = props;
  const entries = useProfitBoardExpenseEntries(props.filter, open ? open.target : null);
  const columns = 'reports.board.expenses.entries';
  const data = entries.data;
  return (
    <RecordSheet
      open={open !== null}
      onClose={props.onClose}
      title={open?.label ?? ''}
      description={
        props.range ? t('reports.common.range', { from: props.range.from, to: props.range.to }) : ''
      }
    >
      {open ? (
        <div className="flex flex-col gap-4">
          <FactChips
            facts={[{ label: t(`${columns}.amount`), value: formatTugrik(open.amount) }]}
          />
          <PanelSection title={t('reports.board.expenses.title')}>
            <ProblemAlert problem={problemFromError(entries.error)} onRetry={entries.refetch} />
            {data?.more ? (
              <p className="text-[0.8125rem] text-muted-foreground">{t(`${columns}.more`)}</p>
            ) : null}
            {data && data.rows.length === 0 ? (
              <EmptyState title={t(`${columns}.empty`)} />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t(`${columns}.date`)}</TableHead>
                      <TableHead>{t(`${columns}.number`)}</TableHead>
                      <TableHead>{t(`${columns}.description`)}</TableHead>
                      <TableHead>{t(`${columns}.account`)}</TableHead>
                      <TableHead>{t(`${columns}.party`)}</TableHead>
                      <TableHead className="text-right">{t(`${columns}.amount`)}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entries.isPending ? <SkeletonRows columns={6} rows={4} /> : null}
                    {data?.rows.map((row) => (
                      <TableRow key={row.lineId}>
                        <TableCell className="font-mono whitespace-nowrap">{row.date}</TableCell>
                        <TableCell className="font-mono whitespace-nowrap">{row.number}</TableCell>
                        <TableCell className="max-w-72">
                          <span className="block truncate" title={row.description ?? undefined}>
                            {row.description ?? NONE}
                          </span>
                        </TableCell>
                        <TableCell className="max-w-56">
                          <span
                            className="block truncate"
                            title={`${row.accountCode} ${row.accountName}`}
                          >
                            {`${row.accountCode} ${row.accountName}`}
                          </span>
                        </TableCell>
                        <TableCell className="max-w-48">
                          <span className="block truncate">{row.partyName ?? NONE}</span>
                        </TableCell>
                        <AmountCell
                          value={row.amount}
                          className={new Decimal(row.amount).lt(0) ? 'text-destructive' : undefined}
                        />
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </PanelSection>
        </div>
      ) : null}
    </RecordSheet>
  );
}
