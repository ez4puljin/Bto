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
 * The basket as Erxes shows it: name, quantity with − / +, unit price and line total. Below 1280px
 * the unit price moves under the name, so the name keeps room on a 1024px till screen.
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
    <div className="min-h-0 flex-1 overflow-auto rounded-xl bg-card shadow-card ring-1 ring-black/[0.06] [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin]">
      <table className="w-full text-[15px]" aria-label={t('posKiosk.sale.cart')}>
        <thead className="sticky top-0 z-10 bg-card">
          <tr className="border-b border-border text-left text-xs font-medium text-muted-foreground">
            <th scope="col" className="h-10 w-12 pl-4 font-medium">
              {t('posKiosk.sale.columns.no')}
            </th>
            <th scope="col" className="h-10 px-3 font-medium">
              {t('posKiosk.sale.columns.name')}
            </th>
            <th scope="col" className="h-10 w-48 px-3 text-center font-medium">
              {t('posKiosk.sale.columns.qty')}
            </th>
            <th scope="col" className="hidden h-10 w-32 px-3 text-right font-medium xl:table-cell">
              {t('posKiosk.sale.columns.price')}
            </th>
            <th scope="col" className="h-10 w-32 px-3 text-right font-medium">
              {t('posKiosk.sale.columns.total')}
            </th>
            <th scope="col" className="h-10 w-14 pr-4">
              <span className="sr-only">{t('common.actions')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {props.lines.map((line, index) => (
            <CartRow
              key={line.productUnitId}
              onSelect={props.onSelect}
              onStep={props.onStep}
              onSetQty={props.onSetQty}
              onRemove={props.onRemove}
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
  );
}

function CartRow(
  props: Omit<CartTableProps, 'lines' | 'quoted' | 'selected'> & {
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
  const label = `${line.name} (${line.uomName})`;
  // An answer for another quantity (the cart changed since) shows dimmed until the next one.
  const current = quoted !== undefined && new Decimal(quoted.qty).eq(line.qty);
  const discount = quoted?.discount && new Decimal(quoted.discount).gt(0) ? quoted.discount : null;

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
      <td className="h-14 pl-4 font-mono text-muted-foreground">{props.index + 1}</td>
      <td className="max-w-0 px-3 py-2">
        <p className="line-clamp-2 font-medium break-words" title={line.name}>
          {line.name}
        </p>
        <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[13px] text-muted-foreground">
          <span className="shrink-0 rounded-full bg-fill px-2 font-medium text-foreground">
            {line.uomName}
          </span>
          <span className="truncate">{line.sku}</span>
          {quoted?.priced && quoted.unitPrice !== null ? (
            <span className="font-mono xl:hidden">
              {' · '}
              {formatTugrik(quoted.unitPrice)}
            </span>
          ) : null}
        </p>
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center justify-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon-lg"
            className="size-11"
            aria-label={t('posKiosk.sale.decrease', { name: label })}
            title={t('posKiosk.sale.decrease', { name: label })}
            disabled={!canDecrease(line.qty)}
            onMouseDown={keepFocus}
            onClick={(event) => {
              event.stopPropagation();
              props.onSelect(line.productUnitId);
              props.onStep(line.productUnitId, -1);
            }}
          >
            <Minus />
          </Button>
          <input
            aria-label={t('posKiosk.sale.qtyFor', { name: label })}
            inputMode="decimal"
            autoComplete="off"
            className="h-11 w-20 rounded-lg border border-input bg-background px-2 text-center font-mono text-base font-semibold shadow-control outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring"
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
          <Button
            type="button"
            variant="outline"
            size="icon-lg"
            className="size-11"
            aria-label={t('posKiosk.sale.increase', { name: label })}
            title={t('posKiosk.sale.increase', { name: label })}
            onMouseDown={keepFocus}
            onClick={(event) => {
              event.stopPropagation();
              props.onSelect(line.productUnitId);
              props.onStep(line.productUnitId, 1);
            }}
          >
            <Plus />
          </Button>
        </div>
      </td>
      <td
        className={cn(
          'hidden px-3 py-2 text-right font-mono whitespace-nowrap xl:table-cell',
          current ? null : 'text-muted-foreground',
        )}
      >
        {quoted === undefined ? (
          <span aria-hidden>{'…'}</span>
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
          'px-3 py-2 text-right font-mono font-semibold whitespace-nowrap',
          current ? null : 'text-muted-foreground',
        )}
      >
        {quoted === undefined ? (
          <span aria-hidden>{'…'}</span>
        ) : quoted.priced && quoted.total !== null ? (
          <>
            {formatTugrik(quoted.total)}
            {discount ? (
              <span className="block text-xs font-medium text-success">
                {t('posKiosk.sale.lineDiscount', { amount: formatMnt(discount) })}
              </span>
            ) : null}
          </>
        ) : (
          <span className="font-sans text-warning">{t('posKiosk.sale.unpriced')}</span>
        )}
      </td>
      <td className="pr-4 text-right">
        <Button
          type="button"
          variant="ghost"
          size="icon-lg"
          className="size-11 text-muted-foreground hover:text-destructive"
          aria-label={t('posKiosk.sale.remove', { name: label })}
          title={t('posKiosk.sale.remove', { name: label })}
          onMouseDown={keepFocus}
          onClick={(event) => {
            event.stopPropagation();
            props.onRemove(line.productUnitId);
          }}
        >
          <Trash2 />
        </Button>
      </td>
    </tr>
  );
}
