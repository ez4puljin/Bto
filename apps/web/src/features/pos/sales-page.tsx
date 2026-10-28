import { EBARIMT_STATUSES, SALE_KINDS } from '@tugeel/shared/pos';
import { ReceiptText } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
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
  SearchField,
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
import { formatCount, formatTugrik } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { hrefWithParam, useSetParam } from '@/lib/search-params';
import { type EbarimtStatus, type SaleKind, useSales, useTills } from './api';
import { EbarimtBadge, SaleKindBadge } from './badges';
import { SalePanel } from './sale-panel';

const isKind = (value: string | null): value is SaleKind =>
  SALE_KINDS.some((entry) => entry === value);
const isEbarimt = (value: string | null): value is EbarimtStatus =>
  EBARIMT_STATUSES.some((entry) => entry === value);

/**
 * «Кассын борлуулалт» (ADR-0063 #3): the tills' sales and returns as the edge replayed them; search
 * by number, ДДТД, TIN or buyer; filter by kind, receipt state, till and day. One opens in the
 * panel (`?sale=`); its number is the row's link for the keyboard.
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
  const shiftId = Number.parseInt(params.get('shiftId') ?? '', 10) || undefined;
  const from = params.get('from') ?? undefined;
  const to = params.get('to') ?? undefined;
  const openId = Number.parseInt(params.get('sale') ?? '', 10);
  const tills = useTills();
  const sales = useSales({ q, kind, ebarimtStatus, tillId, shiftId, from, to });
  const rows = sales.data?.pages.flatMap((page) => page.data) ?? [];
  const total = sales.data?.pages[0]?.total ?? null;
  const filtered = Boolean(q || kind || ebarimtStatus || tillId || shiftId || from || to);
  const clearFilters = () => {
    setSearch('');
    setParams(new URLSearchParams(), { replace: true });
  };

  return (
    <div>
      <PageHeader
        title={t('pos.sales.title')}
        meta={
          total !== null ? (
            <span className="tabular-nums">
              {t('pos.sales.count', { count: formatCount(total) })}
            </span>
          ) : undefined
        }
      />
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
        {/* The two days wrap as a pair: on a laptop they share the second row. */}
        <div className="flex flex-wrap items-center gap-2">
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
        </div>
      </FilterBar>
      <ProblemAlert problem={problemFromError(sales.error)} onRetry={sales.refetch} />
      <ListCard scroll>
        <Table>
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
        </Table>
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
