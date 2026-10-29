import { Decimal } from '@tugeel/shared/money';
import { Ban } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormField } from '@/components/form';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { ScanBox } from '@/components/scan-box';
import { StickyActions } from '@/components/sticky-actions';
import { NativeSelect } from '@/components/native-select';
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
import { cn } from '@/lib/utils';
import { formatQty } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { useScanGuard } from '@/lib/scan/use-wedge-scanner';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { randomUuid } from '@/lib/uuid';
import { type ReceiptDetail, type ReceiptLine, useInventoryMutations, useReceipt } from './api';
import { ReceiptConfirmations, ReceiptNoteCard } from './receipt-note';
import { useWritableWarehouses } from './writable-warehouses';

/** A quantity typed with a comma or spaces, as the API takes it; null when it is not one. */
function parseCount(value: string): string | null {
  const text = value.replace(/\s/g, '').replace(',', '.');
  return /^\d{1,11}(\.\d{1,3})?$/.test(text) ? text : null;
}

type LineState = 'unchecked' | 'notArrived' | 'differs' | 'checked' | 'extra';

function stateOf(line: ReceiptLine): LineState {
  if (line.expectedQty === null) return 'extra';
  if (line.checkedAt === null) return 'unchecked';
  if (new Decimal(line.enteredQty).isZero()) return 'notArrived';
  return new Decimal(line.enteredQty).equals(line.expectedQty) ? 'checked' : 'differs';
}

const STATE_BADGE = {
  unchecked: 'secondary',
  notArrived: 'destructive',
  differs: 'warning',
  checked: 'success',
  extra: 'default',
} as const;

/**
 * The keeper's count against a purchase order's draft receipt (ADR-0115, owner 2026-10-29): a
 * barcode scan (a handheld scanner works anywhere on the page) jumps to the line and shows what was
 * ordered; the keeper types what arrived or marks «Ирээгүй»; a product not on the order is added as
 * a line of its own. The note's pieces and amount (and a photo) are typed from the paper. «Батлах»
 * confirms the lines in the keeper's warehouses; the last warehouse's confirmation posts the
 * receipt, which goes on sale at once.
 */
export function ReceiptReceivePage() {
  const { t } = useTranslation();
  const id = Number.parseInt(useParams().id ?? '', 10);
  const receipt = useReceipt(id, !Number.isNaN(id));
  const loadProblem = problemFromError(receipt.error);
  if (loadProblem || !receipt.data) {
    return (
      <div className="space-y-4">
        <PageHeader title={t('inventory.receipt.receive.open')} />
        {loadProblem ? (
          <ProblemAlert problem={loadProblem} onRetry={receipt.refetch} />
        ) : (
          <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
        )}
      </div>
    );
  }
  return <Receiving detail={receipt.data} />;
}

function Receiving({ detail }: { detail: ReceiptDetail }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const writable = useWritableWarehouses();
  const mutations = useInventoryMutations();
  const lookup = useBarcodeLookup();
  const action = useAction();
  const [message, setMessage] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ lineId: number; at: number } | null>(null);
  const [extra, setExtra] = useState<{
    productName: string;
    unitName: string;
    unitId: number;
  } | null>(null);
  const [extraQty, setExtraQty] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [confirmKey, setConfirmKey] = useState(randomUuid);
  const own = detail.warehouses.filter(
    (warehouse) => writable === null || writable.has(warehouse.id),
  );
  const [warehouseId, setWarehouseId] = useState<number | null>(
    own.length === 1 && detail.warehouses.length > 1 ? (own[0]?.id ?? null) : null,
  );
  const confirmed = new Set(detail.confirmations.map((row) => row.warehouseId));
  const lines = detail.lines.filter(
    (line) => !line.freeGoods && (warehouseId === null || line.warehouseId === warehouseId),
  );
  const checked = lines.filter((line) => line.checkedAt !== null).length;
  const mineUnchecked = detail.lines.filter(
    (line) =>
      line.checkedAt === null &&
      !confirmed.has(line.warehouseId) &&
      (writable === null || writable.has(line.warehouseId)),
  ).length;

  if (detail.status !== 'DRAFT') {
    return (
      <div className="space-y-4">
        <PageHeader
          title={t('inventory.receipt.receive.title', { supplier: detail.supplierName })}
        />
        <p className="text-sm text-muted-foreground">
          {t('inventory.receipt.receive.notDraft')}{' '}
          <Link
            className="text-link underline-offset-4 hover:underline"
            to={`/inventory/receipts/${detail.id}`}
          >
            {detail.number ?? t('inventory.receipt.receive.open')}
          </Link>
        </p>
      </div>
    );
  }

  const onScan = (code: string) => {
    setMessage(null);
    void action.run(async () => {
      const resolved = await lookup.mutateAsync(code);
      const ofProduct = detail.lines.filter(
        (line) => line.productId === resolved.product.id && !line.freeGoods,
      );
      const line =
        ofProduct.find((row) => row.productUnitId === resolved.unit.id) ?? ofProduct[0] ?? null;
      if (line === null) {
        setExtraQty('');
        setExtra({
          productName: resolved.product.name,
          unitName: resolved.unit.uomName,
          unitId: resolved.unit.id,
        });
        return;
      }
      if (warehouseId !== null && line.warehouseId !== warehouseId) setWarehouseId(null);
      setMessage(
        t('inventory.receipt.receive.scanned', {
          product: line.productName,
          expected: line.expectedQty === null ? '—' : formatQty(line.expectedQty),
          unit: line.unitName,
        }),
      );
      setFocus({ lineId: line.id, at: Date.now() });
    });
  };

  const count = (line: ReceiptLine, enteredQty: string) =>
    void action.run(() =>
      mutations.updateReceiptLine.mutateAsync({ id: line.id, body: { enteredQty } }),
    );

  const addExtra = () => {
    const qty = parseCount(extraQty);
    if (!extra || qty === null || new Decimal(qty).isZero()) return;
    void action.run(async () => {
      await mutations.addReceiptLine.mutateAsync({
        id: detail.id,
        body: { productUnitId: extra.unitId, enteredQty: qty },
      });
      setExtra(null);
    });
  };

  const confirm = () =>
    void action.run(async () => {
      const result = await mutations.postReceipt.mutateAsync({ id: detail.id, key: confirmKey });
      setConfirming(false);
      setConfirmKey(randomUuid());
      if (result.status === 'POSTED') {
        toast.success(t('inventory.receipt.receive.posted', { number: result.number ?? '' }));
        await navigate(`/inventory/receipts/${detail.id}`);
      } else {
        toast.success(t('inventory.receipt.receive.confirmed'));
      }
    });

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('inventory.receipt.receive.title', { supplier: detail.supplierName })}
        meta={
          detail.originRef ? (
            <Badge variant="secondary">
              {t('inventory.receipt.fromOrder', { ref: detail.originRef })}
            </Badge>
          ) : null
        }
        description={t('inventory.receipt.receive.description')}
      />
      <ReceiptNoteCard detail={detail} editable />
      <Card role="region" aria-labelledby="receive-lines-title">
        <CardHeader>
          <CardTitle id="receive-lines-title">
            {t('inventory.receipt.receive.linesTitle')}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-64 flex-1">
              <ScanBox letters onScan={onScan} disabled={extra !== null || confirming} autoFocus />
            </div>
            {detail.warehouses.length > 1 ? (
              <FormField
                label={t('inventory.receipt.receive.warehouseFilter')}
                htmlFor="receive-warehouse"
              >
                <NativeSelect
                  id="receive-warehouse"
                  value={warehouseId ?? ''}
                  onChange={(event) =>
                    setWarehouseId(
                      event.target.value ? Number.parseInt(event.target.value, 10) : null,
                    )
                  }
                >
                  <option value="">{t('inventory.receipt.receive.allWarehouses')}</option>
                  {detail.warehouses.map((warehouse) => (
                    <option key={warehouse.id} value={warehouse.id}>
                      {warehouse.name}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
            ) : null}
          </div>
          <p aria-live="polite" className="min-h-5 text-sm">
            {message}
          </p>
          <ProblemAlert problem={extra ? null : action.problem} />
          <ReceiptConfirmations detail={detail} />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10 text-right">
                  {t('inventory.receipt.form.lineNo')}
                </TableHead>
                <TableHead>{t('inventory.sku')}</TableHead>
                <TableHead>{t('inventory.product')}</TableHead>
                <TableHead>{t('inventory.warehouse')}</TableHead>
                <TableHead>{t('inventory.unit')}</TableHead>
                <TableHead className="text-right">
                  {t('inventory.receipt.receive.expected')}
                </TableHead>
                <TableHead className="text-right">
                  {t('inventory.receipt.receive.arrived')}
                </TableHead>
                <TableHead>{t('inventory.receipt.receive.state')}</TableHead>
                <TableHead>
                  <span className="sr-only">{t('common.actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line, index) => (
                <ReceiveRow
                  key={line.id}
                  index={index}
                  line={line}
                  frozen={confirmed.has(line.warehouseId)}
                  focusAt={focus?.lineId === line.id ? focus.at : null}
                  onCount={(qty) => count(line, qty)}
                  onScan={onScan}
                />
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <StickyActions
        summary={t('inventory.receipt.receive.progress', { checked, total: lines.length })}
      >
        <Button variant="outline" asChild>
          <Link to={`/inventory/receipts/${detail.id}`}>
            {t('inventory.receipt.receive.document')}
          </Link>
        </Button>
        <Button
          disabled={mineUnchecked > 0}
          onClick={() => {
            action.clear();
            setConfirming(true);
          }}
        >
          {t('inventory.receipt.receive.confirm')}
        </Button>
      </StickyActions>
      <ConfirmDialog
        open={confirming}
        variant="default"
        title={t('inventory.receipt.receive.confirmTitle')}
        description={t('inventory.receipt.receive.confirmDescription')}
        confirmLabel={t('inventory.receipt.receive.confirm')}
        pending={mutations.postReceipt.isPending}
        problem={action.problem}
        onConfirm={confirm}
        onClose={() => setConfirming(false)}
      />
      <ConfirmDialog
        open={extra !== null}
        variant="default"
        title={t('inventory.receipt.receive.addExtraTitle')}
        description={
          extra
            ? t('inventory.receipt.receive.addExtraDescription', {
                product: extra.productName,
                unit: extra.unitName,
              })
            : ''
        }
        confirmLabel={t('inventory.receipt.receive.addExtra')}
        pending={mutations.addReceiptLine.isPending}
        problem={action.problem}
        onConfirm={addExtra}
        onClose={() => setExtra(null)}
      >
        <FormField label={t('inventory.receipt.receive.arrived')} htmlFor="receive-extra-qty">
          <Input
            id="receive-extra-qty"
            inputMode="decimal"
            autoFocus
            className="font-mono"
            value={extraQty}
            onChange={(event) => setExtraQty(event.target.value)}
          />
        </FormField>
      </ConfirmDialog>
    </div>
  );
}

/** One line: what was ordered, the count typed (empty until checked), «Ирээгүй». */
function ReceiveRow(props: {
  index: number;
  line: ReceiptLine;
  frozen: boolean;
  focusAt: number | null;
  onCount: (qty: string) => void;
  onScan: (code: string) => void;
}) {
  const { t } = useTranslation();
  const { line } = props;
  const saved = line.checkedAt === null ? '' : line.enteredQty;
  const [draft, setDraft] = useState(saved === '' ? '' : new Decimal(saved).toString());
  const input = useRef<HTMLInputElement>(null);
  // The count sent last: Enter saves and leaves the field, and the leave must not send it again.
  const sent = useRef<string | null>(null);
  const guard = useScanGuard(props.onScan, { letters: true });
  const state = stateOf(line);
  const name = t('inventory.productUnit', { product: line.productName, unit: line.unitName });

  // The saved count comes back from the server after each save.
  useEffect(() => {
    setDraft(line.checkedAt === null ? '' : new Decimal(line.enteredQty).toString());
    sent.current = null;
  }, [line.checkedAt, line.enteredQty]);

  // A scan of this line's product puts the cursor in its count.
  useEffect(() => {
    if (props.focusAt === null) return;
    input.current?.focus();
    input.current?.select();
  }, [props.focusAt]);

  const save = () => {
    const value = parseCount(draft);
    if (value === null) return;
    if (line.checkedAt !== null && new Decimal(value).equals(line.enteredQty)) return;
    if (new Decimal(value).isZero() && line.expectedQty === null) return;
    if (sent.current === value) return;
    sent.current = value;
    props.onCount(value);
  };

  return (
    <TableRow data-state={props.focusAt === null ? undefined : 'selected'}>
      <TableCell className="text-right font-mono text-muted-foreground">
        {props.index + 1}
      </TableCell>
      <TableCell className="font-mono text-[13px]">{line.productSku}</TableCell>
      <TableCell className="min-w-40 whitespace-normal">{line.productName}</TableCell>
      <TableCell>{line.warehouseName}</TableCell>
      <TableCell>{line.unitName}</TableCell>
      <TableCell className="text-right font-mono">
        {line.expectedQty === null ? t('common.none') : formatQty(line.expectedQty)}
      </TableCell>
      <TableCell className="text-right">
        <Input
          ref={input}
          aria-label={t('inventory.receipt.receive.arrivedFor', {
            product: line.productName,
            unit: line.unitName,
          })}
          inputMode="decimal"
          autoComplete="off"
          disabled={props.frozen}
          className={cn(
            'ml-auto w-24 text-right font-mono',
            draft !== '' && parseCount(draft) === null && 'border-destructive',
          )}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={save}
          onKeyDown={(event) => {
            guard(event, draft, setDraft);
            if (event.defaultPrevented || event.key !== 'Enter') return;
            event.preventDefault();
            save();
            event.currentTarget.blur();
          }}
        />
      </TableCell>
      <TableCell>
        <Badge variant={STATE_BADGE[state]}>{t(`inventory.receipt.receive.${state}`)}</Badge>
      </TableCell>
      <TableCell>
        {line.expectedQty !== null ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={props.frozen || state === 'notArrived'}
            aria-label={t('inventory.receipt.receive.notArrivedFor', {
              product: line.productName,
              unit: line.unitName,
            })}
            title={name}
            onClick={() => props.onCount('0')}
          >
            <Ban />
            {t('inventory.receipt.receive.notArrived')}
          </Button>
        ) : null}
      </TableCell>
    </TableRow>
  );
}
