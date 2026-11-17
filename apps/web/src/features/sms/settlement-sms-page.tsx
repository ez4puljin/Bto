import { SETTLEMENT_GROUPS, type SettlementGroup, isSettlementGroup } from '@tugeel/shared/finance';
import { Decimal } from '@tugeel/shared/money';
import { MessageSquareText, Send } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import {
  EmptyState,
  FilterBar,
  FilterToggle,
  ListCard,
  ListTable,
  SearchField,
  SegmentedControl,
  SkeletonRows,
  TruncateCell,
} from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ColumnSpec } from '@/lib/column-layout';
import { formatUbMinute } from '@/lib/dayjs';
import { formatCount, formatTugrik } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { useSetParam } from '@/lib/search-params';
import { type SettlementSmsCustomer, useSettlementSmsCustomers, useSmsStatus } from './api';
import { SmsHistory } from './sms-history';
import { SmsSendDialog } from './sms-send-dialog';
import { useSmsReason } from './sms-text';

const VIEWS = ['customers', 'history'] as const;
type View = (typeof VIEWS)[number];

/**
 * The list's columns (ADR-0119): the tick, the code, the name, the phone, the balance and the last
 * SMS. The last SMS goes first when the table is narrow (a tablet upright); the rest is what a row
 * is read for.
 */
const COLUMNS: readonly ColumnSpec[] = [
  { key: 'check', kind: 'check' },
  { key: 'code', kind: 'code' },
  { key: 'name', kind: 'text', weight: 3, min: 10 },
  { key: 'phone', kind: 'code', width: 8 },
  { key: 'balance', kind: 'money', width: 9.5 },
  { key: 'lastSent', kind: 'datetime', width: 10, drop: 1 },
];

/**
 * «Санхүү → Тооцооны SMS» (ADR-0216): a settlement group's customers with their phone and
 * balance; the ticked ones get one text each, rendered with their own name and balance, through
 * WeSend. «Түүх» lists what was sent. A code or a name opens the customer's ledger for the current
 * settlement period.
 */
export function SettlementSmsPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const setParam = useSetParam();
  const view: View = params.get('view') === 'history' ? 'history' : 'customers';
  const asked = params.get('group') ?? undefined;
  const group: SettlementGroup = isSettlementGroup(asked) ? asked : 'DAY_20';
  const withBalance = params.get('all') !== '1';
  const [search, setSearch] = useState(params.get('q') ?? '');
  const q = useDeferredValue(search.trim());
  const canSend = useHasPermission('finance.sms.send');
  const mayConfigure = useHasPermission('ai.settings.manage');
  const reason = useSmsReason();
  const status = useSmsStatus();
  const list = useSettlementSmsCustomers({ group, q, withBalance });
  const rows = useMemo(() => list.data?.data ?? [], [list.data]);
  const period = list.data?.group === group ? list.data.period : undefined;
  /** The ticked customers, kept while the search changes; a new group starts afresh. */
  const [ticked, setTicked] = useState<Map<number, SettlementSmsCustomer>>(new Map());
  const [sending, setSending] = useState(false);

  const tickable = rows.filter((row) => row.phone !== null);
  const tickedHere = tickable.filter((row) => ticked.has(row.customerId)).length;
  const tickedSum = [...ticked.values()].reduce(
    (sum, row) => sum.plus(row.balance),
    new Decimal(0),
  );
  const toggle = (row: SettlementSmsCustomer, on: boolean) =>
    setTicked((previous) => {
      const next = new Map(previous);
      if (on) next.set(row.customerId, row);
      else next.delete(row.customerId);
      return next;
    });
  const toggleAll = (on: boolean) =>
    setTicked((previous) => {
      const next = new Map(previous);
      for (const row of tickable) {
        if (on) next.set(row.customerId, row);
        else next.delete(row.customerId);
      }
      return next;
    });
  const ledgerHref = (customerId: number) =>
    period
      ? `/finance/customers/${customerId}?from=${period.from}&to=${period.to}`
      : `/finance/customers/${customerId}`;
  const ready = status.data?.ready === true;

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('sms.title')}
        description={t('sms.description')}
        meta={
          period && view === 'customers' ? (
            <span>
              {t('sms.period', { from: period.from, to: period.to, due: period.dueDate })}
            </span>
          ) : undefined
        }
        actions={
          canSend && view === 'customers' ? (
            <Button disabled={ticked.size === 0 || !ready} onClick={() => setSending(true)}>
              <Send />
              {t('sms.send')}
            </Button>
          ) : null
        }
      />
      <SegmentedControl
        name={t('sms.tabs.label')}
        options={VIEWS}
        value={view}
        label={(value) => t(`sms.tabs.${value}`)}
        onChange={(value) => setParam('view', value === 'history' ? 'history' : null)}
      />
      {view === 'history' ? (
        <SmsHistory />
      ) : (
        <>
          {canSend && status.data && !ready ? (
            <Alert>
              <AlertDescription>
                {reason(status.data.reason)}
                {mayConfigure ? (
                  <>
                    {' · '}
                    <Link className="text-link underline" to="/settings?tab=sms">
                      {t('sms.notConfiguredLink')}
                    </Link>
                  </>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}
          <FilterBar
            end={
              ticked.size > 0 ? (
                <span className="flex items-center gap-2 text-sm" aria-live="polite">
                  <span className="font-medium">
                    {t('sms.selected', {
                      count: formatCount(ticked.size),
                      amount: formatTugrik(tickedSum.toFixed(2)),
                    })}
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => setTicked(new Map())}>
                    {t('sms.clearSelection')}
                  </Button>
                </span>
              ) : null
            }
          >
            <NativeSelect
              variant="filter"
              active
              aria-label={t('sms.filters.group')}
              value={group}
              onChange={(event) => {
                setTicked(new Map());
                setParam('group', event.target.value === 'DAY_20' ? null : event.target.value);
              }}
            >
              {SETTLEMENT_GROUPS.map((value) => (
                <option key={value} value={value}>
                  {t(`sms.groups.${value}`)}
                </option>
              ))}
            </NativeSelect>
            <SearchField
              aria-label={t('common.search')}
              placeholder={t('sms.filters.search')}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setParam('q', event.target.value.trim());
              }}
            />
            <FilterToggle
              label={t('sms.filters.withBalance')}
              checked={withBalance}
              onCheckedChange={(checked) => setParam('all', checked ? null : '1')}
            />
          </FilterBar>
          <ProblemAlert problem={problemFromError(list.error)} onRetry={list.refetch} />
          <ListCard scroll>
            <ListTable columns={COLUMNS}>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    {canSend ? (
                      <Checkbox
                        aria-label={t('sms.selectAll')}
                        checked={
                          tickedHere > 0 && tickedHere === tickable.length
                            ? true
                            : tickedHere > 0
                              ? 'indeterminate'
                              : false
                        }
                        disabled={tickable.length === 0}
                        onCheckedChange={(checked) => toggleAll(checked === true)}
                      />
                    ) : (
                      <span className="sr-only">{t('sms.columns.select')}</span>
                    )}
                  </TableHead>
                  <TableHead>{t('sms.columns.code')}</TableHead>
                  <TableHead>{t('sms.columns.name')}</TableHead>
                  <TableHead>{t('sms.columns.phone')}</TableHead>
                  <TableHead className="text-right">{t('sms.columns.balance')}</TableHead>
                  <TableHead>{t('sms.columns.lastSent')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.isPending ? <SkeletonRows columns={6} /> : null}
                {rows.map((row) => {
                  const on = ticked.has(row.customerId);
                  return (
                    <TableRow key={row.customerId} data-state={on ? 'selected' : undefined}>
                      <TableCell className="p-0">
                        {canSend && row.phone !== null ? (
                          <label className="flex h-9 cursor-pointer items-center justify-center touch:h-11">
                            <Checkbox
                              aria-label={t('sms.selectRow', { name: row.name })}
                              checked={on}
                              onCheckedChange={(checked) => toggle(row, checked === true)}
                            />
                          </label>
                        ) : null}
                      </TableCell>
                      <TableCell className="font-mono">
                        <Link
                          to={ledgerHref(row.customerId)}
                          className="underline-offset-4 hover:underline"
                        >
                          {row.code}
                        </Link>
                      </TableCell>
                      <TruncateCell text={row.name}>
                        <Link
                          to={ledgerHref(row.customerId)}
                          className="font-medium underline-offset-4 hover:underline"
                        >
                          {row.name}
                        </Link>
                      </TruncateCell>
                      <TableCell className="font-mono">
                        {row.phone === null ? (
                          <span className="text-muted-foreground">{t('sms.noPhone')}</span>
                        ) : (
                          row.phone.replace(/^\+976/, '')
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatTugrik(row.balance)}
                      </TableCell>
                      <TableCell className="font-mono text-muted-foreground">
                        {row.lastSentAt ? formatUbMinute(row.lastSentAt) : ''}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </ListTable>
            {!list.isPending && rows.length === 0 ? (
              <EmptyState icon={MessageSquareText} title={t('sms.empty')} />
            ) : null}
          </ListCard>
          {sending && period ? (
            <SmsSendDialog
              group={group}
              dueDate={period.dueDate}
              customers={[...ticked.values()]}
              onlyWithBalance={withBalance}
              onClose={() => setSending(false)}
              onSent={() => setTicked(new Map())}
              onOpenHistory={() => {
                setSending(false);
                setParam('view', 'history');
              }}
            />
          ) : null}
        </>
      )}
    </div>
  );
}
