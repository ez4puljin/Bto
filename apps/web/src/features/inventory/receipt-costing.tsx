import { Decimal } from '@tugeel/shared/money';
import { type RefObject, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { TableCell } from '@/components/ui/table';
import { formatMnt, formatTugrik } from '@/lib/money';
import type { ReceiptDetail, ReceiptLine, ReceiptLineUpdate } from './api';
import { type CostEntry, entryAmount, parseMoney } from './helpers';
import { EMPTY_ENTRY, entryOfLine, focusNextPrice, type PriceColumn } from './receipt-prices';

/**
 * The three price cells of a line: «Нэгж үнэ» and «Дүн» (the one typed last is the source, the
 * other shows what it comes to) and «Бонус». Read-only, they show the figures.
 */
export function PriceCells(props: {
  /** «Product (unit)», naming the fields of this line. */
  name: string;
  enteredQty: string;
  entry: CostEntry;
  editable: boolean;
  onChange?: (patch: Partial<CostEntry>) => void;
  onLeave?: (column: PriceColumn) => void;
  onEnter?: (column: PriceColumn, field: HTMLInputElement) => void;
  onFree?: (free: boolean) => void;
}) {
  const { t } = useTranslation();
  const { entry } = props;
  const amount = entryAmount(entry, props.enteredQty);
  const unitPrice =
    entry.source === 'unitPrice' && amount !== null
      ? new Decimal(parseMoney(entry.value) ?? 0)
      : amount === null || new Decimal(props.enteredQty).isZero()
        ? null
        : amount.dividedBy(props.enteredQty).toDecimalPlaces(2);
  const labels = {
    unitPrice: t('inventory.receipt.form.unitPrice'),
    amount: t('inventory.receipt.form.amount'),
  };
  const none = t('common.none');

  if (!props.editable) {
    return (
      <>
        <TableCell className="text-right font-mono">
          {entry.free || unitPrice === null ? none : formatMnt(unitPrice.toString())}
        </TableCell>
        <TableCell className="text-right font-mono">
          {amount === null ? none : formatMnt(amount.toString())}
        </TableCell>
        <TableCell>
          {entry.free ? (
            <Badge variant="secondary">{t('inventory.costing.freeGoods')}</Badge>
          ) : null}
        </TableCell>
      </>
    );
  }

  const field = (column: PriceColumn) => {
    const own = entry.source === column && !entry.free;
    const shown = column === 'amount' ? amount : unitPrice;
    return (
      <Input
        data-cost={column}
        aria-label={`${labels[column]}: ${props.name}`}
        inputMode="decimal"
        autoComplete="off"
        className="ml-auto w-28 text-right font-mono"
        disabled={entry.free}
        value={own ? entry.value : ''}
        placeholder={
          !own && shown !== null && !entry.free ? formatMnt(shown.toString()) : undefined
        }
        onChange={(event) => props.onChange?.({ source: column, value: event.target.value })}
        onBlur={() => props.onLeave?.(column)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          props.onEnter?.(column, event.currentTarget);
        }}
      />
    );
  };
  return (
    <>
      <TableCell className="text-right">{field('unitPrice')}</TableCell>
      <TableCell className="text-right">{field('amount')}</TableCell>
      <TableCell>
        <Switch
          aria-label={`${t('inventory.costing.freeGoods')}: ${props.name}`}
          checked={entry.free}
          onCheckedChange={(checked) => props.onFree?.(checked)}
        />
      </TableCell>
    </>
  );
}

/**
 * A draft line's prices, each field saved as it is left (a unit price makes the amount and follows
 * later quantity changes; an amount stays as typed; an emptied field clears the price). The fields
 * take the server's answer when the line's saved prices change, without losing the cursor.
 */
export function DraftPriceCells(props: {
  line: ReceiptLine;
  name: string;
  table: RefObject<HTMLTableElement | null>;
  onSave: (body: ReceiptLineUpdate) => void;
}) {
  const { line } = props;
  const saved = entryOfLine(line, false);
  const stamp = `${line.docUnitPrice ?? ''}|${line.docAmount ?? ''}|${String(line.freeGoods)}|${line.enteredQty}`;
  const [entry, setEntry] = useState(saved);
  const [shownStamp, setShownStamp] = useState(stamp);
  if (shownStamp !== stamp) {
    setShownStamp(stamp);
    setEntry(saved);
  }
  const leave = (column: PriceColumn) => {
    if (entry.free || entry.source !== column) return;
    const before = saved.source === column && !saved.free ? saved.value : '';
    if (entry.value.trim() === '') {
      if (before === '') setEntry(saved);
      else props.onSave(column === 'unitPrice' ? { docUnitPrice: null } : { docAmount: null });
      return;
    }
    const value = parseMoney(entry.value);
    if (value === null) {
      setEntry(saved);
      return;
    }
    if (before !== '' && new Decimal(value).equals(before)) return;
    props.onSave(column === 'unitPrice' ? { docUnitPrice: value } : { docAmount: value });
  };
  return (
    <PriceCells
      name={props.name}
      enteredQty={props.line.enteredQty}
      entry={entry}
      editable
      onChange={(patch) => setEntry((previous) => ({ ...previous, ...patch }))}
      onLeave={leave}
      onEnter={(column, field) => focusNextPrice(props.table, column, field)}
      onFree={(free) => {
        setEntry({ ...EMPTY_ENTRY, free });
        props.onSave({ freeGoods: free });
      }}
    />
  );
}

/** The receipt's totals for cost holders, as the server computed them. */
export function ReceiptTotals({ detail }: { detail: ReceiptDetail }) {
  const { t } = useTranslation();
  const totals = detail.totals;
  if (!totals || detail.lines.length === 0) return null;
  const rows: [string, string][] = [
    [t('inventory.receipt.form.docTotal'), totals.docTotal],
    ...(new Decimal(totals.vatTotal).gt(0)
      ? [[t('inventory.receipt.form.vatTotal'), totals.vatTotal] as [string, string]]
      : []),
    [t('inventory.receipt.form.costTotal'), totals.costTotal],
  ];
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
      <p className="max-w-xl text-[13px] text-muted-foreground">
        {detail.status === 'DRAFT'
          ? t('inventory.receipt.form.pricedHint', {
              priced: totals.pricedLines,
              count: detail.lines.length,
            })
          : null}
      </p>
      <dl
        aria-label={t('inventory.costing.total')}
        className="grid shrink-0 grid-cols-[auto_auto] gap-x-6 gap-y-1 text-sm"
      >
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="text-right font-mono font-medium">{formatTugrik(value)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
