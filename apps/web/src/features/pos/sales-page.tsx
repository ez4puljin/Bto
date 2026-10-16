import { EBARIMT_STATUSES, SALE_KINDS } from '@tugeel/shared/pos';
import { ReceiptText } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
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
  SearchField,
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
import { type EbarimtStatus, type SaleKind, useSales, useTills } from './api';
import { EbarimtBadge, SaleKindBadge } from './badges';
import { SalePanel } from './sale-panel';

const isKind = (value: string | null): value is SaleKind =>
  SALE_KINDS.some((entry) => entry === value);
const isEbarimt = (value: string | null): value is EbarimtStatus =>
  EBARIMT_STATUSES.some((entry) => entry === value);

/**
 * «Борлуулалт» (ADR-0063 #3): the tills' sales and returns as the edge replayed them; search by
 * number, ДДТД, TIN or buyer; filter by kind, receipt state, till and day. One opens in the panel.
 */
export function PosSalesPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
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
      <PageHeader
        title={t('pos.sales.title')}
        meta={total !== null ? t('pos.sales.count', { count: total }) : undefined}
      />
      <FilterBar>
        <SearchField
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
      <ProblemAlert problem={problemFromError(sales.error)} />
      <ListCard>
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
              <ChevronHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sales.isPending ? <SkeletonRows columns={10} /> : null}
            {rows.map((sale) => (
              <LinkRow key={sale.id} to={`?${withParam(params, 'sale', String(sale.id))}`}>
                <TableCell className="font-mono">{sale.number}</TableCell>
                <TableCell className="font-mono">
                  {formatUbDateTime(Date.parse(sale.soldAt))}
                </TableCell>
                <TableCell className="font-mono">{sale.tillCode}</TableCell>
                <TableCell>{sale.cashierName ?? ''}</TableCell>
                <TableCell>
                  <SaleKindBadge kind={sale.kind} />
                </TableCell>
                <TableCell className="text-right font-mono">{formatMnt(sale.total)}</TableCell>
                <TableCell className="text-right font-mono">{formatMnt(sale.cashAmount)}</TableCell>
                <TableCell className="text-right font-mono">{formatMnt(sale.cardAmount)}</TableCell>
                <TableCell>
                  <EbarimtBadge status={sale.ebarimtStatus} />
                </TableCell>
              </LinkRow>
            ))}
          </TableBody>
        </Table>
        {!sales.isPending && rows.length === 0 ? (
          <EmptyState icon={ReceiptText} title={t('pos.sales.empty')} />
        ) : null}
        <LoadMore query={sales} />
      </ListCard>
      <SalePanel saleId={openId > 0 ? openId : null} onClose={() => setParam('sale', undefined)} />
    </div>
  );
}

function withParam(params: URLSearchParams, key: string, value: string): string {
  const next = new URLSearchParams(params);
  next.set(key, value);
  return next.toString();
}
