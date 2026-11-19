import { Download, PackageSearch } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import {
  EmptyState,
  FilterBar,
  FilterToggle,
  ListCard,
  ListTable,
  LoadMore,
  SearchField,
  SegmentedControl,
  SkeletonRows,
  TruncateCell,
} from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useWarehouses } from '@/features/identity/api';
import type { ColumnSpec } from '@/lib/column-layout';
import { formatUbMinute } from '@/lib/dayjs';
import { formatQty } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { useDebounced } from '@/lib/use-debounced';
import {
  type ErkhetStockGroup,
  type ErkhetStockLocation,
  type ErkhetStockRow,
  type ErkhetStockRun,
  useErkhetStockCompare,
  useErkhetStockLocations,
  useErkhetStockMutations,
  useErkhetStockOverview,
} from './api';

const GROUPS: readonly ErkhetStockGroup[] = ['MATCHED', 'NOT_IN_BTO', 'NOT_IN_ERKHET'];

const COLUMNS: readonly ColumnSpec[] = [
  { key: 'code', kind: 'code', width: 8 },
  { key: 'name', kind: 'text', weight: 4, min: 12 },
  { key: 'erkhet', kind: 'qty', width: 9 },
  { key: 'bto', kind: 'qty', width: 9 },
  { key: 'difference', kind: 'qty', width: 7 },
  { key: 'note', kind: 'text', weight: 2, min: 8, drop: 1 },
];

const LOCATION_COLUMNS: readonly ColumnSpec[] = [
  { key: 'code', kind: 'code', width: 5 },
  { key: 'name', kind: 'text', weight: 2, min: 10 },
  { key: 'read', kind: 'status', width: 8 },
  { key: 'warehouse', kind: 'text', weight: 2, min: 12 },
];

const isGroup = (value: string | null): value is ErkhetStockGroup =>
  (GROUPS as readonly string[]).includes(value ?? '');

/** A quantity with its unit, or «—» when it is not known. */
const qtyText = (value: string | null, unit: string | null) =>
  value === null ? '—' : [formatQty(value), unit].filter(Boolean).join(' ');

/**
 * «Эрхэтийн үлдэгдэл» (ADR-0221): Erkhet's balances by location, read through erxes in the
 * background, beside Bto's on-hand of this moment. Each Erkhet location is linked to a Bto warehouse
 * once, by hand; a warehouse's linked locations add up. Units are not converted. Nothing here
 * changes stock: levelling Bto to Erkhet comes later.
 */
export function ErkhetStockPage() {
  const { t } = useTranslation();
  const canManage = useHasPermission('inventory.setup.manage');
  const [params, setParams] = useSearchParams();
  const overview = useErkhetStockOverview();
  const locations = useErkhetStockLocations();
  const warehouses = useWarehouses();
  const mutations = useErkhetStockMutations();
  const action = useAction();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const q = useDebounced(search.trim(), 300);

  const linked = useMemo(() => {
    const seen = new Map<number, string>();
    for (const location of locations.data ?? []) {
      if (location.warehouseId !== null && !seen.has(location.warehouseId)) {
        seen.set(location.warehouseId, location.warehouseName ?? String(location.warehouseId));
      }
    }
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [locations.data]);

  const warehouseParam = Number.parseInt(params.get('warehouse') ?? '', 10);
  const warehouseId = linked.some((entry) => entry.id === warehouseParam)
    ? warehouseParam
    : (linked[0]?.id ?? null);
  const groupParam = params.get('group');
  const group: ErkhetStockGroup = isGroup(groupParam) ? groupParam : 'MATCHED';
  const onlyDifferent = params.get('all') !== '1';
  const compare = useErkhetStockCompare({ warehouseId, group, onlyDifferent, q });
  const first = compare.data?.pages[0];
  const rows = compare.data?.pages.flatMap((page) => page.data) ?? [];

  const patch = (changes: Record<string, string | null>) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const [key, value] of Object.entries(changes)) {
          if (value === null || value === '') next.delete(key);
          else next.set(key, value);
        }
        return next;
      },
      { replace: true },
    );

  const start = () =>
    void action.run(async () => {
      const result = await mutations.start.mutateAsync();
      if (result.active) toast.success(t('erkhetStock.started'));
      else if (!result.configured) toast.warning(t('erkhetStock.notConfigured'));
    });

  const link = (location: ErkhetStockLocation, value: string) =>
    void action.run(async () => {
      const id = Number.parseInt(value, 10);
      await mutations.link.mutateAsync({
        code: location.code,
        warehouseId: Number.isInteger(id) ? id : null,
      });
      toast.success(t('erkhetStock.linked', { code: location.code }));
    });

  const state = overview.data;
  const running = state?.active ?? null;
  const stockWarehouses = (warehouses.data ?? []).filter(
    (warehouse) => warehouse.kind !== 'TRANSIT' && warehouse.status === 'ACTIVE',
  );
  const counts = first?.counts;
  const groupCount = (value: ErkhetStockGroup) =>
    counts === undefined
      ? null
      : value === 'MATCHED'
        ? onlyDifferent
          ? counts.different
          : counts.matched
        : value === 'NOT_IN_BTO'
          ? counts.notInBto
          : counts.notInErkhet;

  return (
    <div>
      <PageHeader
        title={t('erkhetStock.title')}
        description={t('erkhetStock.description')}
        actions={
          canManage ? (
            <Button
              pending={mutations.start.isPending}
              disabled={running !== null || state?.configured === false}
              onClick={start}
            >
              <Download />
              {running ? t('erkhetStock.running') : t('erkhetStock.start')}
            </Button>
          ) : null
        }
      />
      <ProblemAlert
        problem={
          problemFromError(overview.error ?? locations.error ?? compare.error) ?? action.problem
        }
      />
      {state && !state.configured ? (
        <Alert className="mb-4">
          <AlertDescription>{t('erkhetStock.notConfigured')}</AlertDescription>
        </Alert>
      ) : null}

      <RunSummary active={running} latest={state?.latest ?? null} failed={state?.failed ?? null} />

      <h2 className="mt-6 mb-2 text-base font-semibold">{t('erkhetStock.locations.title')}</h2>
      <p className="mb-3 text-sm text-muted-foreground">{t('erkhetStock.locations.hint')}</p>
      <ListCard className="mb-6">
        <ListTable columns={LOCATION_COLUMNS} aria-label={t('erkhetStock.locations.title')}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('erkhetStock.locations.code')}</TableHead>
              <TableHead>{t('erkhetStock.locations.name')}</TableHead>
              <TableHead>{t('erkhetStock.locations.read')}</TableHead>
              <TableHead>{t('erkhetStock.locations.warehouse')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {locations.isPending ? <SkeletonRows columns={LOCATION_COLUMNS.length} /> : null}
            {(locations.data ?? []).map((location) => (
              <TableRow key={location.code}>
                <TableCell className="font-mono tabular-nums">{location.code}</TableCell>
                <TruncateCell text={location.name ?? ''} />
                <TableCell>
                  {location.read ? (
                    <Badge variant="secondary">{t('erkhetStock.locations.isRead')}</Badge>
                  ) : (
                    <span className="text-muted-foreground">
                      {t('erkhetStock.locations.notRead')}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <NativeSelect
                    aria-label={t('erkhetStock.locations.warehouseOf', { code: location.code })}
                    value={location.warehouseId === null ? '' : String(location.warehouseId)}
                    disabled={!canManage || mutations.link.isPending}
                    onChange={(event) => link(location, event.target.value)}
                  >
                    <option value="">{t('erkhetStock.locations.unlinked')}</option>
                    {stockWarehouses.map((warehouse) => (
                      <option key={warehouse.id} value={String(warehouse.id)}>
                        {warehouse.name}
                      </option>
                    ))}
                  </NativeSelect>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </ListTable>
      </ListCard>

      <h2 className="mb-2 text-base font-semibold">{t('erkhetStock.compare.title')}</h2>
      {linked.length === 0 && !locations.isPending ? (
        <EmptyState icon={PackageSearch} title={t('erkhetStock.compare.noLinks')} />
      ) : (
        <>
          <FilterBar
            end={
              first?.readAt ? (
                <p className="text-sm text-muted-foreground">
                  {t('erkhetStock.compare.readAt', { at: formatUbMinute(first.readAt) })}
                </p>
              ) : null
            }
          >
            <NativeSelect
              variant="filter"
              active
              aria-label={t('erkhetStock.compare.warehouse')}
              value={warehouseId === null ? '' : String(warehouseId)}
              onChange={(event) => patch({ warehouse: event.target.value })}
            >
              {linked.map((entry) => (
                <option key={entry.id} value={String(entry.id)}>
                  {entry.name}
                </option>
              ))}
            </NativeSelect>
            <SegmentedControl
              name={t('erkhetStock.compare.groupLabel')}
              options={GROUPS}
              value={group}
              label={(value) => {
                const count = groupCount(value);
                return count === null
                  ? t(`erkhetStock.group.${value}`)
                  : t('erkhetStock.groupCount', {
                      group: t(`erkhetStock.group.${value}`),
                      count,
                    });
              }}
              onChange={(value) => patch({ group: value === 'MATCHED' ? null : value })}
            />
            {group === 'MATCHED' ? (
              <FilterToggle
                label={t('erkhetStock.compare.onlyDifferent')}
                checked={onlyDifferent}
                onCheckedChange={(checked) => patch({ all: checked ? null : '1' })}
              />
            ) : null}
            <SearchField
              placeholder={t('erkhetStock.compare.search')}
              aria-label={t('erkhetStock.compare.search')}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                patch({ q: event.target.value.trim() || null });
              }}
            />
          </FilterBar>
          {first && first.locations.length > 0 ? (
            <p className="mb-2 text-sm text-muted-foreground">
              {t('erkhetStock.compare.locationsOf', {
                list: first.locations
                  .map((location) => [location.code, location.name].filter(Boolean).join(' '))
                  .join(', '),
              })}
            </p>
          ) : null}
          <ListCard scroll>
            <ListTable columns={COLUMNS}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('erkhetStock.column.code')}</TableHead>
                  <TableHead>{t('erkhetStock.column.name')}</TableHead>
                  <TableHead className="text-right">{t('erkhetStock.column.erkhet')}</TableHead>
                  <TableHead className="text-right">{t('erkhetStock.column.bto')}</TableHead>
                  <TableHead className="text-right">{t('erkhetStock.column.difference')}</TableHead>
                  <TableHead>{t('erkhetStock.column.note')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {compare.isPending && warehouseId !== null ? (
                  <SkeletonRows columns={COLUMNS.length} />
                ) : null}
                {rows.map((row) => (
                  <StockRow key={row.key} row={row} />
                ))}
              </TableBody>
            </ListTable>
            {!compare.isPending && rows.length === 0 ? (
              <EmptyState
                icon={PackageSearch}
                title={
                  first?.runId === null
                    ? t('erkhetStock.compare.noRun')
                    : t(`erkhetStock.empty.${group}`)
                }
              />
            ) : null}
            <LoadMore query={compare} />
          </ListCard>
        </>
      )}
    </div>
  );
}

function StockRow(props: { row: ErkhetStockRow }) {
  const { t } = useTranslation();
  const { row } = props;
  const negative = row.difference !== null && row.difference.startsWith('-');
  const different = row.difference !== null && !/^-?0(\.0+)?$/.test(row.difference);
  const note = [
    row.reason ? t(`erkhetStock.reason.${row.reason}`) : null,
    row.erxesCodes.length > 0 && row.erxesCodes.some((code) => code !== row.code)
      ? t('erkhetStock.erxesCodes', { codes: row.erxesCodes.join(', ') })
      : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <TableRow>
      <TableCell className="font-mono tabular-nums">{row.code ?? ''}</TableCell>
      <TruncateCell text={row.name ?? ''} />
      <TableCell className="text-right tabular-nums">{qtyText(row.erkhet, row.erxesUom)}</TableCell>
      <TableCell className="text-right tabular-nums">{qtyText(row.bto, row.btoUnit)}</TableCell>
      <TableCell
        className={
          different
            ? `text-right font-medium tabular-nums ${negative ? 'text-destructive' : 'text-warning'}`
            : 'text-right tabular-nums text-muted-foreground'
        }
      >
        {row.difference === null ? '—' : formatQty(row.difference)}
      </TableCell>
      <TableCell>
        <span className="flex min-w-0 items-center gap-1.5">
          {row.unitDiffers ? (
            <Badge variant="warning" title={t('erkhetStock.unitDiffersHint')}>
              {t('erkhetStock.unitDiffers')}
            </Badge>
          ) : null}
          <span className="min-w-0 truncate text-muted-foreground">{note}</span>
        </span>
      </TableCell>
    </TableRow>
  );
}

/** The run under way with its progress, the last finished one, a newer one that failed. */
function RunSummary(props: {
  active: ErkhetStockRun | null;
  latest: ErkhetStockRun | null;
  failed: ErkhetStockRun | null;
}) {
  const { t } = useTranslation();
  const { active, latest, failed } = props;
  return (
    <div className="flex flex-col gap-2">
      {active ? (
        <Alert>
          <AlertDescription>
            {active.status === 'QUEUED'
              ? t('erkhetStock.run.queued')
              : t('erkhetStock.run.progress', {
                  done: active.batchesDone,
                  total: active.batchesTotal,
                  products: active.products,
                  failed: active.batchesFailed,
                })}
            {active.estimatedFinishAt ? (
              <span className="ml-1">
                {t('erkhetStock.run.finishAt', { at: formatUbMinute(active.estimatedFinishAt) })}
              </span>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
      {failed ? (
        <Alert variant="destructive">
          <AlertDescription>
            {t('erkhetStock.run.failed', {
              at: formatUbMinute(failed.finishedAt ?? failed.createdAt),
              reason: t(`erkhetStock.failure.${failed.failure ?? 'INTERNAL'}`),
            })}
            {failed.failureDetail ? (
              <p className="mt-1 text-xs break-words">
                {t('erkhetStock.run.detail', { detail: failed.failureDetail })}
              </p>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
      <p className="text-sm text-muted-foreground">
        {latest
          ? t('erkhetStock.run.latest', {
              at: formatUbMinute(latest.finishedAt ?? latest.createdAt),
              products: latest.products,
              failed: latest.batchesFailed,
              unread: latest.productsUnread,
              by: latest.startedBy ?? '',
            })
          : t('erkhetStock.run.never')}
      </p>
    </div>
  );
}
