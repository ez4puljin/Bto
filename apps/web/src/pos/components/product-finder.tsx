import type { EdgeProductHit, EdgeProductUnitHit } from '@tugeel/shared/pos';
import { cn } from 'cn';
import { ScanBarcode } from 'lucide-react';
import { type KeyboardEvent, type RefObject, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatTugrik } from '@/lib/money';
import { useDebounced } from '@/lib/use-debounced';
import { useProblemText } from '../messages';
import { useProductSearch } from '../queries';

interface Option {
  key: string;
  product: EdgeProductHit;
  unit: EdgeProductUnitHit;
}

/** One row per product, in its base unit: a box is scanned, never chosen here (owner 2026-11-05). */
function optionsOf(hits: readonly EdgeProductHit[]): Option[] {
  return hits.flatMap((product) =>
    product.units
      .filter((unit) => unit.isBase)
      .map((unit) => ({ key: `${product.productId}:${unit.unitId}`, product, unit })),
  );
}

/**
 * The till's one search (owner 2026-11-04: «2 хайлтыг нэгтгэж нэг болго»): a scanned or typed
 * barcode adds its product on Enter; a name or a code shows the products found under the field,
 * ↑/↓ choose, Enter or a click adds one with quantity 1, Esc clears. A unit without a price cannot
 * be added. With nothing typed, ↑/↓ and the quantity keys still work the cart (`onCartKey`).
 */
export function ProductFinder(props: {
  inputRef: RefObject<HTMLInputElement | null>;
  value: string;
  onChange: (value: string) => void;
  /** Enter on a barcode, a product code or a voucher code: the cart decides what it is. */
  onScan: (text: string) => void;
  onPick: (product: EdgeProductHit, unitId: number) => void;
  /** True when the text is a code to look up as it is, not a name to search. */
  isCode: (text: string) => boolean;
  /** The cart's own keys while nothing is typed; true when it took the key. */
  onCartKey: (event: KeyboardEvent<HTMLInputElement>, empty: boolean) => boolean;
  /** Keys typed in another keyboard layout become digits (the scan box's rule). */
  onTypeKey: (event: KeyboardEvent<HTMLInputElement>) => void;
}) {
  const { t } = useTranslation();
  const problemText = useProblemText();
  const listId = useId();
  const list = useRef<HTMLUListElement>(null);
  const [active, setActive] = useState(-1);
  const text = props.value.trim();
  const q = useDebounced(text, 200);
  const searching = q.length >= 2 && q === text;
  const search = useProductSearch(searching ? q : '');
  const options = searching ? optionsOf(search.data ?? []) : [];
  const open = options.length > 0 || (searching && search.isError);
  const index = Math.min(active, options.length - 1);
  useEffect(() => setActive(-1), [q]);
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [index]);

  const clear = () => {
    props.onChange('');
    setActive(-1);
  };
  const pick = (option: Option | undefined) => {
    if (!option || option.unit.price === null) return;
    props.onPick(option.product, option.unit.unitId);
    clear();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (open && event.key === 'ArrowDown') {
      event.preventDefault();
      setActive(Math.min(index + 1, options.length - 1));
      return;
    }
    if (open && event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(Math.max(index - 1, -1));
      return;
    }
    if (event.key === 'Escape' && props.value !== '') {
      event.preventDefault();
      clear();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (text === '') return;
      // A chosen row wins; a code goes to the cart as it is; a name takes the first product.
      if (index >= 0) pick(options[index]);
      else if (props.isCode(text) || options.length === 0) {
        clear();
        props.onScan(text);
      } else pick(options.find((option) => option.unit.price !== null));
      return;
    }
    if (props.onCartKey(event, props.value === '')) return;
    props.onTypeKey(event);
  };

  return (
    <div className="relative w-full">
      <ScanBarcode
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground"
      />
      <input
        ref={props.inputRef}
        autoFocus
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={index >= 0 && options[index] ? `${listId}-${index}` : undefined}
        aria-label={t('posKiosk.sale.scanLabel')}
        placeholder={t('posKiosk.sale.findPlaceholder')}
        autoComplete="off"
        spellCheck={false}
        className="h-11 w-full rounded-lg border border-input bg-background pr-3 pl-10 font-mono text-base shadow-control outline-none placeholder:font-sans placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring"
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => setActive(-1)}
      />
      {open ? (
        <div className="absolute inset-x-0 top-full z-50 mt-1 rounded-xl bg-popover p-1 shadow-dialog ring-1 ring-black/[0.08]">
          {search.isError ? (
            <p className="px-3 py-2 text-sm text-destructive">{problemText(search.error)}</p>
          ) : null}
          <ul
            ref={list}
            id={listId}
            role="listbox"
            aria-label={t('posKiosk.search.results')}
            className="max-h-[min(24rem,55svh)] space-y-0.5 overflow-y-auto [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin]"
          >
            {options.map((option, position) => {
              const priced = option.unit.price !== null;
              return (
                <li
                  key={option.key}
                  id={`${listId}-${position}`}
                  role="option"
                  aria-selected={position === index}
                  aria-disabled={!priced}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActive(position)}
                  onClick={() => pick(option)}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2',
                    position === index ? 'bg-secondary' : 'hover:bg-accent',
                    priced ? null : 'cursor-not-allowed opacity-70',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[0.9375rem] font-medium">{option.product.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {option.product.sku} · {option.unit.uomName}
                      {option.unit.barcodes?.[0] ? ` · ${option.unit.barcodes[0]}` : null}
                    </p>
                  </div>
                  <span
                    className={cn(
                      'shrink-0 font-mono text-[0.9375rem] font-semibold',
                      priced ? null : 'font-sans text-warning',
                    )}
                  >
                    {priced ? formatTugrik(option.unit.price ?? '0') : t('posKiosk.sale.unpriced')}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
