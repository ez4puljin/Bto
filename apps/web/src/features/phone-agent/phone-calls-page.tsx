import { Phone } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import {
  DateFilter,
  EmptyState,
  FilterBar,
  FilterToggle,
  LinkRow,
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
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ColumnSpec } from '@/lib/column-layout';
import { formatUbMinute } from '@/lib/dayjs';
import { problemFromError } from '@/lib/problem';
import { useSetParam } from '@/lib/search-params';
import { callerOf, formatDuration, narrowCalls, OUTCOME_TONE, OUTCOMES } from './call-format';
import { usePhoneCalls, usePhoneNoHits } from './phone-agent-api';

const TABS = ['calls', 'noHits'] as const;
type Tab = (typeof TABS)[number];

const CALL_COLUMNS: readonly ColumnSpec[] = [
  { key: 'startedAt', kind: 'datetime', width: 10 },
  { key: 'caller', kind: 'code', width: 9.5 },
  { key: 'customer', kind: 'text', weight: 3, min: 9 },
  { key: 'outcome', kind: 'status', width: 9 },
  { key: 'order', kind: 'code', width: 8, drop: 1 },
  { key: 'duration', kind: 'code', width: 5, drop: 2 },
  { key: 'spacer', kind: 'spacer' },
  { key: 'chevron', kind: 'chevron' },
];

const HIT_COLUMNS: readonly ColumnSpec[] = [
  { key: 'createdAt', kind: 'datetime', width: 10 },
  { key: 'query', kind: 'text', weight: 3, min: 12 },
  { key: 'spacer', kind: 'spacer' },
];

/**
 * «Борлуулалт → Утасны дуудлага» (ADR-0232): the calls the phone AI line answered or declined,
 * newest first, and the searches the caller made that found nothing. A row opens its conversation.
 */
export function PhoneCallsPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const setParam = useSetParam();
  const tab: Tab = params.get('tab') === 'noHits' ? 'noHits' : 'calls';
  return (
    <>
      <PageHeader title={t('phoneAgent.calls.title')} />
      <FilterBar>
        <SegmentedControl
          options={TABS}
          value={tab}
          label={(value) => t(`phoneAgent.calls.tabs.${value}`)}
          onChange={(value) => setParam('tab', value === 'calls' ? null : value)}
        />
      </FilterBar>
      {tab === 'calls' ? <CallsList /> : <NoHitsList />}
    </>
  );
}

function CallsList() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const setParam = useSetParam();
  const outcomeParam = params.get('outcome');
  const outcome = OUTCOMES.find((value) => value === outcomeParam);
  const from = params.get('from') ?? undefined;
  const to = params.get('to') ?? undefined;
  const hasOrder = params.get('order') === '1';
  const calls = usePhoneCalls({ outcome });
  const rows = narrowCalls(calls.data?.pages.flatMap((page) => page.data) ?? [], {
    from,
    to,
    hasOrder,
  });
  const none = <span className="text-muted-foreground">{t('phoneAgent.calls.none')}</span>;
  return (
    <>
      <FilterBar>
        <DateFilter
          label={t('phoneAgent.calls.from')}
          value={from}
          onChange={(value) => setParam('from', value ?? null)}
        />
        <DateFilter
          label={t('phoneAgent.calls.to')}
          value={to}
          onChange={(value) => setParam('to', value ?? null)}
        />
        <NativeSelect
          variant="filter"
          aria-label={t('phoneAgent.calls.outcome')}
          value={outcome ?? ''}
          onChange={(event) => setParam('outcome', event.target.value)}
        >
          <option value="">{t('phoneAgent.calls.allOutcomes')}</option>
          {OUTCOMES.map((value) => (
            <option key={value} value={value}>
              {t(`phoneAgent.outcomes.${value}`)}
            </option>
          ))}
        </NativeSelect>
        <FilterToggle
          label={t('phoneAgent.calls.hasOrder')}
          checked={hasOrder}
          onCheckedChange={(checked) => setParam('order', checked ? '1' : null)}
        />
      </FilterBar>
      <ProblemAlert problem={problemFromError(calls.error)} onRetry={calls.refetch} />
      <ListCard scroll>
        <ListTable columns={CALL_COLUMNS}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('phoneAgent.calls.fields.startedAt')}</TableHead>
              <TableHead>{t('phoneAgent.calls.fields.caller')}</TableHead>
              <TableHead>{t('phoneAgent.calls.fields.customer')}</TableHead>
              <TableHead>{t('phoneAgent.calls.fields.outcome')}</TableHead>
              <TableHead>{t('phoneAgent.calls.fields.order')}</TableHead>
              <TableHead>{t('phoneAgent.calls.fields.duration')}</TableHead>
              <SpacerHead />
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {calls.isPending ? <SkeletonRows columns={8} /> : null}
            {rows.map((call) => (
              <LinkRow key={call.id} to={`/sales/phone-calls/${call.id}`}>
                <TableCell className="font-mono">{formatUbMinute(call.startedAt)}</TableCell>
                <TableCell className="font-mono">{callerOf(call) ?? none}</TableCell>
                <TruncateCell text={call.customerName ?? t('phoneAgent.calls.unknown')} />
                <TableCell>
                  {call.outcome ? (
                    <Badge variant={OUTCOME_TONE[call.outcome]}>
                      {t(`phoneAgent.outcomes.${call.outcome}`)}
                    </Badge>
                  ) : (
                    <Badge variant="outline">
                      {t(`phoneAgent.declineReasons.${call.declineReason ?? 'NONE'}`)}
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="font-mono">
                  {call.salesOrderId !== null ? (
                    <Link className="text-link" to={`/sales/orders/${call.salesOrderId}`}>
                      {call.orderNumber}
                    </Link>
                  ) : (
                    none
                  )}
                </TableCell>
                <TableCell className="font-mono">
                  {call.durationS !== null ? formatDuration(call.durationS) : none}
                </TableCell>
                <SpacerCell />
              </LinkRow>
            ))}
          </TableBody>
        </ListTable>
        {!calls.isPending && rows.length === 0 ? (
          <EmptyState icon={Phone} title={t('phoneAgent.calls.empty')} />
        ) : null}
        <LoadMore query={calls} />
      </ListCard>
    </>
  );
}

function NoHitsList() {
  const { t } = useTranslation();
  const hits = usePhoneNoHits();
  const rows = hits.data?.pages.flatMap((page) => page.data) ?? [];
  return (
    <>
      <ProblemAlert problem={problemFromError(hits.error)} onRetry={hits.refetch} />
      <ListCard scroll>
        <ListTable columns={HIT_COLUMNS}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('phoneAgent.calls.fields.startedAt')}</TableHead>
              <TableHead>{t('phoneAgent.calls.fields.query')}</TableHead>
              <SpacerHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {hits.isPending ? <SkeletonRows columns={3} /> : null}
            {rows.map((hit) => (
              <TableRow key={`${hit.callId}-${hit.seq}`}>
                <TableCell className="font-mono">{formatUbMinute(hit.createdAt)}</TableCell>
                <TruncateCell text={hit.query} />
                <SpacerCell />
              </TableRow>
            ))}
          </TableBody>
        </ListTable>
        {!hits.isPending && rows.length === 0 ? (
          <EmptyState icon={Phone} title={t('phoneAgent.calls.noHitsEmpty')} />
        ) : null}
        <LoadMore query={hits} />
      </ListCard>
    </>
  );
}
