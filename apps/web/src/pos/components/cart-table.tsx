import { Decimal } from '@tugeel/shared/money';
import type { EdgeQuotedLine } from '@tugeel/shared/pos';
import { cn } from 'cn';
import { Minus, Plus, ScanBarcode, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { formatMnt, formatQty, formatTugrik } from '@/lib/money';
import { useScanGuard } from '@/lib/scan/use-wedge-scanner';
import { parseQty } from '../amounts';
import { type CartLine, canDecrease } from '../cart';
import { keepFocus, typeDigits } from '../keys';

interface CartTableProps {
  lines: readonly CartLine[];
  /** The edge's latest prices by unit (possibly of the cart before the last change). */
  quoted: ReadonlyMap<number, EdgeQuotedLine>;
  selected: number | null;
  onSelect: (unitId: number) => void;
  onStep: (unitId: number, delta: 1 | -1) => void;
  onSetQty: (unitId: number, qty: string) => void;
  onRemove: (unitId: number) => void;
  /** A scan that lands in a quantity field. */
  onScan: (code: string) => void;
  /** Gives the focus back to the scan box after a quantity was typed. */
  onDone: () => void;
}

/**
 * The basket, one line per product so that as many as possible show (owner 2026-11-05): number,
 * code, name, quantity, unit price and line total. The − / + / remove buttons work the selected line from
 * the bar under the list; a line on the bulk price shows it against the supermarket price.
 */
export function CartTable(props: CartTableProps) {
  const { t } = useTranslation();
  if (props.lines.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl bg-card p-8 text-center shadow-card ring-1 ring-black/[0.06]">
        <ScanBarcode aria-hidden className="size-14 text-muted-foreground/60" />
        <p className="text-lg font-semibold">{t('posKiosk.sale.empty')}</p>
        <p className="text-sm text-muted-foreground">{t('posKiosk.sale.emptyHint')}</p>
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl bg-card shadow-card ring-1 ring-black/[0.06]">
      <div className="min-h-0 flex-1 overflow-auto [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin]">
        <table className="w-full table-fixed text-sm" aria-label={t('posKiosk.sale.cart')}>
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="border-b border-border text-left text-xs font-medium text-muted-foreground">
              <th scope="col" className="h-8 w-10 pl-3 font-medium">
                {t('posKiosk.sale.columns.no')}
              </th>
              <th scope="col" className="h-8 w-[4.5rem] px-2 font-medium">
                {t('posKiosk.sale.columns.code')}
              </th>
              <th scope="col" className="h-8 px-2 font-medium">
                {t('posKiosk.sale.columns.name')}
              </th>
              <th scope="col" className="h-8 w-20 px-2 text-center font-medium xl:w-[14%]">
                {t('posKiosk.sale.columns.qty')}
              </th>
              <th scope="col" className="h-8 w-34 px-2 text-right font-medium xl:w-[20%]">
                {t('posKiosk.sale.columns.price')}
              </th>
              <th scope="col" className="h-8 w-28 pr-3 pl-2 text-right font-medium xl:w-[18%]">
                {t('posKiosk.sale.columns.total')}
              </th>
            </tr>
          </thead>
          <tbody>
            {props.lines.map((line, index) => (
              <CartRow
                key={line.productUnitId}
                onSelect={props.onSelect}
                onSetQty={props.onSetQty}
                onScan={props.onScan}
                onDone={props.onDone}
                index={index}
                line={line}
                quoted={props.quoted.get(line.productUnitId)}
                selected={props.selected === line.productUnitId}
              />
            ))}
          </tbody>
        </table>
      </div>
      <LineActions
        line={props.lines.find((line) => line.productUnitId === props.selected)}
        onStep={props.onStep}
        onRemove={props.onRemove}
      />
    </div>
  );
}

/** The selected line's buttons, 44px as every button a cashier presses (ADR-0113). */
function LineActions(props: {
  line: CartLine | undefined;
  onStep: (unitId: number, delta: 1 | -1) => void;
  onRemove: (unitId: number) => void;
}) {
  const { t } = useTranslation();
  const { line } = props;
  const label = line ? labelOf(line) : '';
  return (
    <div
      role="group"
      aria-label={t('posKiosk.sale.lineActions')}
      className="flex shrink-0 items-center gap-2 border-t border-border px-3 py-1.5"
    >
      <p className="min-w-0 flex-1 truncate text-sm font-medium" title={line?.name}>
        {line ? (
          `${line.name} · ${line.sku}`
        ) : (
          <span className="text-muted-foreground">{t('posKiosk.sale.noLineSelected')}</span>
        )}
      </p>
      <Button
        type="button"
        variant="outline"
        size="icon-lg"
        className="size-11"
        aria-label={t('posKiosk.sale.decrease', { name: label })}
        title={t('posKiosk.sale.decrease', { name: label })}
        disabled={!line || !canDecrease(line.qty)}
        onMouseDown={keepFocus}
        onClick={() => line && props.onStep(line.productUnitId, -1)}
      >
        <Minus />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon-lg"
        className="size-11"
        aria-label={t('posKiosk.sale.increase', { name: label })}
        title={t('posKiosk.sale.increase', { name: label })}
        disabled={!line}
        onMouseDown={keepFocus}
        onClick={() => line && props.onStep(line.productUnitId, 1)}
      >
        <Plus />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-lg"
        className="size-11 text-muted-foreground hover:text-destructive"
        aria-label={t('posKiosk.sale.remove', { name: label })}
        title={t('posKiosk.sale.remove', { name: label })}
        disabled={!line}
        onMouseDown={keepFocus}
        onClick={() => line && props.onRemove(line.productUnitId)}
      >
        <Trash2 />
      </Button>
    </div>
  );
}

function labelOf(line: CartLine): string {
  return `${line.name} (${line.uomName})`;
}

function CartRow(
  props: Pick<CartTableProps, 'onSelect' | 'onSetQty' | 'onScan' | 'onDone'> & {
    index: number;
    line: CartLine;
    quoted: EdgeQuotedLine | undefined;
    selected: boolean;
  },
) {
  const { t } = useTranslation();
  const { line, quoted } = props;
  const [draft, setDraft] = useState<string | null>(null);
  const row = useRef<HTMLTableRowElement>(null);
  const guard = useScanGuard(props.onScan);
  const label = labelOf(line);
  // An answer for another quantity (the cart changed since) shows dimmed until the next one.
  const current = quoted !== undefined && new Decimal(quoted.qty).eq(line.qty);
  const discount = quoted?.discount && new Decimal(quoted.discount).gt(0) ? quoted.discount : null;
  const bulk = quoted?.priced ? (quoted.bulk ?? null) : null;

  useEffect(() => {
    if (props.selected) row.current?.scrollIntoView?.({ block: 'nearest' });
  }, [props.selected]);

  const commit = () => {
    if (draft === null) return;
    const qty = parseQty(draft);
    if (qty !== null && qty !== line.qty) props.onSetQty(line.productUnitId, qty);
    setDraft(null);
  };

  return (
    <tr
      ref={row}
      aria-selected={props.selected}
      data-state={props.selected ? 'selected' : undefined}
      onClick={() => props.onSelect(line.productUnitId)}
      className={cn(
        'border-b border-border/80 transition-colors last:border-0',
        props.selected
          ? 'bg-secondary shadow-[inset_4px_0_0_var(--primary)]'
          : 'hover:bg-accent/70',
        quoted && !quoted.priced ? 'bg-warning-soft' : null,
      )}
    >
      <td className="h-9 pl-3 font-mono text-xs text-muted-foreground">{props.index + 1}</td>
      <td className="truncate px-2 font-mono text-xs text-muted-foreground" title={line.sku}>
        {line.sku}
      </td>
      <td className="px-2">
        <div className="flex min-w-0 items-center gap-1.5" title={line.name}>
          <span className="min-w-0 truncate font-medium">{line.name}</span>
          <span className="shrink-0 rounded-full bg-fill px-1.5 text-xs font-medium">
            {line.uomName}
          </span>
        </div>
      </td>
      <td className="px-2">
        <input
          aria-label={t('posKiosk.sale.qtyFor', { name: label })}
          inputMode="decimal"
          autoComplete="off"
          className="mx-auto block h-7 w-full max-w-20 rounded-md border border-input bg-background px-1 text-center font-mono text-sm font-semibold outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring"
          value={draft ?? formatQty(line.qty)}
          onFocus={(event) => {
            setDraft(line.qty);
            props.onSelect(line.productUnitId);
            event.currentTarget.select();
          }}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            const value = draft ?? line.qty;
            guard(event, value, (restored) => setDraft(restored));
            if (event.defaultPrevented) return;
            if (event.key === 'Enter') {
              event.preventDefault();
              commit();
              props.onDone();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              setDraft(null);
              props.onDone();
            } else {
              typeDigits(event, value, setDraft);
            }
          }}
        />
      </td>
      <td
        className={cn(
          'px-2 text-right font-mono whitespace-nowrap',
          current ? null : 'text-muted-foreground',
        )}
      >
        {quoted === undefined ? (
          <span aria-hidden>{'…'}</span>
        ) : bulk ? (
          <>
            <span className="block text-[0.6875rem] leading-3.5 text-muted-foreground">
              <span className="font-sans">{t('posKiosk.sale.priceRetail')}</span>{' '}
              <s>{formatTugrik(bulk.retailPrice)}</s>
            </span>
            <span className="block text-[0.8125rem] leading-4 font-semibold text-success">
              <span className="font-sans">{t('posKiosk.sale.priceBulk')}</span>{' '}
              {formatTugrik(bulk.bulkPrice)}
            </span>
          </>
        ) : quoted.priced && quoted.unitPrice !== null ? (
          formatTugrik(quoted.unitPrice)
        ) : (
          <span className="font-sans font-semibold text-warning">
            {t('posKiosk.sale.unpriced')}
          </span>
        )}
      </td>
      <td
        className={cn(
          'pr-3 pl-2 text-right font-mono font-semibold whitespace-nowrap',
          current ? null : 'text-muted-foreground',
        )}
      >
        {quoted === undefined ? (
          <span aria-hidden>{'…'}</span>
        ) : quoted.priced && quoted.total !== null ? (
          <>
            {formatTugrik(quoted.total)}
            {discount ? (
              <span className="block text-[0.6875rem] leading-3.5 font-medium text-success">
                {t('posKiosk.sale.lineDiscount', { amount: formatMnt(discount) })}
              </span>
            ) : null}
          </>
        ) : (
          <span className="font-sans text-warning">{t('posKiosk.sale.unpriced')}</span>
        )}
      </td>
    </tr>
  );
}
