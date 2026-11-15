import { EBARIMT_STATUSES, SALE_KINDS } from '@tugeel/shared/pos';
import { ReceiptText } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import {
  ChevronHead,
  EmptyState,
  FilterBar,
  LinkRow,
  ListCard,
  ListTable,
  LoadMore,
  SearchField,
  SkeletonRows,
  SpacerCell,
  SpacerHead,
  TruncateCell,
} from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DateRangeFilter } from '@/features/finance/date-range-filter';
import type { ColumnSpec } from '@/lib/column-layout';
import { formatUbDateTime } from '@/lib/dayjs';
import { formatTugrik } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { hrefWithParam, useSetParam } from '@/lib/search-params';
import {
  type EbarimtStatus,
  type SaleKind,
  useCashiers,
  useSales,
  useSalesSummary,
  useTills,
} from './api';
import { EbarimtBadge, SaleKindBadge } from './badges';
import { SalePanel } from './sale-panel';
import { SalesTotals } from './sales-totals';

const isKind = (value: string | null): value is SaleKind =>
  SALE_KINDS.some((entry) => entry === value);
const isEbarimt = (value: string | null): value is EbarimtStatus =>
  EBARIMT_STATUSES.some((entry) => entry === value);

/**
 * The sales list's columns (ADR-0119): 79.25rem in all, each as wide as its values («К1», a
 * receipt's cash, «Баримт гараагүй»). What a narrower table lets go, least needed first (ADR-0201):
 * the POS's code, which the number begins with (a laptop's 76rem: 74.25); the cashier (64.25);
 * the time, whose day the number carries (a till PC's 56rem: 52.75); the tenders (a tablet's
 * 41rem: 37.75). The number, the kind, the total and the receipt's state stay; the panel says
 * the rest.
 */
const COLUMNS: readonly ColumnSpec[] = [
  { key: 'number', kind: 'number' },
  { key: 'soldAt', kind: 'datetime', drop: 3 },
  { key: 'till', kind: 'code', width: 5, drop: 1 },
  { key: 'cashier', kind: 'text', weight: 2, min: 10, drop: 2 },
  { key: 'kind', kind: 'status', width: 7.5 },
  { key: 'total', kind: 'money' },
  { key: 'cash', kind: 'money', width: 7.5, drop: 4 },
  { key: 'card', kind: 'money', width: 7.5, drop: 4 },
  { key: 'ebarimt', kind: 'status', width: 9 },
  { key: 'spacer', kind: 'spacer' },
  { key: 'chevron', kind: 'chevron' },
];

/**
 * «Кассын борлуулалт» (ADR-0063 #3): the tills' sales and returns as the edge replayed them; search
 * by number, ДДТД, TIN or buyer; filter by kind, receipt state, till, cashier and day, with the
 * filters' totals in a banner (owner 2026-11-10). One opens in the panel (`?sale=`); its number
 * is the row's link for the keyboard.
 */
export function PosSalesPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const setParam = useSetParam();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const q = useDeferredValue(search.trim());
  const kindParam = params.get('kind');
  const kind = isKind(kindParam) ? kindParam : undefined;
  const ebarimtParam = params.get('ebarimt');
  const ebarimtStatus = isEbarimt(ebarimtParam) ? ebarimtParam : undefined;
  const tillId = Number.parseInt(params.get('tillId') ?? '', 10) || undefined;
  const cashierUserId = Number.parseInt(params.get('cashierUserId') ?? '', 10) || undefined;
  const shiftId = Number.parseInt(params.get('shiftId') ?? '', 10) || undefined;
  const from = params.get('from') ?? undefined;
  const to = params.get('to') ?? undefined;
  const openId = Number.parseInt(params.get('sale') ?? '', 10);
  const tills = useTills();
  const cashiers = useCashiers();
  const filter = { q, kind, ebarimtStatus, tillId, cashierUserId, shiftId, from, to };
  const sales = useSales(filter);
  const summary = useSalesSummary(filter);
  const rows = sales.data?.pages.flatMap((page) => page.data) ?? [];
  const filtered = Boolean(
    q || kind || ebarimtStatus || tillId || cashierUserId || shiftId || from || to,
  );
  const clearFilters = () => {
    setSearch('');
    setParams(new URLSearchParams(), { replace: true });
  };

  return (
    <div>
      {/* No count under the title: the banner's first tile counts the sales and the returns, and
          its line took the list's card out of a laptop's window (ADR-0201). */}
      <PageHeader title={t('pos.sales.title')} />
      <FilterBar>
        <SearchField
          className="sm:w-60"
          aria-label={t('common.search')}
          placeholder={t('pos.sales.searchPlaceholder')}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setParam('q', event.target.value.trim());
          }}
        />
        <NativeSelect
          variant="filter"
          aria-label={t('pos.fields.kind')}
          value={kind ?? ''}
          onChange={(event) => setParam('kind', event.target.value)}
        >
          <option value="">{t('pos.sales.allKinds')}</option>
          {SALE_KINDS.map((value) => (
            <option key={value} value={value}>
              {t(`pos.saleKinds.${value}`)}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          variant="filter"
          aria-label={t('pos.fields.ebarimt')}
          value={ebarimtStatus ?? ''}
          onChange={(event) => setParam('ebarimt', event.target.value)}
        >
          <option value="">{t('pos.sales.allEbarimt')}</option>
          {EBARIMT_STATUSES.map((value) => (
            <option key={value} value={value}>
              {t(`pos.ebarimtStatuses.${value}`)}
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
        <NativeSelect
          variant="filter"
          aria-label={t('pos.fields.cashier')}
          value={cashierUserId ?? ''}
          onChange={(event) => setParam('cashierUserId', event.target.value)}
        >
          <option value="">{t('pos.sales.allCashiers')}</option>
          {(cashiers.data ?? []).map((cashier) => (
            <option key={cashier.userId} value={cashier.userId}>
              {cashier.fullName}
            </option>
          ))}
        </NativeSelect>
        <DateRangeFilter
          label={t('pos.fields.paidOn')}
          fromLabel={t('pos.fields.from')}
          toLabel={t('pos.fields.to')}
          from={from}
          to={to}
          onFrom={(value) => setParam('from', value)}
          onTo={(value) => setParam('to', value)}
        />
      </FilterBar>
      <SalesTotals summary={summary.data} />
      <ProblemAlert problem={problemFromError(sales.error)} onRetry={sales.refetch} />
      <ProblemAlert problem={problemFromError(summary.error)} onRetry={summary.refetch} />
      <ListCard scroll>
        <ListTable columns={COLUMNS}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('pos.fields.number')}</TableHead>
              <TableHead>{t('pos.fields.soldAt')}</TableHead>
              <TableHead>{t('pos.fields.till')}</TableHead>
              <TableHead>{t('pos.fields.cashier')}</TableHead>
              <TableHead>{t('pos.fields.kind')}</TableHead>
              <TableHead className="text-right">{t('pos.fields.total')}</TableHead>
              <TableHead className="text-right">{t('pos.fields.cash')}</TableHead>
              <TableHead className="text-right">{t('pos.fields.card')}</TableHead>
              <TableHead>{t('pos.fields.ebarimt')}</TableHead>
              <SpacerHead />
              <ChevronHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sales.isPending ? <SkeletonRows columns={11} /> : null}
            {rows.map((sale) => {
              const href = hrefWithParam(params, 'sale', String(sale.id));
              return (
                <LinkRow key={sale.id} to={href}>
                  <TableCell className="font-mono">
                    <Link to={href} className="font-medium underline-offset-4 hover:underline">
                      {sale.number}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono">
                    {formatUbDateTime(Date.parse(sale.soldAt))}
                  </TableCell>
                  <TableCell className="font-mono">{sale.tillCode}</TableCell>
                  <TruncateCell text={sale.cashierName ?? t('pos.fields.none')}>
                    {sale.cashierName ?? (
                      <span className="text-muted-foreground">{t('pos.fields.none')}</span>
                    )}
                  </TruncateCell>
                  <TableCell>
                    <SaleKindBadge kind={sale.kind} />
                  </TableCell>
                  <TableCell className="text-right font-mono">{formatTugrik(sale.total)}</TableCell>
                  <TableCell className="text-right font-mono">
                    {formatTugrik(sale.cashAmount)}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {formatTugrik(sale.cardAmount)}
                  </TableCell>
                  <TableCell>
                    <EbarimtBadge status={sale.ebarimtStatus} />
                  </TableCell>
                  <SpacerCell />
                </LinkRow>
              );
            })}
          </TableBody>
        </ListTable>
        {!sales.isPending && rows.length === 0 ? (
          <EmptyState
            icon={ReceiptText}
            title={t('pos.sales.empty')}
            {...(filtered ? { onClearFilters: clearFilters } : {})}
          />
        ) : null}
        <LoadMore query={sales} />
      </ListCard>
      <SalePanel saleId={openId > 0 ? openId : null} onClose={() => setParam('sale', null)} />
    </div>
  );
}
