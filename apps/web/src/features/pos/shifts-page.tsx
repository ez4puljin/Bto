import { SHIFT_STATUSES } from '@tugeel/shared/pos';
import { Hourglass } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import {
  ChevronHead,
  DateFilter,
  EmptyState,
  FilterBar,
  LinkRow,
  ListCard,
  LoadMore,
  SkeletonRows,
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
import { formatMnt } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { type ShiftStatus, useShifts, useTills } from './api';
import { ShiftStatusBadge } from './badges';
import { ShiftPanel } from './shift-panel';

const isStatus = (value: string | null): value is ShiftStatus =>
  SHIFT_STATUSES.some((entry) => entry === value);

/**
 * «Ээлж» (ADR-0064): the tills' shifts as the edge replayed them; closed ones wait for the
 * accountant's hand-over («Хүлээн авах ээлж» on the home page). One opens in the panel (`?shift=`).
 */
export function PosShiftsPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const statusParam = params.get('status');
  const status = isStatus(statusParam) ? statusParam : undefined;
  const tillId = Number.parseInt(params.get('tillId') ?? '', 10) || undefined;
  const from = params.get('from') ?? undefined;
  const to = params.get('to') ?? undefined;
  const openId = Number.parseInt(params.get('shift') ?? '', 10);
  const tills = useTills();
  const shifts = useShifts({ status, tillId, from, to });
  const rows = shifts.data?.pages.flatMap((page) => page.data) ?? [];

  const setParam = (key: string, value: string | undefined) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );

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
      <ProblemAlert problem={problemFromError(shifts.error)} />
      <ListCard>
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
              <ChevronHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {shifts.isPending ? <SkeletonRows columns={8} /> : null}
            {rows.map((shift) => (
              <LinkRow key={shift.id} to={`?${withParam(params, 'shift', String(shift.id))}`}>
                <TableCell className="font-mono">{shift.number}</TableCell>
                <TableCell>{shift.tillName}</TableCell>
                <TableCell>{shift.cashierName ?? ''}</TableCell>
                <TableCell className="font-mono">
                  {formatUbDateTime(Date.parse(shift.openedAt))}
                </TableCell>
                <TableCell>
                  <ShiftStatusBadge status={shift.status} />
                </TableCell>
                <TableCell className="text-right font-mono">
                  {formatMnt(shift.salesTotal)}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {shift.variance === null ? '' : formatMnt(shift.variance)}
                </TableCell>
              </LinkRow>
            ))}
          </TableBody>
        </Table>
        {!shifts.isPending && rows.length === 0 ? (
          <EmptyState icon={Hourglass} title={t('pos.shifts.empty')} />
        ) : null}
        <LoadMore query={shifts} />
      </ListCard>
      <ShiftPanel
        shiftId={openId > 0 ? openId : null}
        onClose={() => setParam('shift', undefined)}
      />
    </div>
  );
}

function withParam(params: URLSearchParams, key: string, value: string): string {
  const next = new URLSearchParams(params);
  next.set(key, value);
  return next.toString();
}
