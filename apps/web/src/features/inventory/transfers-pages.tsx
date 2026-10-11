import { Decimal } from '@tugeel/shared/money';
import { Printer } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { ScanBox } from '@/components/scan-box';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useBarcodeLookup } from '@/features/catalog/api';
import { problemFromError } from '@/lib/problem';
import { useScanGuard } from '@/lib/scan/use-wedge-scanner';
import { useAction } from '@/lib/use-action';
import { cn } from '@/lib/utils';
import { randomUuid } from '@/lib/uuid';
import {
  type Bin,
  type TransferDetail,
  type TransferLine,
  type TransferOrigin,
  type TransferStatus,
  useBinLookup,
  useTransfer,
  useTransferMutations,
  useTransfers,
} from './api';
import {
  type CountEntry,
  countBase,
  countEntry,
  inUnit,
  looksLikeLabel,
  useCanWrite,
  useWarehouseName,
  useWarehouseOptions,
} from './helpers';
import { DocStatusBadge, ProductSearch, QtyInput, WarehouseSelect } from './shared';

const TRANSFER_KINDS = ['WHOLESALE', 'STORE'] as const;
const STATUSES: readonly TransferStatus[] = [
  'DRAFT',
  'REQUESTED',
  'SHIPPED',
  'RECEIVED',
  'CANCELLED',
];
const ORIGINS: readonly TransferOrigin[] = ['REQUEST', 'PUSH'];

const isStatus = (value: string | null): value is TransferStatus =>
  STATUSES.some((status) => status === value);

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
 * inventory.transfers.manage request, ship and receive for the warehouses they write for.
 */
export function TransfersPage() {
  const { t } = useTranslation();
  const canManage = useHasPermission('inventory.transfers.manage');
  const [params, setParams] = useSearchParams();
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
  const direction = params.get('direction') === 'OUTGOING' ? 'OUTGOING' : 'INCOMING';
  const statusParam = params.get('status');
  const status = isStatus(statusParam) ? statusParam : undefined;
  const transfers = useTransfers({ warehouseId, direction, status });
  const rows = transfers.data?.pages.flatMap((page) => page.data) ?? [];

  const setParam = (key: string, value: string) =>
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
    <div className="flex flex-col gap-4">
      <PageHeader title={t('inventory.transfers.title')} />
      {canManage ? <TransferCreateCard /> : null}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <WarehouseSelect
          options={warehouses.options}
          value={warehouseId}
          emptyLabel={t('inventory.allWarehouses')}
          onChange={(id) => setParam('warehouseId', id === undefined ? '' : String(id))}
        />
        <NativeSelect
          aria-label={t('inventory.transfers.direction')}
          disabled={warehouseId === undefined}
          value={direction}
          onChange={(event) => setParam('direction', event.target.value)}
        >
          <option value="INCOMING">{t('inventory.transfers.incoming')}</option>
          <option value="OUTGOING">{t('inventory.transfers.outgoing')}</option>
        </NativeSelect>
        <NativeSelect
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
      </div>
      <ProblemAlert problem={problemFromError(transfers.error)} />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('inventory.number')}</TableHead>
            <TableHead>{t('inventory.transfers.from')}</TableHead>
            <TableHead>{t('inventory.transfers.to')}</TableHead>
            <TableHead>{t('inventory.transfer.origin')}</TableHead>
            <TableHead className="text-right">{t('inventory.lines')}</TableHead>
            <TableHead>{t('inventory.status')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
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
                <DocStatusBadge status={row.status} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {!transfers.isPending && rows.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">{t('inventory.transfers.empty')}</p>
      ) : null}
      {transfers.hasNextPage ? (
        <Button
          className="self-start"
          variant="outline"
          disabled={transfers.isFetchingNextPage}
          onClick={() => void transfers.fetchNextPage()}
        >
          {t('common.loadMore')}
        </Button>
      ) : null}
    </div>
  );
}

/** A request is made by the receiving warehouse, a push by the sending one (supermarket returns). */
function TransferCreateCard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const all = useWarehouseOptions(TRANSFER_KINDS);
  const mine = useWarehouseOptions(TRANSFER_KINDS, true);
  const mutations = useTransferMutations();
  const action = useAction();
  const [key] = useState(randomUuid);
  const [origin, setOrigin] = useState<TransferOrigin>('REQUEST');
  const [source, setSource] = useState<number | undefined>();
  const [dest, setDest] = useState<number | undefined>();
  const [note, setNote] = useState('');
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
      await navigate(`/inventory/transfers/${transfer.id}`);
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('inventory.transfer.newTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ProblemAlert problem={action.problem} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <NativeSelect
            aria-label={t('inventory.transfer.origin')}
            value={origin}
            onChange={(event) => {
              const picked = ORIGINS.find((value) => value === event.target.value);
              if (!picked) return;
              setOrigin(picked);
              setSource(undefined);
              setDest(undefined);
            }}
          >
            {ORIGINS.map((value) => (
              <option key={value} value={value}>
                {t(`inventory.transfer.origins.${value}`)}
              </option>
            ))}
          </NativeSelect>
          <WarehouseSelect
            label={t('inventory.transfers.from')}
            options={origin === 'REQUEST' ? all.options : mine.options}
            value={source}
            emptyLabel={t('inventory.transfers.pickFrom')}
            onChange={setSource}
          />
          <WarehouseSelect
            label={t('inventory.transfers.to')}
            options={origin === 'REQUEST' ? mine.options : all.options}
            value={dest}
            emptyLabel={t('inventory.transfers.pickTo')}
            onChange={setDest}
          />
          <Input
            aria-label={t('inventory.note')}
            placeholder={t('inventory.note')}
            maxLength={500}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {t(`inventory.transfer.originHints.${origin}`)}
        </p>
        <Button
          className="self-start"
          disabled={!ready || mutations.create.isPending}
          onClick={create}
        >
          {t('inventory.transfer.createDraft')}
        </Button>
      </CardContent>
    </Card>
  );
}

/** One transfer: the editor of the step the user's warehouse takes, and a printable list. */
export function TransferPage() {
  const { t } = useTranslation();
  const id = Number.parseInt(useParams().id ?? '', 10);
  const canManage = useHasPermission('inventory.transfers.manage');
  const canWrite = useCanWrite();
  const transfer = useTransfer(id);
  const warehouseName = useWarehouseName();
  const [shipping, setShipping] = useState(false);

  const loadProblem = problemFromError(transfer.error);
  if (loadProblem) return <ProblemAlert problem={loadProblem} />;
  if (!transfer.data) {
    return <p className="text-sm text-muted-foreground">{t('common.loading')}</p>;
  }
  const detail = transfer.data;
  const atSource = canManage && canWrite(detail.sourceWarehouseId);
  const atDest = canManage && canWrite(detail.destWarehouseId);
  const owner = detail.origin === 'REQUEST' ? atDest : atSource;
  const editor =
    detail.status === 'DRAFT' && owner && !(detail.origin === 'PUSH' && shipping) ? (
      <TransferDraftEditor
        key={`draft-${detail.id}`}
        detail={detail}
        onShip={() => setShipping(true)}
      />
    ) : (detail.status === 'REQUESTED' || (detail.status === 'DRAFT' && shipping)) && atSource ? (
      <TransferShipEditor key={`ship-${detail.id}`} detail={detail} />
    ) : detail.status === 'SHIPPED' && atDest ? (
      <TransferReceiveEditor key={`receive-${detail.id}`} detail={detail} />
    ) : null;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={detail.number ?? t('inventory.draftNo', { id: detail.id })}
        actions={
          <div className="flex gap-2 print:hidden">
            <Button variant="outline" onClick={() => window.print()}>
              <Printer />
              {t('inventory.transfer.print')}
            </Button>
            <Button variant="outline" asChild>
              <Link to="/inventory/transfers">{t('common.back')}</Link>
            </Button>
          </div>
        }
      />
      <div className="-mt-2 flex flex-wrap items-center gap-2 text-sm">
        <DocStatusBadge status={detail.status} />
        <Badge variant="outline">{t(`inventory.transfer.origins.${detail.origin}`)}</Badge>
        <span>
          {t('inventory.transfer.route', {
            from: warehouseName(detail.sourceWarehouseId),
            to: warehouseName(detail.destWarehouseId),
          })}
        </span>
        {detail.shipDate ? (
          <span className="font-mono text-muted-foreground">
            {t('inventory.transfer.shippedOn', { date: detail.shipDate })}
          </span>
        ) : null}
        {detail.receiveDate ? (
          <span className="font-mono text-muted-foreground">
            {t('inventory.transfer.receivedOn', { date: detail.receiveDate })}
          </span>
        ) : null}
      </div>
      {detail.note ? <p className="text-sm">{detail.note}</p> : null}
      {detail.cancelReason ? (
        <p className="text-sm text-muted-foreground">
          {t('inventory.transfer.cancelReason', { reason: detail.cancelReason })}
        </p>
      ) : null}
      {detail.status === 'REQUESTED' && (atSource || atDest) ? (
        <RequestActions detail={detail} atDest={atDest} />
      ) : null}
      {editor ? <div className="print:hidden">{editor}</div> : null}
      <div className={editor ? 'hidden print:block' : undefined}>
        <TransferLinesView detail={detail} />
      </div>
    </div>
  );
}

/** A sent request: its destination withdraws it, its source declines it with a reason. */
function RequestActions({ detail, atDest }: { detail: TransferDetail; atDest: boolean }) {
  const { t } = useTranslation();
  const mutations = useTransferMutations();
  const action = useAction();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const run = () =>
    void action.run(async () => {
      await mutations.cancel.mutateAsync({
        id: detail.id,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      setOpen(false);
    });

  return (
    <div className="flex flex-wrap items-end gap-2 print:hidden">
      {atDest ? null : (
        <div className="flex flex-col gap-1">
          <Label htmlFor="transfer-decline">{t('inventory.transfer.declineReason')}</Label>
          <Input
            id="transfer-decline"
            className="w-72"
            maxLength={300}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
      )}
      <Button
        variant="outline"
        disabled={!atDest && !reason.trim()}
        onClick={() => {
          action.clear();
          setOpen(true);
        }}
      >
        {atDest ? t('inventory.transfer.withdraw') : t('inventory.transfer.decline')}
      </Button>
      <ConfirmDialog
        open={open}
        title={
          atDest ? t('inventory.transfer.withdrawTitle') : t('inventory.transfer.declineTitle')
        }
        confirmLabel={atDest ? t('inventory.transfer.withdraw') : t('inventory.transfer.decline')}
        pending={mutations.cancel.isPending}
        problem={action.problem}
        onConfirm={run}
        onClose={() => setOpen(false)}
      />
    </div>
  );
}

/** The lines of a draft: products scanned or searched, quantities in the unit asked for. */
function TransferDraftEditor({ detail, onShip }: { detail: TransferDetail; onShip: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const mutations = useTransferMutations();
  const lookupBarcode = useBarcodeLookup();
  const action = useAction();
  const [message, setMessage] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'request' | 'cancel' | null>(null);

  const addUnit = async (productId: number, productUnitId: number) => {
    const line = detail.lines.find((row) => row.productId === productId);
    if (!line) {
      await mutations.addLine.mutateAsync({ id: detail.id, body: { productUnitId, qty: '1' } });
    } else if (line.requestUnitId === productUnitId) {
      await mutations.updateLine.mutateAsync({
        id: line.id,
        body: { qty: new Decimal(line.requestedQty).plus(1).toString() },
      });
    } else {
      setMessage(t('inventory.transfer.otherUnit', { unit: line.unitName }));
    }
  };

  const onScan = (code: string) =>
    void action.run(async () => {
      setMessage(null);
      const resolved = await orNull(lookupBarcode.mutateAsync(code));
      if (resolved) await addUnit(resolved.product.id, resolved.unit.id);
      else setMessage(t('inventory.transfer.unknownProduct', { code }));
    });

  const request = () =>
    void action.run(async () => {
      await mutations.request.mutateAsync(detail.id);
      setConfirm(null);
    });
  const cancel = () =>
    void action.run(async () => {
      await mutations.cancel.mutateAsync({ id: detail.id });
      setConfirm(null);
      await navigate('/inventory/transfers');
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('inventory.lines')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ScanBox
          label={t('inventory.transfer.scanProduct')}
          placeholder={t('inventory.transfer.scanProductPlaceholder')}
          onScan={onScan}
        />
        {message ? <p className="text-sm text-destructive">{message}</p> : null}
        <ProblemAlert problem={confirm ? null : action.problem} />
        <ProductSearch
          onPick={(product) => void action.run(() => addUnit(product.id, product.baseUnit.id))}
        />
        {detail.lines.length > 0 ? (
          <Table>
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
                  <TableCell className="text-right">
                    <Button
                      size="xs"
                      variant="ghost"
                      aria-label={`${t('inventory.remove')}: ${line.productName}`}
                      onClick={() =>
                        void action.run(() => mutations.removeLine.mutateAsync(line.id))
                      }
                    >
                      {t('inventory.remove')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {detail.origin === 'REQUEST' ? (
            <Button
              disabled={detail.lines.length === 0 || mutations.request.isPending}
              onClick={() => {
                action.clear();
                setConfirm('request');
              }}
            >
              {t('inventory.transfer.sendRequest')}
            </Button>
          ) : (
            <Button disabled={detail.lines.length === 0} onClick={onShip}>
              {t('inventory.transfer.prepareShipment')}
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => {
              action.clear();
              setConfirm('cancel');
            }}
          >
            {t('inventory.transfer.cancelDraft')}
          </Button>
        </div>
      </CardContent>
      <ConfirmDialog
        open={confirm === 'request'}
        variant="default"
        title={t('inventory.transfer.requestTitle')}
        description={t('inventory.transfer.requestDescription')}
        confirmLabel={t('inventory.transfer.sendRequest')}
        pending={mutations.request.isPending}
        problem={action.problem}
        onConfirm={request}
        onClose={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'cancel'}
        title={t('inventory.transfer.cancelTitle')}
        confirmLabel={t('inventory.transfer.cancelDraft')}
        pending={mutations.cancel.isPending}
        problem={action.problem}
        onConfirm={cancel}
        onClose={() => setConfirm(null)}
      />
    </Card>
  );
}

interface LineCount extends CountEntry {
  binId: number | null;
  binCode: string | null;
}

/**
 * Scanning for a shipment or a receipt: a shelf label sets the active shelf, a product then takes
 * that shelf on its line. Unknown codes give a message, never a new line.
 */
function useLineScanner(
  detail: TransferDetail,
  warehouseId: number,
  assign: (line: TransferLine, bin: Bin) => void,
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
        setMessage(t('inventory.transfer.notOnTransfer', { name: resolved.product.name }));
      } else if (activeBin === null) {
        setMessage(t('inventory.needBin'));
      } else {
        assign(line, activeBin);
        setMessage(
          t('inventory.transfer.binSet', { name: line.productName, code: activeBin.code }),
        );
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
}) {
  const guard = useScanGuard(props.onScan, { letters: true });
  return (
    <Input
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
function countsOf(detail: TransferDetail, counts: Record<number, LineCount>) {
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

/** The source ships: quantities default to what was asked, shelves to the fixed shelf. */
function TransferShipEditor({ detail }: { detail: TransferDetail }) {
  const { t } = useTranslation();
  const mutations = useTransferMutations();
  const action = useAction();
  const [key, setKey] = useState(randomUuid);
  const [confirm, setConfirm] = useState(false);
  const [counts, setCounts] = useState<Record<number, LineCount>>(() =>
    Object.fromEntries(
      detail.lines.map((line) => [
        line.id,
        { qty: line.requestedQty, base: false, binId: line.fromBinId, binCode: line.fromBinCode },
      ]),
    ),
  );
  const update = (lineId: number, patch: Partial<LineCount>) =>
    setCounts((previous) => {
      const current = previous[lineId];
      return current ? { ...previous, [lineId]: { ...current, ...patch } } : previous;
    });
  const scanner = useLineScanner(detail, detail.sourceWarehouseId, (line, bin) =>
    update(line.id, { binId: bin.id, binCode: bin.code }),
  );
  const base = (line: TransferLine) => {
    const count = counts[line.id];
    return count ? countBase(count, line) : null;
  };
  const invalid = detail.lines.some((line) => base(line) === null);
  const missingBin = detail.lines.some(
    (line) => (base(line)?.gt(0) ?? false) && !counts[line.id]?.binId,
  );
  const nothing = detail.lines.every((line) => !(base(line)?.gt(0) ?? false));

  const ship = () =>
    void action.run(async () => {
      await mutations.ship.mutateAsync({ id: detail.id, key, lines: countsOf(detail, counts) });
      setConfirm(false);
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('inventory.transfer.shipTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ScanBox
          letters
          label={t('inventory.scanLabel')}
          placeholder={t('inventory.scanPlaceholder')}
          onScan={scanner.onScan}
        />
        <span className="text-sm font-medium">
          {scanner.activeBin
            ? t('inventory.activeBin', { code: scanner.activeBin.code })
            : t('inventory.transfer.shelfHint')}
        </span>
        {scanner.message ? (
          <p className="text-sm text-muted-foreground">{scanner.message}</p>
        ) : null}
        <ProblemAlert problem={confirm ? null : (action.problem ?? scanner.problem)} />
        <Table>
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
                    {t('inventory.qtyWithUnit', { qty: line.requestedQty, unit: line.unitName })}
                  </TableCell>
                  <TableCell className="text-right">
                    <CountInput
                      label={`${t('inventory.transfer.toShip')}: ${line.productName}`}
                      value={count?.qty ?? ''}
                      invalid={qtyBase === null}
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
        </Table>
        <Button
          className="self-start"
          disabled={invalid || missingBin || nothing || mutations.ship.isPending}
          onClick={() => {
            setKey(randomUuid());
            action.clear();
            setConfirm(true);
          }}
        >
          {t('inventory.transfer.ship')}
        </Button>
      </CardContent>
      <ConfirmDialog
        open={confirm}
        variant="default"
        title={t('inventory.transfer.shipConfirm')}
        description={t('inventory.transfer.shipDescription')}
        confirmLabel={t('inventory.transfer.ship')}
        pending={mutations.ship.isPending}
        problem={action.problem}
        onConfirm={ship}
        onClose={() => setConfirm(false)}
      />
    </Card>
  );
}

/** The destination counts what arrived, in the unit shipped; the differences are shown first. */
function TransferReceiveEditor({ detail }: { detail: TransferDetail }) {
  const { t } = useTranslation();
  const mutations = useTransferMutations();
  const action = useAction();
  const [key, setKey] = useState(randomUuid);
  const [confirm, setConfirm] = useState(false);
  const [counts, setCounts] = useState<Record<number, LineCount>>(() =>
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
  const invalid = detail.lines.some((line) => base(line) === null);
  const differences = detail.lines.flatMap((line) => {
    const difference = differenceOf(line);
    return difference && !difference.isZero() ? [{ line, difference }] : [];
  });

  const receive = () =>
    void action.run(async () => {
      await mutations.receive.mutateAsync({
        id: detail.id,
        key,
        lines: countsOf(detail, counts),
      });
      setConfirm(false);
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('inventory.transfer.receiveTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ScanBox
          letters
          label={t('inventory.scanLabel')}
          placeholder={t('inventory.scanPlaceholder')}
          onScan={scanner.onScan}
        />
        <span className="text-sm font-medium">
          {scanner.activeBin
            ? t('inventory.activeBin', { code: scanner.activeBin.code })
            : t('inventory.transfer.destinationHint')}
        </span>
        {scanner.message ? (
          <p className="text-sm text-muted-foreground">{scanner.message}</p>
        ) : null}
        <ProblemAlert problem={confirm ? null : (action.problem ?? scanner.problem)} />
        <Table>
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
                  <TableCell className="font-mono">{count?.binCode ?? t('common.none')}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <Button
          className="self-start"
          disabled={invalid || mutations.receive.isPending}
          onClick={() => {
            setKey(randomUuid());
            action.clear();
            setConfirm(true);
          }}
        >
          {t('inventory.transfer.receive')}
        </Button>
      </CardContent>
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
        {differences.length === 0 ? (
          <p className="text-sm">{t('inventory.transfer.noDifference')}</p>
        ) : (
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
            {differences.map(({ line, difference }) => (
              <li key={line.id}>
                {t(
                  difference.isNegative() ? 'inventory.transfer.short' : 'inventory.transfer.extra',
                  {
                    name: line.productName,
                    qty: t('inventory.qtyWithUnit', {
                      qty: difference.abs().toFixed(),
                      unit: line.baseUnitName,
                    }),
                  },
                )}
              </li>
            ))}
          </ul>
        )}
      </ConfirmDialog>
    </Card>
  );
}

function signed(value: Decimal): string {
  return value.isNegative() ? value.toFixed() : `+${value.toFixed()}`;
}

function requestedLabel(origin: TransferOrigin) {
  return origin === 'REQUEST' ? 'inventory.transfer.requested' : 'inventory.transfer.planned';
}

/** A shipped quantity in the line's unit, with the base units when they differ. */
function ShippedQty({ line }: { line: TransferLine }) {
  const { t } = useTranslation();
  const shipped = line.shippedQtyBase;
  if (shipped === null) return <>{t('common.none')}</>;
  const inLineUnit = t('inventory.qtyWithUnit', {
    qty: inUnit(shipped, line.requestFactor),
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
          qty: new Decimal(shipped).toFixed(),
          unit: line.baseUnitName,
        })}
        )
      </span>
    </>
  );
}

/** The printable list: asked, shipped and received quantities with their shelves. */
function TransferLinesView({ detail }: { detail: TransferDetail }) {
  const { t } = useTranslation();
  const received = (line: TransferLine) =>
    line.receivedQtyBase === null
      ? t('common.none')
      : t('inventory.qtyWithUnit', {
          qty: new Decimal(line.receivedQtyBase).toFixed(),
          unit: line.baseUnitName,
        });
  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('inventory.product')}</TableHead>
              <TableHead className="text-right">{t(requestedLabel(detail.origin))}</TableHead>
              <TableHead>{t('inventory.transfer.fromBin')}</TableHead>
              <TableHead className="text-right">{t('inventory.transfer.shipped')}</TableHead>
              <TableHead className="text-right">{t('inventory.transfer.received')}</TableHead>
              <TableHead>{t('inventory.transfer.toBin')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {detail.lines.map((line) => (
              <TableRow key={line.id}>
                <TableCell className="whitespace-normal">
                  <span className="font-mono text-muted-foreground">{line.productSku}</span>{' '}
                  {line.productName}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {t('inventory.qtyWithUnit', { qty: line.requestedQty, unit: line.unitName })}
                </TableCell>
                <TableCell className="font-mono">{line.fromBinCode ?? t('common.none')}</TableCell>
                <TableCell className="text-right font-mono">
                  <ShippedQty line={line} />
                </TableCell>
                <TableCell className="text-right font-mono">{received(line)}</TableCell>
                <TableCell className="font-mono">{line.toBinCode ?? t('common.none')}</TableCell>
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
