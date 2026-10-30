import { BINS_SOON } from '@/lib/features';
import { USER_ADJUSTMENT_REASONS } from '@tugeel/shared/inventory';
import { Decimal } from '@tugeel/shared/money';
import { Plus, SlidersHorizontal, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormField } from '@/components/form';
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
import { useBarcodeLookup } from '@/features/catalog/api';
import type { ColumnSpec } from '@/lib/column-layout';
import { formatQty } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { useSetParam } from '@/lib/search-params';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { useCreateParam } from '@/lib/use-create-param';
import { randomUuid } from '@/lib/uuid';
import {
  type AdjustmentDetail,
  type RequestableReason,
  type AdjustmentStatus,
  type Bin,
  useAdjustment,
  useAdjustments,
  useBinLookup,
  useInventoryMutations,
} from './api';
import {
  isInbound,
  looksLikeLabel,
  parseScanQty,
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

const SHELF_KINDS = ['WHOLESALE', 'STORE'] as const;
const STATUSES: readonly AdjustmentStatus[] = ['DRAFT', 'SUBMITTED', 'POSTED', 'CANCELLED'];
/** Cost per base unit, NUMERIC(14,4). */
const UNIT_COST = /^\d{1,10}(\.\d{1,4})?$/;

/** The adjustments list's columns (ADR-0119). */
const LIST_COLUMNS: readonly ColumnSpec[] = [
  { key: 'number', kind: 'number' },
  { key: 'date', kind: 'date' },
  { key: 'warehouse', kind: 'text', weight: 1 },
  { key: 'reason', kind: 'text', weight: 2 },
  { key: 'lines', kind: 'count' },
  { key: 'status', kind: 'status' },
  { key: 'chevron', kind: 'chevron' },
];

const isStatus = (value: string | null): value is AdjustmentStatus =>
  STATUSES.some((status) => status === value);

/** Adjustments (ADJ-): the warehouse writes goods off or records found ones; an admin approves. */
export function AdjustmentsPage() {
  const { t } = useTranslation();
  const canManage = useHasPermission('inventory.adjustments.manage');
  const [params] = useSearchParams();
  const setParam = useSetParam();
  const statusParam = params.get('status');
  const status = isStatus(statusParam) ? statusParam : undefined;
  const warehouseParam = Number.parseInt(params.get('warehouseId') ?? '', 10);
  const warehouseId = Number.isNaN(warehouseParam) ? undefined : warehouseParam;
  const warehouses = useWarehouseOptions(SHELF_KINDS);
  const warehouseName = useWarehouseName();
  const adjustments = useAdjustments({ warehouseId, status });
  const rows = adjustments.data?.pages.flatMap((page) => page.data) ?? [];
  const [creating, setCreating] = useCreateParam();

  return (
    <div>
      <PageHeader
        title={t('inventory.adjustments.title')}
        description={BINS_SOON ? t('common.binsSoonHint') : undefined}
        actions={
          canManage ? (
            <Button onClick={() => setCreating(true)}>
              <Plus />
              {t('inventory.adjustment.newTitle')}
            </Button>
          ) : null
        }
      />
      {canManage ? (
        <Dialog open={creating} onOpenChange={setCreating}>
          {creating ? <AdjustmentCreateDialog onCancel={() => setCreating(false)} /> : null}
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
          <option value="">{t('inventory.adjustments.allStatuses')}</option>
          {STATUSES.map((value) => (
            <option key={value} value={value}>
              {t(`inventory.docStatus.${value}`)}
            </option>
          ))}
        </NativeSelect>
      </FilterBar>
      <ProblemAlert problem={problemFromError(adjustments.error)} onRetry={adjustments.refetch} />
      <ListCard scroll>
        <ListTable columns={LIST_COLUMNS}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('inventory.number')}</TableHead>
              <TableHead>{t('inventory.date')}</TableHead>
              <TableHead>{t('inventory.warehouse')}</TableHead>
              <TableHead>{t('inventory.adjustments.reason')}</TableHead>
              <TableHead className="text-right">{t('inventory.lines')}</TableHead>
              <TableHead>{t('inventory.status')}</TableHead>
              <ChevronHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {adjustments.isPending ? <SkeletonRows columns={7} /> : null}
            {rows.map((row) => (
              <LinkRow key={row.id} to={`/inventory/adjustments/${row.id}`}>
                <TableCell className="font-mono">
                  <Link
                    to={`/inventory/adjustments/${row.id}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {row.number ?? t('inventory.draftNo', { id: row.id })}
                  </Link>
                </TableCell>
                <TableCell className="font-mono">{row.effectiveDate ?? t('common.none')}</TableCell>
                <TableCell>{warehouseName(row.warehouseId)}</TableCell>
                <TableCell>{t(`inventory.reasons.${row.reason}`)}</TableCell>
                <TableCell className="text-right font-mono">{row.lineCount}</TableCell>
                <TableCell>
                  <DocStatusBadge status={row.status} />
                </TableCell>
              </LinkRow>
            ))}
          </TableBody>
        </ListTable>
        {!adjustments.isPending && rows.length === 0 ? (
          <EmptyState icon={SlidersHorizontal} title={t('inventory.adjustments.empty')} />
        ) : null}
        <LoadMore query={adjustments} />
      </ListCard>
    </div>
  );
}

/** A draft names its warehouse and reason; the goods are scanned on its page. */
function AdjustmentCreateDialog({ onCancel }: { onCancel: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const canApprove = useHasPermission('inventory.adjustments.approve');
  const warehouses = useWarehouseOptions(SHELF_KINDS, true);
  const { defaultId, remember } = useDefaultWarehouse(warehouses.options, 'adjustment');
  const mutations = useInventoryMutations();
  const action = useAction();
  const [key] = useState(randomUuid);
  const [picked, setPicked] = useState<number | undefined>();
  const warehouseId = picked ?? defaultId;
  const [reason, setReason] = useState<RequestableReason>('DAMAGED');
  const [note, setNote] = useState('');
  const reasons: readonly RequestableReason[] = canApprove
    ? [...USER_ADJUSTMENT_REASONS, 'OPENING']
    : USER_ADJUSTMENT_REASONS;

  const create = () =>
    void action.run(async () => {
      if (warehouseId === undefined) return;
      const adjustment = await mutations.createAdjustment.mutateAsync({
        key,
        warehouseId,
        reason,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      remember(warehouseId);
      await navigate(`/inventory/adjustments/${adjustment.id}`, {
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
          create();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('inventory.adjustment.newTitle')}</DialogTitle>
          <DialogDescription>
            {isInbound(reason)
              ? t('inventory.adjustment.increases')
              : t('inventory.adjustment.decreases')}
          </DialogDescription>
        </DialogHeader>
        <ProblemAlert problem={action.problem} />
        <FormField label={t('inventory.warehouse')} htmlFor="adjustment-warehouse">
          <WarehouseSelect
            id="adjustment-warehouse"
            options={warehouses.options}
            value={warehouseId}
            emptyLabel={t('inventory.pickWarehouse')}
            onChange={setPicked}
          />
        </FormField>
        <FormField label={t('inventory.adjustments.reason')} htmlFor="adjustment-reason">
          <NativeSelect
            id="adjustment-reason"
            value={reason}
            onChange={(event) => {
              const chosen = reasons.find((value) => value === event.target.value);
              if (chosen) setReason(chosen);
            }}
          >
            {reasons.map((value) => (
              <option key={value} value={value}>
                {t(`inventory.reasons.${value}`)}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField label={t('inventory.note')} htmlFor="adjustment-note">
          <Input
            id="adjustment-note"
            maxLength={500}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </FormField>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            disabled={warehouseId === undefined || mutations.createAdjustment.isPending}
          >
            {t('inventory.adjustment.createDraft')}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

/** One adjustment: the scan editor while a draft, the approver's decision once submitted. */
export function AdjustmentPage() {
  const { t } = useTranslation();
  const id = Number.parseInt(useParams().id ?? '', 10);
  const location = useLocation();
  const canManage = useHasPermission('inventory.adjustments.manage');
  const adjustment = useAdjustment(id);
  const warehouseName = useWarehouseName();

  const loadProblem = problemFromError(adjustment.error);
  if (loadProblem) return <ProblemAlert problem={loadProblem} />;
  if (!adjustment.data) {
    return <p className="text-sm text-muted-foreground">{t('common.loading')}</p>;
  }
  const detail = adjustment.data;

  return (
    <div className="space-y-4">
      <PageHeader
        title={detail.number ?? t('inventory.draftNo', { id: detail.id })}
        meta={
          <>
            <DocStatusBadge status={detail.status} />
            <Badge variant="outline">{t(`inventory.reasons.${detail.reason}`)}</Badge>
            <span>
              {isInbound(detail.reason)
                ? t('inventory.adjustment.increases')
                : t('inventory.adjustment.decreases')}
            </span>
            <span className="text-foreground">{warehouseName(detail.warehouseId)}</span>
            {detail.effectiveDate ? (
              <span>{t('inventory.postedOn', { date: detail.effectiveDate })}</span>
            ) : null}
          </>
        }
      />
      {detail.status === 'DRAFT' && canManage ? (
        <AdjustmentEditor
          key={detail.id}
          detail={detail}
          focusScan={wantsScanFocus(location.state)}
        />
      ) : (
        <AdjustmentReview key={detail.id} detail={detail} />
      )}
    </div>
  );
}

function AdjustmentEditor({ detail, focusScan }: { detail: AdjustmentDetail; focusScan: boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const mutations = useInventoryMutations();
  const lookupBin = useBinLookup();
  const lookupBarcode = useBarcodeLookup();
  const action = useAction();
  const [activeBin, setActiveBin] = useState<Bin | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  // «Тоо», the quantity the next scan or pick adds (ADR-0047 #2); back to 1 after each product.
  const qty = useScanQty();

  /** Adds `amount` of the unit on the active shelf; false without one. */
  const addUnit = async (productUnitId: number, amount: string) => {
    if (activeBin === null) {
      setMessage(t('inventory.needBin'));
      return false;
    }
    const same = detail.lines.find(
      (line) => line.productUnitId === productUnitId && line.binId === activeBin.id,
    );
    if (same) {
      await mutations.updateAdjustmentLine.mutateAsync({
        id: same.id,
        body: { enteredQty: new Decimal(same.enteredQty).plus(amount).toString() },
      });
    } else {
      await mutations.addAdjustmentLine.mutateAsync({
        id: detail.id,
        body: { productUnitId, enteredQty: amount, binId: activeBin.id },
      });
    }
    return true;
  };

  const onScan = (code: string) => {
    // «Тоо» belongs to this scan; it goes back to 1 at once, and returns if no product took it.
    const typed = qty.read();
    const amount = parseScanQty(typed);
    qty.reset();
    const giveBack = () => {
      if (qty.read() === '1') qty.set(typed);
    };
    void action.run(async () => {
      setMessage(null);
      const find = async <T,>(promise: Promise<T>) => {
        try {
          return await promise;
        } catch (error) {
          if (problemFromError(error)?.code === 'NOT_FOUND') return null;
          throw error;
        }
      };
      const label = looksLikeLabel(code);
      const bin = label
        ? await find(lookupBin.mutateAsync({ warehouseId: detail.warehouseId, code }))
        : null;
      if (bin) {
        setActiveBin(bin);
        giveBack();
        return;
      }
      const resolved = await find(lookupBarcode.mutateAsync(code));
      if (resolved) {
        if (amount === null) {
          setMessage(t('inventory.scanQtyInvalid'));
          giveBack();
        } else if (!(await addUnit(resolved.unit.id, amount))) {
          giveBack();
        }
        return;
      }
      const late = label
        ? null
        : await find(lookupBin.mutateAsync({ warehouseId: detail.warehouseId, code }));
      if (late) setActiveBin(late);
      else setMessage(t('inventory.scanNotFound', { code }));
      giveBack();
    });
  };

  const pick = (productUnitId: number) => {
    const typed = qty.read();
    const amount = parseScanQty(typed);
    if (amount === null) {
      setMessage(t('inventory.scanQtyInvalid'));
      return;
    }
    qty.reset();
    void action.run(async () => {
      setMessage(null);
      if (!(await addUnit(productUnitId, amount))) qty.set(typed);
    });
  };
  const shelfText = activeBin
    ? t('inventory.activeBin', { code: activeBin.code })
    : t('inventory.needBin');

  const submit = () =>
    void action.run(async () => {
      await mutations.adjustmentAction.mutateAsync({ id: detail.id, action: 'submit' });
      toast.success(t('inventory.adjustment.submitted'));
    });
  const cancel = () =>
    void action.run(async () => {
      await mutations.adjustmentAction.mutateAsync({ id: detail.id, action: 'cancel' });
      setConfirm(false);
      await navigate('/inventory/adjustments');
    });

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t('inventory.lines')}</CardTitle>
          {detail.note ? <CardDescription>{detail.note}</CardDescription> : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ScanToolbar
            scanBox={
              <ScanBox
                letters
                autoFocus={focusScan}
                label={t('inventory.scanLabel')}
                placeholder={t('inventory.scanPlaceholder')}
                onScan={onScan}
              />
            }
            qty={<ScanQtyControl id="adjustment-scan-qty" qty={qty} onScan={onScan} />}
            search={
              <ProductSearch onScan={onScan} onPick={(product) => pick(product.baseUnit.id)} />
            }
            status={
              <>
                <span className="font-medium">{shelfText}</span>
                {message && message !== shelfText ? (
                  <span className="text-destructive">{message}</span>
                ) : null}
                {qty.value !== '1' ? (
                  <span className="text-[13px] text-muted-foreground">
                    {t('inventory.scanQtyHint')}
                  </span>
                ) : null}
              </>
            }
          />
          <ProblemAlert problem={confirm ? null : action.problem} />
          {detail.lines.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('inventory.product')}</TableHead>
                  <TableHead>{t('inventory.unit')}</TableHead>
                  <TableHead className="text-right">{t('inventory.qty')}</TableHead>
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
                        label={`${t('inventory.qty')}: ${t('inventory.productUnit', { product: line.productName, unit: line.unitName })}`}
                        value={line.enteredQty}
                        onScan={onScan}
                        onSave={(enteredQty) =>
                          void action.run(() =>
                            mutations.updateAdjustmentLine.mutateAsync({
                              id: line.id,
                              body: { enteredQty },
                            }),
                          )
                        }
                      />
                    </TableCell>
                    <TableCell className="font-mono">{line.binCode}</TableCell>
                    <RowActions>
                      <RowAction
                        label={`${t('inventory.remove')}: ${t('inventory.productUnit', { product: line.productName, unit: line.unitName })}`}
                        icon={Trash2}
                        destructive
                        onClick={() =>
                          void action.run(() => mutations.removeAdjustmentLine.mutateAsync(line.id))
                        }
                      />
                    </RowActions>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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
          {t('inventory.adjustment.cancel')}
        </Button>
        <Button
          disabled={detail.lines.length === 0 || mutations.adjustmentAction.isPending}
          onClick={submit}
        >
          {t('inventory.adjustment.submit')}
        </Button>
      </StickyActions>
      <ConfirmDialog
        open={confirm}
        title={t('inventory.adjustment.cancelTitle')}
        confirmLabel={t('inventory.adjustment.cancel')}
        pending={mutations.adjustmentAction.isPending}
        problem={action.problem}
        onConfirm={cancel}
        onClose={() => setConfirm(false)}
      />
    </>
  );
}

/**
 * A submitted (or finished) adjustment. Approvers post or return it; for found goods a cost
 * holder may give each line a cost per base unit, else the average applies.
 */
function AdjustmentReview({ detail }: { detail: AdjustmentDetail }) {
  const { t } = useTranslation();
  const canManage = useHasPermission('inventory.adjustments.manage');
  const canApprove = useHasPermission('inventory.adjustments.approve');
  const canCost = useHasPermission('inventory.costs.manage');
  const mutations = useInventoryMutations();
  const action = useAction();
  const [confirm, setConfirm] = useState<'approve' | 'cancel' | null>(null);
  const [key, setKey] = useState(randomUuid);
  const [costs, setCosts] = useState<Record<number, string>>({});
  const submitted = detail.status === 'SUBMITTED';
  const withCosts = submitted && canApprove && canCost && isInbound(detail.reason);
  const costsValid = Object.values(costs).every(
    (value) => !value.trim() || UNIT_COST.test(value.trim()),
  );

  const approve = () =>
    void action.run(async () => {
      const posted = await mutations.approveAdjustment.mutateAsync({
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
      toast.success(t('inventory.adjustment.posted', { number: posted.number ?? '' }));
    });
  const sendBack = () =>
    void action.run(async () => {
      await mutations.adjustmentAction.mutateAsync({ id: detail.id, action: 'return' });
      toast.success(t('inventory.adjustment.returned'));
    });
  const cancel = () =>
    void action.run(async () => {
      await mutations.adjustmentAction.mutateAsync({ id: detail.id, action: 'cancel' });
      setConfirm(null);
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
          <ProblemAlert problem={confirm ? null : action.problem} />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('inventory.product')}</TableHead>
                <TableHead>{t('inventory.unit')}</TableHead>
                <TableHead className="text-right">{t('inventory.qty')}</TableHead>
                <TableHead className="text-right">{t('inventory.qtyBase')}</TableHead>
                <TableHead>{t('inventory.bin')}</TableHead>
                {withCosts ? <TableHead>{t('inventory.adjustment.unitCost')}</TableHead> : null}
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
                  <TableCell className="text-right font-mono">
                    {formatQty(line.enteredQty)}
                  </TableCell>
                  <TableCell className="text-right font-mono">{formatQty(line.qtyBase)}</TableCell>
                  <TableCell className="font-mono">{line.binCode}</TableCell>
                  {withCosts ? (
                    <TableCell>
                      <Input
                        aria-label={`${t('inventory.adjustment.unitCost')}: ${t('inventory.productUnit', { product: line.productName, unit: line.unitName })}`}
                        placeholder={t('inventory.adjustment.unitCostHint')}
                        inputMode="decimal"
                        className="w-40 font-mono"
                        value={costs[line.id] ?? ''}
                        onChange={(event) =>
                          setCosts((previous) => ({ ...previous, [line.id]: event.target.value }))
                        }
                      />
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {submitted && (canApprove || canManage) ? (
        <StickyActions summary={t('inventory.linesCount', { count: detail.lines.length })}>
          {canManage ? (
            <Button
              variant="ghost"
              onClick={() => {
                action.clear();
                setConfirm('cancel');
              }}
            >
              {t('inventory.adjustment.cancel')}
            </Button>
          ) : null}
          {canApprove ? (
            <>
              <Button
                variant="outline"
                disabled={mutations.adjustmentAction.isPending}
                onClick={sendBack}
              >
                {t('inventory.adjustment.return')}
              </Button>
              <Button
                disabled={!costsValid}
                onClick={() => {
                  setKey(randomUuid());
                  action.clear();
                  setConfirm('approve');
                }}
              >
                {t('inventory.adjustment.approve')}
              </Button>
            </>
          ) : null}
        </StickyActions>
      ) : null}
      <ConfirmDialog
        open={confirm === 'approve'}
        variant="default"
        title={t('inventory.adjustment.approveTitle')}
        description={t('inventory.adjustment.approveDescription')}
        confirmLabel={t('inventory.adjustment.approve')}
        pending={mutations.approveAdjustment.isPending}
        problem={action.problem}
        onConfirm={approve}
        onClose={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'cancel'}
        title={t('inventory.adjustment.cancelTitle')}
        confirmLabel={t('inventory.adjustment.cancel')}
        pending={mutations.adjustmentAction.isPending}
        problem={action.problem}
        onConfirm={cancel}
        onClose={() => setConfirm(null)}
      />
    </>
  );
}
