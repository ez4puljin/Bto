import { Decimal } from '@tugeel/shared/money';
import { SHIFT_STATUSES } from '@tugeel/shared/pos';
import { Hourglass } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import {
  ChevronHead,
  DateFilter,
  EmptyState,
  FilterBar,
  LinkRow,
  ListCard,
  LoadMore,
  SkeletonRows,
  SpacerCell,
  SpacerHead,
  TruncateCell,
} from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatUbDateTime } from '@/lib/dayjs';
import { formatTugrik } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { hrefWithParam, useSetParam } from '@/lib/search-params';
import { type ShiftStatus, useShifts, useTills } from './api';
import { ShiftStatusBadge } from './badges';
import { ShiftPanel } from './shift-panel';

const isStatus = (value: string | null): value is ShiftStatus =>
  SHIFT_STATUSES.some((entry) => entry === value);

/**
 * «Ээлж» (ADR-0064): the tills' shifts as the edge replayed them; closed ones wait for the
 * accountant's hand-over («Хүлээн авах ээлж» on the home page). One opens in the panel (`?shift=`);
 * its number is the row's link for the keyboard.
 */
export function PosShiftsPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const setParam = useSetParam();
  const statusParam = params.get('status');
  const status = isStatus(statusParam) ? statusParam : undefined;
  const tillId = Number.parseInt(params.get('tillId') ?? '', 10) || undefined;
  const from = params.get('from') ?? undefined;
  const to = params.get('to') ?? undefined;
  const openId = Number.parseInt(params.get('shift') ?? '', 10);
  const tills = useTills();
  const shifts = useShifts({ status, tillId, from, to });
  const rows = shifts.data?.pages.flatMap((page) => page.data) ?? [];
  const filtered = Boolean(status || tillId || from || to);
  const none = <span className="text-muted-foreground">{t('pos.fields.none')}</span>;

  return (
    <div>
      <PageHeader title={t('pos.shifts.title')} />
      <FilterBar>
        <NativeSelect
          variant="filter"
          aria-label={t('pos.fields.status')}
          value={status ?? ''}
          onChange={(event) => setParam('status', event.target.value)}
        >
          <option value="">{t('pos.shifts.allStatuses')}</option>
          {SHIFT_STATUSES.map((value) => (
            <option key={value} value={value}>
              {t(`pos.shiftStatuses.${value}`)}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          variant="filter"
          aria-label={t('pos.fields.till')}
          value={tillId ?? ''}
          onChange={(event) => setParam('tillId', event.target.value)}
        >
          <option value="">{t('pos.shifts.allTills')}</option>
          {(tills.data ?? []).map((till) => (
            <option key={till.id} value={till.id}>
              {till.code} · {till.name}
            </option>
          ))}
        </NativeSelect>
        <DateFilter
          label={t('pos.fields.from')}
          value={from}
          onChange={(value) => setParam('from', value)}
        />
        <DateFilter
          label={t('pos.fields.to')}
          value={to}
          onChange={(value) => setParam('to', value)}
        />
      </FilterBar>
      <ProblemAlert problem={problemFromError(shifts.error)} onRetry={shifts.refetch} />
      <ListCard scroll>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('pos.fields.number')}</TableHead>
              <TableHead>{t('pos.fields.till')}</TableHead>
              <TableHead>{t('pos.fields.cashier')}</TableHead>
              <TableHead>{t('pos.fields.openedAt')}</TableHead>
              <TableHead>{t('pos.fields.status')}</TableHead>
              <TableHead className="text-right">{t('pos.fields.salesTotal')}</TableHead>
              <TableHead className="text-right">{t('pos.fields.variance')}</TableHead>
              <SpacerHead />
              <ChevronHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {shifts.isPending ? <SkeletonRows columns={9} /> : null}
            {rows.map((shift) => {
              const href = hrefWithParam(params, 'shift', String(shift.id));
              const short = shift.variance !== null && new Decimal(shift.variance).isNegative();
              return (
                <LinkRow key={shift.id} to={href}>
                  <TableCell className="font-mono">
                    <Link to={href} className="font-medium underline-offset-4 hover:underline">
                      {shift.number}
                    </Link>
                  </TableCell>
                  <TableCell>{shift.tillName}</TableCell>
                  <TruncateCell text={shift.cashierName ?? t('pos.fields.none')}>
                    {shift.cashierName ?? none}
                  </TruncateCell>
                  <TableCell className="font-mono">
                    {formatUbDateTime(Date.parse(shift.openedAt))}
                  </TableCell>
                  <TableCell>
                    <ShiftStatusBadge status={shift.status} />
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {formatTugrik(shift.salesTotal)}
                  </TableCell>
                  <TableCell
                    className={
                      short ? 'text-right font-mono text-destructive' : 'text-right font-mono'
                    }
                  >
                    {shift.variance === null ? none : formatTugrik(shift.variance)}
                  </TableCell>
                  <SpacerCell />
                </LinkRow>
              );
            })}
          </TableBody>
        </Table>
        {!shifts.isPending && rows.length === 0 ? (
          <EmptyState
            icon={Hourglass}
            title={t('pos.shifts.empty')}
            {...(filtered
              ? { onClearFilters: () => setParams(new URLSearchParams(), { replace: true }) }
              : {})}
          />
        ) : null}
        <LoadMore query={shifts} />
      </ListCard>
      <ShiftPanel shiftId={openId > 0 ? openId : null} onClose={() => setParam('shift', null)} />
    </div>
  );
}
