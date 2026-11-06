import { markupPct } from '@tugeel/shared/inventory';
import { Decimal } from '@tugeel/shared/money';
import { Check, Pencil, Search } from 'lucide-react';
import { Popover } from 'radix-ui';
import {
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useApiClient } from '@/app/api-client-context';
import { useHasPermission } from '@/app/auth-context';
import {
  DENSE_FIELDS,
  ENTRY_CELL,
  ENTRY_ROW,
  ENTRY_SLOT,
  ENTRY_SLOT_CELL,
} from '@/components/document-layout';
import { MoneyInput } from '@/components/money-input';
import { NativeSelect } from '@/components/native-select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Kbd } from '@/components/ui/kbd';
import { Label } from '@/components/ui/label';
import { TableCell, TableRow } from '@/components/ui/table';
import { useBarcodeLookup, useProductLookup } from '@/features/catalog/api';
import { useCurrentPricesOf } from '@/features/pricing/api';
import { BINS_SOON } from '@/lib/features';
import { formatMnt, formatQty } from '@/lib/money';
import { problemFromError, unwrap } from '@/lib/problem';
import { scanBlocked, useScanGuard, useWedgeScanner } from '@/lib/scan/use-wedge-scanner';
import { useDebounced } from '@/lib/use-debounced';
import { cn } from '@/lib/utils';
import {
  type ReceiptLine,
  useLastReceiptPrices,
  useProductLocations,
  useProductStock,
} from './api';
import {
  type CostEntry,
  entryAmount,
  parseMoney,
  parseScanQty,
  useWarehouseName,
  useWarehouseOptions,
} from './helpers';
import { EMPTY_ENTRY, entryOfLine } from './receipt-prices';

const WHOLESALE = ['WHOLESALE'] as const;
/** A new line's price starts in «Нэгж үнэ» (the delivery note's price per unit). */
const START: CostEntry = { ...EMPTY_ENTRY, source: 'unitPrice' };
/** Matches shown under the search box (the owner found 8 too few, 2026-10-23). */
const LOOKUP_LIMIT = 20;
/**
 * The free goods' form, in a sheet: two rows on six tracks; the product, the location, the weight;
 * then the unit, the quantity and the save button.
 */
const LINE_GRID =
  'grid min-w-0 items-start gap-2 sm:grid-cols-[minmax(0,1.35fr)_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,0.85fr)_minmax(0,1fr)]';
/** What the product says, not a field to type in: its text alone, no box. */
const PLAIN_FIELD = 'border-transparent bg-transparent shadow-none';

/** A product as the panel holds it: its units to choose from (base first). */
export interface PanelProduct {
  id: number;
  sku: string;
  name: string;
  units: { id: number; uomName: string; factorToBase: string; isBase: boolean }[];
  /** Net weight of one base unit in kg; null when unknown. */
  weightKg: string | null;
}

/** What the panel hands over when a line is added or saved. */
export interface PanelLine {
  product: PanelProduct;
  productUnitId: number;
  enteredQty: string;
  /** The delivery note's price as typed (cost holders); null when the panel shows no prices. */
  price: CostEntry | null;
  /** Only for a product without a home warehouse: the one it is received into. */
  warehouseId?: number;
}

/** A line's own unit, for editing it: a line keeps its product and unit. */
function productOfLine(line: ReceiptLine): PanelProduct {
  return {
    id: line.productId,
    sku: line.productSku,
    name: line.productName,
    units: [
      {
        id: line.productUnitId,
        uomName: line.unitName,
        factorToBase: line.factorSnapshot,
        isBase: new Decimal(line.factorSnapshot).equals(1),
      },
    ],
    weightKg: line.weightKg,
  };
}

/**
 * The line entry of the receipt window (ADR-0099 #3, ADR-0153, ADR-0156), after Erkhet's one-line
 * editor: two rows inside the lines table's head, each field under its column. The product (name,
 * code or barcode; a scan anywhere on the page lands here), its location, its unit, the quantity and
 * the delivery note's price for cost holders; Enter moves to the next field and saves the line from
 * the last one, emptying the fields. The row under it is never empty, so nothing below moves: the
 * search's switch and the keys while idle, the product's stock, last receipt price, sale price,
 * markup and weight once chosen, what was refused. «Бараа засах» opens the product in a new tab, and
 * coming back reads its location and weight again. A product without a home warehouse asks for the
 * warehouse it goes into, which becomes its home. A line of the table opens here for editing (its
 * product and unit stay). With a supplier chosen the search shows that supplier's products, or all
 * products at a switch (ADR-0103). The `free` variant is a form of its own for free goods: a product,
 * its unit and the quantity, no prices and no scanner.
 */
export function ReceiptLinePanel(props: {
  editing: ReceiptLine | null;
  pending: boolean;
  /** The receipt's supplier: its products are searched first (ADR-0103). */
  supplierId?: number;
  /** Free goods (урамшуулал): no prices, no page-wide scanner. */
  free?: boolean;
  /** Shown beside the save button (the free goods' «Болих»). */
  onClose?: () => void;
  /** The save button is the window's blue one while there is no line to post yet. */
  primary?: boolean;
  /** A problem to show under the fields (a refused add). */
  problem?: ReactNode;
  /** The table has a column of ordered quantities: its cell stays empty here. */
  expected?: boolean;
  /** The search box, for the window to put the cursor in. */
  searchInput?: RefObject<HTMLInputElement | null>;
  onSubmit: (line: PanelLine) => Promise<boolean>;
  onCancelEdit: () => void;
}) {
  const { t } = useTranslation();
  const { editing } = props;
  const free = props.free === true;
  const canCost = useHasPermission('inventory.costs.manage') && !free;
  const api = useApiClient();
  const lookupBarcode = useBarcodeLookup();
  const warehouses = useWarehouseOptions(WHOLESALE);
  const warehouseName = useWarehouseName();
  const ids = useId();
  const cardRoot = useRef<HTMLDivElement>(null);
  const rowRoot = useRef<HTMLTableRowElement>(null);
  const ownSearch = useRef<HTMLInputElement>(null);
  const searchRef = props.searchInput ?? ownSearch;
  const listRef = useRef<HTMLUListElement>(null);
  const warehouseRef = useRef<HTMLSelectElement>(null);
  const unitRef = useRef<HTMLSelectElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);
  const priceRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);

  const [product, setProduct] = useState<PanelProduct | null>(null);
  const [unitId, setUnitId] = useState<number | null>(null);
  const [qty, setQty] = useState('1');
  const [entry, setEntry] = useState<CostEntry>(START);
  const [warehouseId, setWarehouseId] = useState<number | undefined>();
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [landed, setLanded] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [scope, setScope] = useState<'supplier' | 'all'>('supplier');
  const bySupplier = scope === 'supplier' && props.supplierId !== undefined;

  // A line chosen in the table takes the panel over; leaving the edit empties it.
  if ((editing?.id ?? null) !== editingId) {
    setEditingId(editing?.id ?? null);
    if (editing) {
      setProduct(productOfLine(editing));
      setUnitId(editing.productUnitId);
      setQty(new Decimal(editing.enteredQty).toString());
      setEntry(entryOfLine(editing, false));
      setWarehouseId(undefined);
      setSearch('');
      setMessage(null);
      setLanded(null);
    } else {
      setProduct(null);
      setUnitId(null);
      setQty('1');
      setEntry(START);
    }
  }
  const wasEditing = useRef(false);
  useEffect(() => {
    if (editing) {
      qtyRef.current?.focus();
      qtyRef.current?.select();
    }
    // The edit over, by «Хадгалах» or Esc: the cursor is back for the next product.
    else if (wasEditing.current) searchRef.current?.focus();
    wasEditing.current = editing !== null;
  }, [editing, searchRef]);

  const typed = search.trim();
  const q = useDebounced(typed, 200);
  const lookup = useProductLookup(
    q,
    LOOKUP_LIMIT,
    bySupplier ? props.supplierId : undefined,
    product === null,
  );
  // A supplier's products show as soon as the box has the cursor; a search once typed.
  // An answer kept from an earlier text (placeholder data) is not this text's: Enter waits.
  const settled = q === typed && (typed !== '' || bySupplier) && !lookup.isPlaceholderData;
  const matches = settled ? (lookup.data ?? []) : [];
  // The list keeps the last answer on screen, dimmed, until the next comes: it never blinks.
  const rows = typed !== '' || bySupplier ? (lookup.data ?? []) : [];
  const active = highlight < rows.length ? highlight : 0;
  const nothing = settled && typed !== '' && !lookup.isFetching && matches.length === 0;
  const loading = (typed !== '' || bySupplier) && rows.length === 0 && lookup.isFetching;
  // With a supplier the list always opens: its switch is how to reach the other products.
  const listOpen =
    open && (props.supplierId !== undefined || rows.length > 0 || nothing || loading);

  // The arrows keep the active row in sight, moving only the list (never the page).
  useLayoutEffect(() => {
    const box = listRef.current;
    const row = box?.children[active];
    if (!box || !(row instanceof HTMLElement)) return;
    if (row.offsetTop < box.scrollTop) box.scrollTop = row.offsetTop;
    else if (row.offsetTop + row.offsetHeight > box.scrollTop + box.clientHeight) {
      box.scrollTop = row.offsetTop + row.offsetHeight - box.clientHeight;
    }
  }, [active]);

  const productId = product?.id ?? 0;
  const locations = useProductLocations(productId, product !== null);
  const home = locations.data?.find((row) => row.isHome)?.warehouseId;
  const homeless = product !== null && locations.isSuccess && home === undefined && !editing;
  // A product without a home asks for its warehouse first, once its locations are in.
  useEffect(() => {
    if (homeless) warehouseRef.current?.focus();
  }, [homeless]);
  const homeRow = locations.data?.find((row) => row.isHome);
  const homeName = editing ? editing.warehouseName : home === undefined ? '' : warehouseName(home);
  const locationText =
    !BINS_SOON && homeRow?.defaultBinCode ? `${homeName} · ${homeRow.defaultBinCode}` : homeName;
  // Back from «Бараа засах»: what the product says now.
  const editedProduct = useRef(false);
  useEffect(() => {
    const back = () => {
      if (!editedProduct.current || productId === 0) return;
      editedProduct.current = false;
      void locations.refetch();
      void api
        .GET('/api/v1/products/{id}', { params: { path: { id: productId } } })
        .then(unwrap)
        .then((fresh) =>
          setProduct((before) =>
            before?.id === fresh.id
              ? { ...before, name: fresh.name, weightKg: fresh.weightKg }
              : before,
          ),
        )
        .catch(() => undefined);
    };
    window.addEventListener('focus', back);
    return () => window.removeEventListener('focus', back);
  }, [api, locations, productId]);
  const stock = useProductStock(productId, product !== null && home !== undefined);
  const onHand = stock.data?.warehouses.find((row) => row.warehouseId === home)?.onHand ?? null;
  const last = useLastReceiptPrices(product ? [product.id] : [], canCost && product !== null);
  const lastPrice = last.data?.[0] ?? null;
  const current = useCurrentPricesOf(product ? [product.id] : [], product !== null);
  const salePrice = current.data?.[0]?.warehousePrice ?? null;

  const unit = product?.units.find((candidate) => candidate.id === unitId) ?? null;
  const qtyValue = parseScanQty(qty);
  const amount = canCost && qtyValue ? entryAmount(entry, qtyValue) : null;
  const pieceCost =
    amount !== null && qtyValue && unit && !entry.free
      ? amount.dividedBy(new Decimal(qtyValue).times(unit.factorToBase))
      : null;
  const markup = pieceCost !== null && salePrice !== null ? markupPct(salePrice, pieceCost) : null;
  const totalWeight =
    product?.weightKg && qtyValue && unit
      ? formatQty(
          new Decimal(product.weightKg)
            .times(qtyValue)
            .times(unit.factorToBase)
            .toDecimalPlaces(3)
            .toString(),
        )
      : null;

  const chooseProduct = (next: PanelProduct, unitPick?: number) => {
    setProduct(next);
    setUnitId(unitPick ?? next.units.find((candidate) => candidate.isBase)?.id ?? null);
    setSearch('');
    setOpen(false);
    setMessage(null);
    setLanded(null);
    setWarehouseId(undefined);
    // The next field once the product's fields have rendered.
    window.setTimeout(() => {
      const target =
        next.units.length > 1 && unitPick === undefined ? unitRef.current : qtyRef.current;
      target?.focus();
      if (target instanceof HTMLInputElement) target.select();
    }, 0);
  };

  /** A scan: the product and unit of the code; the same code again counts one more. */
  const onScan = (code: string) => {
    if (editing) return;
    void (async () => {
      setMessage(null);
      try {
        const resolved = await lookupBarcode.mutateAsync(code);
        if (product?.id === resolved.product.id && unitId === resolved.unit.id) {
          setQty((before) => new Decimal(parseScanQty(before) ?? '0').plus(1).toString());
          return;
        }
        const base = resolved.product.baseUnit;
        // Every unit and the weight come from the lookup by code; the scanned unit is chosen.
        const listed = (
          await api
            .GET('/api/v1/products/lookup', {
              params: { query: { q: resolved.product.sku, limit: 5 } },
            })
            .then(unwrap)
            .catch(() => [])
        ).find((item) => item.id === resolved.product.id);
        const units = listed?.units ?? [
          { ...resolved.unit },
          ...(resolved.unit.isBase
            ? []
            : [{ id: base.id, uomName: base.uomName, factorToBase: '1', isBase: true }]),
        ];
        setQty('1');
        setEntry(START);
        chooseProduct(
          {
            id: resolved.product.id,
            sku: resolved.product.sku,
            name: resolved.product.name,
            units,
            weightKg: listed?.weightKg ?? null,
          },
          resolved.unit.id,
        );
      } catch (error) {
        if (problemFromError(error)?.code === 'NOT_FOUND') {
          setMessage(t('inventory.scanNotFound', { code }));
        } else {
          setMessage(problemFromError(error)?.detail ?? t('inventory.scanNotFound', { code }));
        }
      }
    })();
  };
  const scanRoot = free ? cardRoot : rowRoot;
  useWedgeScanner(onScan, !editing && !free, { letters: true, root: scanRoot });
  const guard = useScanGuard(onScan, { letters: true });

  // F2: back to the product, wherever the cursor is (a scanner's burst never sends it).
  const chosen = product !== null;
  useEffect(() => {
    if (free) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'F2' || scanBlocked(rowRoot.current)) return;
      event.preventDefault();
      (chosen ? qtyRef : searchRef).current?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [chosen, free, searchRef]);

  /** The fields Enter walks through, in order; the last one adds the line. */
  const chain = (): (HTMLElement | null)[] => [
    searchRef.current,
    homeless ? warehouseRef.current : null,
    product && product.units.length > 1 && !editing ? unitRef.current : null,
    qtyRef.current,
    canCost && !entry.free
      ? entry.source === 'amount' && entry.value.trim() !== ''
        ? amountRef.current
        : priceRef.current
      : null,
  ];
  const next = (from: HTMLElement) => {
    const fields = chain().filter((field): field is HTMLElement => field !== null);
    const at = fields.indexOf(from);
    const target = at >= 0 ? fields[at + 1] : undefined;
    if (target) {
      target.focus();
      if (target instanceof HTMLInputElement) target.select();
    } else {
      void submit();
    }
  };
  const onEnter = (event: KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => {
    if (event.key === 'Escape' && editing) {
      event.preventDefault();
      props.onCancelEdit();
      return;
    }
    if (event.key !== 'Enter') return;
    event.preventDefault();
    next(event.currentTarget);
  };

  const reset = () => {
    setProduct(null);
    setUnitId(null);
    setQty('1');
    setEntry(START);
    setWarehouseId(undefined);
    // The search box replaces the chosen product once this renders.
    window.setTimeout(() => searchRef.current?.focus(), 0);
  };

  const submit = async () => {
    setMessage(null);
    if (!product || unitId === null) {
      setMessage(t('inventory.receipt.panel.pickProduct'));
      searchRef.current?.focus();
      return;
    }
    if (qtyValue === null) {
      setMessage(t('inventory.scanQtyInvalid'));
      qtyRef.current?.focus();
      return;
    }
    if (canCost && !entry.free && entry.value.trim() !== '' && parseMoney(entry.value) === null) {
      setMessage(t('inventory.receipt.form.scanPriceInvalid'));
      return;
    }
    if (homeless && warehouseId === undefined) {
      setMessage(t('inventory.receipt.panel.pickHome'));
      warehouseRef.current?.focus();
      return;
    }
    const saved = await props.onSubmit({
      product,
      productUnitId: unitId,
      enteredQty: qtyValue,
      price: free ? { ...START, free: true } : canCost ? entry : null,
      ...(homeless && warehouseId !== undefined ? { warehouseId } : {}),
    });
    if (saved && !editing) {
      setLanded(product.name);
      reset();
    }
  };

  const none = t('common.none');
  const singleUnit = (product?.units.length ?? 0) < 2;

  const chooseScope = (value: 'supplier' | 'all') => {
    setScope(value);
    setHighlight(0);
  };
  const scopeSwitch =
    props.supplierId !== undefined && !product ? (
      <div
        role="radiogroup"
        aria-label={t('inventory.receipt.panel.scope')}
        className="inline-flex w-fit shrink-0 rounded-full bg-black/[0.05] p-0.5 text-xs"
      >
        {(['supplier', 'all'] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={scope === value}
            tabIndex={scope === value ? 0 : -1}
            className="h-6 rounded-full px-2.5 font-medium text-muted-foreground transition-[color,background-color,box-shadow] duration-200 ease-apple outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-checked:bg-background aria-checked:text-foreground aria-checked:shadow-control"
            onClick={() => {
              chooseScope(value);
              searchRef.current?.focus();
            }}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
              event.preventDefault();
              const other = event.currentTarget.nextElementSibling
                ? event.currentTarget.nextElementSibling
                : event.currentTarget.previousElementSibling;
              chooseScope(value === 'supplier' ? 'all' : 'supplier');
              if (other instanceof HTMLElement) other.focus();
            }}
          >
            {t(`inventory.receipt.panel.scopes.${value}`)}
          </button>
        ))}
      </div>
    ) : null;

  const productControl = product ? (
    <div className="flex h-8.5 min-w-0 items-center gap-2 rounded-lg border border-input bg-muted/40 px-2 text-sm">
      <span className="shrink-0 font-mono text-[0.8125rem] text-muted-foreground">
        {product.sku}
      </span>
      <span className="min-w-0 flex-1 truncate" title={product.name}>
        {product.name}
      </span>
      {editing ? null : (
        <Button
          size="xs"
          variant="ghost"
          aria-label={t('inventory.receipt.panel.changeProduct')}
          onClick={reset}
        >
          {t('inventory.receipt.panel.change')}
        </Button>
      )}
      {/* Keeps the chain's first stop while a product is chosen. */}
      <input
        ref={searchRef}
        id={`${ids}-product`}
        aria-label={t('inventory.productSearch')}
        className="sr-only"
        readOnly
        onKeyDown={onEnter}
      />
    </div>
  ) : (
    <Popover.Root open={listOpen}>
      <Popover.Anchor asChild>
        <div className="relative">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            ref={searchRef}
            id={`${ids}-product`}
            type="search"
            role="combobox"
            autoComplete="off"
            aria-label={t('inventory.product')}
            aria-expanded={listOpen}
            aria-autocomplete="list"
            aria-controls={listOpen && rows.length > 0 ? `${ids}-matches` : undefined}
            aria-activedescendant={
              listOpen && rows.length > 0 ? `${ids}-match-${active}` : undefined
            }
            aria-keyshortcuts="F2"
            className="pl-8!"
            placeholder={
              bySupplier
                ? t('inventory.receipt.panel.supplierSearch')
                : t('inventory.productSearchPlaceholder')
            }
            value={search}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onChange={(event) => {
              setSearch(event.target.value);
              setHighlight(0);
              setOpen(true);
            }}
            onKeyDown={(event) => {
              guard(event, search, setSearch);
              if (event.defaultPrevented) return;
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                if (rows.length === 0) return;
                event.preventDefault();
                const step = event.key === 'ArrowDown' ? 1 : -1;
                setHighlight((active + step + rows.length) % rows.length);
              } else if (event.key === 'Enter') {
                event.preventDefault();
                const match = matches[active];
                if (match) {
                  setQty('1');
                  setEntry(START);
                  chooseProduct(match);
                } else if (typed) {
                  // A code typed by hand: looked up as a barcode or product code.
                  onScan(typed);
                  setSearch('');
                }
              } else if (event.key === 'Escape') {
                setSearch('');
              } else if (event.key === 'F4' && props.supplierId !== undefined) {
                event.preventDefault();
                chooseScope(scope === 'supplier' ? 'all' : 'supplier');
              }
            }}
          />
        </div>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          className="z-50 w-(--radix-popover-trigger-width) max-w-[min(40rem,var(--radix-popover-content-available-width))] min-w-[min(32rem,var(--radix-popover-content-available-width))] overflow-hidden rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-popover"
        >
          {scopeSwitch ? (
            <div
              className="flex items-center justify-between gap-2 border-b border-border px-1 pt-0.5 pb-1.5"
              // A click here keeps the cursor in the box, so the list stays open.
              onMouseDown={(event) => event.preventDefault()}
            >
              {scopeSwitch}
              <span className="inline-flex items-center gap-1 text-xs whitespace-nowrap text-muted-foreground">
                <Kbd>{t('inventory.receipt.panel.keys.scope')}</Kbd>
                {t('inventory.receipt.panel.hints.scope')}
              </span>
            </div>
          ) : null}
          {rows.length === 0 ? (
            loading ? (
              <div aria-hidden className="flex flex-col gap-2 p-2">
                <div className="h-4 w-3/4 animate-pulse rounded bg-fill" />
                <div className="h-4 w-1/2 animate-pulse rounded bg-fill" />
                <div className="h-4 w-2/3 animate-pulse rounded bg-fill" />
              </div>
            ) : (
              <p className="px-3 py-2 text-sm text-muted-foreground">{t('inventory.noProducts')}</p>
            )
          ) : (
            <ul
              ref={listRef}
              id={`${ids}-matches`}
              role="listbox"
              aria-busy={settled ? undefined : true}
              className={cn(
                'relative flex max-h-96 flex-col overflow-y-auto transition-opacity duration-200',
                !settled && 'opacity-60',
              )}
            >
              {rows.map((match, position) => (
                <li
                  key={match.id}
                  id={`${ids}-match-${position}`}
                  role="option"
                  // Enter takes only this text's answer, so only that row reads as selected.
                  aria-selected={settled && position === active}
                  data-active={position === active ? 'true' : undefined}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm hover:bg-accent data-[active=true]:bg-accent"
                  onMouseEnter={() => setHighlight(position)}
                  // Before the box's blur closes the list.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    setQty('1');
                    setEntry(START);
                    chooseProduct(match);
                  }}
                >
                  <span className="shrink-0 font-mono text-[0.8125rem] text-muted-foreground">
                    {match.sku}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{match.name}</span>
                  <span className="shrink-0 text-[0.8125rem] text-muted-foreground">
                    {match.units.map((candidate) => candidate.uomName).join(' / ')}
                    {match.weightKg
                      ? ` · ${t('inventory.receipt.form.weight', { kg: formatQty(match.weightKg) })}`
                      : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );

  const locationControl = homeless ? (
    <NativeSelect
      ref={warehouseRef}
      id={`${ids}-home`}
      aria-label={t('inventory.receipt.panel.homeLabel')}
      className="min-w-0 flex-1"
      value={warehouseId ?? ''}
      onChange={(event) =>
        setWarehouseId(event.target.value ? Number.parseInt(event.target.value, 10) : undefined)
      }
      onKeyDown={onEnter}
    >
      <option value="">{t('inventory.pickWarehouse')}</option>
      {warehouses.options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.name}
        </option>
      ))}
    </NativeSelect>
  ) : (
    <Input
      id={`${ids}-location`}
      aria-label={t('inventory.receipt.panel.location')}
      readOnly
      tabIndex={-1}
      title={locationText || undefined}
      className={cn('min-w-0 flex-1', free ? 'bg-muted/40' : PLAIN_FIELD)}
      value={locationText}
    />
  );

  const unitControl = (
    <NativeSelect
      ref={unitRef}
      id={`${ids}-unit`}
      aria-label={t('inventory.unit')}
      disabled={!product || editing !== null || singleUnit}
      className={!free && singleUnit ? cn(PLAIN_FIELD, 'bg-none disabled:opacity-100') : undefined}
      value={unitId ?? ''}
      onChange={(event) => setUnitId(Number.parseInt(event.target.value, 10))}
      onKeyDown={onEnter}
    >
      {(product?.units ?? []).map((candidate) => (
        <option key={candidate.id} value={candidate.id}>
          {candidate.isBase
            ? candidate.uomName
            : t('inventory.receipt.panel.unitOption', {
                unit: candidate.uomName,
                factor: formatQty(candidate.factorToBase),
              })}
        </option>
      ))}
    </NativeSelect>
  );

  const qtyControl = (
    <Input
      ref={qtyRef}
      id={`${ids}-qty`}
      aria-label={t('inventory.qty')}
      inputMode="decimal"
      autoComplete="off"
      className="text-right font-mono"
      value={qty}
      onChange={(event) => setQty(event.target.value)}
      onKeyDown={(event) => {
        guard(event, qty, setQty);
        if (!event.defaultPrevented) onEnter(event);
      }}
    />
  );

  const priceControl = (
    <MoneyInput
      ref={priceRef}
      id={`${ids}-price`}
      aria-label={t('inventory.receipt.form.unitPrice')}
      disabled={entry.free}
      value={entry.source === 'unitPrice' ? entry.value : ''}
      placeholder={
        entry.source === 'amount' && amount !== null && qtyValue && !entry.free
          ? formatMnt(amount.dividedBy(qtyValue).toDecimalPlaces(2).toString())
          : undefined
      }
      onValueChange={(value) => setEntry({ source: 'unitPrice', value, free: false })}
      onKeyDown={(event) => {
        guard(event, entry.value, (value) => setEntry({ ...entry, value }));
        if (!event.defaultPrevented) onEnter(event);
      }}
    />
  );

  const amountControl = (
    <MoneyInput
      ref={amountRef}
      id={`${ids}-amount`}
      aria-label={t('inventory.receipt.form.amount')}
      disabled={entry.free}
      value={entry.source === 'amount' ? entry.value : ''}
      placeholder={
        entry.source === 'unitPrice' && amount !== null ? formatMnt(amount.toString()) : undefined
      }
      onValueChange={(value) => setEntry({ source: 'amount', value, free: false })}
      onKeyDown={(event) => {
        guard(event, entry.value, (value) => setEntry({ ...entry, value }));
        if (!event.defaultPrevented) onEnter(event);
      }}
    />
  );

  const facts = product ? (
    <dl
      aria-label={t('inventory.receipt.panel.infoLabel')}
      className={cn(
        'flex min-w-0 gap-x-4 gap-y-0.5 text-[0.8125rem]',
        free ? 'flex-wrap rounded-lg bg-muted/50 px-3 py-1.5' : 'flex-1',
      )}
    >
      <Info label={t('inventory.receipt.panel.stock')}>
        {home === undefined
          ? locations.isSuccess
            ? t('inventory.receipt.panel.noHome')
            : none
          : onHand === null
            ? none
            : formatQty(onHand)}
      </Info>
      {canCost ? (
        <Info label={t('inventory.receipt.panel.lastPrice')} gives>
          {lastPrice
            ? t('inventory.receipt.panel.lastPriceValue', {
                price: formatMnt(lastPrice.unitPrice),
                unit: lastPrice.unitName,
                base: formatMnt(lastPrice.basePrice),
                date: lastPrice.date,
                supplier: lastPrice.supplierName,
              })
            : none}
        </Info>
      ) : null}
      <Info label={t('inventory.receipt.panel.currentSale')}>
        {salePrice ? `${formatMnt(salePrice)}₮` : none}
      </Info>
      {canCost ? (
        <Info label={t('inventory.receipt.panel.markup')}>
          {markup === null ? none : `${markup.toFixed(1)}%`}
        </Info>
      ) : null}
      {free ? (
        totalWeight ? (
          <Info label={t('inventory.receipt.panel.weightTotalLabel')}>
            {t('inventory.receipt.panel.weightTotal', { total: totalWeight })}
          </Info>
        ) : null
      ) : product.weightKg ? (
        <Info label={t('inventory.receipt.panel.weightField')}>{formatQty(product.weightKg)}</Info>
      ) : null}
    </dl>
  ) : null;

  const feedback = (
    <div aria-live="polite" className="text-sm empty:-mr-4 has-data-[slot=alert]:basis-full">
      {message ? <p className="text-destructive">{message}</p> : null}
      {props.problem}
    </div>
  );

  if (free) {
    const field = (label: string, id: string, control: ReactNode, span = '') => (
      <div className={`flex min-w-0 flex-col gap-1.5 ${span}`}>
        <Label htmlFor={id} title={label} className="block truncate leading-snug">
          {label}
        </Label>
        {control}
      </div>
    );
    return (
      <Card size="sm" role="region" aria-labelledby={`${ids}-title`}>
        <CardHeader>
          <CardTitle id={`${ids}-title`}>{t('inventory.receipt.discounts.freeTitle')}</CardTitle>
        </CardHeader>
        <CardContent ref={cardRoot} className={`flex flex-col gap-2 ${DENSE_FIELDS}`}>
          <div className={LINE_GRID}>
            {field(t('inventory.product'), `${ids}-product`, productControl, 'sm:col-span-3')}
            {field(
              t('inventory.receipt.panel.location'),
              homeless ? `${ids}-home` : `${ids}-location`,
              <div className="flex min-w-0 gap-1.5">
                {locationControl}
                <EditProduct
                  productId={product?.id ?? null}
                  label={t('inventory.receipt.panel.editProduct')}
                  onOpen={() => {
                    editedProduct.current = true;
                  }}
                />
              </div>,
              'sm:col-span-2',
            )}
            {field(
              t('inventory.receipt.panel.weightField'),
              `${ids}-weight`,
              <Input
                id={`${ids}-weight`}
                readOnly
                tabIndex={-1}
                className="bg-muted/40 text-right font-mono"
                value={product?.weightKg ? formatQty(product.weightKg) : ''}
                placeholder={product ? none : undefined}
              />,
            )}
            {field(t('inventory.unit'), `${ids}-unit`, unitControl)}
            {field(t('inventory.qty'), `${ids}-qty`, qtyControl)}
            <div className="flex items-center justify-end gap-2 self-end sm:col-span-2 sm:col-start-5">
              {props.onClose ? (
                <Button variant="ghost" size="sm" onClick={props.onClose}>
                  {t('common.cancel')}
                </Button>
              ) : null}
              <Button
                className="flex-1"
                size="sm"
                variant={props.primary ? 'default' : 'outline'}
                pending={props.pending}
                onClick={() => void submit()}
              >
                {t('inventory.add')}
              </Button>
            </div>
          </div>
          {facts}
          {/* Empty, it takes back the column's gap and stays in the page for screen readers. */}
          <div aria-live="polite" className="text-sm empty:-mt-2">
            {message ? <p className="text-destructive">{message}</p> : null}
            {props.problem}
          </div>
        </CardContent>
      </Card>
    );
  }

  const hint = (key: string, text: string) => (
    <span className="inline-flex items-center gap-1 whitespace-nowrap text-muted-foreground">
      <Kbd>{key}</Kbd>
      {text}
    </span>
  );
  const columnCount =
    3 + (BINS_SOON ? 1 : 2) + 1 + (props.expected ? 1 : 0) + 2 + (canCost ? 4 : 1);

  return (
    <>
      <TableRow ref={rowRoot} data-editing={editing ? 'true' : undefined} className={ENTRY_ROW}>
        <TableCell colSpan={3} className={ENTRY_CELL}>
          <div className="min-w-56">{productControl}</div>
        </TableCell>
        <TableCell colSpan={BINS_SOON ? 1 : 2} className={ENTRY_CELL}>
          {locationControl}
        </TableCell>
        <TableCell className={ENTRY_CELL}>{unitControl}</TableCell>
        {props.expected ? <TableCell className={ENTRY_CELL} /> : null}
        <TableCell className={ENTRY_CELL}>{qtyControl}</TableCell>
        <TableCell className={ENTRY_CELL}>
          <Input
            id={`${ids}-weight`}
            aria-label={t('inventory.receipt.panel.weightTotalLabel')}
            readOnly
            tabIndex={-1}
            className={cn(PLAIN_FIELD, 'text-right font-mono')}
            value={totalWeight ?? ''}
            placeholder={product ? none : undefined}
          />
        </TableCell>
        {canCost ? (
          <>
            <TableCell className={ENTRY_CELL}>{priceControl}</TableCell>
            <TableCell className={ENTRY_CELL}>{amountControl}</TableCell>
          </>
        ) : null}
        <TableCell colSpan={canCost ? 2 : 1} className={ENTRY_CELL}>
          <div className="flex items-center justify-end gap-1">
            {editing ? (
              <Button variant="ghost" size="sm" className="px-2.5" onClick={props.onCancelEdit}>
                {t('common.cancel')}
              </Button>
            ) : null}
            <Button
              className="min-w-0 flex-1 rounded-lg px-2"
              size="sm"
              variant={props.primary ? 'default' : 'secondary'}
              pending={props.pending}
              onClick={() => void submit()}
            >
              {t('common.save')}
              {editing ? null : <Kbd>{t('inventory.receipt.panel.keys.enter')}</Kbd>}
            </Button>
          </div>
        </TableCell>
      </TableRow>
      <TableRow>
        <TableCell colSpan={columnCount} className={ENTRY_SLOT_CELL}>
          <div className={ENTRY_SLOT}>
            {editing ? (
              <Badge variant="secondary">{t('inventory.receipt.panel.editTitle')}</Badge>
            ) : null}
            {feedback}
            {landed && !product ? (
              <span className="inline-flex min-w-0 items-center gap-1 text-muted-foreground">
                <Check aria-hidden className="size-3.5 shrink-0 text-success" />
                <span className="truncate">
                  {t('inventory.receipt.panel.landed', { name: landed })}
                </span>
              </span>
            ) : null}
            {facts}
            <div className="ml-auto flex shrink-0 items-center gap-3 text-xs">
              {product && !editing ? (
                <Link
                  to={`/catalog/products/${product.id}`}
                  target="_blank"
                  className="inline-flex items-center gap-1 text-[0.8125rem] whitespace-nowrap text-link hover:underline"
                  onClick={() => {
                    editedProduct.current = true;
                  }}
                >
                  <Pencil aria-hidden className="size-3.5" />
                  {t('inventory.receipt.panel.editProduct')}
                </Link>
              ) : null}
              {editing
                ? hint(
                    t('inventory.receipt.panel.keys.escape'),
                    t('inventory.receipt.panel.hints.cancel'),
                  )
                : null}
              {product ? null : (
                <>
                  {hint(
                    t('inventory.receipt.panel.keys.search'),
                    t('inventory.receipt.panel.hints.search'),
                  )}
                  {hint(
                    t('inventory.receipt.panel.keys.enter'),
                    t('inventory.receipt.panel.hints.next'),
                  )}
                </>
              )}
            </div>
          </div>
        </TableCell>
      </TableRow>
    </>
  );
}

/** «Бараа засах» beside the location of the free goods' form: an icon, closed until a product. */
function EditProduct(props: { productId: number | null; label: string; onOpen: () => void }) {
  return props.productId === null ? (
    <Button variant="outline" size="icon-sm" disabled aria-label={props.label} title={props.label}>
      <Pencil />
    </Button>
  ) : (
    <Button variant="outline" size="icon-sm" asChild>
      <Link
        to={`/catalog/products/${props.productId}`}
        target="_blank"
        aria-label={props.label}
        title={props.label}
        onClick={props.onOpen}
      >
        <Pencil />
      </Link>
    </Button>
  );
}

/** One fact; `gives`: the one that is cut, whole on hover, when the line runs out of room. */
function Info(props: { label: string; children: string | number; gives?: boolean }) {
  return (
    <div className={cn('flex gap-1.5', props.gives ? 'min-w-0' : 'shrink-0')}>
      <dt className="whitespace-nowrap text-muted-foreground">{props.label}:</dt>
      <dd
        className={cn('font-medium whitespace-nowrap', props.gives && 'min-w-0 truncate')}
        title={props.gives ? String(props.children) : undefined}
      >
        {props.children}
      </dd>
    </div>
  );
}
