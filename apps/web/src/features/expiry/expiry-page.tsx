import type { ExpiryView } from '@tugeel/shared/expiry';
import type { TFunction } from 'i18next';
import {
  AlertCircle,
  AlertTriangle,
  Archive,
  CalendarX2,
  FileText,
  type LucideIcon,
  Plus,
  Printer,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavigationType, useNavigationType, useSearchParams } from 'react-router';
import { ColumnChooser } from '@/components/column-chooser';
import {
  ButtonRow,
  ChevronHead,
  EmptyState,
  FilterBar,
  ListCard,
  ListTable,
  LoadMore,
  SearchField,
  SkeletonRows,
  TruncateCell,
} from '@/components/list';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatUbMinute } from '@/lib/dayjs';
import { formatCount, formatQty } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { hrefWithParam, useSetParam } from '@/lib/search-params';
import { useCreateParam } from '@/lib/use-create-param';
import { useDebounced } from '@/lib/use-debounced';
import { useHiddenColumns } from '@/lib/use-hidden-columns';
import { useMediaQuery } from '@/lib/use-media-query';
import { cn } from '@/lib/utils';
import {
  type ExpiryItem,
  type ExpirySummary,
  useExpiryFilterName,
  useExpiryFilters,
  useExpiryItems,
  useExpirySummary,
} from './api';
import {
  CHEVRON_COLUMN,
  DEFAULT_HIDDEN_EXPIRY_COLUMNS,
  EXPIRY_COLUMN_KEYS,
  EXPIRY_COLUMN_SPECS,
  type ExpiryColumnKey,
  FULL_DEFAULT_HIDDEN_EXPIRY_COLUMNS,
  FULL_SCREEN,
  isNumericColumn,
  LOCKED_EXPIRY_COLUMNS,
  WIDE_DEFAULT_HIDDEN_EXPIRY_COLUMNS,
} from './expiry-columns';
import { ExpiryCreateDialog } from './expiry-create-dialog';
import {
  ExpiryFilterPanel,
  ExpiryFilterSelects,
  type SetExpiryFilter,
} from './expiry-filter-panel';
import { ExpiryRecordPanel } from './expiry-record-panel';
import {
  type ExpiryFilterOptions,
  expiryPrintHref,
  expiryRecordParams,
  isNarrowed,
  parseExpiryFilter,
  positiveId,
  URGENCY_ROW,
  viewCount,
  withChosenFilters,
} from './helpers';
import { DaysLeft, ExpiryStatusBadge, LiabilityBadge } from './parts';

/** The list's name in the column-choice key (ADR-0050). */
const COLUMNS_LIST = 'inventory.expiry';
/** The search box's wait before it asks the server, as on the old page. */
const SEARCH_WAIT_MS = 300;
const NO_FILTER_OPTIONS: ExpiryFilterOptions = { suppliers: [], warehouses: [], creators: [] };

/**
 * «Хугацааны хяналт» (ADR-0172 #8): the register of what expires, for every signed-in person. The
 * URL keeps the filters and the open record (`?item=`), so the home tiles and a printed list lead
 * to the same view; a row opens the record panel instead of the old page's inline editing.
 */
export function ExpiryPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const setParam = useSetParam();
  const navigation = useNavigationType();
  const filter = parseExpiryFilter(params);
  const [search, setSearch] = useState(filter.q);
  // The menu's own link carries no search, and Back brings an earlier one: the box follows. Its own
  // typing replaces the address, so it never follows itself and no key is lost to a slow address.
  useEffect(() => {
    if (navigation !== NavigationType.Replace) setSearch(filter.q);
  }, [navigation, filter.q]);
  const q = useDebounced(filter.q, SEARCH_WAIT_MS);
  const summary = useExpirySummary();
  const options = useExpiryFilters(filter.view);
  const items = useExpiryItems({ ...filter, q });
  const rows = items.data?.pages.flatMap((page) => page.data) ?? [];
  const [creating, setCreating] = useCreateParam();
  const itemId = positiveId(params.get('item'));
  const today = summary.data?.today;

  const fullScreen = useMediaQuery(FULL_SCREEN);
  const columnState = useHiddenColumns(
    COLUMNS_LIST,
    EXPIRY_COLUMN_KEYS,
    LOCKED_EXPIRY_COLUMNS,
    DEFAULT_HIDDEN_EXPIRY_COLUMNS,
    fullScreen ? FULL_DEFAULT_HIDDEN_EXPIRY_COLUMNS : WIDE_DEFAULT_HIDDEN_EXPIRY_COLUMNS,
  );
  const { hidden } = columnState;
  const columns = useMemo(() => EXPIRY_COLUMN_KEYS.filter((key) => !hidden.has(key)), [hidden]);
  const specs = useMemo(
    () => [...columns.map((key) => EXPIRY_COLUMN_SPECS[key]), CHEVRON_COLUMN],
    [columns],
  );

  const narrowed = isNarrowed(filter);
  const filtered = narrowed || filter.view !== 'ACTIVE';
  const clearFilters = () => {
    setSearch('');
    setParams(new URLSearchParams(), { replace: true });
  };
  const change: SetExpiryFilter = (param, value) => setParam(param, value);
  const setView = (view: ExpiryView) => setParam('view', view === 'ACTIVE' ? '' : view);
  const filterName = useExpiryFilterName();
  const filterOptions = options.data
    ? withChosenFilters(
        options.data,
        filter,
        (kind, id) => filterName(kind, id) ?? t('expiry.filters.chosen', { id }),
      )
    : NO_FILTER_OPTIONS;
  const failed = [items, summary, options].find((read) => read.error);

  return (
    <div>
      <PageHeader
        title={t('expiry.title')}
        meta={countLine(t, summary.data, filter.view, narrowed, rows.length, items.hasNextPage)}
        actions={
          <>
            <Button asChild variant="outline">
              <Link to={expiryPrintHref(filter)} target="_blank">
                <Printer />
                {t('expiry.print')}
              </Link>
            </Button>
            <Button onClick={() => setCreating(true)}>
              <Plus />
              {t('expiry.create')}
            </Button>
          </>
        }
      />
      <ExpiryTiles summary={summary.data} view={filter.view} onView={setView} />
      <div className="flex items-start gap-4">
        <ExpiryFilterPanel
          filter={filter}
          options={filterOptions}
          loaded={options.data !== undefined}
          onChange={change}
        />
        <div className="min-w-0 flex-1">
          <FilterBar
            end={
              <>
                {filtered ? (
                  <Button variant="ghost" size="sm" className="text-link" onClick={clearFilters}>
                    {t('common.clearFilters')}
                  </Button>
                ) : null}
                <ColumnChooser
                  keys={EXPIRY_COLUMN_KEYS}
                  locked={LOCKED_EXPIRY_COLUMNS}
                  label={(key) => t(`expiry.columns.${key}`)}
                  hidden={hidden}
                  toggle={columnState.toggle}
                  showAll={columnState.showAll}
                />
              </>
            }
          >
            <SearchField
              className="sm:w-72"
              aria-label={t('common.search')}
              placeholder={t('expiry.searchPlaceholder')}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setParam('q', event.target.value.trim());
              }}
            />
            <ExpiryFilterSelects filter={filter} options={filterOptions} onChange={change} />
          </FilterBar>
          {/* The three reads fail together more often than not: one alert says it. */}
          <ProblemAlert
            problem={problemFromError(failed?.error)}
            {...(failed ? { onRetry: failed.refetch } : {})}
          />
          <ListCard scroll beside>
            <ListTable columns={specs}>
              <TableHeader>
                <TableRow>
                  {columns.map((key) => (
                    <TableHead key={key} className={cn(isNumericColumn(key) && 'text-right')}>
                      {t(`expiry.columns.${key}`)}
                    </TableHead>
                  ))}
                  <ChevronHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.isPending ? <SkeletonRows columns={specs.length} /> : null}
                {rows.map((item) => (
                  <ButtonRow
                    key={item.id}
                    className={URGENCY_ROW[item.urgency]}
                    onOpen={() => setParam('item', String(item.id))}
                  >
                    {columns.map((key) => (
                      <ExpiryCell
                        key={key}
                        column={key}
                        item={item}
                        href={hrefWithParam(params, 'item', String(item.id))}
                      />
                    ))}
                  </ButtonRow>
                ))}
              </TableBody>
            </ListTable>
            {/* A failed read says so above, and says nothing about what is there. */}
            {!items.isPending && !items.isError && rows.length === 0 ? (
              <EmptyState
                icon={CalendarX2}
                title={t('expiry.empty')}
                {...(filtered ? { onClearFilters: clearFilters } : {})}
              />
            ) : null}
            <LoadMore query={items} />
          </ListCard>
        </div>
      </div>
      {creating ? (
        <ExpiryCreateDialog
          today={today}
          recordHref={(id) => `?${expiryRecordParams(params, id).toString()}`}
          onOpenRecord={(id) => setParams(expiryRecordParams(params, id), { replace: true })}
          onClose={() => setCreating(false)}
        />
      ) : null}
      <ExpiryRecordPanel itemId={itemId} today={today} onClose={() => setParam('item', '')} />
    </div>
  );
}

/**
 * The header's count, in the old page's words. The summary knows a whole view; with another filter
 * on, only what has loaded is known, so a list with more to load says «+».
 */
function countLine(
  t: TFunction,
  summary: ExpirySummary | undefined,
  view: ExpiryView,
  narrowed: boolean,
  loaded: number,
  more: boolean,
): string | undefined {
  if (!narrowed) {
    return summary ? t('expiry.count', { n: formatCount(viewCount(summary, view)) }) : undefined;
  }
  return more
    ? t('expiry.countMore', { n: formatCount(loaded) })
    : t('expiry.count', { n: formatCount(loaded) });
}

const TILE_TONES = {
  info: 'bg-info-soft text-link',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-destructive',
  neutral: 'bg-fill text-muted-foreground',
} as const;

/** The old page's four cards; a click sets the view, and the card standing on it says so. */
function ExpiryTiles(props: {
  summary: ExpirySummary | undefined;
  view: ExpiryView;
  onView: (view: ExpiryView) => void;
}) {
  const { t } = useTranslation();
  const { summary } = props;
  const tiles: {
    view: ExpiryView;
    label: string;
    hint: string;
    count: number | undefined;
    icon: LucideIcon;
    tone: keyof typeof TILE_TONES;
  }[] = [
    {
      view: 'ACTIVE',
      label: t('expiry.tiles.active'),
      hint: t('expiry.tiles.activeHint'),
      count: summary?.active,
      icon: FileText,
      tone: 'info',
    },
    {
      view: 'SOON',
      label: t('expiry.tiles.soon'),
      hint: t('expiry.tiles.soonHint', { n: summary?.soonDays ?? '' }),
      count: summary?.soon,
      icon: AlertTriangle,
      tone: 'warning',
    },
    {
      view: 'EXPIRED',
      label: t('expiry.tiles.expired'),
      hint: t('expiry.tiles.expiredHint'),
      count: summary?.expired,
      icon: AlertCircle,
      tone: 'danger',
    },
    {
      view: 'ARCHIVED',
      label: t('expiry.tiles.archived'),
      hint: t('expiry.tiles.archivedHint'),
      count: summary?.archived,
      icon: Archive,
      tone: 'neutral',
    },
  ];
  return (
    <section
      aria-label={t('expiry.tiles.label')}
      className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4"
    >
      {tiles.map((tile) => {
        const count = tile.count === undefined ? '' : formatCount(tile.count);
        return (
          <button
            key={tile.view}
            type="button"
            aria-pressed={props.view === tile.view}
            aria-label={`${tile.label}: ${count}`}
            className={cn(
              'flex items-center gap-3 rounded-xl bg-card px-3.5 py-2.5 text-left shadow-card ring-1 ring-black/[0.06] transition-[box-shadow,transform] duration-200 ease-apple outline-none hover:shadow-popover focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98]',
              props.view === tile.view && 'ring-2 ring-primary',
            )}
            onClick={() => props.onView(tile.view)}
          >
            <span
              className={cn(
                'grid size-9 shrink-0 place-items-center rounded-lg',
                TILE_TONES[tile.tone],
              )}
            >
              <tile.icon aria-hidden className="size-5" />
            </span>
            <span className="min-w-0">
              <span className="block font-mono text-xl leading-none font-semibold">
                {count || t('common.none')}
              </span>
              <span className="mt-1 block truncate text-[0.8125rem] leading-snug text-muted-foreground">
                {tile.label}
                <span className="text-xs"> · {tile.hint}</span>
              </span>
            </span>
          </button>
        );
      })}
    </section>
  );
}

/** One cell of a row. The product's name is a real link, the keyboard's way to the panel. */
function ExpiryCell(props: { column: ExpiryColumnKey; item: ExpiryItem; href: string }) {
  const { t } = useTranslation();
  const { column, item } = props;
  switch (column) {
    case 'product':
      return (
        <TableCell>
          <Link
            to={props.href}
            title={item.product.name}
            className="block truncate font-medium underline-offset-4 hover:underline"
          >
            {item.product.name}
          </Link>
          <span className="block font-mono text-xs text-muted-foreground">{item.product.sku}</span>
        </TableCell>
      );
    case 'supplier':
      return (
        <TruncateCell text={item.supplier?.name ?? t('common.none')} className="text-[0.8125rem]" />
      );
    case 'note':
      // Wraps, as the old page showed a note whole.
      return (
        <TableCell className="text-[0.8125rem] leading-snug break-words whitespace-pre-wrap">
          {item.note ?? <span className="text-muted-foreground">{t('common.none')}</span>}
        </TableCell>
      );
    case 'expiryDate':
      return <TableCell className="font-mono text-[0.8125rem]">{item.expiryDate}</TableCell>;
    case 'daysLeft':
      return (
        <TableCell className="text-[0.8125rem] leading-snug whitespace-normal">
          <DaysLeft daysLeft={item.daysLeft} urgency={item.urgency} />
        </TableCell>
      );
    case 'qtyFloor':
      return <TableCell className="text-right font-mono">{formatQty(item.qtyFloor)}</TableCell>;
    case 'qtyWarehouse':
      return <TableCell className="text-right font-mono">{formatQty(item.qtyWarehouse)}</TableCell>;
    case 'qtyTotal':
      return (
        <TableCell className="text-right font-mono font-bold">{formatQty(item.qtyTotal)}</TableCell>
      );
    case 'status':
      return (
        <TableCell>
          <ExpiryStatusBadge status={item.status} />
        </TableCell>
      );
    case 'liability':
      return (
        <TableCell className="text-[0.8125rem]">
          <LiabilityBadge liability={item.liability} />
          {item.liability.note ? (
            <span
              title={item.liability.note}
              className="mt-0.5 block truncate text-xs text-muted-foreground"
            >
              {item.liability.note}
            </span>
          ) : null}
        </TableCell>
      );
    case 'createdBy':
      return <TruncateCell text={item.createdByName} className="text-[0.8125rem]" />;
    case 'createdAt':
      return (
        <TableCell className="font-mono text-[0.8125rem] text-muted-foreground">
          {formatUbMinute(item.createdAt)}
        </TableCell>
      );
  }
}
