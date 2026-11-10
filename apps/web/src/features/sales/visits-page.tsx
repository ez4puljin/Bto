import { isoWeekdayOf, VISIT_RESULTS, type VisitResult } from '@tugeel/shared/sales';
import { businessDate } from '@tugeel/shared/time';
import { MapPinned, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import {
  DateFilter,
  EmptyState,
  FilterBar,
  ListCard,
  ListTable,
  LoadMore,
  SegmentedControl,
  SkeletonRows,
  SpacerCell,
  SpacerHead,
  TruncateCell,
} from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { PickedCustomer } from '@/features/partners/customer-picker';
import { CustomerSelect } from '@/features/partners/party-select';
import type { ColumnSpec } from '@/lib/column-layout';
import { formatUbDateTime } from '@/lib/dayjs';
import { formatCount } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { useSetParam } from '@/lib/search-params';
import {
  type RepPlanDay,
  useRepPlan,
  useReps,
  useRepVisits,
  useRepVisitSummary,
  useSetRepPlanDay,
} from './visits-api';

const TABS = ['plan', 'log'] as const;
type Tab = (typeof TABS)[number];

const RESULT_TONE: Record<VisitResult, 'success' | 'secondary' | 'warning' | 'default'> = {
  ORDERED: 'success',
  NO_ORDER: 'secondary',
  CLOSED: 'warning',
  PAYMENT: 'default',
};

const LOG_COLUMNS: readonly ColumnSpec[] = [
  { key: 'visitedAt', kind: 'datetime' },
  { key: 'rep', kind: 'text', weight: 2, min: 10 },
  { key: 'customer', kind: 'text', weight: 3, min: 14 },
  { key: 'result', kind: 'status' },
  { key: 'note', kind: 'text', weight: 3, min: 12 },
  { key: 'spacer', kind: 'spacer' },
];

/**
 * «Айлчлал» (ADR-0183): each rep's weekly round — the stores of every weekday, set here or by the
 * rep in the app — and the log of the visits they marked, with what each came to.
 */
export function RepVisitsPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const setParam = useSetParam();
  const tab: Tab = params.get('tab') === 'log' ? 'log' : 'plan';
  const reps = useReps();
  const repParam = Number.parseInt(params.get('rep') ?? '', 10) || undefined;
  const repId = repParam ?? (tab === 'plan' ? reps.data?.[0]?.id : undefined);
  const repSelect = (
    <NativeSelect
      variant="filter"
      aria-label={t('sales.visits.rep')}
      value={repId ?? ''}
      onChange={(event) => setParam('rep', event.target.value)}
    >
      {tab === 'log' ? <option value="">{t('sales.visits.allReps')}</option> : null}
      {(reps.data ?? []).map((rep) => (
        <option key={rep.id} value={rep.id}>
          {rep.fullName}
        </option>
      ))}
    </NativeSelect>
  );
  return (
    <>
      <PageHeader title={t('sales.visits.title')} />
      <FilterBar>
        <SegmentedControl
          options={TABS}
          value={tab}
          label={(value) => t(`sales.visits.tabs.${value}`)}
          onChange={(value) => setParam('tab', value === 'plan' ? null : value)}
        />
        {repSelect}
        {tab === 'log' ? (
          <div className="flex flex-wrap items-center gap-2">
            <DateFilter
              label={t('sales.visits.from')}
              value={params.get('from') ?? undefined}
              onChange={(value) => setParam('from', value ?? null)}
            />
            <DateFilter
              label={t('sales.visits.to')}
              value={params.get('to') ?? undefined}
              onChange={(value) => setParam('to', value ?? null)}
            />
          </div>
        ) : null}
      </FilterBar>
      <ProblemAlert problem={problemFromError(reps.error)} onRetry={reps.refetch} />
      {tab === 'plan' ? (
        reps.data && reps.data.length === 0 ? (
          <ListCard>
            <EmptyState icon={MapPinned} title={t('sales.visits.noReps')} />
          </ListCard>
        ) : (
          <PlanBoard userId={repId} />
        )
      ) : (
        <VisitLog
          userId={repParam}
          from={params.get('from') ?? undefined}
          to={params.get('to') ?? undefined}
        />
      )}
    </>
  );
}

/** A rep's seven days, each a card of stores with «add» below. */
function PlanBoard({ userId }: { userId: number | undefined }) {
  const { t } = useTranslation();
  const canEdit = useHasPermission('sales.orders.manage');
  const plan = useRepPlan(userId);
  const setDay = useSetRepPlanDay();
  const today = isoWeekdayOf(businessDate());
  const save = (day: RepPlanDay, customerIds: number[]) => {
    if (userId === undefined) return;
    setDay.mutate({ userId, weekday: day.weekday, customerIds });
  };
  return (
    <>
      <ProblemAlert problem={problemFromError(plan.error)} onRetry={plan.refetch} />
      <ProblemAlert problem={problemFromError(setDay.error)} />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {(plan.data ?? []).map((day) => (
          <Card key={day.weekday}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {t(`sales.visits.weekdays.${day.weekday as 1 | 2 | 3 | 4 | 5 | 6 | 7}`)}
                {day.weekday === today ? <Badge>{t('sales.visits.today')}</Badge> : null}
                <span className="ml-auto text-[0.8125rem] font-normal text-muted-foreground tabular-nums">
                  {t('sales.visits.stores', { count: formatCount(day.customers.length) })}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {day.customers.length === 0 ? (
                <p className="text-[0.8125rem] text-muted-foreground">
                  {t('sales.visits.emptyDay')}
                </p>
              ) : (
                <ol className="flex flex-col divide-y divide-border/70">
                  {day.customers.map((customer, index) => (
                    <li key={customer.customerId} className="flex items-start gap-2 py-1.5">
                      <span className="w-5 pt-0.5 text-right text-[0.75rem] text-muted-foreground tabular-nums">
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{customer.name}</span>
                        <span className="block truncate text-[0.75rem] text-muted-foreground">
                          {customer.address ?? customer.code}
                        </span>
                      </span>
                      {canEdit ? (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t('sales.visits.remove', { name: customer.name })}
                          disabled={setDay.isPending}
                          onClick={() =>
                            save(
                              day,
                              day.customers
                                .filter((other) => other.customerId !== customer.customerId)
                                .map((other) => other.customerId),
                            )
                          }
                        >
                          <X />
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ol>
              )}
              {canEdit ? (
                <AddStore
                  id={`plan-add-${day.weekday}`}
                  onAdd={(customer) =>
                    save(day, [
                      ...day.customers
                        .map((other) => other.customerId)
                        .filter((id) => id !== customer.id),
                      customer.id,
                    ])
                  }
                />
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}

/** A store typed into a day: taken at once, the field empties for the next. */
function AddStore(props: { id: string; onAdd: (customer: PickedCustomer) => void }) {
  const [turn, setTurn] = useState(0);
  return (
    <CustomerSelect
      key={turn}
      id={props.id}
      value={null}
      onChange={(customer) => {
        if (!customer) return;
        props.onAdd(customer);
        setTurn((value) => value + 1);
      }}
    />
  );
}

function VisitLog(filter: { userId: number | undefined; from?: string; to?: string }) {
  const { t } = useTranslation();
  const visits = useRepVisits(filter);
  const summary = useRepVisitSummary(filter);
  const rows = visits.data?.pages.flatMap((page) => page.data) ?? [];
  const totals = VISIT_RESULTS.map((result) => ({
    result,
    visits: (summary.data ?? [])
      .filter((row) => row.result === result)
      .reduce((sum, row) => sum + row.visits, 0),
  }));
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {totals.map((total) => (
          <Badge key={total.result} variant={RESULT_TONE[total.result]}>
            {t('sales.visits.resultCount', {
              result: t(`sales.visits.results.${total.result}`),
              count: formatCount(total.visits),
            })}
          </Badge>
        ))}
      </div>
      <ProblemAlert problem={problemFromError(visits.error)} onRetry={visits.refetch} />
      <ListCard scroll>
        <ListTable columns={LOG_COLUMNS}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('sales.visits.columns.visitedAt')}</TableHead>
              <TableHead>{t('sales.visits.rep')}</TableHead>
              <TableHead>{t('sales.visits.columns.customer')}</TableHead>
              <TableHead>{t('sales.visits.columns.result')}</TableHead>
              <TableHead>{t('sales.visits.columns.note')}</TableHead>
              <SpacerHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {visits.isPending ? <SkeletonRows columns={6} /> : null}
            {rows.map((visit) => (
              <TableRow key={visit.id}>
                <TableCell className="font-mono">
                  {formatUbDateTime(Date.parse(visit.visitedAt))}
                </TableCell>
                <TruncateCell text={visit.userName}>{visit.userName}</TruncateCell>
                <TruncateCell text={visit.customer.name}>{visit.customer.name}</TruncateCell>
                <TableCell>
                  <Badge variant={RESULT_TONE[visit.result]}>
                    {t(`sales.visits.results.${visit.result}`)}
                  </Badge>
                </TableCell>
                <TruncateCell text={visit.note ?? ''}>{visit.note ?? ''}</TruncateCell>
                <SpacerCell />
              </TableRow>
            ))}
          </TableBody>
        </ListTable>
        {!visits.isPending && rows.length === 0 ? (
          <EmptyState icon={MapPinned} title={t('sales.visits.emptyLog')} />
        ) : null}
        <LoadMore query={visits} />
      </ListCard>
    </>
  );
}
