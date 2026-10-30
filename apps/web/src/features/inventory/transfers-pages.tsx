import { BINS_SOON } from '@/lib/features';
import { Decimal } from '@tugeel/shared/money';
import { ArrowLeftRight, Plus, Printer, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormField } from '@/components/form';
import { LeaveGuard } from '@/components/leave-guard';
import {
  ChevronHead,
  EmptyState,
  FilterBar,
  LinkRow,
  ListCard,
  ListTable,
  LoadMore,
  RowAction,
  RowActions,
  SkeletonRows,
} from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { ScanBox } from '@/components/scan-box';
import { StickyActions } from '@/components/sticky-actions';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import { Textarea } from '@/components/ui/textarea';
import { type BarcodeResolution, useBarcodeLookup } from '@/features/catalog/api';
import type { ColumnSpec } from '@/lib/column-layout';
import { formatUbDateTime } from '@/lib/dayjs';
import { formatQty } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { useScanGuard } from '@/lib/scan/use-wedge-scanner';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { useSetParam } from '@/lib/search-params';
import { useCreateParam } from '@/lib/use-create-param';
import { cn } from '@/lib/utils';
import { randomUuid } from '@/lib/uuid';
import {
  type Bin,
  type TransferCount,
  type TransferDetail,
  type TransferLine,
  type TransferOrigin,
  type TransferStatus,
  useBinLookup,
  useTransfer,
  useTransferMutations,
  useTransferRequest,
  useTransfers,
} from './api';
import {
  countBase,
  countEntry,
  inUnit,
  looksLikeLabel,
  parseScanQty,
  useCanWrite,
  useWarehouseName,
  useWarehouseOptions,
  wantsScanFocus,
} from './helpers';
import { useDefaultWarehouse } from './last-warehouse';
import { useScanQty } from './scan-qty';
import {
  DocStatusBadge,
  ProductSearch,
  QtyInput,
  ScanQtyControl,
  ScanToolbar,
  WarehouseSelect,
} from './shared';
import {
  type LineCount,
  sweepStepCounts,
  useStepCounts,
  useStepCountsCleanup,
} from './step-counts';

const TRANSFER_KINDS = ['WHOLESALE', 'STORE'] as const;
const STATUSES: readonly TransferStatus[] = [
  'DRAFT',
  'REQUESTED',
  'SHIPPED',
  'COUNTED',
  'RECEIVED',
  'CANCELLED',
];
const ORIGINS: readonly TransferOrigin[] = ['REQUEST', 'PUSH'];

/** The transfers list's columns (ADR-0119). */
const LIST_COLUMNS: readonly ColumnSpec[] = [
  { key: 'number', kind: 'number' },
  { key: 'from', kind: 'text', weight: 1 },
  { key: 'to', kind: 'text', weight: 1 },
  { key: 'origin', kind: 'text', weight: 1 },
  { key: 'lines', kind: 'count' },
  // Two pills: the status and «Дахин нээсэн».
  { key: 'status', kind: 'status', width: 12 },
  { key: 'chevron', kind: 'chevron' },
];

/** The line tables' shared columns: the product wraps, a quantity typed in a box, a chosen unit. */
const PRODUCT: ColumnSpec = { key: 'product', kind: 'text', weight: 3, min: 14 };
const QTY_INPUT: ColumnSpec = { key: 'qty', kind: 'qty', width: 8 };
/** «12 хайрцаг (288 ш)»: the shipped quantity in the line's unit and in base units. */
const SHIPPED: ColumnSpec = { key: 'shipped', kind: 'qty', width: 11 };
const UNIT_CHOICE: ColumnSpec = { key: 'unit', kind: 'text', weight: 1, min: 10 };

const DRAFT_COLUMNS: readonly ColumnSpec[] = [
  PRODUCT,
  { key: 'unit', kind: 'text', weight: 1, min: 4 },
  QTY_INPUT,
  { key: 'actions', kind: 'actions', actions: 1 },
];
const SHIP_COLUMNS: readonly ColumnSpec[] = [
  PRODUCT,
  { key: 'requested', kind: 'qty', width: 8 },
  { ...QTY_INPUT, key: 'toShip' },
  UNIT_CHOICE,
  // The shelf, or «Тавиур уншуулна уу» until one is scanned.
  { key: 'fromBin', kind: 'code', width: 10.5 },
];
const RECEIVE_COLUMNS: readonly ColumnSpec[] = [
  PRODUCT,
  SHIPPED,
  { ...QTY_INPUT, key: 'arrived' },
  UNIT_CHOICE,
  { key: 'difference', kind: 'qty', width: 8 },
  { key: 'toBin', kind: 'code' },
];
const COUNT_COLUMNS: readonly ColumnSpec[] = [
  PRODUCT,
  SHIPPED,
  // «Ирээгүй» and the count box side by side.
  { key: 'arrived', kind: 'qty', width: 13 },
  UNIT_CHOICE,
  { key: 'difference', kind: 'qty', width: 8 },
  { key: 'toBin', kind: 'code' },
  { key: 'actions', kind: 'actions', actions: 1 },
];
const CONFIRM_COLUMNS: readonly ColumnSpec[] = [
  PRODUCT,
  SHIPPED,
  { key: 'counted', kind: 'qty', width: 8 },
  // The difference and, under it, where the goods go back to or come from.
  { key: 'difference', kind: 'text', weight: 2, min: 12 },
  { key: 'toBin', kind: 'code' },
];

const isStatus = (value: string | null): value is TransferStatus =>
  STATUSES.some((status) => status === value);

/** A sent request the destination took back to edit: a draft that keeps its number (ADR-0046). */
const reopened = (transfer: { status: TransferStatus; number: string | null }) =>
  transfer.status === 'DRAFT' && transfer.number !== null;

/** A lookup that answers 404 for an unknown code: null instead of an error. */
async function orNull<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch (error) {
    if (problemFromError(error)?.code === 'NOT_FOUND') return null;
    throw error;
  }
}

/**
 * Transfers (ADR-0035): what a warehouse receives and sends. Everyone reads them; the holders of
 * inventory.transfers.manage request, ship and receive for the warehouses they write for. The
 * direction works on its own too: then it means the warehouses the user writes for.
 */
export function TransfersPage() {
  const { t } = useTranslation();
  const canManage = useHasPermission('inventory.transfers.manage');
  const [params] = useSearchParams();
  const setParam = useSetParam();
  const warehouses = useWarehouseOptions(TRANSFER_KINDS);
  const mine = useWarehouseOptions(TRANSFER_KINDS, true);
  const warehouseName = useWarehouseName();
  const scoped = mine.options.length === 1 && mine.options.length < warehouses.options.length;
  const warehouseParam = Number.parseInt(params.get('warehouseId') ?? '', 10);
  const warehouseId = Number.isNaN(warehouseParam)
    ? scoped
      ? mine.options[0]?.id
      : undefined
    : warehouseParam;
  const directionParam = params.get('direction');
  const direction =
    directionParam === 'INCOMING' || directionParam === 'OUTGOING' ? directionParam : undefined;
  const statusParam = params.get('status');
  const status = isStatus(statusParam) ? statusParam : undefined;
  const transfers = useTransfers({ warehouseId, direction, status });
  const rows = transfers.data?.pages.flatMap((page) => page.data) ?? [];
  const [creating, setCreating] = useCreateParam();

  useEffect(() => sweepStepCounts(), []);

  return (
    <div>
      <PageHeader
        title={t('inventory.transfers.title')}
        actions={
          canManage ? (
            <Button onClick={() => setCreating(true)}>
              <Plus />
              {t('inventory.transfer.newTitle')}
            </Button>
          ) : null
        }
      />
      {canManage ? (
        <Dialog open={creating} onOpenChange={setCreating}>
          {creating ? <TransferCreateDialog onCancel={() => setCreating(false)} /> : null}
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
          aria-label={t('inventory.transfers.direction')}
          value={direction ?? ''}
          onChange={(event) => setParam('direction', event.target.value)}
        >
          <option value="">{t('inventory.transfers.anyDirection')}</option>
          <option value="INCOMING">{t('inventory.transfers.incoming')}</option>
          <option value="OUTGOING">{t('inventory.transfers.outgoing')}</option>
        </NativeSelect>
        <NativeSelect
          variant="filter"
          aria-label={t('inventory.status')}
          value={status ?? ''}
          onChange={(event) => setParam('status', event.target.value)}
        >
          <option value="">{t('inventory.transfers.allStatuses')}</option>
          {STATUSES.map((value) => (
            <option key={value} value={value}>
              {t(`inventory.docStatus.${value}`)}
            </option>
          ))}
        </NativeSelect>
      </FilterBar>
      <ProblemAlert problem={problemFromError(transfers.error)} onRetry={transfers.refetch} />
      <ListCard scroll>
        <ListTable columns={LIST_COLUMNS}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('inventory.number')}</TableHead>
              <TableHead>{t('inventory.transfers.from')}</TableHead>
              <TableHead>{t('inventory.transfers.to')}</TableHead>
              <TableHead>{t('inventory.transfer.origin')}</TableHead>
              <TableHead className="text-right">{t('inventory.lines')}</TableHead>
              <TableHead>{t('inventory.status')}</TableHead>
              <ChevronHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {transfers.isPending ? <SkeletonRows columns={7} /> : null}
            {rows.map((row) => (
              <LinkRow key={row.id} to={`/inventory/transfers/${row.id}`}>
                <TableCell className="font-mono">
                  <Link
                    to={`/inventory/transfers/${row.id}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {row.number ?? t('inventory.draftNo', { id: row.id })}
                  </Link>
                </TableCell>
                <TableCell>{warehouseName(row.sourceWarehouseId)}</TableCell>
                <TableCell>{warehouseName(row.destWarehouseId)}</TableCell>
                <TableCell>{t(`inventory.transfer.origins.${row.origin}`)}</TableCell>
                <TableCell className="text-right font-mono">{row.lineCount}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <DocStatusBadge status={row.status} />
                    {reopened(row) ? (
                      <Badge variant="outline">{t('inventory.transfer.reopenedBadge')}</Badge>
                    ) : null}
                  </div>
                </TableCell>
              </LinkRow>
            ))}
          </TableBody>
        </ListTable>
        {!transfers.isPending && rows.length === 0 ? (
          <EmptyState icon={ArrowLeftRight} title={t('inventory.transfers.empty')} />
        ) : null}
        <LoadMore query={transfers} />
      </ListCard>
    </div>
  );
}

/**
 * A request is made by the receiving warehouse, a push by the sending one (supermarket returns).
 * The user's own side is chosen already: the only warehouse, or the last one used (ADR-0047 #6).
 */
function TransferCreateDialog({ onCancel }: { onCancel: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const all = useWarehouseOptions(TRANSFER_KINDS);
  const mine = useWarehouseOptions(TRANSFER_KINDS, true);
  const asking = useDefaultWarehouse(mine.options, 'transferRequest');
  const pushing = useDefaultWarehouse(mine.options, 'transferPush');
  const mutations = useTransferMutations();
  const action = useAction();
  const [key] = useState(randomUuid);
  const [origin, setOrigin] = useState<TransferOrigin>('REQUEST');
  const [pickedSource, setPickedSource] = useState<number | undefined>();
  const [pickedDest, setPickedDest] = useState<number | undefined>();
  const [note, setNote] = useState('');
  const source = pickedSource ?? (origin === 'PUSH' ? pushing.defaultId : undefined);
  const dest = pickedDest ?? (origin === 'REQUEST' ? asking.defaultId : undefined);
  const ready = source !== undefined && dest !== undefined && source !== dest;

  const create = () =>
    void action.run(async () => {
      if (source === undefined || dest === undefined) return;
      const transfer = await mutations.create.mutateAsync({
        key,
        origin,
        sourceWarehouseId: source,
        destWarehouseId: dest,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      if (origin === 'REQUEST') asking.remember(dest);
      else pushing.remember(source);
      await navigate(`/inventory/transfers/${transfer.id}`, {
        replace: true,
        state: { focusScan: true },
      });
    });

  return (
    <DialogContent closeLabel={t('common.close')}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready && !mutations.create.isPending) create();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('inventory.transfer.newTitle')}</DialogTitle>
          <DialogDescription>{t(`inventory.transfer.originHints.${origin}`)}</DialogDescription>
        </DialogHeader>
        <ProblemAlert problem={action.problem} />
        <FormField label={t('inventory.transfer.origin')} htmlFor="transfer-origin">
          <NativeSelect
            id="transfer-origin"
            value={origin}
            onChange={(event) => {
              const picked = ORIGINS.find((value) => value === event.target.value);
              if (!picked) return;
              setOrigin(picked);
              setPickedSource(undefined);
              setPickedDest(undefined);
            }}
          >
            {ORIGINS.map((value) => (
              <option key={value} value={value}>
                {t(`inventory.transfer.origins.${value}`)}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField label={t('inventory.transfers.from')} htmlFor="transfer-from">
          <WarehouseSelect
            id="transfer-from"
            options={origin === 'REQUEST' ? all.options : mine.options}
            value={source}
            emptyLabel={t('inventory.pickWarehouse')}
            onChange={setPickedSource}
          />
        </FormField>
        <FormField label={t('inventory.transfers.to')} htmlFor="transfer-to">
          <WarehouseSelect
            id="transfer-to"
            options={origin === 'REQUEST' ? mine.options : all.options}
            value={dest}
            emptyLabel={t('inventory.pickWarehouse')}
            onChange={setPickedDest}
          />
        </FormField>
        <FormField label={t('inventory.note')} htmlFor="transfer-note">
          <Input
            id="transfer-note"
            maxLength={500}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </FormField>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={!ready || mutations.create.isPending}>
            {t('inventory.transfer.createDraft')}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

/**
 * One transfer: the editor of the step the user's warehouse takes, and a printable list. A push
 * being prepared for shipping keeps `?ship=1` in the URL, so a reload stays on the ship editor.
 */
export function TransferPage() {
  const { t } = useTranslation();
  const id = Number.parseInt(useParams().id ?? '', 10);
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const canManage = useHasPermission('inventory.transfers.manage');
  const canWrite = useCanWrite();
  const transfer = useTransfer(id);
  const warehouseName = useWarehouseName();
  useStepCountsCleanup(id, transfer.data?.status);
  const shipping = params.get('ship') === '1';

  const loadProblem = problemFromError(transfer.error);
  if (loadProblem) return <ProblemAlert problem={loadProblem} />;
  if (!transfer.data) {
    return <p className="text-sm text-muted-foreground">{t('common.loading')}</p>;
  }
  const detail = transfer.data;
  const atSource = canManage && canWrite(detail.sourceWarehouseId);
  const atDest = canManage && canWrite(detail.destWarehouseId);
  const owner = detail.origin === 'REQUEST' ? atDest : atSource;
  const pushShipping = detail.status === 'DRAFT' && detail.origin === 'PUSH' && shipping;
  const editor =
    detail.status === 'DRAFT' && owner && !pushShipping ? (
      <TransferDraftEditor
        key={`draft-${detail.id}`}
        detail={detail}
        focusScan={wantsScanFocus(location.state)}
        onShip={() => setParams({ ship: '1' })}
      />
    ) : (detail.status === 'REQUESTED' || pushShipping) && atSource ? (
      <TransferShipEditor
        key={`ship-${detail.id}`}
        detail={detail}
        canDecline={detail.status === 'REQUESTED' && !atDest}
      />
    ) : detail.status === 'SHIPPED' && atDest ? (
      detail.origin === 'PUSH' ? (
        <TransferReceiveEditor key={`receive-${detail.id}`} detail={detail} />
      ) : (
        <TransferCountEditor key={`count-${detail.id}`} detail={detail} />
      )
    ) : detail.status === 'COUNTED' && atSource ? (
      <TransferConfirmView key={`confirm-${detail.id}`} detail={detail} />
    ) : null;

  return (
    <div className="space-y-4">
      <PageHeader
        title={detail.number ?? t('inventory.draftNo', { id: detail.id })}
        meta={
          <>
            <DocStatusBadge status={detail.status} />
            {reopened(detail) ? (
              <Badge variant="outline">{t('inventory.transfer.reopenedBadge')}</Badge>
            ) : null}
            <Badge variant="outline">{t(`inventory.transfer.origins.${detail.origin}`)}</Badge>
            <span className="text-foreground">
              {t('inventory.transfer.route', {
                from: warehouseName(detail.sourceWarehouseId),
                to: warehouseName(detail.destWarehouseId),
              })}
            </span>
            {detail.requestedAt ? (
              <span className="font-mono">
                {t('inventory.transfer.requestedOn', {
                  time: formatUbDateTime(Date.parse(detail.requestedAt)),
                })}
              </span>
            ) : null}
            {detail.shipDate ? (
              <span className="font-mono">
                {t('inventory.transfer.shippedOn', { date: detail.shipDate })}
              </span>
            ) : null}
            {detail.countedAt ? (
              <span className="font-mono">
                {t('inventory.transfer.countedOn', {
                  time: formatUbDateTime(Date.parse(detail.countedAt)),
                })}
              </span>
            ) : null}
            {detail.receiveDate ? (
              <span className="font-mono">
                {t('inventory.transfer.receivedOn', { date: detail.receiveDate })}
              </span>
            ) : null}
          </>
        }
        actions={
          <Button variant="outline" onClick={() => window.print()}>
            <Printer />
            {t('inventory.transfer.print')}
          </Button>
        }
      />
      {reopened(detail) && (owner || atSource) ? (
        <Alert className="print:hidden">
          <AlertDescription>
            {owner
              ? t('inventory.transfer.reopenedOwnerNote')
              : t('inventory.transfer.reopenedSourceNote')}
          </AlertDescription>
        </Alert>
      ) : null}
      {detail.requestId !== null ? <RequestGroups detail={detail} /> : null}
      {detail.status === 'SHIPPED' && detail.countReturnReason && atDest ? (
        <Alert className="print:hidden">
          <AlertDescription>
            {t('inventory.transfer.countReturned', { reason: detail.countReturnReason })}
          </AlertDescription>
        </Alert>
      ) : null}
      {detail.status === 'COUNTED' && atDest && !atSource ? (
        <Alert className="print:hidden">
          <AlertDescription>{t('inventory.transfer.waitingConfirm')}</AlertDescription>
        </Alert>
      ) : null}
      {detail.status === 'REQUESTED' && atDest ? <RequestOwnerActions detail={detail} /> : null}
      {editor ? <div className="space-y-4 print:hidden">{editor}</div> : null}
      <div className={editor ? 'hidden print:block' : undefined}>
        <TransferLinesView detail={detail} />
      </div>
    </div>
  );
}

/**
 * The other groups of the same request (ADR-0116 #1): a store's request from several home
 * warehouses is one transfer per sender; each links to the others.
 */
function RequestGroups({ detail }: { detail: TransferDetail }) {
  const { t } = useTranslation();
  const warehouseName = useWarehouseName();
  const request = useTransferRequest(detail.requestId);
  const others = (request.data?.groups ?? []).filter((group) => group.id !== detail.id);
  if (!request.data || (others.length === 0 && !request.data.note)) return null;
  return (
    <Alert className="print:hidden">
      <AlertDescription className="flex flex-col gap-1">
        {request.data.note ? (
          <span>{t('inventory.transfer.requestNote', { note: request.data.note })}</span>
        ) : null}
        {others.length > 0 ? (
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{t('inventory.transfer.requestGroups')}:</span>
            {others.map((group) => (
              <Link key={group.id} className="text-link" to={`/inventory/transfers/${group.id}`}>
                {group.number ?? t('inventory.draftNo', { id: group.id })} ·{' '}
                {warehouseName(group.sourceWarehouseId)} ·{' '}
                {t(`inventory.docStatus.${group.status}`)}
              </Link>
            ))}
          </span>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

/** The transfer's own words (its note, a decline's reason): the lines card's description. */
function TransferNotes({ detail }: { detail: TransferDetail }) {
  const { t } = useTranslation();
  if (!detail.note && !detail.cancelReason) return null;
  return (
    <CardDescription className="flex flex-col gap-0.5">
      {detail.note ? <span>{detail.note}</span> : null}
      {detail.cancelReason ? (
        <span>{t('inventory.transfer.cancelReason', { reason: detail.cancelReason })}</span>
      ) : null}
    </CardDescription>
  );
}

/**
 * A sent request, for the side that asked: take it back to edit it (ADR-0046, nothing to confirm:
 * it is sent again under its number) or withdraw it for good (asked first).
 */
function RequestOwnerActions({ detail }: { detail: TransferDetail }) {
  const { t } = useTranslation();
  const mutations = useTransferMutations();
  const action = useAction();
  const [confirm, setConfirm] = useState(false);
  const reopen = () =>
    void action.run(async () => {
      await mutations.reopen.mutateAsync(detail.id);
      toast.success(t('inventory.transfer.reopened'));
    });
  const withdraw = () =>
    void action.run(async () => {
      await mutations.cancel.mutateAsync({ id: detail.id });
      setConfirm(false);
      toast.success(t('inventory.transfer.withdrawn'));
    });

  return (
    <div className="flex flex-col gap-2 print:hidden">
      <ProblemAlert problem={confirm ? null : action.problem} />
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" disabled={mutations.reopen.isPending} onClick={reopen}>
          {t('inventory.transfer.reopen')}
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            action.clear();
            setConfirm(true);
          }}
        >
          {t('inventory.transfer.withdraw')}
        </Button>
      </div>
      <ConfirmDialog
        open={confirm}
        title={t('inventory.transfer.withdrawTitle')}
        description={t('inventory.transfer.withdrawDescription')}
        confirmLabel={t('inventory.transfer.withdraw')}
        pending={mutations.cancel.isPending}
        problem={action.problem}
        onConfirm={withdraw}
        onClose={() => setConfirm(false)}
      />
    </div>
  );
}

/** The lines of a draft: products scanned or searched, quantities in the unit asked for. */
function TransferDraftEditor(props: {
  detail: TransferDetail;
  focusScan: boolean;
  onShip: () => void;
}) {
  const { detail, onShip } = props;
  const { t } = useTranslation();
  const navigate = useNavigate();
  const mutations = useTransferMutations();
  const lookupBarcode = useBarcodeLookup();
  const action = useAction();
  const [message, setMessage] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  // «Тоо», the quantity the next scan or pick adds (ADR-0047 #2); back to 1 after each product.
  const qty = useScanQty();

  /** Adds `amount` of the unit; false when the line asks for another unit. */
  const addUnit = async (productId: number, productUnitId: number, amount: string) => {
    const line = detail.lines.find((row) => row.productId === productId);
    if (!line) {
      await mutations.addLine.mutateAsync({ id: detail.id, body: { productUnitId, qty: amount } });
    } else if (line.requestUnitId === productUnitId) {
      await mutations.updateLine.mutateAsync({
        id: line.id,
        body: { qty: new Decimal(line.requestedQty).plus(amount).toString() },
      });
    } else {
      setMessage(t('inventory.transfer.otherUnit', { unit: line.unitName }));
      return false;
    }
    return true;
  };

  /** Takes «Тоо» for a scanned or picked product; it returns to the field if no line took it. */
  const take = (source: { code: string } | { productId: number; productUnitId: number }) => {
    const typed = qty.read();
    const amount = parseScanQty(typed);
    qty.reset();
    const giveBack = () => {
      if (qty.read() === '1') qty.set(typed);
    };
    void action.run(async () => {
      setMessage(null);
      if (amount === null) {
        setMessage(t('inventory.scanQtyInvalid'));
        giveBack();
        return;
      }
      if ('code' in source) {
        const resolved = await orNull(lookupBarcode.mutateAsync(source.code));
        if (!resolved) {
          setMessage(t('inventory.transfer.unknownProduct', { code: source.code }));
          giveBack();
          return;
        }
        if (!(await addUnit(resolved.product.id, resolved.unit.id, amount))) giveBack();
        return;
      }
      if (!(await addUnit(source.productId, source.productUnitId, amount))) giveBack();
    });
  };
  const onScan = (code: string) => take({ code });

  // Sending a request asks nothing: it can be taken back (ADR-0047 #7).
  const request = () =>
    void action.run(async () => {
      const sent = await mutations.request.mutateAsync(detail.id);
      toast.success(t('inventory.transfer.requestSent', { number: sent.number ?? '' }));
    });
  const cancel = () =>
    void action.run(async () => {
      await mutations.cancel.mutateAsync({ id: detail.id });
      setConfirm(false);
      await navigate('/inventory/transfers');
    });

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t('inventory.lines')}</CardTitle>
          <TransferNotes detail={detail} />
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ScanToolbar
            scanBox={
              <ScanBox
                autoFocus={props.focusScan}
                label={t('inventory.transfer.scanProduct')}
                placeholder={t('inventory.transfer.scanProductPlaceholder')}
                onScan={onScan}
              />
            }
            qty={<ScanQtyControl id="transfer-scan-qty" qty={qty} onScan={onScan} />}
            search={
              <ProductSearch
                onScan={onScan}
                onPick={(product) =>
                  take({ productId: product.id, productUnitId: product.baseUnit.id })
                }
              />
            }
            status={
              message || qty.value !== '1' ? (
                <>
                  {message ? <span className="text-destructive">{message}</span> : null}
                  {qty.value !== '1' ? (
                    <span className="text-[0.8125rem] text-muted-foreground">
                      {t('inventory.scanQtyHint')}
                    </span>
                  ) : null}
                </>
              ) : null
            }
          />
          <ProblemAlert problem={confirm ? null : action.problem} />
          {detail.lines.length > 0 ? (
            <ListTable columns={DRAFT_COLUMNS}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('inventory.product')}</TableHead>
                  <TableHead>{t('inventory.unit')}</TableHead>
                  <TableHead className="text-right">{t('inventory.qty')}</TableHead>
                  <TableHead>
                    <span className="sr-only">{t('common.actions')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.lines.map((line) => (
                  <TableRow key={line.id}>
                    <TableCell className="whitespace-normal">
                      <span className="font-mono text-muted-foreground">{line.productSku}</span>{' '}
                      {line.productName}
                    </TableCell>
                    <TableCell>{line.unitName}</TableCell>
                    <TableCell className="text-right">
                      <QtyInput
                        key={line.requestedQty}
                        label={`${t('inventory.qty')}: ${line.productName}`}
                        value={line.requestedQty}
                        onScan={onScan}
                        onSave={(qty) =>
                          void action.run(() =>
                            mutations.updateLine.mutateAsync({ id: line.id, body: { qty } }),
                          )
                        }
                      />
                    </TableCell>
                    <RowActions>
                      <RowAction
                        label={`${t('inventory.remove')}: ${line.productName}`}
                        icon={Trash2}
                        destructive
                        onClick={() =>
                          void action.run(() => mutations.removeLine.mutateAsync(line.id))
                        }
                      />
                    </RowActions>
                  </TableRow>
                ))}
              </TableBody>
            </ListTable>
          ) : null}
        </CardContent>
      </Card>
      <StickyActions summary={t('inventory.linesCount', { count: detail.lines.length })}>
        <Button
          variant="ghost"
          onClick={() => {
            action.clear();
            setConfirm(true);
          }}
        >
          {t('inventory.transfer.cancelDraft')}
        </Button>
        {detail.origin === 'REQUEST' ? (
          <Button
            disabled={detail.lines.length === 0 || mutations.request.isPending}
            onClick={request}
          >
            {reopened(detail)
              ? t('inventory.transfer.resendRequest')
              : t('inventory.transfer.sendRequest')}
          </Button>
        ) : (
          <Button disabled={detail.lines.length === 0} onClick={onShip}>
            {t('inventory.transfer.prepareShipment')}
          </Button>
        )}
      </StickyActions>
      <ConfirmDialog
        open={confirm}
        title={t('inventory.transfer.cancelTitle')}
        confirmLabel={t('inventory.transfer.cancelDraft')}
        pending={mutations.cancel.isPending}
        problem={action.problem}
        onConfirm={cancel}
        onClose={() => setConfirm(false)}
      />
    </>
  );
}

/**
 * Scanning for a shipment or a receipt: a shelf label sets the active shelf, a product then takes
 * that shelf on its line. Unknown codes give a message, never a new line.
 */
function useLineScanner(
  detail: TransferDetail,
  warehouseId: number,
  assign: (line: TransferLine, bin: Bin) => void,
  options: {
    /** A product scan lands on its line (ADR-0116): the message to show, or nothing more. */
    onProduct?: (line: TransferLine, resolved: BarcodeResolution) => string | null;
    /** A product that is not on the transfer, when the step may add it. */
    onUnknown?: (resolved: BarcodeResolution) => void;
  } = {},
) {
  const { t } = useTranslation();
  const lookupBin = useBinLookup();
  const lookupBarcode = useBarcodeLookup();
  const [activeBin, setActiveBin] = useState<Bin | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const action = useAction();

  const onScan = (code: string) =>
    void action.run(async () => {
      setMessage(null);
      const label = looksLikeLabel(code);
      const bin = label ? await orNull(lookupBin.mutateAsync({ warehouseId, code })) : null;
      if (bin) {
        setActiveBin(bin);
        return;
      }
      const resolved = await orNull(lookupBarcode.mutateAsync(code));
      if (!resolved) {
        const late = label ? null : await orNull(lookupBin.mutateAsync({ warehouseId, code }));
        if (late) setActiveBin(late);
        else setMessage(t('inventory.scanNotFound', { code }));
        return;
      }
      const line = detail.lines.find((row) => row.productId === resolved.product.id);
      if (!line) {
        if (options.onUnknown) options.onUnknown(resolved);
        else setMessage(t('inventory.transfer.notOnTransfer', { name: resolved.product.name }));
      } else if (activeBin !== null) {
        assign(line, activeBin);
        setMessage(
          t('inventory.transfer.binSet', { name: line.productName, code: activeBin.code }),
        );
      } else if (options.onProduct) {
        setMessage(options.onProduct(line, resolved));
      } else {
        setMessage(t('inventory.needBin'));
      }
    });

  return { onScan, activeBin, message, problem: action.problem };
}

/** A count field that accepts zero; a scan landing here goes to the scanner instead. */
function CountInput(props: {
  label: string;
  value: string;
  invalid: boolean;
  onChange: (value: string) => void;
  onScan: (code: string) => void;
  /** Changes when a scan lands on this line: the field takes the focus and selects its text. */
  focusAt?: number;
}) {
  const guard = useScanGuard(props.onScan, { letters: true });
  const ref = useRef<HTMLInputElement>(null);
  const focusAt = props.focusAt;
  useEffect(() => {
    if (focusAt === undefined) return;
    ref.current?.focus();
    ref.current?.select();
  }, [focusAt]);
  return (
    <Input
      ref={ref}
      aria-label={props.label}
      aria-invalid={props.invalid}
      inputMode="decimal"
      autoComplete="off"
      className={cn('ml-auto w-24 text-right font-mono', props.invalid && 'border-destructive')}
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
      onKeyDown={(event) => guard(event, props.value, props.onChange)}
    />
  );
}

/** Which line a scan landed on, and when (a second scan of the same line focuses it again). */
interface LineFocus {
  lineId: number;
  at: number;
}

/** The line's unit or its base unit, when they differ. */
function UnitChoice(props: {
  line: TransferLine;
  base: boolean;
  onChange: (base: boolean) => void;
}) {
  const { t } = useTranslation();
  if (props.line.requestUnitId === props.line.baseUnitId) return <span>{props.line.unitName}</span>;
  return (
    <NativeSelect
      aria-label={`${t('inventory.unit')}: ${props.line.productName}`}
      className="w-32"
      value={props.base ? 'base' : 'line'}
      onChange={(event) => props.onChange(event.target.value === 'base')}
    >
      <option value="line">{props.line.unitName}</option>
      <option value="base">{props.line.baseUnitName}</option>
    </NativeSelect>
  );
}

/** What a count sends: the line's unit or the base unit, the quantity and the bin. */
function countsOf(detail: TransferDetail, counts: Record<number, LineCount>): TransferCount[] {
  return detail.lines.map((line) => {
    const count = counts[line.id];
    return {
      lineId: line.id,
      productUnitId: count?.base ? line.baseUnitId : line.requestUnitId,
      qty: count?.qty.trim() ?? '0',
      ...(count?.binId ? { binId: count.binId } : {}),
    };
  });
}

/**
 * One Idempotency-Key per set of counts: a retry of the same counts replays the stored answer, a
 * changed count is a new step.
 */
function useCountsKey() {
  const last = useRef<{ counts: string; key: string } | null>(null);
  return (lines: TransferCount[]) => {
    const counts = JSON.stringify(lines);
    if (last.current?.counts !== counts) last.current = { counts, key: randomUuid() };
    return last.current.key;
  };
}

/** Counts restored from this device, with the way back to the defaults. */
function RestoredNote(props: { restored: number; dropped: number; onReset: () => void }) {
  const { t } = useTranslation();
  const [hidden, setHidden] = useState(false);
  if (hidden || (props.restored === 0 && props.dropped === 0)) return null;
  return (
    <Alert>
      <AlertDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {props.restored > 0 ? (
          <span>{t('inventory.transfer.restored', { count: props.restored })}</span>
        ) : null}
        {props.dropped > 0 ? (
          <span>{t('inventory.transfer.restoreDropped', { count: props.dropped })}</span>
        ) : null}
        {props.restored > 0 ? (
          <Button
            size="xs"
            variant="ghost"
            className="text-link"
            onClick={() => {
              props.onReset();
              setHidden(true);
            }}
          >
            {t('inventory.transfer.resetCounts')}
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

/**
 * The source ships: quantities default to what was asked, shelves to the fixed shelf. The counts
 * stay on this device until shipped (ADR-0047 #6); a shipment as asked goes at once, one that
 * differs lists the differences first (#7). The source may decline a request, with a reason.
 */
function TransferShipEditor({
  detail,
  canDecline,
}: {
  detail: TransferDetail;
  canDecline: boolean;
}) {
  const { t } = useTranslation();
  const mutations = useTransferMutations();
  const action = useAction();
  const keyFor = useCountsKey();
  const [confirm, setConfirm] = useState<'ship' | 'decline' | null>(null);
  const [reason, setReason] = useState('');
  const step = useStepCounts(detail, 'ship', () =>
    Object.fromEntries(
      detail.lines.map((line) => [
        line.id,
        { qty: line.requestedQty, base: false, binId: line.fromBinId, binCode: line.fromBinCode },
      ]),
    ),
  );
  const { counts, setCounts } = step;
  const update = (lineId: number, patch: Partial<LineCount>) =>
    setCounts((previous) => {
      const current = previous[lineId];
      return current ? { ...previous, [lineId]: { ...current, ...patch } } : previous;
    });
  const [focus, setFocus] = useState<LineFocus | null>(null);
  // A product scan without a shelf lands on its line and shows what was asked (ADR-0116, slice 1's
  // receiving); with a shelf scanned first it sets the shelf, as before.
  const scanner = useLineScanner(
    detail,
    detail.sourceWarehouseId,
    (line, bin) => update(line.id, { binId: bin.id, binCode: bin.code }),
    {
      onProduct: (line) => {
        setFocus({ lineId: line.id, at: Date.now() });
        return t('inventory.transfer.scannedRequested', {
          name: line.productName,
          qty: t('inventory.qtyWithUnit', {
            qty: formatQty(line.requestedQty),
            unit: line.unitName,
          }),
        });
      },
    },
  );
  const base = (line: TransferLine) => {
    const count = counts[line.id];
    return count ? countBase(count, line) : null;
  };
  const invalidCount = detail.lines.filter((line) => base(line) === null).length;
  const missingBins = detail.lines.filter(
    (line) => (base(line)?.gt(0) ?? false) && !counts[line.id]?.binId,
  ).length;
  const invalid = invalidCount > 0;
  const missingBin = missingBins > 0;
  const nothing = detail.lines.every((line) => !(base(line)?.gt(0) ?? false));
  // Why «Илгээх» waits, said where the button is (ADR-0066).
  const blocked = invalid
    ? t('inventory.transfer.blockedInvalid', { count: invalidCount })
    : missingBin
      ? t('inventory.transfer.blockedBins', { count: missingBins })
      : nothing
        ? t('inventory.transfer.blockedNothing')
        : null;
  const differences = detail.lines.flatMap((line) => {
    const shipped = base(line);
    if (shipped === null) return [];
    const difference = shipped.minus(new Decimal(line.requestedQty).times(line.requestFactor));
    return difference.isZero() ? [] : [{ line, difference, none: shipped.isZero() }];
  });

  const ship = () =>
    void action.run(async () => {
      const lines = countsOf(detail, counts);
      const shipped = await mutations.ship.mutateAsync({
        id: detail.id,
        key: keyFor(lines),
        lines,
      });
      step.clear();
      setConfirm(null);
      toast.success(t('inventory.transfer.shippedToast', { number: shipped.number ?? '' }));
    });
  const decline = () =>
    void action.run(async () => {
      await mutations.cancel.mutateAsync({ id: detail.id, reason: reason.trim() });
      step.clear();
      setConfirm(null);
      toast.success(t('inventory.transfer.declined'));
    });

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t('inventory.transfer.shipTitle')}</CardTitle>
          <TransferNotes detail={detail} />
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <RestoredNote restored={step.restored} dropped={step.dropped} onReset={step.reset} />
          <ScanToolbar
            scanBox={
              <ScanBox
                letters
                label={t('inventory.scanLabel')}
                placeholder={t('inventory.scanPlaceholder')}
                onScan={scanner.onScan}
              />
            }
            status={
              <>
                <span className="font-medium">
                  {scanner.activeBin
                    ? t('inventory.activeBin', { code: scanner.activeBin.code })
                    : t('inventory.transfer.shelfHint')}
                </span>
                {scanner.message ? (
                  <span className="text-muted-foreground">{scanner.message}</span>
                ) : null}
              </>
            }
          />
          <ProblemAlert problem={confirm ? null : (action.problem ?? scanner.problem)} />
          <ListTable columns={SHIP_COLUMNS}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('inventory.product')}</TableHead>
                <TableHead className="text-right">{t(requestedLabel(detail.origin))}</TableHead>
                <TableHead className="text-right">{t('inventory.transfer.toShip')}</TableHead>
                <TableHead>{t('inventory.unit')}</TableHead>
                <TableHead>{t('inventory.transfer.fromBin')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.lines.map((line) => {
                const count = counts[line.id];
                const qtyBase = base(line);
                return (
                  <TableRow key={line.id}>
                    <TableCell className="whitespace-normal">
                      <span className="font-mono text-muted-foreground">{line.productSku}</span>{' '}
                      {line.productName}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {t('inventory.qtyWithUnit', {
                        qty: formatQty(line.requestedQty),
                        unit: line.unitName,
                      })}
                    </TableCell>
                    <TableCell className="text-right">
                      <CountInput
                        label={`${t('inventory.transfer.toShip')}: ${line.productName}`}
                        value={count?.qty ?? ''}
                        invalid={qtyBase === null}
                        onChange={(qty) => update(line.id, { qty })}
                        onScan={scanner.onScan}
                        focusAt={focus?.lineId === line.id ? focus.at : undefined}
                      />
                    </TableCell>
                    <TableCell>
                      <UnitChoice
                        line={line}
                        base={count?.base ?? false}
                        onChange={(value) => update(line.id, { base: value })}
                      />
                    </TableCell>
                    <TableCell className="font-mono">
                      {count?.binCode ??
                        (qtyBase?.gt(0) ? (
                          <span className="font-sans text-destructive">
                            {t('inventory.transfer.scanShelf')}
                          </span>
                        ) : (
                          t('common.none')
                        ))}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </ListTable>
        </CardContent>
      </Card>
      <StickyActions
        summary={
          blocked ? (
            <span className="text-warning">{blocked}</span>
          ) : differences.length > 0 ? (
            t('inventory.transfer.differencesCount', { count: differences.length })
          ) : (
            t('inventory.linesCount', { count: detail.lines.length })
          )
        }
      >
        {canDecline ? (
          <Button
            variant="ghost"
            onClick={() => {
              action.clear();
              setReason('');
              setConfirm('decline');
            }}
          >
            {t('inventory.transfer.decline')}
          </Button>
        ) : null}
        <Button
          disabled={invalid || missingBin || nothing || mutations.ship.isPending}
          onClick={() => {
            action.clear();
            if (differences.length > 0) setConfirm('ship');
            else ship();
          }}
        >
          {t('inventory.transfer.ship')}
        </Button>
      </StickyActions>
      <ConfirmDialog
        open={confirm === 'ship'}
        variant="default"
        title={t('inventory.transfer.shipDifferences')}
        description={t('inventory.transfer.shipDescription')}
        confirmLabel={t('inventory.transfer.ship')}
        pending={mutations.ship.isPending}
        problem={action.problem}
        onConfirm={ship}
        onClose={() => setConfirm(null)}
      >
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
          {differences.map(({ line, difference, none }) => (
            <li key={line.id}>
              {none
                ? t('inventory.transfer.shipNone', { name: line.productName })
                : t(
                    difference.isNegative()
                      ? 'inventory.transfer.shipShort'
                      : 'inventory.transfer.shipExtra',
                    { name: line.productName, qty: differenceText(t, line, difference) },
                  )}
            </li>
          ))}
        </ul>
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === 'decline'}
        title={t('inventory.transfer.declineTitle')}
        description={t('inventory.transfer.declineDescription')}
        confirmLabel={t('inventory.transfer.decline')}
        disabled={!reason.trim()}
        pending={mutations.cancel.isPending}
        problem={action.problem}
        onConfirm={decline}
        onClose={() => setConfirm(null)}
      >
        <FormField label={t('inventory.transfer.declineReason')} htmlFor="transfer-decline-reason">
          <Textarea
            id="transfer-decline-reason"
            rows={2}
            maxLength={300}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </FormField>
      </ConfirmDialog>
      <LeaveGuard
        when={step.dirty}
        title={t('inventory.transfer.leaveTitle')}
        description={t('inventory.transfer.leaveDescription')}
        leaveLabel={t('inventory.transfer.leave')}
      />
    </>
  );
}

/**
 * The destination counts what arrived, in the unit shipped; the differences are shown first. The
 * counts stay on this device until received; a receipt without differences goes at once.
 */
function TransferReceiveEditor({ detail }: { detail: TransferDetail }) {
  const { t } = useTranslation();
  const mutations = useTransferMutations();
  const action = useAction();
  const keyFor = useCountsKey();
  const [confirm, setConfirm] = useState(false);
  const step = useStepCounts(detail, 'receive', () =>
    Object.fromEntries(
      detail.lines.map((line) => [
        line.id,
        {
          ...countEntry(line.shippedQtyBase ?? '0', line),
          binId: line.toBinId,
          binCode: line.toBinCode,
        },
      ]),
    ),
  );
  const { counts, setCounts } = step;
  const update = (lineId: number, patch: Partial<LineCount>) =>
    setCounts((previous) => {
      const current = previous[lineId];
      return current ? { ...previous, [lineId]: { ...current, ...patch } } : previous;
    });
  const scanner = useLineScanner(detail, detail.destWarehouseId, (line, bin) =>
    update(line.id, { binId: bin.id, binCode: bin.code }),
  );
  const base = (line: TransferLine) => {
    const count = counts[line.id];
    return count ? countBase(count, line) : null;
  };
  const differenceOf = (line: TransferLine) =>
    base(line)?.minus(line.shippedQtyBase ?? '0') ?? null;
  const invalidCount = detail.lines.filter((line) => base(line) === null).length;
  const invalid = invalidCount > 0;
  const differences = detail.lines.flatMap((line) => {
    const difference = differenceOf(line);
    return difference && !difference.isZero() ? [{ line, difference }] : [];
  });

  const receive = () =>
    void action.run(async () => {
      const lines = countsOf(detail, counts);
      const received = await mutations.receive.mutateAsync({
        id: detail.id,
        key: keyFor(lines),
        lines,
      });
      step.clear();
      setConfirm(false);
      toast.success(t('inventory.transfer.receivedToast', { number: received.number ?? '' }));
    });

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t('inventory.transfer.receiveTitle')}</CardTitle>
          <TransferNotes detail={detail} />
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <RestoredNote restored={step.restored} dropped={step.dropped} onReset={step.reset} />
          <ScanToolbar
            scanBox={
              <ScanBox
                letters
                label={t('inventory.scanLabel')}
                placeholder={t('inventory.scanPlaceholder')}
                onScan={scanner.onScan}
              />
            }
            status={
              <>
                <span className="font-medium">
                  {scanner.activeBin
                    ? t('inventory.activeBin', { code: scanner.activeBin.code })
                    : t('inventory.transfer.destinationHint')}
                </span>
                {scanner.message ? (
                  <span className="text-muted-foreground">{scanner.message}</span>
                ) : null}
              </>
            }
          />
          <ProblemAlert problem={confirm ? null : (action.problem ?? scanner.problem)} />
          <ListTable columns={RECEIVE_COLUMNS}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('inventory.product')}</TableHead>
                <TableHead className="text-right">{t('inventory.transfer.shipped')}</TableHead>
                <TableHead className="text-right">{t('inventory.transfer.arrived')}</TableHead>
                <TableHead>{t('inventory.unit')}</TableHead>
                <TableHead className="text-right">{t('inventory.transfer.difference')}</TableHead>
                <TableHead>{t('inventory.transfer.toBin')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.lines.map((line) => {
                const count = counts[line.id];
                const difference = differenceOf(line);
                return (
                  <TableRow key={line.id}>
                    <TableCell className="whitespace-normal">
                      <span className="font-mono text-muted-foreground">{line.productSku}</span>{' '}
                      {line.productName}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      <ShippedQty line={line} />
                    </TableCell>
                    <TableCell className="text-right">
                      <CountInput
                        label={`${t('inventory.transfer.arrived')}: ${line.productName}`}
                        value={count?.qty ?? ''}
                        invalid={difference === null}
                        onChange={(qty) => update(line.id, { qty })}
                        onScan={scanner.onScan}
                      />
                    </TableCell>
                    <TableCell>
                      <UnitChoice
                        line={line}
                        base={count?.base ?? false}
                        onChange={(value) => update(line.id, { base: value })}
                      />
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-right font-mono',
                        difference && !difference.isZero() && 'text-destructive',
                      )}
                    >
                      {difference && !difference.isZero()
                        ? t('inventory.qtyWithUnit', {
                            qty: signed(difference),
                            unit: line.baseUnitName,
                          })
                        : t('common.none')}
                    </TableCell>
                    <TableCell className="font-mono">
                      {count?.binCode ?? t('common.none')}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </ListTable>
        </CardContent>
      </Card>
      <StickyActions
        summary={
          invalid ? (
            <span className="text-warning">
              {t('inventory.transfer.blockedInvalid', { count: invalidCount })}
            </span>
          ) : differences.length > 0 ? (
            t('inventory.transfer.differencesCount', { count: differences.length })
          ) : (
            t('inventory.linesCount', { count: detail.lines.length })
          )
        }
      >
        <Button
          disabled={invalid || mutations.receive.isPending}
          onClick={() => {
            action.clear();
            if (differences.length > 0) setConfirm(true);
            else receive();
          }}
        >
          {t('inventory.transfer.receive')}
        </Button>
      </StickyActions>
      <ConfirmDialog
        open={confirm}
        variant="default"
        title={t('inventory.transfer.receiveConfirm')}
        confirmLabel={t('inventory.transfer.receive')}
        pending={mutations.receive.isPending}
        problem={action.problem}
        onConfirm={receive}
        onClose={() => setConfirm(false)}
      >
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
          {differences.map(({ line, difference }) => (
            <li key={line.id}>
              {t(
                difference.isNegative() ? 'inventory.transfer.short' : 'inventory.transfer.extra',
                { name: line.productName, qty: differenceText(t, line, difference) },
              )}
            </li>
          ))}
        </ul>
      </ConfirmDialog>
      <LeaveGuard
        when={step.dirty}
        title={t('inventory.transfer.leaveTitle')}
        description={t('inventory.transfer.leaveDescription')}
        leaveLabel={t('inventory.transfer.leave')}
      />
    </>
  );
}

/** A line's count as the count editor keeps it: what the server holds, in the line's unit. */
function countedEntry(line: TransferLine): LineCount {
  return {
    ...(line.countedQtyBase === null
      ? { qty: '', base: false }
      : countEntry(line.countedQtyBase, line)),
    binId: line.toBinId,
    binCode: line.toBinCode,
  };
}

/**
 * The store counts a shipped request (ADR-0116 #4): a product scan lands on its line and shows what
 * was shipped, the arrived quantity is typed or «Ирээгүй» pressed, and every count is saved on the
 * server as it is typed (the keeper sees it on confirmation). A product that was not asked for is
 * added after a question (#5). «Тоолж дуусгах» hands the group to the sender's keeper.
 */
function TransferCountEditor({ detail }: { detail: TransferDetail }) {
  const { t } = useTranslation();
  const mutations = useTransferMutations();
  const action = useAction();
  const [confirm, setConfirm] = useState(false);
  const [extra, setExtra] = useState<{ resolved: BarcodeResolution; qty: string } | null>(null);
  const [counts, setCounts] = useState<Record<number, LineCount>>(() =>
    Object.fromEntries(detail.lines.map((line) => [line.id, countedEntry(line)])),
  );
  const [focus, setFocus] = useState<LineFocus | null>(null);
  const [unsaved, setUnsaved] = useState(0);
  const [saveFailed, setSaveFailed] = useState(false);
  const pending = useRef(new Map<number, LineCount>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef<Promise<void> | null>(null);

  // A line added meanwhile (the scan's extra product) gets its entry; typed counts are kept.
  useEffect(() => {
    setCounts((previous) => {
      const next = { ...previous };
      for (const line of detail.lines) if (!(line.id in next)) next[line.id] = countedEntry(line);
      return next;
    });
  }, [detail.lines]);

  const flush = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (saving.current) return saving.current;
    const entries = [...pending.current.entries()].flatMap(([lineId, count]) => {
      const line = detail.lines.find((row) => row.id === lineId);
      if (!line || countBase(count, line) === null) return [];
      return [
        {
          lineId,
          productUnitId: count.base ? line.baseUnitId : line.requestUnitId,
          qty: count.qty.trim(),
          ...(count.binId ? { binId: count.binId } : {}),
        },
      ];
    });
    pending.current.clear();
    setUnsaved(0);
    if (entries.length === 0) return Promise.resolve();
    saving.current = mutations.saveCounts
      .mutateAsync({ id: detail.id, entries })
      .then(() => setSaveFailed(false))
      .catch(() => {
        // Kept for «Дахин оролдох»: the entries go back into the queue.
        for (const entry of entries) {
          const count = counts[entry.lineId];
          if (count && !pending.current.has(entry.lineId)) pending.current.set(entry.lineId, count);
        }
        setUnsaved(pending.current.size);
        setSaveFailed(true);
      })
      .finally(() => {
        saving.current = null;
      });
    return saving.current;
  };
  const update = (lineId: number, patch: Partial<LineCount>) => {
    const current = counts[lineId];
    if (!current) return;
    const next = { ...current, ...patch };
    setCounts((previous) => ({ ...previous, [lineId]: next }));
    const line = detail.lines.find((row) => row.id === lineId);
    if (line && countBase(next, line) !== null) {
      pending.current.set(lineId, next);
      setUnsaved(pending.current.size);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), 600);
    }
  };
  const scanner = useLineScanner(
    detail,
    detail.destWarehouseId,
    (line, bin) => update(line.id, { binId: bin.id, binCode: bin.code }),
    {
      onProduct: (line) => {
        setFocus({ lineId: line.id, at: Date.now() });
        return t('inventory.transfer.scannedShipped', {
          name: line.productName,
          qty: t('inventory.qtyWithUnit', {
            qty: formatQty(inUnit(line.shippedQtyBase ?? '0', line.requestFactor)),
            unit: line.unitName,
          }),
        });
      },
      onUnknown: (resolved) => setExtra({ resolved, qty: '' }),
    },
  );
  const base = (line: TransferLine) => {
    const count = counts[line.id];
    return count ? countBase(count, line) : null;
  };
  const differenceOf = (line: TransferLine) =>
    base(line)?.minus(line.shippedQtyBase ?? '0') ?? null;
  const uncounted = detail.lines.filter((line) => base(line) === null);
  const differences = detail.lines.flatMap((line) => {
    const difference = differenceOf(line);
    return difference && !difference.isZero() ? [{ line, difference }] : [];
  });
  const finish = () =>
    void action.run(async () => {
      await flush();
      if (pending.current.size > 0) return;
      const counted = await mutations.finishCount.mutateAsync(detail.id);
      setConfirm(false);
      toast.success(t('inventory.transfer.countedToast', { number: counted.number ?? '' }));
    });
  const addExtra = () =>
    void action.run(async () => {
      if (!extra) return;
      const added = await mutations.addCountLine.mutateAsync({
        id: detail.id,
        key: randomUuid(),
        body: {
          productId: extra.resolved.product.id,
          productUnitId: extra.resolved.unit.id,
          qty: extra.qty.trim(),
        },
      });
      const line = added.lines.find((row) => row.productId === extra.resolved.product.id);
      if (line) setCounts((previous) => ({ ...previous, [line.id]: countedEntry(line) }));
      setExtra(null);
      toast.success(t('inventory.transfer.extraAdded', { name: extra.resolved.product.name }));
    });
  const removeExtra = (line: TransferLine) =>
    void action.run(async () => {
      pending.current.delete(line.id);
      setUnsaved(pending.current.size);
      await mutations.removeLine.mutateAsync(line.id);
    });
  const summary =
    unsaved > 0 ? (
      <span className="text-warning">
        {saveFailed
          ? t('inventory.transfer.saveFailed')
          : t('inventory.transfer.unsaved', { count: unsaved })}
      </span>
    ) : uncounted.length > 0 ? (
      <span className="text-warning">
        {t('inventory.transfer.blockedUncounted', { count: uncounted.length })}
      </span>
    ) : differences.length > 0 ? (
      t('inventory.transfer.differencesCount', { count: differences.length })
    ) : (
      t('inventory.linesCount', { count: detail.lines.length })
    );

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t('inventory.transfer.countTitle')}</CardTitle>
          <CardDescription>{t('inventory.transfer.countHint')}</CardDescription>
          <TransferNotes detail={detail} />
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ScanToolbar
            scanBox={
              <ScanBox
                letters
                label={t('inventory.scanLabel')}
                placeholder={t('inventory.scanPlaceholder')}
                onScan={scanner.onScan}
              />
            }
            status={
              <>
                <span className="font-medium">
                  {scanner.activeBin
                    ? t('inventory.activeBin', { code: scanner.activeBin.code })
                    : t('inventory.transfer.destinationHint')}
                </span>
                {scanner.message ? (
                  <span className="text-muted-foreground">{scanner.message}</span>
                ) : null}
              </>
            }
          />
          <ProblemAlert
            problem={confirm || extra ? null : (action.problem ?? scanner.problem)}
            onRetry={saveFailed ? () => void flush() : undefined}
          />
          <ListTable columns={COUNT_COLUMNS}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('inventory.product')}</TableHead>
                <TableHead className="text-right">{t('inventory.transfer.shipped')}</TableHead>
                <TableHead className="text-right">{t('inventory.transfer.arrived')}</TableHead>
                <TableHead>{t('inventory.unit')}</TableHead>
                <TableHead className="text-right">{t('inventory.transfer.difference')}</TableHead>
                <TableHead>{t('inventory.transfer.toBin')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.lines.map((line) => {
                const count = counts[line.id];
                const difference = differenceOf(line);
                const none = difference !== null && base(line)?.isZero();
                return (
                  <TableRow
                    key={line.id}
                    data-state={focus?.lineId === line.id ? 'selected' : undefined}
                  >
                    <TableCell className="whitespace-normal">
                      <span className="font-mono text-muted-foreground">{line.productSku}</span>{' '}
                      {line.productName}
                      {line.unrequested ? (
                        <>
                          {' '}
                          <Badge variant="outline">{t('inventory.transfer.unrequested')}</Badge>
                        </>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {line.unrequested ? t('common.none') : <ShippedQty line={line} />}
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="inline-flex items-center gap-2">
                        <Button
                          size="xs"
                          variant={none ? 'secondary' : 'ghost'}
                          onClick={() => update(line.id, { qty: '0', base: false })}
                        >
                          {t('inventory.transfer.notArrived')}
                        </Button>
                        <CountInput
                          label={`${t('inventory.transfer.arrived')}: ${line.productName}`}
                          value={count?.qty ?? ''}
                          invalid={difference === null}
                          onChange={(qty) => update(line.id, { qty })}
                          onScan={scanner.onScan}
                          focusAt={focus?.lineId === line.id ? focus.at : undefined}
                        />
                      </span>
                    </TableCell>
                    <TableCell>
                      <UnitChoice
                        line={line}
                        base={count?.base ?? false}
                        onChange={(value) => update(line.id, { base: value })}
                      />
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-right font-mono',
                        difference && !difference.isZero() && 'text-destructive',
                      )}
                    >
                      {difference === null
                        ? t('inventory.transfer.notCounted')
                        : difference.isZero()
                          ? t('common.none')
                          : t('inventory.qtyWithUnit', {
                              qty: signed(difference),
                              unit: line.baseUnitName,
                            })}
                    </TableCell>
                    <TableCell className="font-mono">
                      {count?.binCode ?? t('common.none')}
                    </TableCell>
                    {line.unrequested ? (
                      <RowActions>
                        <RowAction
                          icon={Trash2}
                          label={t('inventory.transfer.removeExtra')}
                          onClick={() => removeExtra(line)}
                        />
                      </RowActions>
                    ) : (
                      <TableCell />
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </ListTable>
        </CardContent>
      </Card>
      <StickyActions summary={summary}>
        <Button
          disabled={
            unsaved > 0 ||
            uncounted.length > 0 ||
            mutations.finishCount.isPending ||
            mutations.saveCounts.isPending
          }
          onClick={() => {
            action.clear();
            if (differences.length > 0) setConfirm(true);
            else finish();
          }}
        >
          {t('inventory.transfer.finishCount')}
        </Button>
      </StickyActions>
      <ConfirmDialog
        open={confirm}
        variant="default"
        title={t('inventory.transfer.finishConfirm')}
        description={t('inventory.transfer.finishDescription')}
        confirmLabel={t('inventory.transfer.finishCount')}
        pending={mutations.finishCount.isPending}
        problem={action.problem}
        onConfirm={finish}
        onClose={() => setConfirm(false)}
      >
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
          {differences.map(({ line, difference }) => (
            <li key={line.id}>
              {t(
                difference.isNegative() ? 'inventory.transfer.short' : 'inventory.transfer.extra',
                { name: line.productName, qty: differenceText(t, line, difference) },
              )}
            </li>
          ))}
        </ul>
      </ConfirmDialog>
      <ConfirmDialog
        open={extra !== null}
        variant="default"
        title={t('inventory.transfer.addExtraTitle', { name: extra?.resolved.product.name ?? '' })}
        description={t('inventory.transfer.addExtraDescription')}
        confirmLabel={t('inventory.transfer.addExtra')}
        disabled={!extra || !parseScanQty(extra.qty)}
        pending={mutations.addCountLine.isPending}
        problem={action.problem}
        onConfirm={addExtra}
        onClose={() => setExtra(null)}
      >
        <FormField
          label={t('inventory.transfer.addExtraQty', { unit: extra?.resolved.unit.uomName ?? '' })}
          htmlFor="transfer-extra-qty"
        >
          <Input
            id="transfer-extra-qty"
            inputMode="decimal"
            autoComplete="off"
            className="w-32 text-right font-mono"
            value={extra?.qty ?? ''}
            onChange={(event) =>
              setExtra((previous) =>
                previous ? { ...previous, qty: event.target.value } : previous,
              )
            }
          />
        </FormField>
      </ConfirmDialog>
    </>
  );
}

/**
 * The sender's keeper confirms the store's count (ADR-0116 #6): the differences line by line, where
 * a shortfall returns and what a surplus takes; the ledger moves on «Батлах». «Буцаах» sends the
 * count back to the store with a reason.
 */
function TransferConfirmView({ detail }: { detail: TransferDetail }) {
  const { t } = useTranslation();
  const mutations = useTransferMutations();
  const action = useAction();
  const [dialog, setDialog] = useState<'confirm' | 'return' | null>(null);
  const [reason, setReason] = useState('');
  const key = useRef(randomUuid());
  const differences = detail.lines.flatMap((line) => {
    if (line.countedQtyBase === null) return [];
    const difference = new Decimal(line.countedQtyBase).minus(line.shippedQtyBase ?? '0');
    return difference.isZero() ? [] : [{ line, difference }];
  });
  const confirm = () =>
    void action.run(async () => {
      const received = await mutations.confirm.mutateAsync({ id: detail.id, key: key.current });
      setDialog(null);
      toast.success(t('inventory.transfer.confirmedToast', { number: received.number ?? '' }));
    });
  const sendBack = () =>
    void action.run(async () => {
      await mutations.returnCount.mutateAsync({ id: detail.id, reason: reason.trim() });
      setDialog(null);
      toast.success(t('inventory.transfer.returnedToast'));
    });
  const countedText = (line: TransferLine) =>
    line.countedQtyBase === null
      ? t('inventory.transfer.notCounted')
      : new Decimal(line.countedQtyBase).isZero()
        ? t('inventory.transfer.notArrived')
        : t('inventory.qtyWithUnit', {
            qty: formatQty(line.countedQtyBase),
            unit: line.baseUnitName,
          });

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t('inventory.transfer.confirmTitle')}</CardTitle>
          <CardDescription>{t('inventory.transfer.confirmHint')}</CardDescription>
          <TransferNotes detail={detail} />
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ProblemAlert problem={dialog ? null : action.problem} />
          <ListTable columns={CONFIRM_COLUMNS}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('inventory.product')}</TableHead>
                <TableHead className="text-right">{t('inventory.transfer.shipped')}</TableHead>
                <TableHead className="text-right">{t('inventory.transfer.counted')}</TableHead>
                <TableHead className="text-right">{t('inventory.transfer.difference')}</TableHead>
                <TableHead>{t('inventory.transfer.toBin')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.lines.map((line) => {
                const difference = differences.find((row) => row.line.id === line.id)?.difference;
                return (
                  <TableRow key={line.id}>
                    <TableCell className="whitespace-normal">
                      <span className="font-mono text-muted-foreground">{line.productSku}</span>{' '}
                      {line.productName}
                      {line.unrequested ? (
                        <>
                          {' '}
                          <Badge variant="outline">{t('inventory.transfer.unrequested')}</Badge>
                        </>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {line.unrequested ? t('common.none') : <ShippedQty line={line} />}
                    </TableCell>
                    <TableCell className="text-right font-mono">{countedText(line)}</TableCell>
                    <TableCell className="whitespace-normal text-right">
                      {difference ? (
                        <span className="flex flex-col items-end">
                          <span className="font-mono text-destructive">
                            {t('inventory.qtyWithUnit', {
                              qty: signed(difference),
                              unit: line.baseUnitName,
                            })}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {difference.isNegative()
                              ? t('inventory.transfer.goesBack', {
                                  qty: differenceText(t, line, difference),
                                  bin: line.fromBinCode ?? t('common.none'),
                                })
                              : t('inventory.transfer.comesFrom', {
                                  qty: differenceText(t, line, difference),
                                })}
                          </span>
                        </span>
                      ) : (
                        t('common.none')
                      )}
                    </TableCell>
                    <TableCell className="font-mono">
                      {line.toBinCode ?? t('common.none')}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </ListTable>
        </CardContent>
      </Card>
      <StickyActions
        summary={
          differences.length > 0
            ? t('inventory.transfer.differencesCount', { count: differences.length })
            : t('inventory.linesCount', { count: detail.lines.length })
        }
      >
        <Button
          variant="ghost"
          onClick={() => {
            action.clear();
            setReason('');
            setDialog('return');
          }}
        >
          {t('inventory.transfer.returnCount')}
        </Button>
        <Button
          disabled={mutations.confirm.isPending}
          onClick={() => {
            action.clear();
            setDialog('confirm');
          }}
        >
          {t('inventory.transfer.confirm')}
        </Button>
      </StickyActions>
      <ConfirmDialog
        open={dialog === 'confirm'}
        variant="default"
        title={t('inventory.transfer.confirmQuestion')}
        description={t('inventory.transfer.confirmDescription')}
        confirmLabel={t('inventory.transfer.confirm')}
        pending={mutations.confirm.isPending}
        problem={action.problem}
        onConfirm={confirm}
        onClose={() => setDialog(null)}
      >
        {differences.length > 0 ? (
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
            {differences.map(({ line, difference }) => (
              <li key={line.id}>
                {t(
                  difference.isNegative() ? 'inventory.transfer.short' : 'inventory.transfer.extra',
                  { name: line.productName, qty: differenceText(t, line, difference) },
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === 'return'}
        title={t('inventory.transfer.returnTitle')}
        description={t('inventory.transfer.returnDescription')}
        confirmLabel={t('inventory.transfer.returnCount')}
        disabled={!reason.trim()}
        pending={mutations.returnCount.isPending}
        problem={action.problem}
        onConfirm={sendBack}
        onClose={() => setDialog(null)}
      >
        <FormField label={t('inventory.transfer.returnReason')} htmlFor="transfer-return-reason">
          <Textarea
            id="transfer-return-reason"
            rows={2}
            maxLength={300}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </FormField>
      </ConfirmDialog>
    </>
  );
}

function signed(value: Decimal): string {
  return value.isNegative() ? formatQty(value.toFixed()) : `+${formatQty(value.toFixed())}`;
}

function requestedLabel(origin: TransferOrigin) {
  return origin === 'REQUEST' ? 'inventory.transfer.requested' : 'inventory.transfer.planned';
}

/**
 * A count's difference from the plan: in the line's unit when it is a whole number of them, with
 * the base units («1 хайрцаг (24 ш)»), else in base units.
 */
function differenceText(t: TFunction, line: TransferLine, difference: Decimal): string {
  const base = difference.abs();
  const inLineUnit = base.dividedBy(line.requestFactor);
  return line.requestUnitId === line.baseUnitId || !inLineUnit.isInteger()
    ? t('inventory.qtyWithUnit', { qty: formatQty(base.toFixed()), unit: line.baseUnitName })
    : t('inventory.qtyWithBase', {
        qty: formatQty(inLineUnit.toFixed()),
        unit: line.unitName,
        base: formatQty(base.toFixed()),
        baseUnit: line.baseUnitName,
      });
}

/** A shipped quantity in the line's unit, with the base units when they differ. */
function ShippedQty({ line }: { line: TransferLine }) {
  const { t } = useTranslation();
  const shipped = line.shippedQtyBase;
  if (shipped === null) return <>{t('common.none')}</>;
  const inLineUnit = t('inventory.qtyWithUnit', {
    qty: formatQty(inUnit(shipped, line.requestFactor)),
    unit: line.unitName,
  });
  return line.requestUnitId === line.baseUnitId ? (
    <>{inLineUnit}</>
  ) : (
    <>
      {inLineUnit}{' '}
      <span className="text-muted-foreground">
        (
        {t('inventory.qtyWithUnit', {
          qty: formatQty(shipped),
          unit: line.baseUnitName,
        })}
        )
      </span>
    </>
  );
}

/** The printable list: asked, shipped, counted and received quantities with their shelves. */
function TransferLinesView({ detail }: { detail: TransferDetail }) {
  const { t } = useTranslation();
  const received = (line: TransferLine) =>
    line.receivedQtyBase === null
      ? t('common.none')
      : t('inventory.qtyWithUnit', {
          qty: formatQty(line.receivedQtyBase),
          unit: line.baseUnitName,
        });
  const counted = (line: TransferLine) =>
    line.countedQtyBase === null
      ? t('common.none')
      : new Decimal(line.countedQtyBase).isZero()
        ? t('inventory.transfer.notArrived')
        : t('inventory.qtyWithUnit', {
            qty: formatQty(line.countedQtyBase),
            unit: line.baseUnitName,
          });
  const withCounts = detail.lines.some((line) => line.countedQtyBase !== null);
  return (
    <Card>
      {detail.note || detail.cancelReason ? (
        <CardHeader>
          <TransferNotes detail={detail} />
        </CardHeader>
      ) : null}
      <CardContent className="flex flex-col gap-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('inventory.product')}</TableHead>
              <TableHead className="text-right">{t(requestedLabel(detail.origin))}</TableHead>
              {BINS_SOON ? null : <TableHead>{t('inventory.transfer.fromBin')}</TableHead>}
              <TableHead className="text-right">{t('inventory.transfer.shipped')}</TableHead>
              {withCounts ? (
                <TableHead className="text-right">{t('inventory.transfer.counted')}</TableHead>
              ) : null}
              <TableHead className="text-right">{t('inventory.transfer.received')}</TableHead>
              {BINS_SOON ? null : <TableHead>{t('inventory.transfer.toBin')}</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {detail.lines.map((line) => (
              <TableRow key={line.id}>
                <TableCell className="whitespace-normal">
                  <span className="font-mono text-muted-foreground">{line.productSku}</span>{' '}
                  {line.productName}
                  {line.unrequested ? (
                    <>
                      {' '}
                      <Badge variant="outline">{t('inventory.transfer.unrequested')}</Badge>
                    </>
                  ) : null}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {line.unrequested
                    ? t('common.none')
                    : t('inventory.qtyWithUnit', {
                        qty: formatQty(line.requestedQty),
                        unit: line.unitName,
                      })}
                </TableCell>
                {BINS_SOON ? null : (
                  <TableCell className="font-mono">
                    {line.fromBinCode ?? t('common.none')}
                  </TableCell>
                )}
                <TableCell className="text-right font-mono">
                  {line.unrequested ? t('common.none') : <ShippedQty line={line} />}
                </TableCell>
                {withCounts ? (
                  <TableCell className="text-right font-mono">{counted(line)}</TableCell>
                ) : null}
                <TableCell className="text-right font-mono">{received(line)}</TableCell>
                {BINS_SOON ? null : (
                  <TableCell className="font-mono">{line.toBinCode ?? t('common.none')}</TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {detail.lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('inventory.transfer.noLines')}</p>
        ) : null}
        <div className="hidden grid-cols-2 gap-8 pt-8 text-sm print:grid">
          <p className="border-t pt-1">{t('inventory.transfer.signSender')}</p>
          <p className="border-t pt-1">{t('inventory.transfer.signReceiver')}</p>
        </div>
      </CardContent>
    </Card>
  );
}
