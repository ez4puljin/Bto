import { ChevronDown, ChevronRight, FileSearch } from 'lucide-react';
import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { EmptyState, ListCard, ListTable, SkeletonRows, TruncateCell } from '@/components/list';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ColumnSpec } from '@/lib/column-layout';
import { formatUbMinute } from '@/lib/dayjs';
import { formatQty } from '@/lib/money';
import { cn } from '@/lib/utils';
import type { StockProblem, StockProblemEvent, StockProblemPending } from './api';
import { balanceReportHref, hasQty, sheetPath } from './helpers';

const COLUMNS: readonly ColumnSpec[] = [
  { key: 'expand', kind: 'icon', width: 2.5 },
  { key: 'product', kind: 'text', weight: 2, min: 12 },
  { key: 'onHand', kind: 'qty', width: 7 },
  { key: 'red', kind: 'qty', width: 7 },
  { key: 'cut', kind: 'qty', width: 7 },
  { key: 'last', kind: 'datetime', width: 10, drop: 1 },
  { key: 'actions', kind: 'actions', width: 22 },
];

export type RowAction = 'legit' | 'zeroOut';

export function ProblemList(props: {
  rows: readonly StockProblem[] | undefined;
  pending: boolean;
  canManage: boolean;
  onAction: (row: StockProblem, action: RowAction) => void;
}) {
  const { t } = useTranslation();
  const canReports = useHasPermission('reports.view');
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
  const toggle = (id: number) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <ListCard scroll>
      <ListTable columns={COLUMNS}>
        <TableHeader>
          <TableRow>
            <TableHead aria-hidden />
            <TableHead>{t('stockProblems.page.columns.product')}</TableHead>
            <TableHead className="text-right">{t('stockProblems.page.columns.onHand')}</TableHead>
            <TableHead className="text-right text-destructive">
              {t('stockProblems.group.RED')}
            </TableHead>
            <TableHead className="text-right">{t('stockProblems.group.CUT')}</TableHead>
            <TableHead>{t('stockProblems.page.columns.last')}</TableHead>
            <TableHead className="text-right">{t('stockProblems.page.columns.actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.pending ? <SkeletonRows columns={7} /> : null}
          {(props.rows ?? []).map((row) => {
            const expanded = open.has(row.product.id);
            const red = hasQty(row.redQty);
            return (
              <Fragment key={row.product.id}>
                <TableRow
                  data-testid="problem-row"
                  className={cn(red && 'bg-danger-soft/50 text-destructive')}
                >
                  <TableCell>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-expanded={expanded}
                      aria-label={t('stockProblems.page.expand', { name: row.product.name })}
                      onClick={() => toggle(row.product.id)}
                    >
                      {expanded ? <ChevronDown /> : <ChevronRight />}
                    </Button>
                  </TableCell>
                  <TruncateCell text={`${row.product.sku} · ${row.product.name}`}>
                    <span className="font-mono text-xs text-muted-foreground">
                      {row.product.sku}
                    </span>{' '}
                    <span className="font-medium">{row.product.name}</span>
                  </TruncateCell>
                  <TableCell className="text-right font-mono">{formatQty(row.onHand)}</TableCell>
                  <TableCell className="text-right font-mono">
                    {red ? formatQty(row.redQty) : ''}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {hasQty(row.cutQty) ? formatQty(row.cutQty) : ''}
                  </TableCell>
                  <TableCell className="font-mono">{formatUbMinute(row.lastEventAt)}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center justify-end gap-1">
                      {row.pending ? (
                        <PendingBadge pending={row.pending} />
                      ) : props.canManage ? (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => props.onAction(row, 'legit')}
                          >
                            {t('stockProblems.action.legit')}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => props.onAction(row, 'zeroOut')}
                          >
                            {t('stockProblems.action.zeroOut')}
                          </Button>
                        </>
                      ) : null}
                      {canReports ? (
                        <Button size="sm" variant="ghost" asChild>
                          <Link
                            to={balanceReportHref(
                              row.product.id,
                              row.warehouseId,
                              `${row.product.sku} - ${row.product.name}`,
                            )}
                          >
                            <FileSearch />
                            {t('stockProblems.page.report')}
                          </Link>
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
                {expanded ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={COLUMNS.length} className="bg-fill/40 whitespace-normal">
                      <Events events={row.events} />
                    </TableCell>
                  </TableRow>
                ) : null}
              </Fragment>
            );
          })}
        </TableBody>
      </ListTable>
      {!props.pending && (props.rows ?? []).length === 0 ? (
        <EmptyState title={t('stockProblems.page.empty')} />
      ) : null}
    </ListCard>
  );
}

/** «Хүлээгдэж буй» and the document the decision waits for. */
function PendingBadge({ pending }: { pending: StockProblemPending }) {
  const { t } = useTranslation();
  const link = pending.issueId
    ? {
        to: `/inventory/issues/${pending.issueId}`,
        label: t('stockProblems.page.pendingIssue', { id: pending.issueId }),
      }
    : pending.adjustmentId
      ? {
          to: `/inventory/adjustments/${pending.adjustmentId}`,
          label: t('stockProblems.page.pendingAdjustment', { id: pending.adjustmentId }),
        }
      : pending.sheetId
        ? {
            to: sheetPath(pending.sheetId),
            label: t('stockProblems.page.pendingSheet', { id: pending.sheetId }),
          }
        : null;
  return (
    <>
      <Badge variant="warning">{t('stockProblems.page.pending')}</Badge>
      {link ? (
        <Link to={link.to} className="text-link underline-offset-4 hover:underline">
          {link.label}
        </Link>
      ) : null}
    </>
  );
}

function Events({ events }: { events: readonly StockProblemEvent[] }) {
  const { t } = useTranslation();
  return (
    <ul className="flex flex-col gap-1.5 py-1 text-[0.8125rem]">
      {events.map((event, index) => {
        const red = event.kind === 'POS_SHORTFALL';
        return (
          <li
            key={`${event.kind}-${event.shortfallId ?? event.orderLineId ?? index}-${event.at}`}
            className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5"
          >
            <Badge variant={red ? 'destructive' : 'secondary'}>
              {t(red ? 'stockProblems.group.RED' : 'stockProblems.group.CUT')}
            </Badge>
            {event.kind === 'POS_SHORTFALL' ? (
              event.saleId ? (
                <Link
                  to={`/pos/sales?sale=${event.saleId}`}
                  className="font-medium text-link underline-offset-4 hover:underline"
                >
                  {t('stockProblems.page.event.sale', { number: event.saleNumber ?? event.saleId })}
                </Link>
              ) : null
            ) : (
              <>
                <span className="font-medium">
                  {t(`stockProblems.page.event.reason.${event.kind}`)}
                </span>
                {event.orderId ? (
                  <Link
                    to={`/sales/orders/${event.orderId}`}
                    className="font-medium text-link underline-offset-4 hover:underline"
                  >
                    {t('stockProblems.page.event.order', {
                      number: event.orderNumber ?? event.orderId,
                    })}
                  </Link>
                ) : null}
              </>
            )}
            <span className="font-mono text-muted-foreground">{formatUbMinute(event.at)}</span>
            {event.customerName ? (
              <span>
                {t('stockProblems.page.event.customer')}: {event.customerName}
              </span>
            ) : null}
            {event.repName ? (
              <span>
                {t('stockProblems.page.event.rep')}: {event.repName}
              </span>
            ) : null}
            {event.orderedQtyBase ? (
              <span>
                {t('stockProblems.page.event.ordered')}:{' '}
                <span className="font-mono">{formatQty(event.orderedQtyBase)}</span>
              </span>
            ) : null}
            <span>
              {t(red ? 'stockProblems.page.event.qty' : 'stockProblems.page.event.cutQty')}:{' '}
              <span className="font-mono">{formatQty(event.qtyBase)}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
