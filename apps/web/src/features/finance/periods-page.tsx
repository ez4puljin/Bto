import { addMonths, businessDate } from '@tugeel/shared/time';
import { CalendarCheck, History } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHasPermission } from '@/app/auth-context';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormField } from '@/components/form';
import { EmptyState, ListCard, SkeletonRows } from '@/components/list';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatUbDateTime } from '@/lib/dayjs';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { randomUuid } from '@/lib/uuid';
import {
  type FinancePeriod,
  type FinancePeriodEvent,
  useFinancePeriodEvents,
  useFinancePeriods,
  usePeriodMutations,
} from './api';
import { VoidDialog } from './void-dialog';

/** The month before this one, `YYYY-MM`: the one usually closed next. */
const previousMonth = (): string => addMonths(`${businessDate().slice(0, 7)}-01`, -1).slice(0, 7);

/**
 * «Сарын хаалт» (ADR-0102): the months of the books with their status, closing a month that has
 * ended and reopening the latest closed one with a reason; every close and reopen in the history.
 */
export function PeriodsPage() {
  const { t } = useTranslation();
  const canClose = useHasPermission('finance.periods.close');
  const canReopen = useHasPermission('finance.periods.reopen');
  const periods = useFinancePeriods();
  const events = useFinancePeriodEvents();
  const mutations = usePeriodMutations();
  const closeAction = useAction();
  const reopenAction = useAction();
  const [month, setMonth] = useState(previousMonth);
  const [confirming, setConfirming] = useState(false);
  const [reopening, setReopening] = useState<FinancePeriod | null>(null);
  const rows = periods.data ?? [];
  const latestClosed = rows.find((row) => row.status === 'CLOSED')?.code ?? null;

  const close = () =>
    void closeAction
      .run(async () => {
        await mutations.close.mutateAsync({ code: month, key: randomUuid() });
        toast.success(t('finance.periods.closed', { month }));
      })
      .then((ok) => {
        if (ok) setConfirming(false);
      });

  const reopen = (period: FinancePeriod, reason: string) =>
    void reopenAction
      .run(async () => {
        await mutations.reopen.mutateAsync({ code: period.code, key: randomUuid(), reason });
        toast.success(t('finance.periods.reopened', { month: period.code }));
      })
      .then((ok) => {
        if (ok) setReopening(null);
      });

  return (
    <div>
      <PageHeader
        title={t('finance.periods.title')}
        description={t('finance.periods.description')}
      />
      <ProblemAlert problem={problemFromError(periods.error)} />
      {canClose ? (
        <Card className="mb-3 gap-2">
          <CardHeader>
            <CardTitle>{t('finance.periods.closeCard')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-wrap items-end gap-2">
              <FormField label={t('finance.periods.month')} htmlFor="close-month">
                <Input
                  id="close-month"
                  type="month"
                  className="sm:w-44"
                  value={month}
                  max={previousMonth()}
                  onChange={(event) => setMonth(event.target.value)}
                />
              </FormField>
              <Button
                disabled={!/^\d{4}-\d{2}$/.test(month)}
                onClick={() => {
                  closeAction.clear();
                  setConfirming(true);
                }}
              >
                <CalendarCheck />
                {t('finance.periods.close')}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
      <ListCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('finance.periods.columns.month')}</TableHead>
              <TableHead>{t('finance.periods.columns.status')}</TableHead>
              <TableHead>{t('finance.periods.columns.last')}</TableHead>
              <TableHead className="w-10">
                <span className="sr-only">{t('common.actions')}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {periods.isPending ? <SkeletonRows columns={4} /> : null}
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-mono">{row.code}</TableCell>
                <TableCell>
                  <Badge variant={row.status === 'CLOSED' ? 'secondary' : 'outline'}>
                    {t(`finance.periods.statuses.${row.status}`)}
                  </Badge>
                </TableCell>
                <TableCell className="text-[13px] text-muted-foreground">
                  {row.lastEvent ? <EventText event={row.lastEvent} /> : null}
                </TableCell>
                <TableCell>
                  {canReopen && row.code === latestClosed ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        reopenAction.clear();
                        setReopening(row);
                      }}
                    >
                      {t('finance.periods.reopen')}
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!periods.isPending && rows.length === 0 ? (
          <EmptyState icon={CalendarCheck} title={t('finance.periods.empty')} />
        ) : null}
      </ListCard>
      <h2 className="mt-6 mb-2.5 text-[15px] leading-tight font-semibold tracking-tight">
        {t('finance.periods.history')}
      </h2>
      <ListCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('finance.periods.columns.at')}</TableHead>
              <TableHead>{t('finance.periods.columns.month')}</TableHead>
              <TableHead>{t('finance.periods.columns.action')}</TableHead>
              <TableHead>{t('finance.periods.columns.who')}</TableHead>
              <TableHead>{t('finance.periods.columns.reason')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.isPending ? <SkeletonRows columns={5} /> : null}
            {(events.data ?? []).map((event) => (
              <TableRow key={event.id}>
                <TableCell className="font-mono">
                  {formatUbDateTime(Date.parse(event.createdAt))}
                </TableCell>
                <TableCell className="font-mono">{event.period}</TableCell>
                <TableCell>{t(`finance.periods.actions.${event.action}`)}</TableCell>
                <TableCell>{event.actorLabel}</TableCell>
                <TableCell>{event.reason ?? ''}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!events.isPending && (events.data ?? []).length === 0 ? (
          <EmptyState icon={History} title={t('finance.periods.historyEmpty')} />
        ) : null}
      </ListCard>
      <ConfirmDialog
        open={confirming}
        title={t('finance.periods.closeTitle', { month })}
        description={t('finance.periods.closeDescription')}
        confirmLabel={t('finance.periods.close')}
        variant="default"
        pending={mutations.close.isPending}
        problem={closeAction.problem}
        onConfirm={close}
        onClose={() => setConfirming(false)}
      />
      {reopening ? (
        <VoidDialog
          open
          title={t('finance.periods.reopenTitle', { month: reopening.code })}
          description={t('finance.periods.reopenDescription')}
          pending={mutations.reopen.isPending}
          problem={reopenAction.problem}
          submitLabel={t('finance.periods.reopen')}
          variant="default"
          onClose={() => setReopening(null)}
          onConfirm={(reason) => reopen(reopening, reason)}
        />
      ) : null}
    </div>
  );
}

function EventText({ event }: { event: FinancePeriodEvent }) {
  const { t } = useTranslation();
  const parts = [
    t(`finance.periods.actions.${event.action}`),
    event.actorLabel,
    formatUbDateTime(Date.parse(event.createdAt)),
    ...(event.reason ? [event.reason] : []),
  ];
  return <>{parts.join(' · ')}</>;
}
