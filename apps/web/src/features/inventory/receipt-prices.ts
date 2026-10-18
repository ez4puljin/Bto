import { Decimal } from '@tugeel/shared/money';
import { businessDate } from '@tugeel/shared/time';
import { type RefObject, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { randomUuid } from '@/lib/uuid';
import {
  type ReceiptDetail,
  type ReceiptLine,
  useInventoryMutations,
  usePendingReceipts,
} from './api';
import { type CostEntry, entryAmount, parseMoney, useCanWrite } from './helpers';

/*
 * A receipt's delivery-note prices (ADR-0033, ADR-0078): typed on the receipt itself by holders of
 * inventory.costs.manage, VAT included as on the note; the server takes the VAT out. On a draft each
 * field is saved as it is left; on a posted receipt the whole costing is saved at once.
 */

/** The two price fields of a line. */
export type PriceColumn = 'unitPrice' | 'amount';

export const EMPTY_ENTRY: CostEntry = { source: 'amount', value: '', free: false };

const plain = (value: string) => new Decimal(value).toString();

/**
 * A line's price as the server keeps it: bonus, the unit price typed on a draft (it makes the
 * amount), else the amount. A costed receipt's lines carry the costing's amounts.
 */
export function entryOfLine(line: ReceiptLine, costed: boolean): CostEntry {
  if (line.freeGoods) return { source: 'amount', value: '', free: true };
  if (!costed && line.docUnitPrice != null) {
    return { source: 'unitPrice', value: plain(line.docUnitPrice), free: false };
  }
  return {
    source: 'amount',
    value: line.docAmount == null ? '' : plain(line.docAmount),
    free: false,
  };
}

export const sameEntry = (a: CostEntry, b: CostEntry) =>
  a.free === b.free && a.source === b.source && a.value.trim() === b.value.trim();

/** Moves the cursor to the same price field of the next line that takes one. */
export function focusNextPrice(
  table: RefObject<HTMLTableElement | null>,
  column: PriceColumn,
  from: HTMLInputElement,
) {
  const fields = Array.from(
    table.current?.querySelectorAll<HTMLInputElement>(`input[data-cost="${column}"]`) ?? [],
  );
  const next = fields.slice(fields.indexOf(from) + 1).find((field) => !field.disabled);
  if (next) next.focus();
  else from.blur();
}

/** Whether a posted receipt's costs may still be changed (PENDING, or until `recostUntil`). */
export function costsChangeable(detail: ReceiptDetail): boolean {
  return (
    detail.status === 'POSTED' &&
    (detail.costingStatus === 'PENDING' ||
      detail.recostUntil === null ||
      businessDate() <= detail.recostUntil)
  );
}

/**
 * The accountant's costs of a posted receipt (ADR-0033, ADR-0047 #1): the prices typed on the lines,
 * sent at once through PUT /costs; «Хадгалаад дараагийнх» then opens the next receipt waiting for
 * its costs. A new costing version (a save, someone else's) starts the fields afresh.
 */
export function usePostedCosts(detail: ReceiptDetail, enabled: boolean) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const mutations = useInventoryMutations();
  const action = useAction();
  const pendingReceipts = usePendingReceipts(enabled);
  const canWrite = useCanWrite();
  const costed = detail.costingStatus === 'COSTED';
  const stamp = `${detail.status}:${detail.costingVersion}`;
  const initial = useMemo(
    () => Object.fromEntries(detail.lines.map((line) => [line.id, entryOfLine(line, costed)])),
    [detail.lines, costed],
  );
  const [shownStamp, setShownStamp] = useState(stamp);
  const [entries, setEntries] = useState<Record<number, CostEntry>>({});
  const [saved, setSaved] = useState(false);
  const [key, setKey] = useState(randomUuid);
  const [goTo, setGoTo] = useState<number | null>(null);
  if (shownStamp !== stamp) {
    setShownStamp(stamp);
    setEntries({});
    setSaved(false);
  }

  const entry = (lineId: number) => entries[lineId] ?? initial[lineId] ?? EMPTY_ENTRY;
  const amounts = detail.lines.map((line) => entryAmount(entry(line.id), line.enteredQty));
  const complete = detail.lines.length > 0 && amounts.every((amount) => amount !== null);
  const total = amounts.reduce<Decimal>((sum, amount) => sum.plus(amount ?? 0), new Decimal(0));
  const dirty = detail.lines.some(
    (line) => !sameEntry(entry(line.id), initial[line.id] ?? EMPTY_ENTRY),
  );

  // Navigate once the save has rendered, so the leave question no longer applies.
  useEffect(() => {
    if (goTo !== null) void navigate(`/inventory/receipts/${goTo}`);
  }, [goTo, navigate]);

  const change = (lineId: number, patch: Partial<CostEntry>) =>
    setEntries((previous) => ({ ...previous, [lineId]: { ...entry(lineId), ...patch } }));

  /** The next receipt waiting for its costs, down the list and back to its top. */
  const nextPending = () => {
    const rows = (pendingReceipts.data ?? []).filter(
      (row) => row.id !== detail.id && canWrite(row.warehouseId),
    );
    return (rows.find((row) => row.id < detail.id) ?? rows[0])?.id ?? null;
  };

  const save = (andNext: boolean) =>
    void action.run(async () => {
      await mutations.costReceipt.mutateAsync({
        id: detail.id,
        key,
        body: {
          costingVersion: detail.costingVersion,
          lines: detail.lines.map((line) => {
            const value = entry(line.id);
            if (value.free) return { lineId: line.id, freeGoods: true };
            const typed = parseMoney(value.value) ?? value.value.trim();
            return value.source === 'amount'
              ? { lineId: line.id, amount: typed }
              : { lineId: line.id, unitPrice: typed };
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

  return {
    entry,
    change,
    complete,
    dirty,
    saved,
    total,
    save,
    pending: mutations.costReceipt.isPending,
    problem: action.problem,
  };
}

export type PostedCosts = ReturnType<typeof usePostedCosts>;
