import { unitCostOf } from '@tugeel/shared/inventory';
import { Decimal } from '@tugeel/shared/money';
import { businessDate } from '@tugeel/shared/time';
import { Pencil } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { LeaveGuard } from '@/components/leave-guard';
import { ProblemAlert } from '@/components/problem-alert';
import { StickyActions } from '@/components/sticky-actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatMnt } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { randomUuid } from '@/lib/uuid';
import {
  type ReceiptCosting,
  type ReceiptDetail,
  useInventoryMutations,
  usePendingReceipts,
  useReceiptCosting,
} from './api';
import { type CostEntry, entryAmount, useCanWrite } from './helpers';

type CostedLine = ReceiptCosting['lines'][number];
type Column = 'unitPrice' | 'amount';

const EMPTY: CostEntry = { source: 'amount', value: '', free: false };

const entryOf = (line: CostedLine): CostEntry =>
  line.freeGoods
    ? { source: 'amount', value: '', free: true }
    : { source: 'amount', value: line.amount ?? '', free: false };

const sameEntry = (a: CostEntry, b: CostEntry) =>
  a.free === b.free && a.source === b.source && a.value.trim() === b.value.trim();

/**
 * The accountant's costs, on the receipt itself (ADR-0033, ADR-0047 #1): a receipt waiting for
 * its costs opens as a form, a costed one reads first and is changed with «Засах» until its
 * deadline. «Хадгалаад дараагийнх» saves and opens the next receipt waiting for its costs.
 */
export function ReceiptCostingCard({ detail }: { detail: ReceiptDetail }) {
  const { t } = useTranslation();
  const costing = useReceiptCosting(detail.id);
  const problem = problemFromError(costing.error);
  if (problem) return <ProblemAlert problem={problem} />;
  if (!costing.data) return <p className="text-sm text-muted-foreground">{t('common.loading')}</p>;
  return <CostingForm key={costing.data.costingVersion} costing={costing.data} />;
}

function CostingForm({ costing }: { costing: ReceiptCosting }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const mutations = useInventoryMutations();
  const action = useAction();
  const pendingReceipts = usePendingReceipts();
  const canWrite = useCanWrite();
  const [key, setKey] = useState(randomUuid);
  const waiting = costing.costingStatus === 'PENDING';
  const changeable =
    waiting || costing.recostUntil === null || businessDate() <= costing.recostUntil;
  const [editing, setEditing] = useState(waiting);
  const initial = useMemo(
    () => Object.fromEntries(costing.lines.map((line) => [line.lineId, entryOf(line)])),
    [costing],
  );
  const [entries, setEntries] = useState<Record<number, CostEntry>>(initial);
  const [saved, setSaved] = useState(false);
  const [goTo, setGoTo] = useState<number | null>(null);
  const table = useRef<HTMLTableElement>(null);

  const entry = (lineId: number) => entries[lineId] ?? EMPTY;
  const amounts = costing.lines.map((line) => entryAmount(entry(line.lineId), line.enteredQty));
  const complete = amounts.every((amount) => amount !== null);
  const total = amounts.reduce<Decimal>((sum, amount) => sum.plus(amount ?? 0), new Decimal(0));
  const dirty = costing.lines.some(
    (line) => !sameEntry(entry(line.lineId), initial[line.lineId] ?? EMPTY),
  );

  // Navigate once the save has rendered, so the leave question no longer applies.
  useEffect(() => {
    if (goTo !== null) void navigate(`/inventory/receipts/${goTo}`);
  }, [goTo, navigate]);

  const change = useCallback(
    (lineId: number, patch: Partial<CostEntry>) =>
      setEntries((previous) => ({
        ...previous,
        [lineId]: { ...(previous[lineId] ?? EMPTY), ...patch },
      })),
    [],
  );
  const onEnter = useCallback((column: Column, index: number) => {
    const fields = table.current?.querySelectorAll<HTMLInputElement>(
      `input[data-cost="${column}"]`,
    );
    const next = Array.from(fields ?? []).find(
      (field, position) => position > index && !field.disabled,
    );
    next?.focus();
  }, []);

  /** The next receipt waiting for its costs, down the list and back to its top. */
  const nextPending = () => {
    const rows = (pendingReceipts.data ?? []).filter(
      (row) => row.id !== costing.receiptId && canWrite(row.warehouseId),
    );
    return (rows.find((row) => row.id < costing.receiptId) ?? rows[0])?.id ?? null;
  };

  const save = (andNext: boolean) =>
    void action.run(async () => {
      await mutations.costReceipt.mutateAsync({
        id: costing.receiptId,
        key,
        body: {
          costingVersion: costing.costingVersion,
          lines: costing.lines.map((line) => {
            const value = entry(line.lineId);
            if (value.free) return { lineId: line.lineId, freeGoods: true };
            return value.source === 'amount'
              ? { lineId: line.lineId, amount: value.value.trim() }
              : { lineId: line.lineId, unitPrice: value.value.trim() };
          }),
        },
      });
      setKey(randomUuid());
      setSaved(true);
      toast.success(t('inventory.costing.saved'));
      if (!andNext) return;
      const target = nextPending();
      if (target === null) toast.info(t('inventory.costing.noneLeft'));
      else setGoTo(target);
    });

  return (
    <>
      <Card role="region" aria-labelledby="receipt-costing-title">
        <CardHeader>
          <CardTitle id="receipt-costing-title">{t('inventory.receipts.costing')}</CardTitle>
          {!editing && changeable ? (
            <CardAction>
              <Button
                variant="secondary"
                size="sm"
                aria-label={t('common.editRecord', { name: t('inventory.receipts.costing') })}
                onClick={() => setEditing(true)}
              >
                <Pencil />
                {t('common.edit')}
              </Button>
            </CardAction>
          ) : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-[13px] text-muted-foreground">
            {editing
              ? t('inventory.costing.hint')
              : costing.recostUntil
                ? t('inventory.costing.recostUntil', { date: costing.recostUntil })
                : null}
          </p>
          <ProblemAlert problem={action.problem} />
          <Table ref={table}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('inventory.product')}</TableHead>
                <TableHead className="text-right">{t('inventory.qty')}</TableHead>
                {editing ? (
                  <TableHead className="text-right">{t('inventory.costing.provisional')}</TableHead>
                ) : null}
                <TableHead className="text-right">{t('inventory.costing.unitPrice')}</TableHead>
                <TableHead className="text-right">{t('inventory.costing.amount')}</TableHead>
                <TableHead>{t('inventory.costing.freeGoods')}</TableHead>
                <TableHead className="text-right">{t('inventory.costing.baseCost')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {costing.lines.map((line, index) => (
                <CostRow
                  key={line.lineId}
                  line={line}
                  index={index}
                  entry={entry(line.lineId)}
                  amount={amounts[index] ?? null}
                  editing={editing}
                  onChange={change}
                  onEnter={onEnter}
                />
              ))}
            </TableBody>
          </Table>
          {editing && !complete ? (
            <p className="text-[13px] text-muted-foreground">{t('inventory.costing.missing')}</p>
          ) : null}
        </CardContent>
      </Card>
      {editing ? (
        <StickyActions
          summary={
            <>
              {t('inventory.costing.total')}:{' '}
              <span className="font-mono font-medium text-foreground">
                {formatMnt(total.toString())}
              </span>
            </>
          }
        >
          {!waiting ? (
            <Button
              variant="ghost"
              onClick={() => {
                setEntries(initial);
                setEditing(false);
                action.clear();
              }}
            >
              {t('common.cancel')}
            </Button>
          ) : null}
          <Button
            variant="outline"
            disabled={!complete || mutations.costReceipt.isPending}
            onClick={() => save(false)}
          >
            {t('common.save')}
          </Button>
          <Button
            disabled={!complete || mutations.costReceipt.isPending}
            onClick={() => save(true)}
          >
            {t('inventory.costing.saveAndNext')}
          </Button>
        </StickyActions>
      ) : null}
      <LeaveGuard
        when={editing && dirty && !saved}
        title={t('inventory.costing.unsavedTitle')}
        description={t('inventory.costing.unsavedDescription')}
        leaveLabel={t('inventory.costing.leave')}
      />
    </>
  );
}

/**
 * One line: a price per entered unit or the line's amount, whichever was typed last (the other
 * shows the figure it comes to), then «Бонус». Enter moves to the same field of the next line.
 */
const CostRow = memo(function CostRow(props: {
  line: CostedLine;
  index: number;
  entry: CostEntry;
  amount: Decimal | null;
  editing: boolean;
  onChange: (lineId: number, patch: Partial<CostEntry>) => void;
  onEnter: (column: Column, index: number) => void;
}) {
  const { t } = useTranslation();
  const { line, entry, amount } = props;
  const name = t('inventory.productUnit', { product: line.productName, unit: line.unitName });
  const unitPrice =
    amount === null || new Decimal(line.enteredQty).isZero()
      ? null
      : amount.dividedBy(line.enteredQty).toDecimalPlaces(2);
  const baseCost = amount === null ? null : unitCostOf(amount, line.qtyBase);
  const field = (column: Column) => {
    const own = entry.source === column;
    const shown = column === 'amount' ? amount : unitPrice;
    return (
      <Input
        data-cost={column}
        aria-label={`${t(column === 'amount' ? 'inventory.costing.amount' : 'inventory.costing.unitPrice')}: ${name}`}
        inputMode="decimal"
        autoComplete="off"
        className="ml-auto w-32 text-right font-mono"
        disabled={entry.free}
        value={own ? entry.value : ''}
        placeholder={!own && shown !== null ? formatMnt(shown.toString()) : undefined}
        onChange={(event) =>
          props.onChange(line.lineId, { source: column, value: event.target.value })
        }
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          props.onEnter(column, props.index);
        }}
      />
    );
  };
  const none = t('common.none');
  return (
    <TableRow>
      <TableCell className="min-w-40 whitespace-normal">{line.productName}</TableCell>
      <TableCell className="text-right font-mono">
        {t('inventory.qtyWithUnit', { qty: line.enteredQty, unit: line.unitName })}
      </TableCell>
      {props.editing ? (
        <>
          <TableCell className="text-right font-mono">
            {formatMnt(line.provisionalUnitCost)}
          </TableCell>
          <TableCell className="text-right">{field('unitPrice')}</TableCell>
          <TableCell className="text-right">{field('amount')}</TableCell>
          <TableCell>
            <Switch
              aria-label={`${t('inventory.costing.freeGoods')}: ${name}`}
              checked={entry.free}
              onCheckedChange={(checked) => props.onChange(line.lineId, { free: checked })}
            />
          </TableCell>
        </>
      ) : (
        <>
          <TableCell className="text-right font-mono">
            {unitPrice === null ? none : formatMnt(unitPrice.toString())}
          </TableCell>
          <TableCell className="text-right font-mono">
            {amount === null ? none : formatMnt(amount.toString())}
          </TableCell>
          <TableCell>
            {entry.free ? (
              <Badge variant="secondary">{t('inventory.costing.freeGoods')}</Badge>
            ) : (
              none
            )}
          </TableCell>
        </>
      )}
      <TableCell className="text-right font-mono">
        {baseCost === null ? none : formatMnt(baseCost.toString())}
      </TableCell>
    </TableRow>
  );
});
