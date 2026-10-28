import { PackagePlus, Plus } from 'lucide-react';
import { useDeferredValue, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useLocation, useParams, useSearchParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { RequirePermission } from '@/app/require-auth';
import {
  ChevronHead,
  EmptyState,
  FilterBar,
  FilterChip,
  FilterToggle,
  LinkRow,
  ListCard,
  LoadMore,
  SearchField,
  SkeletonRows,
  TruncateCell,
} from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { DateRangeFilter } from '@/features/finance/date-range-filter';
import { useSupplier } from '@/features/partners/api';
import { SupplierPicker } from '@/features/partners/supplier-picker';
import { formatTugrik } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { useSetParam } from '@/lib/search-params';
import {
  type ReceiptDetail,
  type ReceiptStatus,
  useProductStock,
  useReceipt,
  useReceipts,
} from './api';
import { useWarehouseOptions, wantsScanFocus } from './helpers';
import { ReceiptForm } from './receipt-form';
import { DocStatusBadge, ProductSearch, WarehouseSelect } from './shared';

const RECEIPT_STATUSES: readonly ReceiptStatus[] = ['DRAFT', 'POSTED', 'CANCELLED'];
const WHOLESALE = ['WHOLESALE'] as const;

const isStatus = (value: string | null): value is ReceiptStatus =>
  RECEIPT_STATUSES.some((status) => status === value);

/**
 * Goods receipts (ADR-0033, ADR-0099): every user reads them, filtered by the delivery note's dates,
 * the supplier, a product they hold or a warehouse they fill; cost holders see each note's payable;
 * accountants find the ones waiting for costs.
 */
export function ReceiptsPage() {
  const { t } = useTranslation();
  const canManage = useHasPermission('inventory.receipts.manage');
  const canCost = useHasPermission('inventory.costs.manage');
  const [params] = useSearchParams();
  const setParam = useSetParam();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const q = useDeferredValue(search.trim());
  const statusParam = params.get('status');
  const status = isStatus(statusParam) ? statusParam : undefined;
  const idParam = (name: string) => {
    const value = Number.parseInt(params.get(name) ?? '', 10);
    return Number.isNaN(value) ? undefined : value;
  };
  const warehouseId = idParam('warehouseId');
  const supplierId = idParam('supplierId');
  const productId = idParam('productId');
  const from = params.get('from') ?? undefined;
  const to = params.get('to') ?? undefined;
  const costingPending = params.get('costing') === 'pending';
  const warehouses = useWarehouseOptions(WHOLESALE);
  const supplier = useSupplier(supplierId ?? 0, supplierId !== undefined);
  const product = useProductStock(productId ?? 0, productId !== undefined);
  const receipts = useReceipts({
    q,
    status,
    warehouseId,
    costingPending,
    supplierId,
    productId,
    from,
    to,
  });
  const rows = receipts.data?.pages.flatMap((page) => page.data) ?? [];

  // Old links (the home page, the search) opened a create dialog; a receipt is now its own page.
  if (params.get('new') === '1') return <Navigate to="/inventory/receipts/new" replace />;

  return (
    <div>
      <PageHeader
        title={t('inventory.receipts.title')}
        actions={
          canManage ? (
            <Button asChild>
              <Link to="/inventory/receipts/new">
                <Plus />
                {t('inventory.receipts.create')}
              </Link>
            </Button>
          ) : null
        }
      />
      <FilterBar>
        <SearchField
          aria-label={t('common.search')}
          placeholder={t('inventory.receipts.searchPlaceholder')}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setParam('q', event.target.value.trim());
          }}
        />
        <DateRangeFilter
          label={t('inventory.date')}
          fromLabel={t('inventory.receipts.from')}
          toLabel={t('inventory.receipts.to')}
          from={from}
          to={to}
          onFrom={(value) => setParam('from', value ?? '')}
          onTo={(value) => setParam('to', value ?? '')}
        />
        {supplierId !== undefined ? (
          <FilterChip
            clearLabel={t('inventory.receipts.clearSupplier')}
            onClear={() => setParam('supplierId', '')}
          >
            {supplier.data?.name ?? t('common.loading')}
          </FilterChip>
        ) : (
          <div className="w-full sm:w-56">
            <label htmlFor="receipts-supplier" className="sr-only">
              {t('inventory.receipts.supplier')}
            </label>
            <SupplierPicker
              floating
              variant="filter"
              id="receipts-supplier"
              value={null}
              onChange={(picked) => setParam('supplierId', picked ? String(picked.id) : '')}
            />
          </div>
        )}
        {productId !== undefined ? (
          <FilterChip
            clearLabel={t('inventory.receipts.clearProduct')}
            onClear={() => setParam('productId', '')}
          >
            <span className="font-mono text-muted-foreground">{product.data?.product.sku}</span>{' '}
            <span>{product.data?.product.name}</span>
          </FilterChip>
        ) : (
          <>
            <label htmlFor="receipts-product" className="sr-only">
              {t('inventory.receipts.product')}
            </label>
            <ProductSearch
              id="receipts-product"
              variant="filter"
              className="sm:w-56"
              pickLabel={t('inventory.receipts.pickProduct')}
              onPick={(picked) => setParam('productId', String(picked.id))}
            />
          </>
        )}
        <WarehouseSelect
          variant="filter"
          options={warehouses.options}
          value={warehouseId}
          emptyLabel={t('inventory.allWarehouses')}
          onChange={(id) => setParam('warehouseId', id === undefined ? '' : String(id))}
        />
        <NativeSelect
          variant="filter"
          aria-label={t('inventory.status')}
          value={status ?? ''}
          onChange={(event) => setParam('status', event.target.value)}
        >
          <option value="">{t('inventory.adjustments.allStatuses')}</option>
          {RECEIPT_STATUSES.map((value) => (
            <option key={value} value={value}>
              {t(`inventory.docStatus.${value}`)}
            </option>
          ))}
        </NativeSelect>
        {canCost ? (
          <FilterToggle
            label={t('inventory.receipts.costingPending')}
            checked={costingPending}
            onCheckedChange={(checked) => setParam('costing', checked ? 'pending' : '')}
          />
        ) : null}
      </FilterBar>
      <ProblemAlert problem={problemFromError(receipts.error)} onRetry={receipts.refetch} />
      <ListCard scroll>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('inventory.number')}</TableHead>
              <TableHead>{t('inventory.date')}</TableHead>
              <TableHead>{t('inventory.receipts.supplier')}</TableHead>
              <TableHead>{t('inventory.receipts.supplierDoc')}</TableHead>
              <TableHead>{t('inventory.receipts.payment')}</TableHead>
              {canCost ? (
                <TableHead className="text-right">{t('inventory.receipts.amount')}</TableHead>
              ) : null}
              <TableHead className="text-right">{t('inventory.lines')}</TableHead>
              <TableHead>{t('inventory.status')}</TableHead>
              <ChevronHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {receipts.isPending ? <SkeletonRows columns={canCost ? 9 : 8} /> : null}
            {rows.map((receipt) => (
              <LinkRow key={receipt.id} to={`/inventory/receipts/${receipt.id}`}>
                <TableCell className="font-mono">
                  <Link
                    to={`/inventory/receipts/${receipt.id}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {receipt.number ?? t('inventory.draftNo', { id: receipt.id })}
                  </Link>
                </TableCell>
                <TableCell className="font-mono">
                  {receipt.supplierDocDate ?? receipt.effectiveDate ?? t('common.none')}
                </TableCell>
                <TruncateCell text={receipt.supplierName} />
                <TableCell className="font-mono">
                  {receipt.supplierDocNo ?? t('common.none')}
                </TableCell>
                <TableCell>
                  {t(`inventory.receipt.paymentMethods.${receipt.paymentMethod}`)}
                </TableCell>
                {canCost ? (
                  <TableCell className="text-right font-mono">
                    {receipt.netAmount ? formatTugrik(receipt.netAmount) : t('common.none')}
                  </TableCell>
                ) : null}
                <TableCell className="text-right font-mono">{receipt.lineCount}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <DocStatusBadge status={receipt.status} />
                    {receipt.costingStatus ? (
                      <Badge variant={receipt.costingStatus === 'PENDING' ? 'warning' : 'outline'}>
                        {t(`inventory.costingStatus.${receipt.costingStatus}`)}
                      </Badge>
                    ) : null}
                  </div>
                </TableCell>
              </LinkRow>
            ))}
          </TableBody>
        </Table>
        {!receipts.isPending && rows.length === 0 ? (
          <EmptyState icon={PackagePlus} title={t('inventory.receipts.empty')} />
        ) : null}
        <LoadMore query={receipts} />
      </ListCard>
    </div>
  );
}

/**
 * One receipt on its own page (`/inventory/receipts/:id`, `new` for a receipt not made yet): the
 * delivery note's header on top, the lines below (ReceiptForm). A new receipt takes its draft's
 * address once its first line is added and the page stays mounted (same route, same key), so the
 * scan box keeps the cursor, the active shelf and what the last scan did.
 */
export function ReceiptPage() {
  const { t } = useTranslation();
  const param = useParams().id ?? '';
  const isNew = param === 'new';
  const id = isNew ? Number.NaN : Number.parseInt(param, 10);
  const location = useLocation();
  const canManage = useHasPermission('inventory.receipts.manage');
  const receipt = useReceipt(id, !Number.isNaN(id));
  /** The receipt this page created: the form that made it carries on with it. */
  const created = useRef<number | null>(null);
  const onCreated = (newId: number) => {
    created.current = newId;
  };

  if (isNew) {
    if (!canManage)
      return <RequirePermission permission="inventory.receipts.manage">{null}</RequirePermission>;
    return <ReceiptScreen key="new" detail={null} focusScan={false} onCreated={onCreated} />;
  }
  const loadProblem = problemFromError(receipt.error);
  if (loadProblem || !receipt.data) {
    return (
      <div>
        <PageHeader title={t('inventory.receipts.title')} />
        {loadProblem ? (
          <ProblemAlert problem={loadProblem} />
        ) : (
          <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
        )}
      </div>
    );
  }
  return (
    <ReceiptScreen
      key={created.current === id ? 'new' : String(id)}
      detail={receipt.data}
      focusScan={wantsScanFocus(location.state)}
      onCreated={onCreated}
    />
  );
}

function ReceiptScreen(props: {
  detail: ReceiptDetail | null;
  focusScan: boolean;
  onCreated: (id: number) => void;
}) {
  const { t } = useTranslation();
  const { detail } = props;
  return (
    <div className="space-y-4">
      <PageHeader
        title={
          detail === null
            ? t('inventory.receipt.newTitle')
            : (detail.number ?? t('inventory.draftNo', { id: detail.id }))
        }
        description={detail === null ? t('inventory.receipt.wholesaleOnly') : undefined}
        meta={
          detail ? (
            <>
              <DocStatusBadge status={detail.status} />
              {detail.costingStatus ? (
                <Badge variant={detail.costingStatus === 'PENDING' ? 'warning' : 'outline'}>
                  {t(`inventory.costingStatus.${detail.costingStatus}`)}
                </Badge>
              ) : null}
              {detail.effectiveDate ? (
                <span>{t('inventory.postedOn', { date: detail.effectiveDate })}</span>
              ) : null}
            </>
          ) : undefined
        }
      />
      <ReceiptForm detail={detail} focusScan={props.focusScan} onCreated={props.onCreated} />
    </div>
  );
}
