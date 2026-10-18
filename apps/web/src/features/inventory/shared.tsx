import { Popover } from 'radix-ui';
import { type ReactNode, useDeferredValue, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NativeSelect } from '@/components/native-select';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { type ProductSummary, useProducts } from '@/features/catalog/api';
import type { Warehouse } from '@/features/identity/api';
import { useScanGuard } from '@/lib/scan/use-wedge-scanner';
import { cn } from '@/lib/utils';
import { isQty, parseScanQty } from './helpers';
import type { ScanQty } from './scan-qty';

type DocStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'REQUESTED'
  | 'SHIPPED'
  | 'POSTED'
  | 'RECEIVED'
  | 'COUNTING'
  | 'REVIEW'
  | 'APPROVED'
  | 'CANCELLED';

export function WarehouseSelect(props: {
  /** Set when a visible label names the select (`FormField htmlFor`). */
  id?: string;
  options: readonly Warehouse[];
  value: number | undefined;
  onChange: (id: number | undefined) => void;
  /** The empty choice: "all warehouses" in filters, "pick one" in forms. */
  emptyLabel: string;
  label?: string;
  className?: string;
  /** `filter`: a pill in a list's filter bar (ADR-0042). */
  variant?: 'default' | 'filter';
}) {
  const { t } = useTranslation();
  return (
    <NativeSelect
      id={props.id}
      aria-label={props.id ? undefined : (props.label ?? t('inventory.warehouse'))}
      className={props.className}
      variant={props.variant}
      value={props.value ?? ''}
      onChange={(event) =>
        props.onChange(event.target.value ? Number.parseInt(event.target.value, 10) : undefined)
      }
    >
      <option value="">{props.emptyLabel}</option>
      {props.options.map((warehouse) => (
        <option key={warehouse.id} value={warehouse.id}>
          {warehouse.kind === 'TRANSIT' ? t('org.kinds.TRANSIT') : warehouse.name}
        </option>
      ))}
    </NativeSelect>
  );
}

export function DocStatusBadge({ status }: { status: DocStatus }) {
  const { t } = useTranslation();
  const variant =
    status === 'POSTED' || status === 'RECEIVED' || status === 'APPROVED'
      ? 'success'
      : status === 'SUBMITTED' ||
          status === 'REQUESTED' ||
          status === 'SHIPPED' ||
          status === 'COUNTING' ||
          status === 'REVIEW'
        ? 'default'
        : status === 'DRAFT'
          ? 'secondary'
          : 'outline';
  return <Badge variant={variant}>{t(`inventory.docStatus.${status}`)}</Badge>;
}

/**
 * Search active products by name, SKU or barcode and pick one (documents without a scanner). The
 * matches open under the box without moving the page (ADR-0066): ↑/↓ choose one, Enter adds the
 * chosen one (the first unless moved), Escape clears; a click adds too. With `onScan`, a scan that
 * lands in the box goes to the page's scanner instead (the scanned unit, not the base unit) and the
 * typed text comes back.
 */
export function ProductSearch({
  id,
  onPick,
  pickLabel,
  autoFocus,
  onScan,
  className,
  variant = 'default',
}: {
  /** Set when a visible label names the search box. */
  id?: string;
  onPick: (product: ProductSummary) => void;
  /** The button of each found product; default «Нэмэх». */
  pickLabel?: string;
  /** Puts the cursor in the box when it appears (opened with «Бараа нэмэх»). */
  autoFocus?: boolean;
  /** A scan screen's scanner: barcodes that land in the box go there. */
  onScan?: (code: string) => void;
  /** Widths of the box's wrapper; `max-w-sm` unless given. */
  className?: string;
  /** `filter`: a pill in a list's filter bar, like `SearchField`. */
  variant?: 'default' | 'filter';
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState({ q: '', index: 0 });
  const anchor = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const typed = search.trim();
  const q = useDeferredValue(typed);
  const products = useProducts({ q, status: 'ACTIVE' });
  // Nothing from an older search once the box is cleared (a pick, Escape).
  const rows = typed && q ? (products.data?.pages[0]?.data ?? []).slice(0, 8) : [];
  const index = highlight.q === q && highlight.index < rows.length ? highlight.index : 0;
  const label = pickLabel ?? t('inventory.add');
  const guard = useScanGuard((code) => onScan?.(code), { letters: true });
  const nothing = typed !== '' && q === typed && !products.isPending && rows.length === 0;
  const shown = open && (rows.length > 0 || nothing);
  const optionId = (position: number) => `${listId}-${position}`;

  const pick = (product: ProductSummary) => {
    onPick(product);
    setSearch('');
    setOpen(false);
    input.current?.focus();
  };

  return (
    <Popover.Root open={shown} onOpenChange={(next) => (next ? undefined : setOpen(false))}>
      <Popover.Anchor asChild>
        <div ref={anchor} className={cn('w-full max-w-sm', className)}>
          <Input
            ref={input}
            id={id}
            type="search"
            autoFocus={autoFocus}
            autoComplete="off"
            aria-label={id ? undefined : t('inventory.productSearch')}
            aria-controls={shown ? listId : undefined}
            aria-activedescendant={shown && rows.length > 0 ? optionId(index) : undefined}
            placeholder={t('inventory.productSearchPlaceholder')}
            className={variant === 'filter' ? 'h-8 rounded-full pl-3 md:text-[13px]' : undefined}
            value={search}
            onFocus={() => setOpen(true)}
            onChange={(event) => {
              setSearch(event.target.value);
              setOpen(true);
            }}
            onKeyDown={(event) => {
              if (onScan) {
                guard(event, search, setSearch);
                if (event.defaultPrevented) return;
              }
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                if (rows.length === 0) return;
                event.preventDefault();
                setOpen(true);
                const step = event.key === 'ArrowDown' ? 1 : -1;
                setHighlight({ q, index: (index + step + rows.length) % rows.length });
              } else if (event.key === 'Enter') {
                // Never submits a form around the box; adds the chosen match.
                event.preventDefault();
                const chosen = rows[index];
                if (chosen) pick(chosen);
              } else if (event.key === 'Escape' && search !== '') {
                event.preventDefault();
                setSearch('');
              }
            }}
          />
        </div>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          // The cursor stays in the box; a click on it keeps the matches open.
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={(event) => {
            if (event.target instanceof Node && anchor.current?.contains(event.target)) {
              event.preventDefault();
            }
          }}
          onEscapeKeyDown={() => setSearch('')}
          className="z-50 w-(--radix-popover-trigger-width) max-w-[min(36rem,var(--radix-popover-content-available-width))] min-w-72 overflow-hidden rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-popover"
        >
          {rows.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">{t('inventory.noProducts')}</p>
          ) : (
            <ul id={listId} className="flex max-h-80 flex-col overflow-y-auto">
              {rows.map((product, position) => (
                <li key={product.id}>
                  <button
                    type="button"
                    id={optionId(position)}
                    data-active={position === index ? 'true' : undefined}
                    aria-label={`${label}: ${product.name}`}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent data-[active=true]:bg-accent"
                    onMouseEnter={() => setHighlight({ q, index: position })}
                    onClick={() => pick(product)}
                  >
                    <span className="shrink-0 font-mono text-[13px] text-muted-foreground">
                      {product.sku}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{product.name}</span>
                    <span className="shrink-0 text-[13px] font-medium text-link">{label}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * A line quantity: saved on Enter or when leaving the field. A scan that lands here goes to the
 * scan box instead (useScanGuard) and the quantity stays as it was.
 */
export function QtyInput(props: {
  label: string;
  value: string;
  onSave: (value: string) => void;
  onScan: (code: string) => void;
}) {
  const [draft, setDraft] = useState(props.value);
  const guard = useScanGuard(props.onScan, { letters: true });
  const save = () => {
    if (draft === props.value) return;
    if (isQty(draft)) props.onSave(draft);
    else setDraft(props.value);
  };
  return (
    <Input
      aria-label={props.label}
      inputMode="decimal"
      autoComplete="off"
      className="ml-auto w-24 text-right font-mono"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={save}
      onKeyDown={(event) => {
        guard(event, draft, setDraft);
        if (event.defaultPrevented || event.key !== 'Enter') return;
        event.preventDefault();
        save();
      }}
    />
  );
}

/** The «Тоо» field beside a scan box; a scan that lands here goes to `onScan` instead. */
export function ScanQtyField(props: { id: string; qty: ScanQty; onScan: (code: string) => void }) {
  const guard = useScanGuard(props.onScan, { letters: true });
  const invalid = parseScanQty(props.qty.value) === null;
  return (
    <Input
      id={props.id}
      inputMode="decimal"
      autoComplete="off"
      aria-invalid={invalid}
      className={cn('w-20 text-right font-mono', invalid && 'border-destructive')}
      value={props.qty.value}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => props.qty.set(event.target.value)}
      onKeyDown={(event) => guard(event, props.qty.value, props.qty.set)}
    />
  );
}

/** «Тоо» with its label, for a scan editor's toolbar; the hint under the toolbar says what it does. */
export function ScanQtyControl(props: {
  id: string;
  qty: ScanQty;
  onScan: (code: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex shrink-0 items-center gap-2 lg:h-9">
      <Label htmlFor={props.id}>{t('inventory.scanQty')}</Label>
      <ScanQtyField id={props.id} qty={props.qty} onScan={props.onScan} />
    </div>
  );
}

/**
 * A scan editor's toolbar (ADR-0066): the scan box, «Тоо» and the product search in one row on a
 * desktop (stacked on phones), and one status line under it — the active shelf and what the last
 * scan did — so the first line of the document stays near the top of the window.
 */
export function ScanToolbar(props: {
  scanBox: ReactNode;
  qty?: ReactNode;
  search?: ReactNode;
  status?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      {/* The scan box keeps room for its label and buttons; the search wraps below when tight. */}
      <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-start lg:gap-4">
        <div className="min-w-0 lg:min-w-[26rem] lg:flex-1">{props.scanBox}</div>
        {props.qty}
        {props.search ? (
          <div className="min-w-0 lg:w-64 xl:w-72 2xl:w-96">{props.search}</div>
        ) : null}
      </div>
      {props.status ? (
        <div className="flex min-h-5 flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          {props.status}
        </div>
      ) : null}
    </div>
  );
}
