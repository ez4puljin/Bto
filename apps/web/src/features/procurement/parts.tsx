import { useDeferredValue, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FilterChip, LoadMore, SearchField } from '@/components/list';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { useSuppliers } from '@/features/partners/api';
import { formatCount } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import type { PoStatus } from './api';

const STATUS_VARIANT = {
  PREPARING: 'secondary',
  SENT: 'default',
  IN_TRANSIT: 'default',
  ARRIVED: 'warning',
  ACCOUNTING: 'warning',
  RECEIVED: 'success',
} as const satisfies Record<PoStatus, 'secondary' | 'default' | 'warning' | 'success'>;

/** A supplier's (or an order's lowest) status: grey while prepared, blue on the way, amber to receive. */
export function PoStatusBadge({ status }: { status: PoStatus }) {
  const { t } = useTranslation();
  return <Badge variant={STATUS_VARIANT[status]}>{t(`procurement.status.${status}`)}</Badge>;
}

/**
 * Ticks over the active suppliers, searched by name, code, phone or TIN; the ticked ones stay
 * while the search changes and show as chips above the list. `exclude`: already in the order.
 */
export function SupplierTicks(props: {
  id: string;
  value: ReadonlyMap<number, string>;
  onChange: (next: ReadonlyMap<number, string>) => void;
  exclude?: ReadonlySet<number>;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim());
  const suppliers = useSuppliers({ q, status: 'ACTIVE' }, { limit: 50 });
  const rows = suppliers.data?.pages.flatMap((page) => page.data) ?? [];
  const toggle = (id: number, name: string, checked: boolean) => {
    const next = new Map(props.value);
    if (checked) next.set(id, name);
    else next.delete(id);
    props.onChange(next);
  };

  return (
    <div className="flex flex-col gap-2">
      <SearchField
        id={props.id}
        className="sm:w-full"
        aria-label={t('procurement.ticks.search')}
        placeholder={t('procurement.ticks.searchPlaceholder')}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <div className="flex flex-wrap items-center gap-1.5" aria-live="polite">
        <span className="text-[13px] text-muted-foreground">
          {props.value.size > 0
            ? t('procurement.ticks.chosen', { count: formatCount(props.value.size) })
            : t('procurement.ticks.none')}
        </span>
        {[...props.value].map(([id, name]) => (
          <FilterChip
            key={id}
            clearLabel={t('procurement.ticks.remove', { name })}
            onClear={() => toggle(id, name, false)}
          >
            {name}
          </FilterChip>
        ))}
      </div>
      <ProblemAlert problem={problemFromError(suppliers.error)} onRetry={suppliers.refetch} />
      <div className="max-h-72 overflow-y-auto rounded-lg border border-border">
        <ul className="flex flex-col divide-y divide-border/80">
          {rows.map((row) => {
            const inOrder = props.exclude?.has(row.id) ?? false;
            return (
              <li key={row.id}>
                <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2 hover:bg-accent has-[button:disabled]:cursor-default has-[button:disabled]:hover:bg-transparent">
                  <Checkbox
                    checked={inOrder || props.value.has(row.id)}
                    disabled={inOrder}
                    onCheckedChange={(checked) => toggle(row.id, row.name, checked === true)}
                  />
                  <span className="min-w-0 flex-1 truncate">{row.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">{row.code}</span>
                  {inOrder ? (
                    <Badge variant="outline">{t('procurement.ticks.inOrder')}</Badge>
                  ) : null}
                </label>
              </li>
            );
          })}
        </ul>
        {suppliers.isPending ? (
          <p className="px-3 py-2 text-[13px] text-muted-foreground">{t('common.loading')}</p>
        ) : null}
        {!suppliers.isPending && rows.length === 0 ? (
          <p className="px-3 py-2 text-[13px] text-muted-foreground">
            {t('procurement.ticks.empty')}
          </p>
        ) : null}
        <LoadMore query={suppliers} />
      </div>
    </div>
  );
}
