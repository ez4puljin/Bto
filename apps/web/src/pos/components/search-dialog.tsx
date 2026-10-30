import type { EdgeProductHit, EdgeProductUnitHit } from '@tugeel/shared/pos';
import { cn } from 'cn';
import { Search } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { formatQty, formatTugrik } from '@/lib/money';
import { useDebounced } from '@/lib/use-debounced';
import { useProblemText } from '../messages';
import { useProductSearch } from '../queries';
import { KioskAlert } from './layout';

interface Option {
  key: string;
  product: EdgeProductHit;
  unit: EdgeProductUnitHit;
}

function optionsOf(hits: readonly EdgeProductHit[]): Option[] {
  return hits.flatMap((product) =>
    product.units.map((unit) => ({ key: `${product.productId}:${unit.unitId}`, product, unit })),
  );
}

/**
 * «Бараа хайх (F6)»: type a name, a code or a barcode; ↑/↓ move through the units found, Enter
 * adds the highlighted one with quantity 1, Esc closes. A unit without a price cannot be added.
 */
export function SearchDialog(props: {
  open: boolean;
  onClose: () => void;
  onPick: (product: EdgeProductHit, unitId: number) => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={props.open} onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent size="lg" className="gap-3" onCloseAutoFocus={props.onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>{t('posKiosk.search.title')}</DialogTitle>
          <DialogDescription>{t('posKiosk.search.hint')}</DialogDescription>
        </DialogHeader>
        {props.open ? <SearchPanel onPick={props.onPick} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function SearchPanel({ onPick }: { onPick: (product: EdgeProductHit, unitId: number) => void }) {
  const { t } = useTranslation();
  const problemText = useProblemText();
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const q = useDebounced(text.trim(), 250);
  const search = useProductSearch(q);
  const options = q.length > 0 ? optionsOf(search.data ?? []) : [];
  const index = Math.min(active, options.length - 1);
  const listId = useId();
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [index]);

  const pick = (option: Option | undefined) => {
    if (option && option.unit.price !== null) onPick(option.product, option.unit.unitId);
  };

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          autoFocus
          role="combobox"
          aria-expanded={options.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={options[index] ? `${listId}-${index}` : undefined}
          aria-label={t('posKiosk.search.label')}
          placeholder={t('posKiosk.search.placeholder')}
          autoComplete="off"
          spellCheck={false}
          className="h-12 pl-10 text-lg md:text-lg"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActive(Math.min(index + 1, options.length - 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActive(Math.max(index - 1, 0));
            } else if (event.key === 'Enter') {
              event.preventDefault();
              pick(options[index]);
            }
          }}
        />
      </div>
      {search.isError ? <KioskAlert>{problemText(search.error)}</KioskAlert> : null}
      <ul
        ref={list}
        id={listId}
        role="listbox"
        aria-label={t('posKiosk.search.results')}
        className="max-h-[min(26rem,55svh)] min-h-24 space-y-1 overflow-y-auto [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin]"
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
                'flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5',
                position === index ? 'bg-secondary' : 'hover:bg-accent',
                priced ? null : 'cursor-not-allowed opacity-70',
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[0.9375rem] font-medium">{option.product.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {option.product.sku} ·{' '}
                  {option.unit.isBase
                    ? option.unit.uomName
                    : t('posKiosk.search.unitFactor', {
                        uom: option.unit.uomName,
                        factor: formatQty(option.unit.factor),
                      })}
                  {option.unit.barcodes?.[0] ? ` · ${option.unit.barcodes[0]}` : null}
                </p>
              </div>
              <span
                className={cn(
                  'shrink-0 font-mono text-[0.9375rem] font-semibold',
                  priced ? null : 'font-sans text-warning',
                )}
              >
                {option.unit.price !== null
                  ? formatTugrik(option.unit.price)
                  : t('posKiosk.sale.unpriced')}
              </span>
            </li>
          );
        })}
      </ul>
      {q.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('posKiosk.search.typeMore')}</p>
      ) : search.isFetching && options.length === 0 ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t('posKiosk.search.searching')}
        </p>
      ) : search.isSuccess && options.length === 0 ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t('posKiosk.search.empty')}
        </p>
      ) : null}
    </div>
  );
}
