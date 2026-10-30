import { matchesQuery, queryTerms, searchKeys } from '@tugeel/shared/text';
import { SquareCheckBig, SquareMinus } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FilterChip, SearchField } from '@/components/list';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { formatCount } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { type PoStatus, type SupplierCandidate, useSupplierCandidates } from './api';

const STATUS_VARIANT = {
  PREPARING: 'secondary',
  SENT: 'default',
  SHIPPING: 'default',
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

/** A status with how many suppliers of an order stand in it. */
export function StatusCountBadge({ status, count }: { status: PoStatus; count: number }) {
  const { t } = useTranslation();
  return (
    <Badge variant={STATUS_VARIANT[status]} className="gap-1">
      <span>{t(`procurement.status.${status}`)}</span>
      <span className="font-mono">{formatCount(count)}</span>
    </Badge>
  );
}

/**
 * Ticks over the active suppliers, searched in the browser by name, code, phone or TIN over the one
 * list the server gives (with each supplier's main-product count); the ticked ones stay while the
 * search changes and show as chips above the list. «Бүгдийг сонгох» ticks every listed supplier
 * with at least one main product and names how many it skipped. `exclude`: already in the order.
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
  const candidates = useSupplierCandidates();
  const all = candidates.data ?? NO_CANDIDATES;
  const keyed = useMemo(
    () =>
      all.map((row) => ({
        row,
        keys: searchKeys(row.name, [row.code, row.phone ?? '', row.tin ?? '']),
      })),
    [all],
  );
  const terms = useMemo(() => queryTerms(q), [q]);
  const listed =
    terms.length === 0
      ? all
      : keyed.filter(({ keys }) => matchesQuery(keys, terms)).map(({ row }) => row);
  const free = (row: SupplierCandidate) => !(props.exclude?.has(row.id) ?? false);
  const eligible = listed.filter((row) => free(row) && row.mainProductCount > 0);
  const skipped = listed.filter((row) => free(row) && row.mainProductCount === 0).length;
  const allChosen = eligible.length > 0 && eligible.every((row) => props.value.has(row.id));
  const toggle = (id: number, name: string, checked: boolean) => {
    const next = new Map(props.value);
    if (checked) next.set(id, name);
    else next.delete(id);
    props.onChange(next);
  };
  const toggleAll = () => {
    const next = new Map(props.value);
    for (const row of eligible) {
      if (allChosen) next.delete(row.id);
      else next.set(row.id, row.name);
    }
    props.onChange(next);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <SearchField
          id={props.id}
          className="sm:w-full"
          aria-label={t('procurement.ticks.search')}
          placeholder={t('procurement.ticks.searchPlaceholder')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          disabled={eligible.length === 0}
          onClick={toggleAll}
        >
          {allChosen ? <SquareMinus /> : <SquareCheckBig />}
          {t(allChosen ? 'procurement.ticks.clearAll' : 'procurement.ticks.selectAll')}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5" aria-live="polite">
        <span className="text-[13px] text-muted-foreground">
          {props.value.size > 0
            ? t('procurement.ticks.chosen', { count: formatCount(props.value.size) })
            : t('procurement.ticks.none')}
        </span>
        {skipped > 0 ? (
          <span className="text-[13px] text-muted-foreground">
            · {t('procurement.ticks.skippedNoMain', { count: formatCount(skipped) })}
          </span>
        ) : null}
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
      <ProblemAlert problem={problemFromError(candidates.error)} onRetry={candidates.refetch} />
      <div className="max-h-72 overflow-y-auto rounded-lg border border-border">
        <ul className="flex flex-col divide-y divide-border/80">
          {listed.map((row) => {
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
                  <span className="w-24 shrink-0 text-right text-xs text-muted-foreground">
                    {row.mainProductCount > 0
                      ? t('procurement.ticks.mainProducts', {
                          count: formatCount(row.mainProductCount),
                        })
                      : t('procurement.ticks.noMainProducts')}
                  </span>
                  {inOrder ? (
                    <Badge variant="outline">{t('procurement.ticks.inOrder')}</Badge>
                  ) : null}
                </label>
              </li>
            );
          })}
        </ul>
        {candidates.isPending ? (
          <p className="px-3 py-2 text-[13px] text-muted-foreground">{t('common.loading')}</p>
        ) : null}
        {!candidates.isPending && listed.length === 0 ? (
          <p className="px-3 py-2 text-[13px] text-muted-foreground">
            {t('procurement.ticks.empty')}
          </p>
        ) : null}
      </div>
    </div>
  );
}

const NO_CANDIDATES: readonly SupplierCandidate[] = [];
