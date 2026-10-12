import { useDeferredValue, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NativeSelect } from '@/components/native-select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { type ProductSummary, useProducts } from '@/features/catalog/api';
import type { Warehouse } from '@/features/identity/api';
import { useScanGuard } from '@/lib/scan/use-wedge-scanner';
import { isQty } from './helpers';

type DocStatus =
  'DRAFT' | 'SUBMITTED' | 'REQUESTED' | 'SHIPPED' | 'POSTED' | 'RECEIVED' | 'CANCELLED';

export function WarehouseSelect(props: {
  options: readonly Warehouse[];
  value: number | undefined;
  onChange: (id: number | undefined) => void;
  /** The empty choice: "all warehouses" in filters, "pick one" in forms. */
  emptyLabel: string;
  label?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <NativeSelect
      aria-label={props.label ?? t('inventory.warehouse')}
      className={props.className}
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
    status === 'POSTED' || status === 'RECEIVED'
      ? 'secondary'
      : status === 'SUBMITTED' || status === 'REQUESTED' || status === 'SHIPPED'
        ? 'default'
        : 'outline';
  return <Badge variant={variant}>{t(`inventory.docStatus.${status}`)}</Badge>;
}

/** Search active products by name, SKU or barcode and pick one (documents without a scanner). */
export function ProductSearch({
  onPick,
  pickLabel,
}: {
  onPick: (product: ProductSummary) => void;
  /** The button of each found product; default «Нэмэх». */
  pickLabel?: string;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim());
  const products = useProducts({ q, status: 'ACTIVE' });
  const rows = q ? (products.data?.pages[0]?.data ?? []).slice(0, 8) : [];

  return (
    <div className="flex flex-col gap-2">
      <Input
        type="search"
        aria-label={t('inventory.productSearch')}
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
