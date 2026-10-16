import { useDeferredValue, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NativeSelect } from '@/components/native-select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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

/** Search active products by name, SKU or barcode and pick one (documents without a scanner). */
export function ProductSearch({
  id,
  onPick,
  pickLabel,
  saleReady,
}: {
  /** Set when a visible label names the search box. */
  id?: string;
  onPick: (product: ProductSummary) => void;
  /** The button of each found product; default «Нэмэх». */
  pickLabel?: string;
  /** Only products whose prices are complete (an app notice's products, ADR-0062). */
  saleReady?: boolean;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim());
  const products = useProducts({ q, status: 'ACTIVE', ...(saleReady ? { saleReady } : {}) });
  const rows = q ? (products.data?.pages[0]?.data ?? []).slice(0, 8) : [];

  return (
    <div className="flex flex-col gap-2">
      <Input
        id={id}
        type="search"
        aria-label={id ? undefined : t('inventory.productSearch')}
        placeholder={t('inventory.productSearchPlaceholder')}
        className="max-w-sm"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      {q && !products.isPending && rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('inventory.noProducts')}</p>
      ) : null}
      {rows.length > 0 ? (
        <ul className="flex max-w-xl flex-col divide-y rounded-md border">
          {rows.map((product) => (
            <li key={product.id} className="flex items-center gap-2 px-3 py-1.5">
              <span className="font-mono text-sm text-muted-foreground">{product.sku}</span>
              <span className="text-sm">{product.name}</span>
              <Button
                type="button"
                size="xs"
                variant="outline"
                className="ml-auto"
                aria-label={`${pickLabel ?? t('inventory.add')}: ${product.name}`}
                onClick={() => {
                  onPick(product);
                  setSearch('');
                }}
              >
                {pickLabel ?? t('inventory.add')}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
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
