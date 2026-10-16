import { MAX_STOCKTAKE_BINS } from '@tugeel/shared/inventory';
import { Decimal } from '@tugeel/shared/money';
import { ClipboardCheck, Plus, X } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { CheckboxGroup } from '@/components/checkbox-group';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormField } from '@/components/form';
import {
  ChevronHead,
  EmptyState,
  FilterBar,
  LinkRow,
  ListCard,
  LoadMore,
  SegmentedControl,
  SkeletonRows,
} from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { ScanBox } from '@/components/scan-box';
import { StickyActions } from '@/components/sticky-actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatUbDateTime } from '@/lib/dayjs';
import { formatMnt, formatQty } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { useSetParam } from '@/lib/search-params';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { useCreateParam } from '@/lib/use-create-param';
import { cn } from '@/lib/utils';
import { randomUuid } from '@/lib/uuid';
import {
  type Bin,
  type StocktakeBin,
  type StocktakeDetail,
  type StocktakeLine,
  type StocktakeStatus,
  useBinLookup,
  useStocktake,
  useStocktakeBinPreview,
  useStocktakeLines,
  useStocktakeMutations,
  useStocktakes,
} from './api';
import { useCanWrite, useWarehouseName, useWarehouseOptions } from './helpers';
import { useDefaultWarehouse } from './last-warehouse';
import { DocStatusBadge, WarehouseSelect } from './shared';
import { StocktakeCounter } from './stocktake-count';

const SHELF_KINDS = ['WHOLESALE', 'STORE'] as const;
const STATUSES: readonly StocktakeStatus[] = [
  'DRAFT',
  'COUNTING',
  'REVIEW',
  'APPROVED',
  'CANCELLED',
];
const SCOPES = ['prefix', 'all', 'scan'] as const;
type Scope = (typeof SCOPES)[number];
/** Cost per base unit, NUMERIC(14,4). */
const UNIT_COST = /^\d{1,10}(\.\d{1,4})?$/;
/** Shelf codes listed on a page before «+N». */
const CODES_SHOWN = 60;
const REVIEW_VIEWS = ['differences', 'all'] as const;

const isStatus = (value: string | null): value is StocktakeStatus =>
  STATUSES.some((status) => status === value);
const signed = (value: string) =>
  value.startsWith('-') ? formatQty(value) : `+${formatQty(value)}`;

/**
 * Stocktakes (ST-, ADR-0038): warehouse staff count shelf by shelf without seeing what the system
 * expects; an admin reviews the differences and approves them.
 */
export function StocktakesPage() {
  const { t } = useTranslation();
  const canManage = useHasPermission('inventory.stocktakes.manage');
  const [params] = useSearchParams();
  const setParam = useSetParam();
  const warehouses = useWarehouseOptions(SHELF_KINDS);
  const warehouseName = useWarehouseName();
  const warehouseParam = Number.parseInt(params.get('warehouseId') ?? '', 10);
  const warehouseId = Number.isNaN(warehouseParam) ? undefined : warehouseParam;
  const statusParam = params.get('status');
  const status = isStatus(statusParam) ? statusParam : undefined;
  const stocktakes = useStocktakes({ warehouseId, status });
  const rows = stocktakes.data?.pages.flatMap((page) => page.data) ?? [];
  const [creating, setCreating] = useCreateParam();

  return (
    <div>
      <PageHeader
        title={t('inventory.stocktakes.title')}
        actions={
          canManage ? (
            <Button onClick={() => setCreating(true)}>
              <Plus />
              {t('inventory.stocktake.newTitle')}
            </Button>
          ) : null
        }
      />
      {canManage ? (
        <Dialog open={creating} onOpenChange={setCreating}>
          {creating ? <StocktakeCreateDialog onCancel={() => setCreating(false)} /> : null}
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
      <ProblemAlert problem={problemFromError(stocktakes.error)} />
      <ListCard scroll>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('inventory.number')}</TableHead>
              <TableHead>{t('inventory.warehouse')}</TableHead>
              <TableHead className="text-right">{t('inventory.stocktakes.shelves')}</TableHead>
              <TableHead>{t('inventory.status')}</TableHead>
              <TableHead>{t('inventory.date')}</TableHead>
              <ChevronHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {stocktakes.isPending ? <SkeletonRows columns={6} /> : null}
            {rows.map((row) => (
              <LinkRow key={row.id} to={`/inventory/stocktakes/${row.id}`}>
                <TableCell className="font-mono">
                  <Link
                    to={`/inventory/stocktakes/${row.id}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {row.number ?? t('inventory.stocktake.noNumber', { id: row.id })}
                  </Link>
                </TableCell>
                <TableCell>{warehouseName(row.warehouseId)}</TableCell>
                <TableCell className="text-right font-mono">
                  {t('inventory.stocktakes.shelvesProgress', {
                    finished: row.finishedBinCount,
                    total: row.binCount,
                  })}
                </TableCell>
                <TableCell>
                  <DocStatusBadge status={row.status} />
                </TableCell>
                <TableCell className="font-mono">
                  {row.effectiveDate ??
                    formatUbDateTime(Date.parse(row.startedAt ?? row.createdAt))}
                </TableCell>
              </LinkRow>
            ))}
          </TableBody>
        </Table>
        {!stocktakes.isPending && rows.length === 0 ? (
          <EmptyState icon={ClipboardCheck} title={t('inventory.stocktakes.empty')} />
        ) : null}
        <LoadMore query={stocktakes} />
      </ListCard>
    </div>
  );
}

/** A draft names its warehouse and shelves: a code prefix, every shelf, or scanned labels. */
function StocktakeCreateDialog({ onCancel }: { onCancel: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const mine = useWarehouseOptions(SHELF_KINDS, true);
  const { defaultId, remember } = useDefaultWarehouse(mine.options, 'stocktake');
  const mutations = useStocktakeMutations();
  const lookup = useBinLookup();
  const action = useAction();
  const [key, setKey] = useState(randomUuid);
  const [picked, setPicked] = useState<number | undefined>();
  const [scope, setScope] = useState<Scope>('prefix');
  const [prefix, setPrefix] = useState('');
  const [scanned, setScanned] = useState<Bin[]>([]);
  const [missing, setMissing] = useState<string | null>(null);
  const [note, setNote] = useState('');
  // The only warehouse, or the last one chosen, is picked already.
  const warehouseId = picked ?? defaultId;
  const typed = useDeferredValue(prefix.trim());
  const preview = useStocktakeBinPreview(
    scope === 'scan'
      ? {}
      : { warehouseId, ...(scope === 'prefix' ? { prefix: typed } : { all: true }) },
  );
  const counted = preview.data?.binCount ?? 0;
  const previewOk = counted > 0 && counted <= MAX_STOCKTAKE_BINS;
  const ready =
    warehouseId !== undefined &&
    (scope === 'scan' ? scanned.length > 0 : previewOk && !preview.isFetching);

  const addBin = (code: string) => {
    if (warehouseId === undefined) return;
    lookup.mutate(
      { warehouseId, code },
      {
        onSuccess: (bin) => {
          setMissing(null);
          setScanned((list) => (list.some((row) => row.id === bin.id) ? list : [...list, bin]));
        },
        onError: () => setMissing(code),
      },
    );
  };

  const create = () =>
    void action
      .run(async () => {
        if (warehouseId === undefined) return;
        const created = await mutations.create.mutateAsync({
          key,
          warehouseId,
          ...(scope === 'prefix'
            ? { prefix: prefix.trim() }
            : scope === 'all'
              ? { all: true }
              : { binIds: scanned.map((bin) => bin.id) }),
          ...(note.trim() ? { note: note.trim() } : {}),
        });
        remember(warehouseId);
        await navigate(`/inventory/stocktakes/${created.id}`, { replace: true });
      })
      .then((done) => {
        // A refused draft is a new intent once the form changes.
        if (!done) setKey(randomUuid());
      });

  return (
    // Wider than the default: the label scan box and its camera button share a row.
    <DialogContent closeLabel={t('common.close')} size="md">
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready && !mutations.create.isPending) create();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('inventory.stocktake.newTitle')}</DialogTitle>
          <DialogDescription>{t(`inventory.stocktake.scopeHints.${scope}`)}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <ProblemAlert problem={action.problem} />
          <FormField label={t('inventory.warehouse')} htmlFor="stocktake-warehouse">
            <WarehouseSelect
              id="stocktake-warehouse"
              options={mine.options}
              value={warehouseId}
              emptyLabel={t('inventory.stocktake.pickWarehouse')}
              onChange={(id) => {
                setPicked(id);
                setScanned([]);
              }}
            />
          </FormField>
          <FormField label={t('inventory.stocktake.scope')} htmlFor="stocktake-scope">
            <NativeSelect
              id="stocktake-scope"
              value={scope}
              onChange={(event) => {
                const next = SCOPES.find((value) => value === event.target.value);
                if (next) setScope(next);
              }}
            >
              {SCOPES.map((value) => (
                <option key={value} value={value}>
                  {t(`inventory.stocktake.scopes.${value}`)}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          {scope === 'prefix' ? (
            <FormField label={t('inventory.stocktake.prefix')} htmlFor="stocktake-prefix">
              <Input
                id="stocktake-prefix"
                placeholder={t('inventory.stocktake.prefixPlaceholder')}
                className="font-mono"
                autoComplete="off"
                maxLength={32}
                value={prefix}
                onChange={(event) => setPrefix(event.target.value)}
              />
            </FormField>
          ) : null}
          <FormField label={t('inventory.note')} htmlFor="stocktake-note">
            <Input
              id="stocktake-note"
              maxLength={500}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </FormField>
          {scope === 'scan' ? (
            warehouseId === undefined ? null : (
              <div className="flex flex-col gap-2">
                <ScanBox
                  letters
                  label={t('inventory.stocktake.scanBins')}
                  placeholder={t('inventory.stocktake.scanBinsPlaceholder')}
                  onScan={addBin}
                />
                {missing ? (
                  <p className="text-sm text-destructive">
                    {t('inventory.stocktake.binNotFound', { code: missing })}
                  </p>
                ) : null}
                {scanned.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {scanned.map((bin) => (
                      <Badge key={bin.id} variant="outline" className="gap-1 font-mono">
                        {bin.code}
                        <button
                          type="button"
                          aria-label={t('inventory.stocktake.removeBin', { code: bin.code })}
                          onClick={() =>
                            setScanned((list) => list.filter((row) => row.id !== bin.id))
                          }
                        >
                          <X className="size-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </div>
            )
          ) : (
            <BinPreviewLine
              problem={problemFromError(preview.error)}
              preview={warehouseId === undefined ? undefined : preview.data}
            />
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={!ready || mutations.create.isPending}>
            {t('inventory.stocktake.createDraft')}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

function BinPreviewLine({
  preview,
  problem,
}: {
  preview:
    | { binCount: number; countingCount: number; firstCode: string | null; lastCode: string | null }
    | undefined;
  problem: ReturnType<typeof problemFromError>;
}) {
  const { t } = useTranslation();
  if (problem) return <ProblemAlert problem={problem} />;
  if (!preview) return null;
  if (preview.binCount === 0) {
    return <p className="text-sm text-destructive">{t('inventory.stocktake.previewNone')}</p>;
  }
  if (preview.binCount > MAX_STOCKTAKE_BINS) {
    return (
      <p className="text-sm text-destructive">
        {t('inventory.stocktake.previewTooMany', { max: MAX_STOCKTAKE_BINS })}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1 text-sm">
      <p className="font-medium">
        {t('inventory.stocktake.preview', {
          count: preview.binCount,
          first: preview.firstCode ?? '',
          last: preview.lastCode ?? '',
        })}
      </p>
      {preview.countingCount > 0 ? (
        <p className="text-destructive">
          {t('inventory.stocktake.previewCounting', { count: preview.countingCount })}
        </p>
      ) : null}
    </div>
  );
}

/** One stocktake: the step its status and the reader's rights call for. */
export function StocktakePage() {
  const { t } = useTranslation();
  const id = Number.parseInt(useParams().id ?? '', 10);
  const canManage = useHasPermission('inventory.stocktakes.manage');
  const canApprove = useHasPermission('inventory.stocktakes.approve');
  const canWrite = useCanWrite();
  const stocktake = useStocktake(id);
  const warehouseName = useWarehouseName();

  const loadProblem = problemFromError(stocktake.error);
  if (loadProblem) return <ProblemAlert problem={loadProblem} />;
  if (!stocktake.data) {
    return <p className="text-sm text-muted-foreground">{t('common.loading')}</p>;
  }
  const detail = stocktake.data;
  const writer = canWrite(detail.warehouseId);
  const counter = detail.status === 'COUNTING' && canManage && writer;
  const finished = detail.bins.filter((bin) => bin.finishedAt !== null).length;

  const body = (() => {
    switch (detail.status) {
      case 'DRAFT':
        return canManage && writer ? (
          <StocktakeDraft detail={detail} />
        ) : (
          <StocktakeSummary detail={detail} />
        );
      case 'COUNTING':
        return counter ? (
          <StocktakeCounter key={detail.id} detail={detail} />
        ) : (
          <StocktakeSummary detail={detail} />
        );
      case 'REVIEW':
        return canApprove && writer ? (
          <StocktakeReview detail={detail} />
        ) : (
          <StocktakeSummary detail={detail} text={t('inventory.stocktake.waiting')} />
        );
      case 'APPROVED':
        return canApprove ? (
          <StocktakeReview detail={detail} />
        ) : (
          <StocktakeSummary detail={detail} text={t('inventory.stocktake.approvedNote')} />
        );
      case 'CANCELLED':
        return <StocktakeSummary detail={detail} text={t('inventory.stocktake.cancelledNote')} />;
    }
  })();

  return (
    <div className="space-y-4">
      <PageHeader
        title={detail.number ?? t('inventory.stocktake.noNumber', { id: detail.id })}
        meta={
          <>
            <DocStatusBadge status={detail.status} />
            <span className="text-foreground">{warehouseName(detail.warehouseId)}</span>
            {/* The counter's shelf list shows the progress itself. */}
            {detail.status === 'COUNTING' && !counter ? (
              <span>
                {t('inventory.stocktake.progress', { finished, total: detail.bins.length })}
              </span>
            ) : null}
            {detail.effectiveDate ? (
              <span className="font-mono">
                {t('inventory.stocktake.approvedOn', { date: detail.effectiveDate })}
              </span>
            ) : null}
          </>
        }
      />
      {body}
    </div>
  );
}

/**
 * A stocktake read by someone who does not count or approve it: where it stands and its shelves in
 * one card, the note as the card's description (as on every document).
 */
function StocktakeSummary({ detail, text }: { detail: StocktakeDetail; text?: string }) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('inventory.stocktake.binsTitle', { count: detail.bins.length })}</CardTitle>
        {detail.note ? <CardDescription>{detail.note}</CardDescription> : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {text ? <p className="text-sm">{text}</p> : null}
        <BinCodes bins={detail.bins} />
      </CardContent>
    </Card>
  );
}

/** The shelves of a stocktake, finished ones marked. */
function BinCodes({ bins }: { bins: StocktakeBin[] }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap gap-1">
      {bins.slice(0, CODES_SHOWN).map((bin) => (
        <Badge
          key={bin.id}
          variant={bin.finishedAt ? 'secondary' : 'outline'}
          className="font-mono"
          title={bin.finishedAt ? t('inventory.stocktake.finished') : undefined}
        >
          {bin.code}
        </Badge>
      ))}
      {bins.length > CODES_SHOWN ? (
        <Badge variant="outline">
          {t('inventory.stocktake.moreCodes', { count: bins.length - CODES_SHOWN })}
        </Badge>
      ) : null}
    </div>
  );
}

/** A draft: its shelves, started on the counting day or cancelled. */
function StocktakeDraft({ detail }: { detail: StocktakeDetail }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const mutations = useStocktakeMutations();
  const action = useAction();
  const [confirm, setConfirm] = useState<'start' | 'cancel' | null>(null);
  const ask = (which: 'start' | 'cancel') => {
    action.clear();
    setConfirm(which);
  };
  const start = () =>
    void action.run(async () => {
      await mutations.start.mutateAsync(detail.id);
      setConfirm(null);
    });
  const cancel = () =>
    void action.run(async () => {
      await mutations.cancel.mutateAsync(detail.id);
      setConfirm(null);
      await navigate('/inventory/stocktakes');
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('inventory.stocktake.binsTitle', { count: detail.bins.length })}</CardTitle>
        {detail.note ? <CardDescription>{detail.note}</CardDescription> : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <BinCodes bins={detail.bins} />
        <p className="text-xs text-muted-foreground">{t('inventory.stocktake.draftHint')}</p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => ask('start')}>{t('inventory.stocktake.start')}</Button>
          <Button variant="outline" onClick={() => ask('cancel')}>
            {t('inventory.stocktake.cancel')}
          </Button>
        </div>
      </CardContent>
      <ConfirmDialog
        open={confirm === 'start'}
        variant="default"
        title={t('inventory.stocktake.startTitle')}
        description={t('inventory.stocktake.startDescription')}
        confirmLabel={t('inventory.stocktake.start')}
        pending={mutations.start.isPending}
        problem={action.problem}
        onConfirm={start}
        onClose={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'cancel'}
        title={t('inventory.stocktake.cancelTitle')}
        description={t('inventory.stocktake.cancelDescription')}
        confirmLabel={t('inventory.stocktake.cancel')}
        pending={mutations.cancel.isPending}
        problem={action.problem}
        onConfirm={cancel}
        onClose={() => setConfirm(null)}
      />
    </Card>
  );
}

/** What a counted line shows: a count, or 0 marked as not found when nobody counted it. */
function countedText(line: StocktakeLine, none: string, notFound: (qty: string) => string) {
  if (line.countedQty === null) return none;
  const counted = formatQty(line.countedQty);
  return line.countedAt === null ? notFound(counted) : counted;
}

/**
 * The approver's review: frozen against counted per line, the differences first. In review the
 * approver gives surpluses a cost (cost holders), approves, sends shelves back or cancels; after
 * approval the same table stays as the record.
 */
function StocktakeReview({ detail }: { detail: StocktakeDetail }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const canCost = useHasPermission('inventory.costs.manage');
  const open = detail.status === 'REVIEW';
  const [all, setAll] = useState(false);
  const lines = useStocktakeLines(detail.id, !all, true);
  const rows = lines.data?.pages.flatMap((page) => page.data) ?? [];
  const mutations = useStocktakeMutations();
  const action = useAction();
  const [confirm, setConfirm] = useState<'approve' | 'recount' | 'cancel' | null>(null);
  const [key, setKey] = useState(randomUuid);
  const [costs, setCosts] = useState<Record<number, string>>({});
  const [recount, setRecount] = useState<number[]>([]);
  const withAverages = open && canCost;
  const costsValid = Object.values(costs).every(
    (value) => !value.trim() || UNIT_COST.test(value.trim()),
  );
  // Shelves with differences first, in code order.
  const shelves = [...detail.bins].sort(
    (a, b) => Number((b.differenceCount ?? 0) > 0) - Number((a.differenceCount ?? 0) > 0),
  );

  const ask = (which: 'approve' | 'recount' | 'cancel') => {
    action.clear();
    if (which === 'approve') setKey(randomUuid());
    if (which === 'recount') {
      setRecount(detail.bins.filter((bin) => (bin.differenceCount ?? 0) > 0).map((bin) => bin.id));
    }
    setConfirm(which);
  };
  const approve = () =>
    void action.run(async () => {
      const approved = await mutations.approve.mutateAsync({
        id: detail.id,
        key,
        costs: Object.entries(costs)
          .filter(([, value]) => value.trim())
          .map(([lineId, value]) => ({
            lineId: Number.parseInt(lineId, 10),
            unitCost: value.trim(),
          })),
      });
      setConfirm(null);
      toast.success(t('inventory.stocktake.approved', { number: approved.number ?? '' }));
    });
  const sendBack = () =>
    void action.run(async () => {
      await mutations.recount.mutateAsync({ id: detail.id, binIds: recount });
      setConfirm(null);
      toast.success(t('inventory.stocktake.sentBack', { count: recount.length }));
    });
  const cancel = () =>
    void action.run(async () => {
      await mutations.cancel.mutateAsync(detail.id);
      setConfirm(null);
      await navigate('/inventory/stocktakes');
    });

  return (
    <>
      <Card>
        {detail.note ? (
          <CardHeader>
            <CardDescription>{detail.note}</CardDescription>
          </CardHeader>
        ) : null}
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="font-medium">
              {t('inventory.stocktake.summary', { count: detail.differenceCount ?? 0 })}
            </span>
            {detail.shortageValue !== undefined ? (
              <span>
                {t('inventory.stocktake.shortageValue', { value: formatMnt(detail.shortageValue) })}
              </span>
            ) : null}
            {detail.surplusValue !== undefined ? (
              <span>
                {t('inventory.stocktake.surplusValue', { value: formatMnt(detail.surplusValue) })}
              </span>
            ) : null}
            {detail.shortageValue !== undefined ? (
              <span className="text-muted-foreground">{t('inventory.stocktake.valuesNote')}</span>
            ) : null}
          </div>
          <div>
            {/* Two views of one table: a segmented control, never two blue buttons. */}
            <SegmentedControl
              options={REVIEW_VIEWS}
              value={all ? 'all' : 'differences'}
              label={(view) =>
                view === 'all'
                  ? t('inventory.stocktake.allLines')
                  : t('inventory.stocktake.onlyDifferences')
              }
              onChange={(view) => setAll(view === 'all')}
            />
          </div>
          <ProblemAlert
            problem={confirm ? null : (action.problem ?? problemFromError(lines.error))}
          />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('inventory.stocktake.columns.bin')}</TableHead>
                <TableHead>{t('inventory.stocktake.columns.product')}</TableHead>
                <TableHead className="text-right">
                  {t('inventory.stocktake.columns.expected')}
                </TableHead>
                <TableHead className="text-right">
                  {t('inventory.stocktake.columns.counted')}
                </TableHead>
                <TableHead className="text-right">
                  {t('inventory.stocktake.columns.difference')}
                </TableHead>
                {withAverages ? (
                  <>
                    <TableHead className="text-right">
                      {t('inventory.stocktake.columns.avgCost')}
                    </TableHead>
                    <TableHead>{t('inventory.stocktake.columns.unitCost')}</TableHead>
                  </>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((line) => {
                const difference = line.difference ?? null;
                const changed = difference !== null && !new Decimal(difference).isZero();
                const surplus = difference !== null && new Decimal(difference).gt(0);
                return (
                  <TableRow key={line.id}>
                    <TableCell className="font-mono">{line.binCode}</TableCell>
                    <TableCell className="min-w-48 whitespace-normal">
                      <span className="font-mono text-muted-foreground">{line.productSku}</span>{' '}
                      {line.productName}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {line.expectedQty ? formatQty(line.expectedQty) : t('common.none')}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {countedText(line, t('common.none'), (qty) =>
                        t('inventory.stocktake.notFound', { qty }),
                      )}
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-right font-mono',
                        changed && !surplus && 'text-destructive',
                      )}
                    >
                      {difference === null || !changed
                        ? t('common.none')
                        : t('inventory.qtyWithUnit', {
                            qty: signed(difference),
                            unit: line.baseUnitName,
                          })}
                    </TableCell>
                    {withAverages ? (
                      <>
                        <TableCell className="text-right font-mono">
                          {line.avgCost ? formatMnt(line.avgCost) : t('common.none')}
                        </TableCell>
                        <TableCell>
                          {surplus ? (
                            <Input
                              aria-label={t('inventory.stocktake.unitCostFor', {
                                code: line.binCode,
                                name: line.productName,
                              })}
                              placeholder={t('inventory.stocktake.unitCostHint')}
                              inputMode="decimal"
                              className="w-40 font-mono"
                              value={costs[line.id] ?? ''}
                              onChange={(event) =>
                                setCosts((previous) => ({
                                  ...previous,
                                  [line.id]: event.target.value,
                                }))
                              }
                            />
                          ) : null}
                        </TableCell>
                      </>
                    ) : null}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {!lines.isPending && rows.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">
              {all ? t('inventory.stocktake.noLinesAll') : t('inventory.stocktake.noDifferences')}
            </p>
          ) : null}
          <LoadMore query={lines} />
        </CardContent>
      </Card>
      {open ? (
        <StickyActions
          summary={t('inventory.stocktake.summary', { count: detail.differenceCount ?? 0 })}
        >
          <Button variant="ghost" onClick={() => ask('cancel')}>
            {t('inventory.stocktake.cancel')}
          </Button>
          <Button variant="outline" onClick={() => ask('recount')}>
            {t('inventory.stocktake.recount')}
          </Button>
          <Button disabled={!costsValid} onClick={() => ask('approve')}>
            {t('inventory.stocktake.approve')}
          </Button>
        </StickyActions>
      ) : null}
      <ConfirmDialog
        open={confirm === 'approve'}
        variant="default"
        title={t('inventory.stocktake.approveTitle')}
        description={t('inventory.stocktake.approveDescription')}
        confirmLabel={t('inventory.stocktake.approve')}
        pending={mutations.approve.isPending}
        problem={action.problem}
        onConfirm={approve}
        onClose={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'recount'}
        variant="default"
        title={t('inventory.stocktake.recountTitle')}
        description={t('inventory.stocktake.recountDescription')}
        confirmLabel={t('inventory.stocktake.recount')}
        pending={mutations.recount.isPending}
        disabled={recount.length === 0}
        problem={action.problem}
        onConfirm={sendBack}
        onClose={() => setConfirm(null)}
      >
        <div className="max-h-72 overflow-y-auto">
          <CheckboxGroup
            name="recount"
            options={shelves.map((bin) => ({
              value: bin.id,
              label: t('inventory.stocktake.recountBin', {
                code: bin.code,
                count: bin.differenceCount ?? 0,
              }),
            }))}
            value={recount}
            onChange={setRecount}
          />
        </div>
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === 'cancel'}
        title={t('inventory.stocktake.cancelTitle')}
        description={t('inventory.stocktake.cancelDescription')}
        confirmLabel={t('inventory.stocktake.cancel')}
        pending={mutations.cancel.isPending}
        problem={action.problem}
        onConfirm={cancel}
        onClose={() => setConfirm(null)}
      />
    </>
  );
}
