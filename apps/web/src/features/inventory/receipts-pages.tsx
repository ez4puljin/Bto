import { Decimal } from '@tugeel/shared/money';
import { PackagePlus, Plus, Trash2 } from 'lucide-react';
import { useDeferredValue, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DetailCard, FieldList } from '@/components/detail';
import { FormField, FormFooter, FormRow, FormSection } from '@/components/form';
import {
  ChevronHead,
  EmptyState,
  FilterBar,
  FilterToggle,
  LinkRow,
  ListCard,
  LoadMore,
  RowAction,
  RowActions,
  SearchField,
  SkeletonRows,
} from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { ScanBox } from '@/components/scan-box';
import { StickyActions } from '@/components/sticky-actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { Textarea } from '@/components/ui/textarea';
import { useBarcodeLookup } from '@/features/catalog/api';
import { type PickedSupplier, SupplierPicker } from '@/features/partners/supplier-picker';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { useCreateParam } from '@/lib/use-create-param';
import { randomUuid } from '@/lib/uuid';
import {
  type Bin,
  type ReceiptDetail,
  type ReceiptLine,
  type ReceiptStatus,
  useBinLookup,
  useInventoryMutations,
  useReceipt,
  useReceiptSnapshot,
  useReceipts,
} from './api';
import {
  looksLikeLabel,
  parseScanQty,
  useCanWrite,
  useWarehouseName,
  useWarehouseOptions,
} from './helpers';
import { useDefaultWarehouse } from './last-warehouse';
import { ReceiptCostingCard } from './receipt-costing';
import { useScanQty } from './scan-qty';
import { DocStatusBadge, ProductSearch, QtyInput, ScanQtyField, WarehouseSelect } from './shared';

const RECEIPT_STATUSES: readonly ReceiptStatus[] = ['DRAFT', 'POSTED', 'CANCELLED'];
const WHOLESALE = ['WHOLESALE'] as const;

const isStatus = (value: string | null): value is ReceiptStatus =>
  RECEIPT_STATUSES.some((status) => status === value);

/** A lookup that answers 404 for an unknown code: null instead of an error. */
async function orNull<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch (error) {
    if (problemFromError(error)?.code === 'NOT_FOUND') return null;
    throw error;
  }
}

/** Goods receipts (ADR-0033): every user reads them; accountants find the ones waiting for costs. */
export function ReceiptsPage() {
  const { t } = useTranslation();
  const canManage = useHasPermission('inventory.receipts.manage');
  const canCost = useHasPermission('inventory.costs.manage');
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const q = useDeferredValue(search.trim());
  const statusParam = params.get('status');
  const status = isStatus(statusParam) ? statusParam : undefined;
  const warehouseParam = Number.parseInt(params.get('warehouseId') ?? '', 10);
  const warehouseId = Number.isNaN(warehouseParam) ? undefined : warehouseParam;
  const costingPending = params.get('costing') === 'pending';
  const warehouses = useWarehouseOptions(WHOLESALE);
  const warehouseName = useWarehouseName();
  const receipts = useReceipts({ q, status, warehouseId, costingPending });
  const rows = receipts.data?.pages.flatMap((page) => page.data) ?? [];
  const [creating, setCreating] = useCreateParam();

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
    <div>
      <PageHeader
        title={t('inventory.receipts.title')}
        actions={
          canManage ? (
            <Button onClick={() => setCreating(true)}>
              <Plus />
              {t('inventory.receipts.create')}
            </Button>
          ) : null
        }
      />
      {canManage ? (
        <Dialog open={creating} onOpenChange={setCreating}>
          {creating ? <ReceiptCreateDialog onCancel={() => setCreating(false)} /> : null}
        </Dialog>
      ) : null}
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
      <ProblemAlert problem={problemFromError(receipts.error)} />
      <ListCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('inventory.number')}</TableHead>
              <TableHead>{t('inventory.date')}</TableHead>
              <TableHead>{t('inventory.warehouse')}</TableHead>
              <TableHead>{t('inventory.receipts.supplier')}</TableHead>
              <TableHead>{t('inventory.receipts.supplierDoc')}</TableHead>
              <TableHead className="text-right">{t('inventory.lines')}</TableHead>
              <TableHead>{t('inventory.status')}</TableHead>
              <ChevronHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {receipts.isPending ? <SkeletonRows columns={8} /> : null}
            {rows.map((receipt) => (
              <LinkRow key={receipt.id} to={`/inventory/receipts/${receipt.id}`}>
                <TableCell className="font-mono">
                  <Link to={`/inventory/receipts/${receipt.id}`} className="font-medium">
                    {receipt.number ?? t('inventory.draftNo', { id: receipt.id })}
                  </Link>
                </TableCell>
                <TableCell className="font-mono">
                  {receipt.effectiveDate ?? t('common.none')}
                </TableCell>
                <TableCell>{warehouseName(receipt.warehouseId)}</TableCell>
                <TableCell className="whitespace-normal">{receipt.supplierName}</TableCell>
                <TableCell className="font-mono">
                  {receipt.supplierDocNo ?? t('common.none')}
                </TableCell>
                <TableCell className="text-right font-mono">{receipt.lineCount}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <DocStatusBadge status={receipt.status} />
                    {receipt.costingStatus ? (
                      <Badge variant={receipt.costingStatus === 'PENDING' ? 'default' : 'outline'}>
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
 * A new receipt in a dialog (ADR-0047 #1): the warehouse is chosen already (the only one, or the
 * last one used), the supplier and the delivery note follow; then the goods are scanned at once.
 */
function ReceiptCreateDialog({ onCancel }: { onCancel: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const warehouses = useWarehouseOptions(WHOLESALE, true);
  const { defaultId, remember } = useDefaultWarehouse(warehouses.options, 'receipt');
  const mutations = useInventoryMutations();
  const action = useAction();
  const [key, setKey] = useState(randomUuid);
  const [picked, setPicked] = useState<number | undefined>();
  const warehouseId = picked ?? defaultId;
  const [supplier, setSupplier] = useState<PickedSupplier | null>(null);
  const [docNo, setDocNo] = useState('');
  const [docDate, setDocDate] = useState('');
  const [note, setNote] = useState('');
  const ready = warehouseId !== undefined && supplier !== null;
  const started = useRef(false);

  // Once the warehouse is chosen (the list may still be loading on open), start with the supplier.
  useEffect(() => {
    if (started.current || warehouseId === undefined) return;
    started.current = true;
    const field = document.getElementById('receipt-supplier');
    const active = document.activeElement;
    const untouched =
      active === null || active === document.body || active.id === 'receipt-warehouse';
    if (field instanceof HTMLInputElement && untouched) field.focus();
  }, [warehouseId]);

  const create = () =>
    void action
      .run(async () => {
        if (warehouseId === undefined || supplier === null) return;
        const receipt = await mutations.createReceipt.mutateAsync({
          key,
          warehouseId,
          supplierId: supplier.id,
          ...(docNo.trim() ? { supplierDocNo: docNo.trim() } : {}),
          ...(docDate ? { supplierDocDate: docDate } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        });
        remember(warehouseId);
        await navigate(`/inventory/receipts/${receipt.id}`, {
          replace: true,
          state: { focusScan: true },
        });
      })
      .then((done) => {
        // A refused draft is a new intent once the form changes.
        if (!done) setKey(randomUuid());
      });

  return (
    <DialogContent closeLabel={t('common.close')} className="sm:max-w-lg">
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready && !mutations.createReceipt.isPending) create();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('inventory.receipt.newTitle')}</DialogTitle>
          <DialogDescription>{t('inventory.receipt.wholesaleOnly')}</DialogDescription>
        </DialogHeader>
        <ProblemAlert problem={action.problem ?? problemFromError(warehouses.error)} />
        <FormField label={t('inventory.warehouse')} htmlFor="receipt-warehouse">
          <WarehouseSelect
            id="receipt-warehouse"
            options={warehouses.options}
            value={warehouseId}
            emptyLabel={t('inventory.pickWarehouse')}
            onChange={setPicked}
          />
        </FormField>
        <FormField label={t('inventory.receipts.supplier')} htmlFor="receipt-supplier">
          <SupplierPicker id="receipt-supplier" value={supplier} onChange={setSupplier} />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t('inventory.receipt.supplierDocNo')} htmlFor="receipt-doc-no">
            <Input
              id="receipt-doc-no"
              maxLength={50}
              value={docNo}
              onChange={(event) => setDocNo(event.target.value)}
            />
          </FormField>
          <FormField label={t('inventory.receipt.supplierDocDate')} htmlFor="receipt-doc-date">
            <Input
              id="receipt-doc-date"
              type="date"
              value={docDate}
              onChange={(event) => setDocDate(event.target.value)}
            />
          </FormField>
        </div>
        <FormField label={t('inventory.note')} htmlFor="receipt-note">
          <Textarea
            id="receipt-note"
            rows={2}
            maxLength={500}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </FormField>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={!ready || mutations.createReceipt.isPending}>
            {t('inventory.receipt.createDraft')}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

/**
 * One receipt: the scan editor while it is a draft, the accountant's costs once posted (for cost
 * holders), its lines otherwise; the delivery note's card beside it on wide screens.
 */
export function ReceiptPage() {
  const { t } = useTranslation();
  const id = Number.parseInt(useParams().id ?? '', 10);
  const location = useLocation();
  const canManage = useHasPermission('inventory.receipts.manage');
  const canCost = useHasPermission('inventory.costs.manage');
  const receipt = useReceipt(id);
  const warehouseName = useWarehouseName();

  const loadProblem = problemFromError(receipt.error);
  if (loadProblem) return <ProblemAlert problem={loadProblem} />;
  if (!receipt.data) return <p className="text-sm text-muted-foreground">{t('common.loading')}</p>;
  const detail = receipt.data;
  const state: unknown = location.state;
  const focusScan =
    typeof state === 'object' && state !== null && 'focusScan' in state && state.focusScan === true;

  const body =
    detail.status === 'DRAFT' && canManage ? (
      <ReceiptEditor key={detail.id} detail={detail} focusScan={focusScan} />
    ) : detail.status === 'POSTED' && canCost ? (
      <ReceiptCostingCard detail={detail} />
    ) : (
      <Card>
        <CardContent>
          <ReceiptLinesTable lines={detail.lines} />
        </CardContent>
      </Card>
    );

  return (
    <div className="space-y-4">
      <PageHeader
        title={detail.number ?? t('inventory.draftNo', { id: detail.id })}
        meta={
          <>
            <DocStatusBadge status={detail.status} />
            {detail.costingStatus ? (
              <Badge variant={detail.costingStatus === 'PENDING' ? 'default' : 'outline'}>
                {t(`inventory.costingStatus.${detail.costingStatus}`)}
              </Badge>
            ) : null}
            <span className="text-foreground">{warehouseName(detail.warehouseId)}</span>
            <span>{detail.supplierName}</span>
            {detail.effectiveDate ? (
              <span className="font-mono">{detail.effectiveDate}</span>
            ) : null}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_19rem] lg:items-start">
        <div className="min-w-0 space-y-4">{body}</div>
        <ReceiptHeaderCard detail={detail} />
      </div>
    </div>
  );
}

/** The delivery note: read first, corrected with «Засах» while the receipt is a draft. */
function ReceiptHeaderCard({ detail }: { detail: ReceiptDetail }) {
  const { t } = useTranslation();
  const canManage = useHasPermission('inventory.receipts.manage');
  const canWrite = useCanWrite();
  const warehouseName = useWarehouseName();
  return (
    <DetailCard
      title={t('inventory.receipt.headerTitle')}
      canEdit={detail.status === 'DRAFT' && canManage && canWrite(detail.warehouseId)}
      view={
        <FieldList
          items={[
            { label: t('inventory.warehouse'), value: warehouseName(detail.warehouseId) },
            {
              label: t('inventory.receipts.supplier'),
              value: detail.supplierName,
              hint: detail.supplierCode,
            },
            { label: t('inventory.receipt.supplierDocNo'), value: detail.supplierDocNo },
            { label: t('inventory.receipt.supplierDocDate'), value: detail.supplierDocDate },
            { label: t('inventory.note'), value: detail.note },
          ]}
        />
      }
      edit={(close) => <ReceiptHeaderForm detail={detail} onDone={close} />}
    />
  );
}

function ReceiptHeaderForm({ detail, onDone }: { detail: ReceiptDetail; onDone: () => void }) {
  const { t } = useTranslation();
  const mutations = useInventoryMutations();
  const action = useAction();
  const warehouseName = useWarehouseName();
  const [supplier, setSupplier] = useState<PickedSupplier | null>({
    id: detail.supplierId,
    code: detail.supplierCode,
    name: detail.supplierName,
  });
  const [docNo, setDocNo] = useState(detail.supplierDocNo ?? '');
  const [docDate, setDocDate] = useState(detail.supplierDocDate ?? '');
  const [note, setNote] = useState(detail.note ?? '');

  const save = () =>
    void action.run(async () => {
      if (supplier === null) return;
      await mutations.updateReceipt.mutateAsync({
        id: detail.id,
        body: {
          supplierId: supplier.id,
          supplierDocNo: docNo.trim() || null,
          supplierDocDate: docDate || null,
          note: note.trim() || null,
        },
      });
      toast.success(t('inventory.receipt.headerSaved'));
      onDone();
    });

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <ProblemAlert problem={action.problem} />
      <FormSection>
        <FormRow label={t('inventory.warehouse')} hint={t('inventory.receipt.warehouseFixed')}>
          <p className="text-sm sm:pt-2">{warehouseName(detail.warehouseId)}</p>
        </FormRow>
        <FormRow label={t('inventory.receipts.supplier')} htmlFor="receipt-header-supplier">
          <SupplierPicker id="receipt-header-supplier" value={supplier} onChange={setSupplier} />
        </FormRow>
        <FormRow label={t('inventory.receipt.supplierDocNo')} htmlFor="receipt-header-doc-no">
          <Input
            id="receipt-header-doc-no"
            maxLength={50}
            value={docNo}
            onChange={(event) => setDocNo(event.target.value)}
          />
        </FormRow>
        <FormRow label={t('inventory.receipt.supplierDocDate')} htmlFor="receipt-header-doc-date">
          <Input
            id="receipt-header-doc-date"
            type="date"
            value={docDate}
            onChange={(event) => setDocDate(event.target.value)}
          />
        </FormRow>
        <FormRow label={t('inventory.note')} htmlFor="receipt-header-note">
          <Textarea
            id="receipt-header-note"
            rows={2}
            maxLength={500}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </FormRow>
      </FormSection>
      <FormFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" disabled={supplier === null || mutations.updateReceipt.isPending}>
          {t('common.save')}
        </Button>
      </FormFooter>
    </form>
  );
}

function ReceiptLinesTable({ lines }: { lines: readonly ReceiptLine[] }) {
  const { t } = useTranslation();
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('inventory.product')}</TableHead>
          <TableHead>{t('inventory.unit')}</TableHead>
          <TableHead className="text-right">{t('inventory.qty')}</TableHead>
          <TableHead className="text-right">{t('inventory.qtyBase')}</TableHead>
          <TableHead>{t('inventory.bin')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {lines.map((line) => (
          <TableRow key={line.id}>
            <TableCell className="whitespace-normal">
              <span className="font-mono text-muted-foreground">{line.productSku}</span>{' '}
              {line.productName}
            </TableCell>
            <TableCell>{line.unitName}</TableCell>
            <TableCell className="text-right font-mono">{line.enteredQty}</TableCell>
            <TableCell className="text-right font-mono">{line.qtyBase}</TableCell>
            <TableCell className="font-mono">{line.binCode}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** What a scan added, for the line under the scan box. */
interface Added {
  qty: string;
  unit: string;
  name: string;
  /** In base units when the scanned unit is a pack. */
  base?: { qty: string; unit: string };
}

/**
 * The draft editor (owner, 2026-10-11: the warehouse counts and registers, goods go straight onto
 * their shelf). One scan box: a shelf label makes that shelf active, a product barcode adds «Тоо»
 * of its unit (ADR-0047 #2), a repeat adds to its line; without an active shelf the product's
 * fixed shelf applies. Scans are handled one after another against the latest copy of the draft.
 */
function ReceiptEditor({ detail, focusScan }: { detail: ReceiptDetail; focusScan: boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const mutations = useInventoryMutations();
  const lookupBin = useBinLookup();
  const lookupBarcode = useBarcodeLookup();
  const latest = useReceiptSnapshot(detail.id);
  const action = useAction();
  const qty = useScanQty();
  const [activeBin, setActiveBinState] = useState<Bin | null>(null);
  const bin = useRef<Bin | null>(null);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const [missing, setMissing] = useState<string | null>(null);
  const [invalidQty, setInvalidQty] = useState(false);
  const [added, setAdded] = useState<Added | null>(null);
  const [confirm, setConfirm] = useState<'post' | 'cancel' | null>(null);
  const [postKey, setPostKey] = useState(randomUuid);

  const setActiveBin = (next: Bin | null) => {
    bin.current = next;
    setActiveBinState(next);
  };
  const enqueue = (work: () => Promise<void>) => {
    chain.current = chain.current.then(() => action.run(work));
  };

  const addUnit = async (productUnitId: number, amount: string) => {
    const receipt = latest() ?? detail;
    const shelf = bin.current;
    const same = receipt.lines.find(
      (line) => line.productUnitId === productUnitId && (shelf === null || line.binId === shelf.id),
    );
    if (same) {
      await mutations.updateReceiptLine.mutateAsync({
        id: same.id,
        body: { enteredQty: new Decimal(same.enteredQty).plus(amount).toString() },
      });
    } else {
      await mutations.addReceiptLine.mutateAsync({
        id: detail.id,
        body: { productUnitId, enteredQty: amount, ...(shelf ? { binId: shelf.id } : {}) },
      });
    }
  };

  const onScan = (code: string) => {
    // «Тоо» belongs to this scan; it goes back to 1 at once, and returns if no product took it.
    const typed = qty.read();
    const amount = parseScanQty(typed);
    qty.reset();
    const giveBack = () => {
      if (qty.read() === '1') qty.set(typed);
    };
    enqueue(async () => {
      setMissing(null);
      setInvalidQty(false);
      const asBin = () => orNull(lookupBin.mutateAsync({ warehouseId: detail.warehouseId, code }));
      const label = looksLikeLabel(code);
      const shelf = label ? await asBin() : null;
      if (shelf) {
        setActiveBin(shelf);
        giveBack();
        return;
      }
      const resolved = await orNull(lookupBarcode.mutateAsync(code));
      if (resolved) {
        if (amount === null) {
          setInvalidQty(true);
          giveBack();
          return;
        }
        await addUnit(resolved.unit.id, amount);
        const factor = new Decimal(resolved.unit.factorToBase);
        setAdded({
          qty: amount,
          unit: resolved.unit.uomName,
          name: resolved.product.name,
          ...(factor.equals(1)
            ? {}
            : {
                base: {
                  qty: factor.times(amount).toString(),
                  unit: resolved.product.baseUnit.uomName,
                },
              }),
        });
        return;
      }
      const lateShelf = label ? null : await asBin();
      if (lateShelf) setActiveBin(lateShelf);
      else setMissing(code);
      giveBack();
    });
  };

  const pick = (productUnitId: number, unit: string, name: string) => {
    const typed = qty.read();
    const amount = parseScanQty(typed);
    if (amount === null) {
      setInvalidQty(true);
      return;
    }
    qty.reset();
    enqueue(async () => {
      setInvalidQty(false);
      await addUnit(productUnitId, amount);
      setAdded({ qty: amount, unit, name });
    });
  };

  const post = () =>
    void action.run(async () => {
      const posted = await mutations.postReceipt.mutateAsync({ id: detail.id, key: postKey });
      setConfirm(null);
      toast.success(t('inventory.receipt.posted', { number: posted.number ?? '' }));
    });
  const cancel = () =>
    void action.run(async () => {
      await mutations.cancelReceipt.mutateAsync(detail.id);
      setConfirm(null);
      await navigate('/inventory/receipts');
    });

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t('inventory.lines')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ScanBox
            letters
            autoFocus={focusScan}
            label={t('inventory.scanLabel')}
            placeholder={t('inventory.scanPlaceholder')}
            onScan={onScan}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor="receipt-scan-qty">{t('inventory.scanQty')}</Label>
            <ScanQtyField id="receipt-scan-qty" qty={qty} onScan={onScan} />
            <span className="text-xs text-muted-foreground">{t('inventory.scanQtyHint')}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">
              {activeBin
                ? t('inventory.activeBin', { code: activeBin.code })
                : t('inventory.activeBinNone')}
            </span>
            {activeBin ? (
              <Button size="xs" variant="ghost" onClick={() => setActiveBin(null)}>
                {t('inventory.clearBin')}
              </Button>
            ) : null}
          </div>
          {added ? (
            <p aria-live="polite" className="text-sm font-medium">
              {added.base
                ? t('inventory.scanAddedBase', {
                    qty: added.qty,
                    unit: added.unit,
                    base: added.base.qty,
                    baseUnit: added.base.unit,
                    name: added.name,
                  })
                : t('inventory.scanAdded', { qty: added.qty, unit: added.unit, name: added.name })}
            </p>
          ) : null}
          {invalidQty ? (
            <p className="text-sm text-destructive">{t('inventory.scanQtyInvalid')}</p>
          ) : null}
          {missing ? (
            <p className="text-sm text-destructive">
              {t('inventory.scanNotFound', { code: missing })}
            </p>
          ) : null}
          <ProblemAlert problem={confirm ? null : action.problem} />
          <ProductSearch
            onPick={(product) => pick(product.baseUnit.id, product.baseUnit.uomName, product.name)}
          />
          {detail.lines.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('inventory.receipt.linesEmpty')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('inventory.product')}</TableHead>
                  <TableHead>{t('inventory.unit')}</TableHead>
                  <TableHead className="text-right">{t('inventory.qty')}</TableHead>
                  <TableHead className="text-right">{t('inventory.qtyBase')}</TableHead>
                  <TableHead>{t('inventory.bin')}</TableHead>
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
                        key={line.enteredQty}
                        label={`${t('inventory.qty')}: ${line.productName}`}
                        value={line.enteredQty}
                        onScan={onScan}
                        onSave={(enteredQty) =>
                          void action.run(() =>
                            mutations.updateReceiptLine.mutateAsync({
                              id: line.id,
                              body: { enteredQty },
                            }),
                          )
                        }
                      />
                    </TableCell>
                    <TableCell className="text-right font-mono">{line.qtyBase}</TableCell>
                    <TableCell>
                      <span className="font-mono">{line.binCode}</span>
                      {activeBin && activeBin.id !== line.binId ? (
                        <Button
                          size="xs"
                          variant="ghost"
                          className="ml-1"
                          onClick={() =>
                            void action.run(() =>
                              mutations.updateReceiptLine.mutateAsync({
                                id: line.id,
                                body: { binId: activeBin.id },
                              }),
                            )
                          }
                        >
                          {t('inventory.moveToBin', { code: activeBin.code })}
                        </Button>
                      ) : null}
                    </TableCell>
                    <RowActions>
                      <RowAction
                        label={`${t('inventory.remove')}: ${line.productName}`}
                        icon={Trash2}
                        destructive
                        onClick={() =>
                          void action.run(() => mutations.removeReceiptLine.mutateAsync(line.id))
                        }
                      />
                    </RowActions>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <StickyActions summary={t('inventory.linesCount', { count: detail.lines.length })}>
        <Button
          variant="ghost"
          onClick={() => {
            action.clear();
            setConfirm('cancel');
          }}
        >
          {t('inventory.receipt.cancel')}
        </Button>
        <Button
          disabled={detail.lines.length === 0}
          onClick={() => {
            setPostKey(randomUuid());
            action.clear();
            setConfirm('post');
          }}
        >
          {t('inventory.receipt.post')}
        </Button>
      </StickyActions>
      <ConfirmDialog
        open={confirm === 'post'}
        variant="default"
        title={t('inventory.receipt.postTitle')}
        description={t('inventory.receipt.postDescription')}
        confirmLabel={t('inventory.receipt.post')}
        pending={mutations.postReceipt.isPending}
        problem={action.problem}
        onConfirm={post}
        onClose={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'cancel'}
        title={t('inventory.receipt.cancelTitle')}
        confirmLabel={t('inventory.receipt.cancel')}
        pending={mutations.cancelReceipt.isPending}
        problem={action.problem}
        onConfirm={cancel}
        onClose={() => setConfirm(null)}
      />
    </>
  );
}
