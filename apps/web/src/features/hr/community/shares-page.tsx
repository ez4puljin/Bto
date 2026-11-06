import { addDays, businessDate } from '@tugeel/shared/time';
import { MapPin } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { Combobox } from '@/components/combobox';
import {
  DateFilter,
  EmptyState,
  FilterBar,
  ListCard,
  ListTable,
  SegmentedControl,
  SkeletonRows,
} from '@/components/list';
import { GeoMap } from '@/components/map/geo-map';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ColumnSpec } from '@/lib/column-layout';
import { formatUbMinute } from '@/lib/dayjs';
import { problemFromError } from '@/lib/problem';
import { useSetParam } from '@/lib/search-params';
import { cn } from '@/lib/utils';
import { useHrShares } from '../engagement-api';
import { sharePoint, useWorkingStaff } from './community-helpers';
import { PersonLine } from './community-kit';

const VIEWS = ['LIST', 'MAP'] as const;
type View = (typeof VIEWS)[number];

const COLUMNS: readonly ColumnSpec[] = [
  { key: 'who', kind: 'text', weight: 2, min: 11 },
  { key: 'when', kind: 'datetime' },
  { key: 'note', kind: 'text', weight: 2, min: 8 },
];

/**
 * «Илгээсэн байршил» (ADR-0146): the places the staff sent from the app, at most a period long; a
 * row in the list flies the map to its point.
 */
export function SharesPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const setParam = useSetParam();
  const working = useWorkingStaff();
  const today = businessDate();
  const from = params.get('from') ?? addDays(today, -6);
  const to = params.get('to') ?? today;
  const userParam = params.get('userId') ?? '';
  const view: View = params.get('view') === 'MAP' ? 'MAP' : 'LIST';
  const [focusId, setFocusId] = useState<string | null>(null);
  const shares = useHrShares(from, to, userParam ? Number(userParam) : undefined);
  const rows = useMemo(() => shares.data ?? [], [shares.data]);
  const points = useMemo(() => rows.map(sharePoint), [rows]);
  const filtered = params.has('from') || params.has('to') || userParam !== '';
  return (
    <div>
      <PageHeader title={t('nav.hrShares')} description={t('hr.community.shares.description')} />
      <FilterBar
        end={
          <SegmentedControl
            name={t('hr.community.shares.view')}
            options={VIEWS}
            value={view}
            label={(value) => t(`hr.community.shares.views.${value}`)}
            onChange={(value) => setParam('view', value === 'LIST' ? null : value)}
          />
        }
      >
        <DateFilter
          label={t('hr.community.from')}
          value={from}
          onChange={(value) => setParam('from', value ?? null)}
        />
        <DateFilter
          label={t('hr.community.to')}
          value={to}
          onChange={(value) => setParam('to', value ?? null)}
        />
        <Combobox
          aria-label={t('hr.community.shares.employee')}
          value={userParam}
          emptyLabel={t('hr.community.shares.allEmployees')}
          options={working.map((row) => ({
            value: String(row.userId),
            label: row.fullName,
            hint: row.divisionName ?? undefined,
          }))}
          onChange={(value) => setParam('userId', value || null)}
        />
      </FilterBar>
      <ProblemAlert problem={problemFromError(shares.error)} onRetry={shares.refetch} />
      <div
        className={cn(
          'grid items-start gap-4',
          view === 'LIST' && 'xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]',
        )}
      >
        {view === 'LIST' ? (
          <ListCard scroll>
            {shares.data && rows.length === 0 ? (
              <EmptyState
                title={filtered ? t('hr.community.noMatch') : t('hr.community.shares.empty')}
                icon={MapPin}
                onClearFilters={filtered ? () => setParams({}, { replace: true }) : undefined}
              />
            ) : (
              <ListTable columns={COLUMNS}>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('hr.community.shares.columns.who')}</TableHead>
                    <TableHead>{t('hr.community.shares.columns.when')}</TableHead>
                    <TableHead>{t('hr.community.shares.columns.note')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shares.isPending ? <SkeletonRows columns={COLUMNS.length} /> : null}
                  {rows.map((share) => {
                    const id = String(share.id);
                    return (
                      <TableRow
                        key={share.id}
                        data-state={focusId === id ? 'selected' : undefined}
                        className="cursor-pointer has-[button:focus-visible]:bg-accent"
                        onClick={() => setFocusId(id)}
                      >
                        <TableCell>
                          <button
                            type="button"
                            className="block w-full text-left outline-none"
                            aria-label={t('hr.community.shares.focus', { name: share.fullName })}
                            aria-pressed={focusId === id}
                          >
                            <PersonLine name={share.fullName} photoUrl={share.photoUrl} />
                          </button>
                        </TableCell>
                        <TableCell className="font-mono text-[0.75rem]">
                          {formatUbMinute(share.createdAt)}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          <span className="block truncate" title={share.note ?? undefined}>
                            {share.note ?? t('common.none')}
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </ListTable>
            )}
          </ListCard>
        ) : null}
        <GeoMap
          points={points}
          label={t('hr.community.shares.mapLabel')}
          focusId={focusId}
          className={cn(
            'bg-card',
            view === 'LIST' ? 'h-[calc(100dvh-14rem)] min-h-80' : 'h-[calc(100dvh-13rem)] min-h-96',
          )}
        />
      </div>
    </div>
  );
}
