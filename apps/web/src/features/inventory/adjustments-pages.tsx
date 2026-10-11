import { USER_ADJUSTMENT_REASONS } from '@tugeel/shared/inventory';
import { Decimal } from '@tugeel/shared/money';
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
import { useAction } from '@/lib/use-action';
import { randomUuid } from '@/lib/uuid';
import {
  type AdjustmentDetail,
  type AdjustmentReason,
  type AdjustmentStatus,
  type Bin,
  useAdjustment,
  useAdjustments,
  useBinLookup,
  useInventoryMutations,
} from './api';
import { isInbound, looksLikeLabel, useWarehouseName, useWarehouseOptions } from './helpers';
import { DocStatusBadge, ProductSearch, QtyInput, WarehouseSelect } from './shared';

const SHELF_KINDS = ['WHOLESALE', 'STORE'] as const;
const STATUSES: readonly AdjustmentStatus[] = ['DRAFT', 'SUBMITTED', 'POSTED', 'CANCELLED'];
/** Cost per base unit, NUMERIC(14,4). */
const UNIT_COST = /^\d{1,10}(\.\d{1,4})?$/;

const isStatus = (value: string | null): value is AdjustmentStatus =>
  STATUSES.some((status) => status === value);

/** Adjustments (ADJ-): the warehouse writes goods off or records found ones; an admin approves. */
export function AdjustmentsPage() {
  const { t } = useTranslation();
  const canManage = useHasPermission('inventory.adjustments.manage');
  const [params, setParams] = useSearchParams();
  const statusParam = params.get('status');
  const status = isStatus(statusParam) ? statusParam : undefined;
  const warehouseParam = Number.parseInt(params.get('warehouseId') ?? '', 10);
  const warehouseId = Number.isNaN(warehouseParam) ? undefined : warehouseParam;
  const warehouses = useWarehouseOptions(SHELF_KINDS);
  const warehouseName = useWarehouseName();
  const adjustments = useAdjustments({ warehouseId, status });
  const rows = adjustments.data?.pages.flatMap((page) => page.data) ?? [];

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
      <PageHeader title={t('inventory.adjustments.title')} />
      {canManage ? <AdjustmentCreateCard /> : null}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <WarehouseSelect
          options={warehouses.options}
          value={warehouseId}
          emptyLabel={t('inventory.allWarehouses')}
          onChange={(id) => setParam('warehouseId', id === undefined ? '' : String(id))}
        />
        <NativeSelect
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
      </div>
      <ProblemAlert problem={problemFromError(adjustments.error)} />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('inventory.number')}</TableHead>
            <TableHead>{t('inventory.date')}</TableHead>
            <TableHead>{t('inventory.warehouse')}</TableHead>
            <TableHead>{t('inventory.adjustments.reason')}</TableHead>
            <TableHead className="text-right">{t('inventory.lines')}</TableHead>
            <TableHead>{t('inventory.status')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
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
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {!adjustments.isPending && rows.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">{t('inventory.adjustments.empty')}</p>
      ) : null}
      {adjustments.hasNextPage ? (
        <Button
          className="self-start"
          variant="outline"
          disabled={adjustments.isFetchingNextPage}
          onClick={() => void adjustments.fetchNextPage()}
        >
          {t('common.loadMore')}
        </Button>
      ) : null}
    </div>
  );
}

function AdjustmentCreateCard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const canApprove = useHasPermission('inventory.adjustments.approve');
  const warehouses = useWarehouseOptions(SHELF_KINDS, true);
  const mutations = useInventoryMutations();
  const action = useAction();
  const [key] = useState(randomUuid);
  const [warehouseId, setWarehouseId] = useState<number | undefined>();
  const [reason, setReason] = useState<AdjustmentReason>('DAMAGED');
  const [note, setNote] = useState('');
  const reasons: readonly AdjustmentReason[] = canApprove
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
      await navigate(`/inventory/adjustments/${adjustment.id}`);
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('inventory.adjustment.newTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <ProblemAlert problem={action.problem} />
        <WarehouseSelect
          options={warehouses.options}
          value={warehouseId}
          emptyLabel={t('inventory.pickWarehouse')}
          onChange={setWarehouseId}
        />
        <NativeSelect
          aria-label={t('inventory.adjustments.reason')}
          value={reason}
          onChange={(event) => {
            const picked = reasons.find((value) => value === event.target.value);
            if (picked) setReason(picked);
          }}
        >
          {reasons.map((value) => (
            <option key={value} value={value}>
              {t(`inventory.reasons.${value}`)}
            </option>
          ))}
        </NativeSelect>
        <Input
          aria-label={t('inventory.note')}
          placeholder={t('inventory.note')}
          maxLength={500}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
        <Button
          disabled={warehouseId === undefined || mutations.createAdjustment.isPending}
          onClick={create}
        >
          {t('inventory.adjustments.create')}
        </Button>
      </CardContent>
    </Card>
  );
}

/** One adjustment: the scan editor while a draft, the approver's decision once submitted. */
export function AdjustmentPage() {
  const { t } = useTranslation();
  const id = Number.parseInt(useParams().id ?? '', 10);
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
    <div className="flex flex-col gap-4">
      <PageHeader
        title={detail.number ?? t('inventory.draftNo', { id: detail.id })}
        actions={
          <Button variant="outline" asChild>
            <Link to="/inventory/adjustments">{t('common.back')}</Link>
          </Button>
        }
      />
      <div className="-mt-2 flex flex-wrap items-center gap-2 text-sm">
        <DocStatusBadge status={detail.status} />
        <Badge variant="outline">{t(`inventory.reasons.${detail.reason}`)}</Badge>
        <span className="text-muted-foreground">
          {isInbound(detail.reason)
            ? t('inventory.adjustment.increases')
            : t('inventory.adjustment.decreases')}
        </span>
        <span>{warehouseName(detail.warehouseId)}</span>
        {detail.effectiveDate ? (
          <span className="font-mono text-muted-foreground">{detail.effectiveDate}</span>
        ) : null}
      </div>
      {detail.note ? <p className="text-sm">{detail.note}</p> : null}
      {detail.status === 'DRAFT' && canManage ? (
        <AdjustmentEditor key={detail.id} detail={detail} />
      ) : (
        <AdjustmentReview key={detail.id} detail={detail} />
      )}
    </div>
  );
}

function AdjustmentEditor({ detail }: { detail: AdjustmentDetail }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const mutations = useInventoryMutations();
  const lookupBin = useBinLookup();
  const lookupBarcode = useBarcodeLookup();
  const action = useAction();
  const [activeBin, setActiveBin] = useState<Bin | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);

  const addUnit = async (productUnitId: number) => {
    if (activeBin === null) {
      setMessage(t('inventory.needBin'));
      return;
    }
    const same = detail.lines.find(
      (line) => line.productUnitId === productUnitId && line.binId === activeBin.id,
    );
    if (same) {
      await mutations.updateAdjustmentLine.mutateAsync({
        id: same.id,
        body: { enteredQty: new Decimal(same.enteredQty).plus(1).toString() },
      });
    } else {
      await mutations.addAdjustmentLine.mutateAsync({
        id: detail.id,
        body: { productUnitId, enteredQty: '1', binId: activeBin.id },
      });
    }
  };

  const onScan = (code: string) =>
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
        return;
      }
      const resolved = await find(lookupBarcode.mutateAsync(code));
      if (resolved) {
        await addUnit(resolved.unit.id);
        return;
      }
      const late = label
        ? null
        : await find(lookupBin.mutateAsync({ warehouseId: detail.warehouseId, code }));
      if (late) setActiveBin(late);
      else setMessage(t('inventory.scanNotFound', { code }));
    });

  const submit = () =>
    void action.run(() =>
      mutations.adjustmentAction.mutateAsync({ id: detail.id, action: 'submit' }),
    );
  const cancel = () =>
    void action.run(async () => {
      await mutations.adjustmentAction.mutateAsync({ id: detail.id, action: 'cancel' });
      setConfirm(false);
      await navigate('/inventory/adjustments');
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
        <span className="text-sm font-medium">
          {activeBin ? t('inventory.activeBin', { code: activeBin.code }) : t('inventory.needBin')}
        </span>
        {message ? <p className="text-sm text-destructive">{message}</p> : null}
        <ProblemAlert problem={confirm ? null : action.problem} />
        <ProductSearch onPick={(product) => void action.run(() => addUnit(product.baseUnit.id))} />
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
                      label={`${t('inventory.qty')}: ${line.productName}`}
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
                  <TableCell className="text-right">
                    <Button
                      size="xs"
                      variant="ghost"
                      aria-label={`${t('inventory.remove')}: ${line.productName}`}
                      onClick={() =>
                        void action.run(() => mutations.removeAdjustmentLine.mutateAsync(line.id))
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
          <Button
            disabled={detail.lines.length === 0 || mutations.adjustmentAction.isPending}
            onClick={submit}
          >
            {t('inventory.adjustment.submit')}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              action.clear();
              setConfirm(true);
            }}
          >
            {t('inventory.adjustment.cancel')}
          </Button>
        </div>
      </CardContent>
      <ConfirmDialog
        open={confirm}
        title={t('inventory.adjustment.cancelTitle')}
        confirmLabel={t('inventory.adjustment.cancel')}
        pending={mutations.adjustmentAction.isPending}
        problem={action.problem}
        onConfirm={cancel}
        onClose={() => setConfirm(false)}
      />
    </Card>
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
      await mutations.approveAdjustment.mutateAsync({
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
    });
  const cancel = () =>
    void action.run(async () => {
      await mutations.adjustmentAction.mutateAsync({ id: detail.id, action: 'cancel' });
      setConfirm(null);
    });

  return (
    <Card>
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
                <TableCell className="text-right font-mono">{line.enteredQty}</TableCell>
                <TableCell className="text-right font-mono">{line.qtyBase}</TableCell>
                <TableCell className="font-mono">{line.binCode}</TableCell>
                {withCosts ? (
                  <TableCell>
                    <Input
                      aria-label={`${t('inventory.adjustment.unitCost')}: ${line.productName}`}
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
        {submitted ? (
          <div className="flex flex-wrap gap-2">
            {canApprove ? (
              <>
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
                <Button
                  variant="outline"
                  disabled={mutations.adjustmentAction.isPending}
                  onClick={() =>
                    void action.run(() =>
                      mutations.adjustmentAction.mutateAsync({ id: detail.id, action: 'return' }),
                    )
                  }
                >
                  {t('inventory.adjustment.return')}
                </Button>
              </>
            ) : null}
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
          </div>
        ) : null}
      </CardContent>
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
    </Card>
  );
}
