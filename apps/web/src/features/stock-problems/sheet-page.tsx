import { stockProblemOutcome } from '@tugeel/shared';
import { Printer } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { ListCard, ListTable, TruncateCell } from '@/components/list';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ColumnSpec } from '@/lib/column-layout';
import { formatUbMinute } from '@/lib/dayjs';
import { formatQty } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { cn } from '@/lib/utils';
import { randomUuid } from '@/lib/uuid';
import {
  type StockProblemSheetDetail,
  type StockProblemSheetLine,
  useStockProblemMutations,
  useStockProblemSheet,
} from './api';
import { hasQty, SHEETS_ROOT, sheetPrintPath } from './helpers';
import { SheetStatusBadge } from './sheet-status';

const COLUMNS: readonly ColumnSpec[] = [
  { key: 'bin', kind: 'code', width: 6 },
  { key: 'product', kind: 'text', weight: 2, min: 12 },
  { key: 'system', kind: 'qty', width: 7 },
  { key: 'red', kind: 'qty', width: 7 },
  { key: 'cut', kind: 'qty', width: 7 },
  { key: 'counted', kind: 'qty', width: 7 },
  { key: 'difference', kind: 'qty', width: 7 },
  { key: 'result', kind: 'status', width: 8.5 },
  { key: 'who', kind: 'text', weight: 1, drop: 1 },
];

/** One morning sheet (ADR-0230 §5): its lines in shelf order, the approval and the way to print. */
export function StockProblemSheetPage() {
  const { t } = useTranslation();
  const id = Number.parseInt(useParams().id ?? '', 10);
  const canManage = useHasPermission('stockProblems.manage');
  const sheet = useStockProblemSheet(id);
  const [approving, setApproving] = useState(false);
  const loadProblem = problemFromError(sheet.error);
  if (loadProblem) return <ProblemAlert problem={loadProblem} onRetry={sheet.refetch} />;
  const detail = sheet.data;
  if (!detail) return <p className="text-sm text-muted-foreground">{t('common.loading')}</p>;
  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title={t('stockProblems.sheets.title', { date: detail.sheetDate })}
        crumbs={[{ label: t('stockProblems.title'), to: `${SHEETS_ROOT}?tab=sheets` }]}
        meta={
          <>
            <SheetStatusBadge status={detail.status} />
            <span className="text-foreground">{detail.warehouseName}</span>
            <span>
              {t('stockProblems.sheets.progress', {
                counted: detail.countedCount,
                lines: detail.lineCount,
              })}
            </span>
            <span>
              {t('stockProblems.sheets.builtLine', {
                who: detail.builtByName ?? t('stockProblems.sheets.job'),
                at: formatUbMinute(detail.builtAt),
              })}
            </span>
            {detail.approvedAt ? (
              <span>
                {t('stockProblems.sheets.approvedLine', {
                  who: detail.approvedByName ?? '',
                  at: formatUbMinute(detail.approvedAt),
                })}
              </span>
            ) : null}
          </>
        }
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to={sheetPrintPath(detail.id)} target="_blank">
                <Printer />
                {t('stockProblems.sheets.print')}
              </Link>
            </Button>
            {canManage && detail.status === 'OPEN' ? (
              <Button onClick={() => setApproving(true)}>
                {t('stockProblems.sheets.approve')}
              </Button>
            ) : null}
          </>
        }
      />
      {detail.issueId || detail.adjustmentId ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-card p-3 text-sm shadow-card ring-1 ring-black/[0.06]">
          <span className="text-muted-foreground">{t('stockProblems.sheets.links')}:</span>
          {detail.issueId ? (
            <Link
              to={`/inventory/issues/${detail.issueId}`}
              className="font-medium text-link underline-offset-4 hover:underline"
            >
              {t('stockProblems.sheets.issue')} №{detail.issueId}
            </Link>
          ) : null}
          {detail.adjustmentId ? (
            <Link
              to={`/inventory/adjustments/${detail.adjustmentId}`}
              className="font-medium text-link underline-offset-4 hover:underline"
            >
              {t('stockProblems.sheets.adjustment')} №{detail.adjustmentId}
            </Link>
          ) : null}
        </div>
      ) : null}
      <LinesTable lines={detail.lines} />
      <Dialog open={approving} onOpenChange={setApproving}>
        {approving ? <ApproveDialog sheet={detail} onDone={() => setApproving(false)} /> : null}
      </Dialog>
    </div>
  );
}

const RESULT_TONE = {
  EQUAL: 'text-muted-foreground',
  SHORTAGE: 'text-destructive',
  SURPLUS: 'text-success',
} as const;

function LinesTable({ lines }: { lines: readonly StockProblemSheetLine[] }) {
  const { t } = useTranslation();
  return (
    <ListCard scroll>
      <ListTable columns={COLUMNS}>
        <TableHeader>
          <TableRow>
            <TableHead>{t('stockProblems.sheets.lineColumns.bin')}</TableHead>
            <TableHead>{t('stockProblems.sheets.lineColumns.product')}</TableHead>
            <TableHead className="text-right">
              {t('stockProblems.sheets.lineColumns.system')}
            </TableHead>
            <TableHead className="text-right">
              {t('stockProblems.sheets.lineColumns.red')}
            </TableHead>
            <TableHead className="text-right">
              {t('stockProblems.sheets.lineColumns.cut')}
            </TableHead>
            <TableHead className="text-right">
              {t('stockProblems.sheets.lineColumns.counted')}
            </TableHead>
            <TableHead className="text-right">
              {t('stockProblems.sheets.lineColumns.difference')}
            </TableHead>
            <TableHead>{t('stockProblems.sheets.lineColumns.result')}</TableHead>
            <TableHead>{t('stockProblems.sheets.lineColumns.who')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((line) => {
            const outcome =
              line.outcome ??
              (line.difference === null ? null : stockProblemOutcome(line.difference));
            return (
              <TableRow key={line.id}>
                <TableCell className="font-mono">{line.binCode ?? t('common.none')}</TableCell>
                <TruncateCell text={`${line.product.sku} · ${line.product.name}`}>
                  <span className="font-mono text-xs text-muted-foreground">
                    {line.product.sku}
                  </span>{' '}
                  <span className="font-medium">{line.product.name}</span>
                </TruncateCell>
                <TableCell className="text-right font-mono">{formatQty(line.systemQty)}</TableCell>
                <TableCell
                  className={cn('text-right font-mono', hasQty(line.redQty) && 'text-destructive')}
                >
                  {hasQty(line.redQty) ? formatQty(line.redQty) : ''}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {hasQty(line.cutQty) ? formatQty(line.cutQty) : ''}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {line.countedQty === null ? '' : formatQty(line.countedQty)}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {line.difference === null ? '' : formatQty(line.difference)}
                </TableCell>
                <TableCell className={cn(outcome && RESULT_TONE[outcome])}>
                  {outcome
                    ? t(`stockProblems.sheets.result.${outcome}`)
                    : t('stockProblems.sheets.notCounted')}
                </TableCell>
                <TruncateCell
                  text={
                    line.countedAt
                      ? `${line.countedByName ?? ''} ${formatUbMinute(line.countedAt)}`.trim()
                      : ''
                  }
                />
              </TableRow>
            );
          })}
        </TableBody>
      </ListTable>
    </ListCard>
  );
}

/** «Батлах»; an uncounted line is told first, then «Зөвхөн тоолсныг батлах» is offered. */
function ApproveDialog({ sheet, onDone }: { sheet: StockProblemSheetDetail; onDone: () => void }) {
  const { t } = useTranslation();
  const mutations = useStockProblemMutations();
  const action = useAction();
  const [key] = useState(randomUuid);
  const [countedKey] = useState(randomUuid);
  const uncounted =
    action.problem?.code === 'CONFLICT' && action.problem.params?.reason === 'SHEET_LINES_UNCOUNTED'
      ? Number(action.problem.params.count ?? sheet.lineCount - sheet.countedCount)
      : null;
  const missing = action.problem?.code === 'SETTING_MISSING';
  const run = (countedOnly: boolean) =>
    void action.run(async () => {
      await mutations.approve.mutateAsync({
        key: countedOnly ? countedKey : key,
        id: sheet.id,
        countedOnly,
      });
      toast.success(t('stockProblems.sheets.approved'));
      onDone();
    });
  return (
    <DialogContent closeLabel={t('common.close')}>
      <DialogHeader>
        <DialogTitle>{t('stockProblems.sheets.approveTitle')}</DialogTitle>
        <DialogDescription>{t('stockProblems.sheets.approveText')}</DialogDescription>
      </DialogHeader>
      {uncounted !== null ? (
        <p role="alert" className="rounded-lg bg-warning-soft p-3 text-sm text-warning">
          {t('stockProblems.sheets.approveUncounted', { count: uncounted })}
        </p>
      ) : missing ? (
        <p role="alert" className="rounded-lg bg-danger-soft p-3 text-sm text-destructive">
          {t('stockProblems.sheets.settingMissing')}
        </p>
      ) : (
        <ProblemAlert problem={action.problem} />
      )}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          {t('common.cancel')}
        </Button>
        {uncounted !== null ? (
          <Button type="button" disabled={mutations.approve.isPending} onClick={() => run(true)}>
            {t('stockProblems.sheets.countedOnly')}
          </Button>
        ) : (
          <Button type="button" disabled={mutations.approve.isPending} onClick={() => run(false)}>
            {t('stockProblems.sheets.approve')}
          </Button>
        )}
      </DialogFooter>
    </DialogContent>
  );
}
