import { markupPct } from '@tugeel/shared/inventory';
import { Decimal } from '@tugeel/shared/money';
import { Popover } from 'radix-ui';
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApiClient } from '@/app/api-client-context';
import { useHasPermission } from '@/app/auth-context';
import { NativeSelect } from '@/components/native-select';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useBarcodeLookup, useProductLookup } from '@/features/catalog/api';
import { useCurrentPricesOf } from '@/features/pricing/api';
import { formatMnt, formatQty } from '@/lib/money';
import { problemFromError, unwrap } from '@/lib/problem';
import { useScanGuard, useWedgeScanner } from '@/lib/scan/use-wedge-scanner';
import { useDebounced } from '@/lib/use-debounced';
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
  /** Whole tugriks per base unit; '' leaves none; null when the user may not set sale prices. */
  salePrice: string | null;
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

/** A whole-tugrik sale price as typed, or null. */
function parseWhole(text: string): string | null {
  const value = text.trim().replace(/[\s,]/g, '');
  return /^\d{1,12}$/.test(value) && new Decimal(value).gt(0)
    ? new Decimal(value).toFixed(0)
    : null;
}

/**
 * The line entry of the receipt window (ADR-0099 #3), after Erkhet's one-line editor: the product
 * (name, code or barcode; a scan anywhere on the page lands here), its unit, the quantity, the
 * delivery note's price for cost holders and a new sale price per piece for price holders; Enter
 * moves to the next field and adds the line from the last one. A product without a home warehouse
 * asks for the warehouse it goes into, which becomes its home. Under the fields: the home
 * warehouse and its stock, the weight, the last receipt price, the sale price and the markup. A
 * line of the table opens here for editing (its product and unit stay). With a supplier chosen the
 * search shows that supplier's products, or all products at a switch (ADR-0101). The `free`
 * variant takes free goods: a product, its unit and the quantity, no prices and no scanner.
 */
export function ReceiptLinePanel(props: {
  editing: ReceiptLine | null;
  pending: boolean;
  /** The receipt's supplier: its products are searched first (ADR-0101). */
  supplierId?: number;
  /** Free goods (урамшуулал): no prices, no sale price, no page-wide scanner. */
  free?: boolean;
  /** Shown beside «Нэмэх» (the free goods' «Болих»). */
  onClose?: () => void;
  /** A problem to show under the fields (a refused add). */
  problem?: ReactNode;
  onSubmit: (line: PanelLine) => Promise<boolean>;
  onCancelEdit: () => void;
}) {
  const { t } = useTranslation();
  const { editing } = props;
  const free = props.free === true;
  const canCost = useHasPermission('inventory.costs.manage') && !free;
  const canPrice = useHasPermission('pricing.prices.manage') && !free;
  const api = useApiClient();
  const lookupBarcode = useBarcodeLookup();
  const warehouses = useWarehouseOptions(WHOLESALE);
  const warehouseName = useWarehouseName();
  const ids = useId();
  const root = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const warehouseRef = useRef<HTMLSelectElement>(null);
  const unitRef = useRef<HTMLSelectElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);
  const priceRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const saleRef = useRef<HTMLInputElement>(null);

  const [product, setProduct] = useState<PanelProduct | null>(null);
  const [unitId, setUnitId] = useState<number | null>(null);
  const [qty, setQty] = useState('1');
  const [entry, setEntry] = useState<CostEntry>(START);
  const [sale, setSale] = useState('');
  const [warehouseId, setWarehouseId] = useState<number | undefined>();
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
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
      setSale(editing.salePrice ?? '');
      setWarehouseId(undefined);
      setSearch('');
      setMessage(null);
    } else {
      setProduct(null);
      setUnitId(null);
      setQty('1');
      setEntry(START);
      setSale('');
    }
  }
  useEffect(() => {
    if (editing) qtyRef.current?.select();
  }, [editing]);

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
  const active = highlight < matches.length ? highlight : 0;
  const nothing = settled && typed !== '' && !lookup.isFetching && matches.length === 0;

  const productId = product?.id ?? 0;
  const locations = useProductLocations(productId, product !== null);
  const home = locations.data?.find((row) => row.isHome)?.warehouseId;
  const homeless = product !== null && locations.isSuccess && home === undefined && !editing;
  // A product without a home asks for its warehouse first, once its locations are in.
  useEffect(() => {
    if (homeless) warehouseRef.current?.focus();
  }, [homeless]);
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
  const newSale = canPrice ? parseWhole(sale) : null;
  const markup =
    pieceCost !== null && (newSale ?? salePrice) !== null
      ? markupPct(newSale ?? salePrice ?? 0, pieceCost)
      : null;

  const chooseProduct = (next: PanelProduct, unitPick?: number) => {
    setProduct(next);
    setUnitId(unitPick ?? next.units.find((candidate) => candidate.isBase)?.id ?? null);
    setSearch('');
    setOpen(false);
    setMessage(null);
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
        setSale('');
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
  useWedgeScanner(onScan, !editing && !free, { letters: true, root });
  const guard = useScanGuard(onScan, { letters: true });

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
    canPrice ? saleRef.current : null,
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
    setSale('');
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
    if (canPrice && sale.trim() !== '' && newSale === null) {
      setMessage(t('inventory.receipt.panel.salePriceInvalid'));
      saleRef.current?.focus();
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
      salePrice: canPrice ? (newSale ?? '') : null,
      ...(homeless && warehouseId !== undefined ? { warehouseId } : {}),
    });
    if (saved && !editing) reset();
  };

  const field = (label: string, id: string, control: ReactNode, hint?: ReactNode) => (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {control}
      {hint ? (
        <p id={`${id}-hint`} className="truncate text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
  const none = t('common.none');

  return (
    <Card role="region" aria-labelledby={`${ids}-title`}>
      <CardHeader>
        <CardTitle id={`${ids}-title`}>
          {free
            ? t('inventory.receipt.discounts.freeTitle')
            : editing
              ? t('inventory.receipt.panel.editTitle')
              : t('inventory.receipt.panel.title')}
        </CardTitle>
      </CardHeader>
      <CardContent ref={root} className="flex flex-col gap-3">
        {props.supplierId !== undefined && !product ? (
          <div
            role="radiogroup"
            aria-label={t('inventory.receipt.panel.scope')}
            className="inline-flex w-fit rounded-full border border-border p-0.5 text-[13px]"
          >
            {(['supplier', 'all'] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={scope === value}
                className="rounded-full px-3 py-1 font-medium text-muted-foreground aria-checked:bg-secondary aria-checked:text-secondary-foreground"
                onClick={() => {
                  setScope(value);
                  setHighlight(0);
                  searchRef.current?.focus();
                }}
              >
                {t(`inventory.receipt.panel.scopes.${value}`)}
              </button>
            ))}
          </div>
        ) : null}
        <div className="grid gap-x-3 gap-y-3 sm:grid-cols-2 lg:grid-cols-[minmax(16rem,2.4fr)_minmax(7rem,1fr)_minmax(6rem,0.8fr)_minmax(7rem,1fr)_minmax(7rem,1fr)_minmax(7rem,1fr)]">
          {field(
            t('inventory.product'),
            `${ids}-product`,
            product ? (
              <div className="flex h-9 min-w-0 items-center gap-2 rounded-lg border border-input bg-muted/40 px-3 text-sm">
                <span className="shrink-0 font-mono text-[13px] text-muted-foreground">
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
              <Popover.Root open={open && (matches.length > 0 || nothing)}>
                <Popover.Anchor asChild>
                  <Input
                    ref={searchRef}
                    id={`${ids}-product`}
                    type="search"
                    autoComplete="off"
                    placeholder={
                      bySupplier
                        ? t('inventory.receipt.panel.supplierSearch')
                        : t('inventory.productSearchPlaceholder')
                    }
                    aria-controls={open ? `${ids}-matches` : undefined}
                    aria-activedescendant={
                      open && matches.length > 0 ? `${ids}-match-${active}` : undefined
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
                        if (matches.length === 0) return;
                        event.preventDefault();
                        const step = event.key === 'ArrowDown' ? 1 : -1;
                        setHighlight((active + step + matches.length) % matches.length);
                      } else if (event.key === 'Enter') {
                        event.preventDefault();
                        const chosen = matches[active];
                        if (chosen) {
                          setQty('1');
                          setEntry(START);
                          setSale('');
                          chooseProduct(chosen);
                        } else if (typed) {
                          // A code typed by hand: looked up as a barcode or product code.
                          onScan(typed);
                          setSearch('');
                        }
                      } else if (event.key === 'Escape') {
                        setSearch('');
                      }
                    }}
                  />
                </Popover.Anchor>
                <Popover.Portal>
                  <Popover.Content
                    align="start"
                    sideOffset={4}
                    onOpenAutoFocus={(event) => event.preventDefault()}
                    onCloseAutoFocus={(event) => event.preventDefault()}
                    className="z-50 w-(--radix-popover-trigger-width) max-w-[min(40rem,var(--radix-popover-content-available-width))] min-w-80 overflow-hidden rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-popover"
                  >
                    {matches.length === 0 ? (
                      <p className="px-3 py-2 text-sm text-muted-foreground">
                        {t('inventory.noProducts')}
                      </p>
                    ) : (
                      <ul
                        id={`${ids}-matches`}
                        role="listbox"
                        className="flex max-h-96 flex-col overflow-y-auto"
                      >
                        {matches.map((match, position) => (
                          <li
                            key={match.id}
                            id={`${ids}-match-${position}`}
                            role="option"
                            aria-selected={position === active}
                            data-active={position === active ? 'true' : undefined}
                            className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm hover:bg-accent data-[active=true]:bg-accent"
                            onMouseEnter={() => setHighlight(position)}
                            // Before the box's blur closes the list.
                            onMouseDown={(event) => {
                              event.preventDefault();
                              setQty('1');
                              setEntry(START);
                              setSale('');
                              chooseProduct(match);
                            }}
                          >
                            <span className="shrink-0 font-mono text-[13px] text-muted-foreground">
                              {match.sku}
                            </span>
                            <span className="min-w-0 flex-1 truncate">{match.name}</span>
                            <span className="shrink-0 text-[13px] text-muted-foreground">
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
            ),
          )}
          {field(
            t('inventory.unit'),
            `${ids}-unit`,
            <NativeSelect
              ref={unitRef}
              id={`${ids}-unit`}
              disabled={!product || editing !== null || (product?.units.length ?? 0) < 2}
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
            </NativeSelect>,
          )}
          {field(
            t('inventory.qty'),
            `${ids}-qty`,
            <Input
              ref={qtyRef}
              id={`${ids}-qty`}
              inputMode="decimal"
              autoComplete="off"
              className="text-right font-mono"
              value={qty}
              onChange={(event) => setQty(event.target.value)}
              onKeyDown={(event) => {
                guard(event, qty, setQty);
                if (!event.defaultPrevented) onEnter(event);
              }}
            />,
          )}
          {canCost
            ? field(
                t('inventory.receipt.form.unitPrice'),
                `${ids}-price`,
                <Input
                  ref={priceRef}
                  id={`${ids}-price`}
                  inputMode="decimal"
                  autoComplete="off"
                  className="text-right font-mono"
                  disabled={entry.free}
                  value={entry.source === 'unitPrice' ? entry.value : ''}
                  placeholder={
                    entry.source === 'amount' && amount !== null && qtyValue && !entry.free
                      ? formatMnt(amount.dividedBy(qtyValue).toDecimalPlaces(2).toString())
                      : undefined
                  }
                  onChange={(event) =>
                    setEntry({ source: 'unitPrice', value: event.target.value, free: false })
                  }
                  onKeyDown={(event) => {
                    guard(event, entry.value, (value) => setEntry({ ...entry, value }));
                    if (!event.defaultPrevented) onEnter(event);
                  }}
                />,
                lastPrice
                  ? t('inventory.receipt.panel.lastPriceHint', {
                      price: formatMnt(lastPrice.unitPrice),
                      unit: lastPrice.unitName,
                      date: lastPrice.date,
                    })
                  : undefined,
              )
            : null}
          {canCost
            ? field(
                t('inventory.receipt.form.amount'),
                `${ids}-amount`,
                <Input
                  ref={amountRef}
                  id={`${ids}-amount`}
                  inputMode="decimal"
                  autoComplete="off"
                  className="text-right font-mono"
                  disabled={entry.free}
                  value={entry.source === 'amount' ? entry.value : ''}
                  placeholder={
                    entry.source === 'unitPrice' && amount !== null
                      ? formatMnt(amount.toString())
                      : undefined
                  }
                  onChange={(event) =>
                    setEntry({ source: 'amount', value: event.target.value, free: false })
                  }
                  onKeyDown={(event) => {
                    guard(event, entry.value, (value) => setEntry({ ...entry, value }));
                    if (!event.defaultPrevented) onEnter(event);
                  }}
                />,
              )
            : null}
          {canPrice
            ? field(
                t('inventory.receipt.panel.salePrice'),
                `${ids}-sale`,
                <Input
                  ref={saleRef}
                  id={`${ids}-sale`}
                  inputMode="numeric"
                  autoComplete="off"
                  className="text-right font-mono"
                  value={sale}
                  placeholder={salePrice ? formatMnt(salePrice) : undefined}
                  onChange={(event) => setSale(event.target.value)}
                  onKeyDown={(event) => {
                    guard(event, sale, setSale);
                    if (!event.defaultPrevented) onEnter(event);
                  }}
                />,
              )
            : null}
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          {homeless ? (
            <div className="flex items-center gap-2">
              <Label htmlFor={`${ids}-home`} className="text-warning">
                {t('inventory.receipt.panel.homeLabel')}
              </Label>
              <NativeSelect
                ref={warehouseRef}
                id={`${ids}-home`}
                className="w-56"
                value={warehouseId ?? ''}
                onChange={(event) =>
                  setWarehouseId(
                    event.target.value ? Number.parseInt(event.target.value, 10) : undefined,
                  )
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
            </div>
          ) : null}
          <div className="ml-auto flex items-center gap-2">
            {props.onClose ? (
              <Button variant="ghost" onClick={props.onClose}>
                {t('common.cancel')}
              </Button>
            ) : null}
            {editing ? (
              <Button variant="ghost" onClick={props.onCancelEdit}>
                {t('common.cancel')}
              </Button>
            ) : null}
            <Button disabled={props.pending} onClick={() => void submit()}>
              {editing ? t('common.save') : t('inventory.add')}
            </Button>
          </div>
        </div>
        {product ? (
          <dl
            aria-label={t('inventory.receipt.panel.infoLabel')}
            className="flex flex-wrap gap-x-6 gap-y-1 rounded-lg bg-muted/50 px-3 py-2 text-[13px]"
          >
            <Info label={t('inventory.receipt.panel.home')}>
              {home === undefined
                ? locations.isSuccess
                  ? t('inventory.receipt.panel.noHome')
                  : none
                : `${warehouseName(home)} · ${t('inventory.receipt.panel.onHand', {
                    qty: onHand === null ? '…' : formatQty(onHand),
                  })}`}
            </Info>
            <Info label={t('inventory.receipt.panel.weight')}>
              {product.weightKg
                ? t('inventory.receipt.panel.weightValue', {
                    kg: formatQty(product.weightKg),
                    total:
                      qtyValue && unit
                        ? formatQty(
                            new Decimal(product.weightKg)
                              .times(qtyValue)
                              .times(unit.factorToBase)
                              .toDecimalPlaces(3)
                              .toString(),
                          )
                        : '…',
                  })
                : none}
            </Info>
            {canCost ? (
              <Info label={t('inventory.receipt.panel.lastPrice')}>
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
          </dl>
        ) : null}
        <div aria-live="polite" className="text-sm">
          {message ? <p className="text-destructive">{message}</p> : null}
          {props.problem}
        </div>
      </CardContent>
    </Card>
  );
}

function Info(props: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 gap-1.5">
      <dt className="text-muted-foreground">{props.label}:</dt>
      <dd className="min-w-0 font-medium">{props.children}</dd>
    </div>
  );
}
