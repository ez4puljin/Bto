import { FileSpreadsheet, History } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useSearchParams } from 'react-router';
import {
  EmptyState,
  FilterBar,
  ListCard,
  LoadMore,
  SearchField,
  SkeletonRows,
  TruncateCell,
} from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatUbDateTime } from '@/lib/dayjs';
import { saveBlob } from '@/lib/download';
import { problemFromError } from '@/lib/problem';
import { useSetParam } from '@/lib/search-params';
import { useAction } from '@/lib/use-action';
import {
  type HistoryRow,
  isPoStatus,
  useOrderHistory,
  usePurchaseOrder,
  usePurchaseOrderDownloads,
} from './api';

const idOf = (value: string | null | undefined) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isNaN(parsed) ? undefined : parsed;
};

/**
 * The order's history (`/procurement/orders/:id/history`, ADR-0118 #6): who changed what and when
 * — creation, suppliers, every status, each cell before → after, the shipped and counted
 * quantities, the keepers' notes, the receipt's steps, the prices — filtered by user, supplier and
 * product, with an Excel of the same rows.
 */
export function PurchaseOrderHistoryPage() {
  const { t } = useTranslation();
  const id = idOf(useParams().id) ?? 0;
  const order = usePurchaseOrder(id);
  const [params] = useSearchParams();
  const setParam = useSetParam();
  const userId = idOf(params.get('user'));
  const supplierId = idOf(params.get('supplier'));
  const [search, setSearch] = useState(params.get('q') ?? '');
  const q = useDeferredValue(search.trim().toLowerCase());
  const history = useOrderHistory(id, { userId, supplierId });
  const rows = history.data?.pages.flatMap((page) => page.data) ?? [];
  const shown = q
    ? rows.filter((row) =>
        `${row.productSku ?? ''} ${row.productName ?? ''}`.toLowerCase().includes(q),
      )
    : rows;
  const users = new Map<number, string>();
  for (const row of rows) {
    if (row.userId !== null && row.userName) users.set(row.userId, row.userName);
  }
  const downloads = usePurchaseOrderDownloads();
  const exporting = useAction();
  const number = order.data?.number ?? '';
  const filtered = userId !== undefined || supplierId !== undefined || q !== '';

  return (
    <div>
      <PageHeader
        title={t('procurement.history.title')}
        description={t('procurement.history.description')}
        meta={number ? <span className="font-mono">{number}</span> : undefined}
        crumbs={[
          { label: t('procurement.orders.title'), to: '/procurement/orders' },
          { label: number || '…', to: `/procurement/orders/${id}` },
        ]}
        actions={
          <Button
            variant="outline"
            pending={downloads.historyExcel.isPending}
            onClick={() =>
              void exporting.run(async () =>
                saveBlob(
                  await downloads.historyExcel.mutateAsync({ id, userId, supplierId }),
                  `${number || id}-${t('procurement.history.title')}.xlsx`,
                ),
              )
            }
          >
            <FileSpreadsheet />
            {t('procurement.history.excelButton')}
          </Button>
        }
      />
      <FilterBar>
        <NativeSelect
          variant="filter"
          aria-label={t('procurement.history.user')}
          value={userId === undefined ? '' : String(userId)}
          onChange={(event) => setParam('user', event.target.value)}
        >
          <option value="">{t('procurement.history.allUsers')}</option>
          {[...users].map(([value, name]) => (
            <option key={value} value={value}>
              {name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          variant="filter"
          aria-label={t('procurement.history.supplier')}
          value={supplierId === undefined ? '' : String(supplierId)}
          onChange={(event) => setParam('supplier', event.target.value)}
        >
          <option value="">{t('procurement.history.allSuppliers')}</option>
          {(order.data?.suppliers ?? []).map((supplier) => (
            <option key={supplier.supplierId} value={supplier.supplierId}>
              {supplier.supplierName}
            </option>
          ))}
        </NativeSelect>
        <SearchField
          aria-label={t('procurement.history.product')}
          placeholder={t('procurement.history.productPlaceholder')}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setParam('q', event.target.value.trim());
          }}
        />
      </FilterBar>
      <ProblemAlert problem={exporting.problem} />
      <ProblemAlert problem={problemFromError(history.error)} onRetry={history.refetch} />
      <ListCard scroll>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('procurement.history.at')}</TableHead>
              <TableHead>{t('procurement.history.user')}</TableHead>
              <TableHead>{t('procurement.history.action')}</TableHead>
              <TableHead>{t('procurement.history.supplier')}</TableHead>
              <TableHead>{t('procurement.history.product')}</TableHead>
              <TableHead>{t('procurement.history.change')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {history.isPending ? <SkeletonRows columns={6} /> : null}
            {shown.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-mono whitespace-nowrap">
                  {formatUbDateTime(Date.parse(row.at))}
                </TableCell>
                <TableCell>{row.userName ?? t('common.none')}</TableCell>
                <TableCell>{t(`procurement.history.kind.${row.kind}`)}</TableCell>
                <TruncateCell text={row.supplierName ?? ''} />
                <TruncateCell
                  text={
                    row.productId === null ? '' : `${row.productSku ?? ''} ${row.productName ?? ''}`
                  }
                />
                <TableCell>
                  <Change row={row} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!history.isPending && shown.length === 0 ? (
          <EmptyState
            icon={History}
            title={t(filtered ? 'procurement.history.emptyFiltered' : 'procurement.history.empty')}
            onClearFilters={
              filtered
                ? () => {
                    setSearch('');
                    setParam('q', '');
                    setParam('user', '');
                    setParam('supplier', '');
                  }
                : undefined
            }
          />
        ) : null}
        <LoadMore query={history} />
      </ListCard>
    </div>
  );
}

/** «хуучин → шинэ», a status by its name, and whatever else the change says. */
function Change({ row }: { row: HistoryRow }) {
  const { t } = useTranslation();
  const side = (value: string | null) => {
    if (value === null) return t('common.none');
    if (row.kind === 'STATUS' && isPoStatus(value)) return t(`procurement.status.${value}`);
    return value;
  };
  const hasSides = row.from !== null || row.to !== null;
  return (
    <span className="flex flex-wrap items-center gap-x-2">
      {hasSides ? (
        <span className="font-mono">
          {row.from !== null || row.to !== null ? (
            <>
              <span className={row.from === null ? 'text-muted-foreground' : undefined}>
                {side(row.from)}
              </span>
              <span className="mx-1 text-muted-foreground" aria-hidden>
                →
              </span>
              <span className="font-semibold">{side(row.to)}</span>
            </>
          ) : null}
        </span>
      ) : null}
      {row.detail ? <span className="text-[13px] text-muted-foreground">{row.detail}</span> : null}
    </span>
  );
}
