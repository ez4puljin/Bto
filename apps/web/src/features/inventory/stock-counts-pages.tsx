import { businessDate } from '@tugeel/shared/time';
import { ClipboardCheck, FileSearch, Plus } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { CheckboxGroup } from '@/components/checkbox-group';
import { DialogFormFooter, FormField } from '@/components/form';
import {
  ChevronHead,
  EmptyState,
  FilterBar,
  FilterChip,
  LinkRow,
  ListCard,
  ListTable,
  LoadMore,
  SearchField,
  SkeletonRows,
} from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { SearchSelect } from '@/components/search-select';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useCategories } from '@/features/catalog/api';
import { DateRangeFilter } from '@/features/finance/date-range-filter';
import { useSuppliers } from '@/features/partners/api';
import { monthStart } from '@/features/reports/report-helpers';
import { useSegments } from '@/features/segments/api';
import type { ColumnSpec } from '@/lib/column-layout';
import { formatUbDateTime } from '@/lib/dayjs';
import { formatMnt, formatQty } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { useSetParam } from '@/lib/search-params';
import { useAction } from '@/lib/use-action';
import { useCreateParam } from '@/lib/use-create-param';
import { randomUuid } from '@/lib/uuid';
import {
  type StockCountScope,
  type StockCountStatus,
  useStockCountMutations,
  useStockCountVariance,
  useStockCounts,
} from './counts-api';
import { useWarehouseOptions } from './helpers';
import { useDefaultWarehouse } from './last-warehouse';
import { DocStatusBadge, WarehouseSelect } from './shared';
import { signedQty } from './stock-count-helpers';
import { SettlementText } from './stock-count-settlement';

// Counts by product (ADR-0176): the list, a new count and the variance report.

const COUNT_KINDS = ['WHOLESALE', 'STORE'] as const;
const STATUSES: readonly StockCountStatus[] = ['COUNTING', 'REVIEW', 'APPROVED', 'CANCELLED'];
const SCOPES: readonly StockCountScope[] = ['ALL', 'SCANNED', 'SEGMENT', 'SUPPLIER', 'CATEGORY'];
/** The server takes up to 50 suppliers or categories. */
const MAX_SCOPE_IDS = 50;

const LIST_COLUMNS: readonly ColumnSpec[] = [
  { key: 'number', kind: 'number' },
  { key: 'warehouse', kind: 'text', weight: 1 },
  { key: 'scope', kind: 'text', weight: 1 },
  { key: 'progress', kind: 'count', width: 7 },
  { key: 'status', kind: 'status' },
  { key: 'date', kind: 'datetime' },
  { key: 'chevron', kind: 'chevron' },
];

const isStatus = (value: string | null): value is StockCountStatus =>
  STATUSES.some((status) => status === value);

export function StockCountsPage() {
  const { t } = useTranslation();
  const canManage = useHasPermission('inventory.stocktakes.manage');
  const [params] = useSearchParams();
  const setParam = useSetParam();
  const warehouses = useWarehouseOptions(COUNT_KINDS);
  const warehouseParam = Number.parseInt(params.get('warehouseId') ?? '', 10);
  const warehouseId = Number.isNaN(warehouseParam) ? undefined : warehouseParam;
  const statusParam = params.get('status');
  const status = isStatus(statusParam) ? statusParam : undefined;
  const counts = useStockCounts({ warehouseId, status });
  const rows = counts.data?.pages.flatMap((page) => page.data) ?? [];
  const [creating, setCreating] = useCreateParam();

  return (
    <div>
      <PageHeader
        title={t('inventory.counts.title')}
        description={t('inventory.counts.description')}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/inventory/counts/variance">
                <FileSearch />
                {t('inventory.counts.variance.title')}
              </Link>
            </Button>
            {canManage ? (
              <Button onClick={() => setCreating(true)}>
                <Plus />
                {t('inventory.counts.new')}
              </Button>
            ) : null}
          </>
        }
      />
      {canManage ? (
        <Dialog open={creating} onOpenChange={setCreating}>
          {creating ? <CountCreateDialog onCancel={() => setCreating(false)} /> : null}
        </Dialog>
      ) : null}
      <FilterBar>
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
          <option value="">{t('inventory.stocktakes.allStatuses')}</option>
          {STATUSES.map((value) => (
            <option key={value} value={value}>
              {t(`inventory.docStatus.${value}`)}
            </option>
          ))}
        </NativeSelect>
      </FilterBar>
      <ProblemAlert problem={problemFromError(counts.error)} onRetry={counts.refetch} />
      <ListCard scroll>
        <ListTable columns={LIST_COLUMNS}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('inventory.number')}</TableHead>
              <TableHead>{t('inventory.warehouse')}</TableHead>
              <TableHead>{t('inventory.counts.scope')}</TableHead>
              <TableHead className="text-right">{t('inventory.counts.progressHead')}</TableHead>
              <TableHead>{t('inventory.status')}</TableHead>
              <TableHead>{t('inventory.date')}</TableHead>
              <ChevronHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {counts.isPending ? <SkeletonRows columns={7} /> : null}
            {rows.map((row) => (
              <LinkRow key={row.id} to={`/inventory/counts/${row.id}`}>
                <TableCell className="font-mono">
                  <Link
                    to={`/inventory/counts/${row.id}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {row.number ?? t('inventory.stocktake.noNumber', { id: row.id })}
                  </Link>
                </TableCell>
                <TableCell>{row.warehouseName}</TableCell>
                <TableCell className="truncate">
                  {row.scopeLabel
                    ? t('inventory.counts.scopeWith', {
                        scope: t(`inventory.counts.scopes.${row.scopeMode}`),
                        label: row.scopeLabel,
                      })
                    : t(`inventory.counts.scopes.${row.scopeMode}`)}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {t('inventory.counts.progress', { counted: row.counted, lines: row.lines })}
                </TableCell>
                <TableCell>
                  <DocStatusBadge status={row.status} />
                </TableCell>
                <TableCell className="font-mono">
                  {row.effectiveDate ??
                    (row.startedAt ? formatUbDateTime(Date.parse(row.startedAt)) : '')}
                </TableCell>
              </LinkRow>
            ))}
          </TableBody>
        </ListTable>
        {!counts.isPending && rows.length === 0 ? (
          <EmptyState icon={ClipboardCheck} title={t('inventory.counts.empty')} />
        ) : null}
        <LoadMore query={counts} />
      </ListCard>
    </div>
  );
}

interface Named {
  id: number;
  name: string;
}

/** A new count: the location, which products are called up and whether counters see the stock. */
function CountCreateDialog({ onCancel }: { onCancel: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const mine = useWarehouseOptions(COUNT_KINDS, true);
  const { defaultId, remember } = useDefaultWarehouse(mine.options, 'stocktake');
  const mutations = useStockCountMutations();
  const action = useAction();
  const [key, setKey] = useState(randomUuid);
  const [picked, setPicked] = useState<number | undefined>();
  const [scope, setScope] = useState<StockCountScope>('ALL');
  const [segmentId, setSegmentId] = useState('');
  const [suppliers, setSuppliers] = useState<Named[]>([]);
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [showStock, setShowStock] = useState(false);
  const [note, setNote] = useState('');
  const [supplierQ, setSupplierQ] = useState('');
  const warehouseId = picked ?? defaultId;
  const segments = useSegments('PRODUCT', { enabled: scope === 'SEGMENT' });
  const categories = useCategories();
  const found = useSuppliers(
    { q: supplierQ, status: 'ACTIVE' },
    { enabled: scope === 'SUPPLIER' && supplierQ.trim() !== '', limit: 20 },
  );
  const supplierOptions = (found.data?.pages[0]?.data ?? [])
    .filter((row) => !suppliers.some((chosen) => chosen.id === row.id))
    .map((row) => ({ value: String(row.id), label: row.name }));

  const chosen = ((): { ids: number[]; label: string | null } | null => {
    switch (scope) {
      case 'ALL':
      case 'SCANNED':
        return { ids: [], label: null };
      case 'SEGMENT': {
        const segment = (segments.data ?? []).find((row) => String(row.id) === segmentId);
        return segment ? { ids: [segment.id], label: segment.name } : null;
      }
      case 'SUPPLIER':
        return suppliers.length > 0
          ? {
              ids: suppliers.map((row) => row.id),
              label: suppliers.map((row) => row.name).join(', '),
            }
          : null;
      case 'CATEGORY': {
        const rows = (categories.data ?? []).filter((row) => categoryIds.includes(String(row.id)));
        return rows.length > 0
          ? { ids: rows.map((row) => row.id), label: rows.map((row) => row.name).join(', ') }
          : null;
      }
    }
  })();
  const ready = warehouseId !== undefined && chosen !== null && chosen.ids.length <= MAX_SCOPE_IDS;

  const create = () =>
    void action
      .run(async () => {
        if (warehouseId === undefined || chosen === null) return;
        const created = await mutations.create.mutateAsync({
          key,
          warehouseId,
          scopeMode: scope,
          ...(chosen.ids.length > 0 ? { scopeIds: chosen.ids } : {}),
          ...(chosen.label ? { scopeLabel: chosen.label.slice(0, 200) } : {}),
          showStock,
          ...(note.trim() ? { note: note.trim() } : {}),
        });
        remember(warehouseId);
        await navigate(`/inventory/counts/${created.id}`, { replace: true });
      })
      .then((done) => {
        if (!done) setKey(randomUuid());
      });

  return (
    <DialogContent closeLabel={t('common.close')} size="md">
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready && !mutations.create.isPending) create();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('inventory.counts.new')}</DialogTitle>
          <DialogDescription>{t(`inventory.counts.scopeHints.${scope}`)}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <ProblemAlert problem={action.problem} />
          <FormField label={t('inventory.warehouse')} htmlFor="count-warehouse">
            <WarehouseSelect
              id="count-warehouse"
              options={mine.options}
              value={warehouseId}
              emptyLabel={t('inventory.stocktake.pickWarehouse')}
              onChange={setPicked}
            />
          </FormField>
          <FormField label={t('inventory.counts.scope')} htmlFor="count-scope">
            <NativeSelect
              id="count-scope"
              value={scope}
              onChange={(event) => {
                const next = SCOPES.find((value) => value === event.target.value);
                if (next) setScope(next);
              }}
            >
              {SCOPES.map((value) => (
                <option key={value} value={value}>
                  {t(`inventory.counts.scopes.${value}`)}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          {scope === 'SEGMENT' ? (
            <FormField label={t('inventory.counts.segment')} htmlFor="count-segment">
              <NativeSelect
                id="count-segment"
                value={segmentId}
                onChange={(event) => setSegmentId(event.target.value)}
              >
                <option value="">{t('inventory.counts.pickSegment')}</option>
                {(segments.data ?? []).map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
          ) : null}
          {scope === 'SUPPLIER' ? (
            <FormField label={t('inventory.counts.suppliers')} htmlFor="count-supplier">
              <div className="flex flex-col gap-2">
                <SearchSelect
                  id="count-supplier"
                  value=""
                  options={supplierOptions}
                  placeholder={t('inventory.counts.supplierSearch')}
                  onSearch={setSupplierQ}
                  searching={found.isFetching}
                  onChange={(next) => {
                    const row = supplierOptions.find((option) => option.value === next);
                    if (row && suppliers.length < MAX_SCOPE_IDS) {
                      setSuppliers((list) => [
                        ...list,
                        { id: Number.parseInt(row.value, 10), name: row.label },
                      ]);
                    }
                  }}
                />
                {suppliers.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {suppliers.map((row) => (
                      <FilterChip
                        key={row.id}
                        clearLabel={t('inventory.counts.remove', { name: row.name })}
                        onClear={() =>
                          setSuppliers((list) => list.filter((other) => other.id !== row.id))
                        }
                      >
                        {row.name}
                      </FilterChip>
                    ))}
                  </div>
                ) : null}
              </div>
            </FormField>
          ) : null}
          {scope === 'CATEGORY' ? (
            <FormField
              label={t('inventory.counts.categories')}
              error={
                categoryIds.length > MAX_SCOPE_IDS
                  ? t('inventory.counts.tooMany', { max: MAX_SCOPE_IDS })
                  : undefined
              }
            >
              <div className="max-h-56 overflow-y-auto rounded-lg border border-border p-3">
                <CheckboxGroup
                  name="count-categories"
                  options={(categories.data ?? []).map((row) => ({
                    value: String(row.id),
                    label: row.name,
                  }))}
                  value={categoryIds}
                  onChange={setCategoryIds}
                />
              </div>
            </FormField>
          ) : null}
          <label className="flex items-start gap-3 text-sm">
            <Switch className="mt-0.5" checked={showStock} onCheckedChange={setShowStock} />
            <span className="flex flex-col">
              <span className="font-medium">{t('inventory.counts.showStock')}</span>
              <span className="text-[0.8125rem] text-muted-foreground">
                {t('inventory.counts.showStockHint')}
              </span>
            </span>
          </label>
          <FormField label={t('inventory.note')} htmlFor="count-note">
            <Input
              id="count-note"
              maxLength={500}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </FormField>
        </div>
        <DialogFormFooter
          pending={mutations.create.isPending}
          onCancel={onCancel}
          submitLabel={t('inventory.counts.create')}
          disabled={!ready}
        />
      </form>
    </DialogContent>
  );
}

/**
 * The variance report: the differences of the approved counts in a period. A product opens its
 * movement report for the same dates; a double click on a row opens the count.
 */
export function StockCountVariancePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const seesCost = useHasPermission('inventory.costs.manage');
  const [params] = useSearchParams();
  const setParam = useSetParam();
  const warehouses = useWarehouseOptions(COUNT_KINDS);
  const from = params.get('from') ?? monthStart();
  const to = params.get('to') ?? businessDate();
  const warehouseParam = Number.parseInt(params.get('warehouseId') ?? '', 10);
  const warehouseId = Number.isNaN(warehouseParam) ? undefined : warehouseParam;
  const [text, setText] = useState('');
  const q = useDeferredValue(text.trim());
  const variance = useStockCountVariance({ from, to, warehouseId, q });
  const rows = variance.data?.pages.flatMap((page) => page.data) ?? [];
  const columns: readonly ColumnSpec[] = [
    { key: 'date', kind: 'date' },
    { key: 'number', kind: 'number' },
    { key: 'warehouse', kind: 'text', weight: 1 },
    { key: 'product', kind: 'text', weight: 2 },
    { key: 'expected', kind: 'qty' },
    { key: 'counted', kind: 'qty' },
    { key: 'difference', kind: 'qty' },
    ...(seesCost ? [{ key: 'cost', kind: 'money' } as const] : []),
    { key: 'settlement', kind: 'text', weight: 1 },
    { key: 'charge', kind: 'money' },
  ];

  return (
    <div>
      <PageHeader
        title={t('inventory.counts.variance.title')}
        description={t('inventory.counts.variance.description')}
        crumbs={[{ label: t('inventory.counts.title'), to: '/inventory/counts' }]}
      />
      <FilterBar>
        <SearchField
          aria-label={t('common.search')}
          placeholder={t('inventory.counts.searchProduct')}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <DateRangeFilter
          label={t('inventory.date')}
          fromLabel={t('inventory.counts.variance.from')}
          toLabel={t('inventory.counts.variance.to')}
          from={from}
          to={to}
          onFrom={(value) => setParam('from', value ?? monthStart())}
          onTo={(value) => setParam('to', value ?? businessDate())}
        />
        <WarehouseSelect
          variant="filter"
          options={warehouses.options}
          value={warehouseId}
          emptyLabel={t('inventory.allWarehouses')}
          onChange={(id) => setParam('warehouseId', id === undefined ? '' : String(id))}
        />
      </FilterBar>
      <ProblemAlert problem={problemFromError(variance.error)} onRetry={variance.refetch} />
      <ListCard scroll>
        <ListTable columns={columns}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('inventory.date')}</TableHead>
              <TableHead>{t('inventory.number')}</TableHead>
              <TableHead>{t('inventory.warehouse')}</TableHead>
              <TableHead>{t('inventory.product')}</TableHead>
              <TableHead className="text-right">{t('inventory.counts.expected')}</TableHead>
              <TableHead className="text-right">{t('inventory.counts.counted')}</TableHead>
              <TableHead className="text-right">{t('inventory.counts.difference')}</TableHead>
              {seesCost ? (
                <TableHead className="text-right">{t('inventory.counts.unitCost')}</TableHead>
              ) : null}
              <TableHead>{t('inventory.counts.settlementHead')}</TableHead>
              <TableHead className="text-right">{t('inventory.counts.charge')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {variance.isPending ? <SkeletonRows columns={columns.length} /> : null}
            {rows.map((row) => (
              <TableRow
                key={row.lineId}
                className="cursor-default"
                title={t('inventory.counts.variance.rowHint')}
                onDoubleClick={() => void navigate(`/inventory/counts/${row.stocktakeId}`)}
              >
                <TableCell className="font-mono">{row.effectiveDate ?? ''}</TableCell>
                <TableCell className="font-mono">
                  {row.number ?? t('inventory.stocktake.noNumber', { id: row.stocktakeId })}
                </TableCell>
                <TableCell className="truncate">{row.warehouseName}</TableCell>
                <TableCell className="truncate">
                  <Link
                    to={`/inventory/movements?product=${row.productId}&warehouse=${row.warehouseId}&from=${from}&to=${to}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {row.name}
                  </Link>
                  <span className="ml-2 font-mono text-xs text-muted-foreground">{row.sku}</span>
                </TableCell>
                <TableCell className="text-right font-mono">
                  {row.expectedQty === null ? '' : formatQty(row.expectedQty)}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {row.countedQty === null ? '' : formatQty(row.countedQty)}
                </TableCell>
                <TableCell
                  className={
                    row.differenceQty.startsWith('-')
                      ? 'text-right font-mono font-medium text-destructive'
                      : 'text-right font-mono font-medium'
                  }
                >
                  {signedQty(row.differenceQty)}
                </TableCell>
                {seesCost ? (
                  <TableCell className="text-right font-mono">
                    {row.unitCost === null ? '' : formatMnt(row.unitCost)}
                  </TableCell>
                ) : null}
                <TableCell className="truncate">
                  <SettlementText value={row.settlement} />
                </TableCell>
                <TableCell className="text-right font-mono">
                  {row.chargeAmount === null ? '' : formatMnt(row.chargeAmount)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </ListTable>
        {!variance.isPending && rows.length === 0 ? (
          <EmptyState icon={FileSearch} title={t('inventory.counts.variance.empty')} />
        ) : null}
        <LoadMore query={variance} />
      </ListCard>
    </div>
  );
}
