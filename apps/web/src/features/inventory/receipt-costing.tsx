import { Decimal } from '@tugeel/shared/money';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { TableCell } from '@/components/ui/table';
import { formatMnt, formatTugrik } from '@/lib/money';
import type { ReceiptDetail } from './api';
import { type CostEntry, entryAmount, parseMoney } from './helpers';
import type { PriceColumn } from './receipt-prices';

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
 * The receipt's totals for cost holders, as the server computed them (with the discount and the
 * payable when the note has a discount, ADR-0099 #4).
 */
export function ReceiptTotals({ detail }: { detail: ReceiptDetail }) {
  const { t } = useTranslation();
  const totals = detail.totals;
  if (!totals || detail.lines.length === 0) return null;
  const discounted = new Decimal(totals.discountTotal).gt(0);
  const rows: [string, string][] = [
    [t('inventory.receipt.form.docTotal'), totals.docTotal],
    ...(discounted
      ? ([
          [t('inventory.receipt.form.discountTotal'), `-${totals.discountTotal}`],
          [t('inventory.receipt.form.netTotal'), totals.netTotal],
        ] as [string, string][])
      : []),
    ...(new Decimal(totals.vatTotal).gt(0)
      ? [[t('inventory.receipt.form.vatTotal'), totals.vatTotal] as [string, string]]
      : []),
    [t('inventory.receipt.form.costTotal'), totals.costTotal],
  ];
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
      <p className="max-w-xl text-[0.8125rem] text-muted-foreground">
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
