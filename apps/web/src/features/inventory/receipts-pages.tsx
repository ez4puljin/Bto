import { Decimal } from '@tugeel/shared/money';
import { PackagePlus, Plus } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { ConfirmDialog } from '@/components/confirm-dialog';
import {
  ChevronHead,
  EmptyState,
  FilterBar,
  FilterToggle,
  LinkRow,
  ListCard,
  LoadMore,
  SearchField,
  SkeletonRows,
} from '@/components/list';
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
import { Textarea } from '@/components/ui/textarea';
import { useBarcodeLookup } from '@/features/catalog/api';
import { type PickedSupplier, SupplierPicker } from '@/features/partners/supplier-picker';
import { problemFromError } from '@/lib/problem';
import { useAction } from '@/lib/use-action';
import { randomUuid } from '@/lib/uuid';
import {
  type Bin,
  type ReceiptDetail,
  type ReceiptLine,
  type ReceiptStatus,
  useBinLookup,
  useInventoryMutations,
  useReceipt,
  useReceipts,
} from './api';
import { looksLikeLabel, useWarehouseName, useWarehouseOptions } from './helpers';
import { DocStatusBadge, ProductSearch, QtyInput, WarehouseSelect } from './shared';

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

/** A new receipt: warehouse, supplier and delivery note; the goods are scanned on the next page. */
export function ReceiptCreatePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const warehouses = useWarehouseOptions(WHOLESALE, true);
  const mutations = useInventoryMutations();
  const action = useAction();
  const [key] = useState(randomUuid);
  const [warehouseId, setWarehouseId] = useState<number | undefined>();
  const [supplier, setSupplier] = useState<PickedSupplier | null>(null);
  const [docNo, setDocNo] = useState('');
  const [docDate, setDocDate] = useState('');
  const [note, setNote] = useState('');
  const ready = warehouseId !== undefined && supplier !== null;

  const create = () =>
    void action.run(async () => {
      if (warehouseId === undefined || supplier === null) return;
      const receipt = await mutations.createReceipt.mutateAsync({
        key,
        warehouseId,
        supplierId: supplier.id,
        ...(docNo.trim() ? { supplierDocNo: docNo.trim() } : {}),
        ...(docDate ? { supplierDocDate: docDate } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      await navigate(`/inventory/receipts/${receipt.id}`);
    });

  return (
    <div>
      <PageHeader title={t('inventory.receipt.newTitle')} />
      <Card className="max-w-xl">
        <CardContent className="flex flex-col gap-4">
          <ProblemAlert problem={action.problem ?? problemFromError(warehouses.error)} />
          <div className="flex flex-col gap-2">
            <Label>{t('inventory.warehouse')}</Label>
            <WarehouseSelect
              options={warehouses.options}
              value={warehouseId}
              emptyLabel={t('inventory.pickWarehouse')}
              onChange={setWarehouseId}
            />
            <p className="text-xs text-muted-foreground">{t('inventory.receipt.wholesaleOnly')}</p>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="receipt-supplier">{t('inventory.receipts.supplier')}</Label>
            <SupplierPicker id="receipt-supplier" value={supplier} onChange={setSupplier} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="receipt-doc-no">{t('inventory.receipt.supplierDocNo')}</Label>
              <Input
                id="receipt-doc-no"
                maxLength={50}
                value={docNo}
                onChange={(event) => setDocNo(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="receipt-doc-date">{t('inventory.receipt.supplierDocDate')}</Label>
              <Input
                id="receipt-doc-date"
                type="date"
                value={docDate}
                onChange={(event) => setDocDate(event.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="receipt-note">{t('inventory.note')}</Label>
            <Textarea
              id="receipt-note"
              maxLength={500}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
          <Button
            className="self-start"
            disabled={!ready || mutations.createReceipt.isPending}
            onClick={create}
          >
            {t('inventory.receipt.createDraft')}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

/** One receipt: the scan editor while it is a draft, its lines once posted. */
export function ReceiptPage() {
  const { t } = useTranslation();
  const id = Number.parseInt(useParams().id ?? '', 10);
  const canManage = useHasPermission('inventory.receipts.manage');
  const canCost = useHasPermission('inventory.costs.manage');
  const receipt = useReceipt(id);
  const warehouseName = useWarehouseName();

  const loadProblem = problemFromError(receipt.error);
  if (loadProblem) return <ProblemAlert problem={loadProblem} />;
  if (!receipt.data) return <p className="text-sm text-muted-foreground">{t('common.loading')}</p>;
  const detail = receipt.data;

  return (
    <div className="flex flex-col gap-4">
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
            {detail.supplierDocNo ? (
              <span className="font-mono">{detail.supplierDocNo}</span>
            ) : null}
            {detail.effectiveDate ? (
              <span className="font-mono">{detail.effectiveDate}</span>
            ) : null}
          </>
        }
        actions={
          detail.status === 'POSTED' && canCost ? (
            <Button asChild>
              <Link to={`/inventory/receipts/${detail.id}/costing`}>
                {detail.costingStatus === 'COSTED'
                  ? t('inventory.receipt.recost')
                  : t('inventory.receipt.cost')}
              </Link>
            </Button>
          ) : null
        }
      />
      {detail.status === 'DRAFT' && canManage ? (
        <ReceiptEditor key={detail.id} detail={detail} />
      ) : (
        <Card>
          <CardContent>
            <ReceiptLinesTable lines={detail.lines} />
          </CardContent>
        </Card>
      )}
    </div>
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

/**
 * The draft editor (owner, 2026-10-11: the warehouse counts and registers, goods go straight onto
 * their shelf). One scan box: a shelf label makes that shelf active, a product barcode adds the
 * unit to it or counts one more; without an active shelf the product's fixed shelf applies.
 */
function ReceiptEditor({ detail }: { detail: ReceiptDetail }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const mutations = useInventoryMutations();
  const lookupBin = useBinLookup();
  const lookupBarcode = useBarcodeLookup();
  const action = useAction();
  const [activeBin, setActiveBin] = useState<Bin | null>(null);
  const [missing, setMissing] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'post' | 'cancel' | null>(null);
  const [postKey, setPostKey] = useState(randomUuid);

  const addUnit = async (productUnitId: number) => {
    const same = detail.lines.find(
      (line) =>
        line.productUnitId === productUnitId && (activeBin === null || line.binId === activeBin.id),
    );
    if (same) {
      await mutations.updateReceiptLine.mutateAsync({
        id: same.id,
        body: { enteredQty: new Decimal(same.enteredQty).plus(1).toString() },
      });
    } else {
      await mutations.addReceiptLine.mutateAsync({
        id: detail.id,
        body: { productUnitId, enteredQty: '1', ...(activeBin ? { binId: activeBin.id } : {}) },
      });
    }
  };

  const onScan = (code: string) =>
    void action.run(async () => {
      setMissing(null);
      const bin = () => orNull(lookupBin.mutateAsync({ warehouseId: detail.warehouseId, code }));
      const label = looksLikeLabel(code);
      const asBin = label ? await bin() : null;
      if (asBin) {
        setActiveBin(asBin);
        return;
      }
      const resolved = await orNull(lookupBarcode.mutateAsync(code));
      if (resolved) {
        await addUnit(resolved.unit.id);
        return;
      }
      const lateBin = label ? null : await bin();
      if (lateBin) setActiveBin(lateBin);
      else setMissing(code);
    });

  const post = () =>
    void action.run(async () => {
      await mutations.postReceipt.mutateAsync({ id: detail.id, key: postKey });
      setConfirm(null);
    });
  const cancel = () =>
    void action.run(async () => {
      await mutations.cancelReceipt.mutateAsync(detail.id);
      setConfirm(null);
      await navigate('/inventory/receipts');
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('inventory.lines')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ScanBox
          letters
          label={t('inventory.scanLabel')}
          placeholder={t('inventory.scanPlaceholder')}
          onScan={onScan}
        />
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
        {missing ? (
          <p className="text-sm text-destructive">
            {t('inventory.scanNotFound', { code: missing })}
          </p>
        ) : null}
        <ProblemAlert problem={confirm ? null : action.problem} />
        <ProductSearch onPick={(product) => void action.run(() => addUnit(product.baseUnit.id))} />
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
                  <TableCell className="text-right">
                    <Button
                      size="xs"
                      variant="ghost"
                      aria-label={`${t('inventory.remove')}: ${line.productName}`}
                      onClick={() =>
                        void action.run(() => mutations.removeReceiptLine.mutateAsync(line.id))
                      }
                    >
                      {t('inventory.remove')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <div className="flex flex-wrap gap-2">
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
          <Button
            variant="outline"
            onClick={() => {
              action.clear();
              setConfirm('cancel');
            }}
          >
            {t('inventory.receipt.cancel')}
          </Button>
        </div>
      </CardContent>
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
    </Card>
  );
}
