import { useInfiniteQuery } from '@tanstack/react-query';
import { ChevronDown, History } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApiClient } from '@/app/api-client-context';
import { LoadMore } from '@/components/list';
import { ProblemAlert } from '@/components/problem-alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useWarehouseName } from '@/features/inventory/helpers';
import { useSuppliersByIds } from '@/features/partners/api';
import { usePriceProfileChoices } from '@/features/pricing/api';
import { formatUbDateTime } from '@/lib/dayjs';
import { formatMnt, formatQty } from '@/lib/money';
import { problemFromError, unwrap } from '@/lib/problem';
import { cn } from '@/lib/utils';

type Payload = Record<string, unknown> | null | undefined;

interface Change {
  label: string;
  from?: string;
  to?: string;
}

/** The product's own fields a person changes, in the order the form shows them. */
const PRODUCT_FIELDS = [
  ['name', 'catalog.product.name'],
  ['sku', 'catalog.product.sku'],
  ['categoryId', 'catalog.product.category'],
  ['weightKg', 'catalog.product.weight'],
  ['status', 'catalog.product.status'],
  ['vatType', 'catalog.product.vatType'],
  ['cityTax', 'catalog.product.cityTax'],
  ['classificationCode', 'catalog.product.classificationCode'],
] as const;

const text = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  return typeof value === 'string' ? value : JSON.stringify(value);
};

const idOf = (value: unknown): number | null => {
  const id = Number.parseInt(text(value), 10);
  return Number.isSafeInteger(id) ? id : null;
};

/** The home warehouse, as each of the location changes writes it; undefined when it says nothing. */
function homeOf(payload: Payload): unknown {
  if (!payload) return undefined;
  if ('home' in payload) return payload.home;
  if ('homeWarehouseId' in payload) return payload.homeWarehouseId;
  if ('isHome' in payload) return payload.isHome ? payload.warehouseId : null;
  return undefined;
}

/**
 * Who changed what on this product and when (owner 2026-11-06): its facts, units, barcodes and
 * pictures, its prices, locations and suppliers. Read from the audit only once opened, as most
 * visits never look at it.
 */
export function ProductHistoryCard(props: {
  productId: number;
  categoryPath: (id: number) => string | undefined;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <Card role="region" aria-label={t('catalog.product.history.title')}>
      <CardHeader>
        <CardTitle>
          <button
            type="button"
            aria-expanded={open}
            className="flex w-full items-center gap-2 text-left"
            onClick={() => setOpen((value) => !value)}
          >
            <History aria-hidden className="size-4 text-muted-foreground" />
            <span className="flex-1">{t('catalog.product.history.title')}</span>
            <ChevronDown
              aria-hidden
              className={cn(
                'size-4 text-muted-foreground transition-transform',
                !open && '-rotate-90',
              )}
            />
          </button>
        </CardTitle>
      </CardHeader>
      {open ? (
        <CardContent className="flex flex-col gap-2">
          <HistoryList {...props} />
        </CardContent>
      ) : null}
    </Card>
  );
}

function HistoryList(props: {
  productId: number;
  categoryPath: (id: number) => string | undefined;
}) {
  const { t } = useTranslation();
  const api = useApiClient();
  const history = useInfiniteQuery({
    queryKey: ['catalog', 'products', props.productId, 'history'],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/products/{id}/history', {
          params: { path: { id: props.productId }, query: { cursor: pageParam } },
          signal,
        }),
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = history.data?.pages.flatMap((page) => page.data) ?? [];
  const warehouseName = useWarehouseName();
  const profiles = usePriceProfileChoices();
  const supplierIds = [
    ...new Set(
      rows.flatMap((row) => {
        if (row.entity !== 'product_suppliers') return [];
        const id = idOf((row.after as Payload)?.supplierId ?? (row.before as Payload)?.supplierId);
        return id === null ? [] : [id];
      }),
    ),
  ];
  const suppliers = useSuppliersByIds(supplierIds);
  const supplierName = (id: number | null) =>
    suppliers.data?.find((supplier) => supplier.id === id)?.name ?? '';
  const none = t('common.none');

  const productValue = (field: string, value: unknown) => {
    const raw = text(value);
    if (raw === '') return none;
    if (field === 'categoryId') {
      const id = idOf(raw);
      return (id === null ? undefined : props.categoryPath(id)) ?? raw;
    }
    if (field === 'status' && (raw === 'ACTIVE' || raw === 'INACTIVE')) {
      return t(`catalog.products.status.${raw}`);
    }
    return raw;
  };
  const warehouseOf = (value: unknown) => {
    const id = idOf(value);
    return id === null ? none : warehouseName(id);
  };
  const priceOf = (value: unknown) => (text(value) ? `${formatMnt(text(value))}₮` : none);
  const qtyOf = (value: unknown) => (text(value) ? formatQty(text(value)) : none);
  const profileOf = (value: unknown) =>
    profiles.data?.find((profile) => profile.id === idOf(value))?.name ?? (text(value) || none);

  const changesOf = (entity: string, action: string, before: Payload, after: Payload): Change[] => {
    const differs = (from: unknown, to: unknown) => text(from) !== text(to);
    if (entity === 'products' && action === 'UPDATE') {
      return PRODUCT_FIELDS.filter(
        ([field]) => after?.[field] !== undefined && differs(before?.[field], after[field]),
      ).map(([field, label]) => ({
        label: t(label),
        from: productValue(field, before?.[field]),
        to: productValue(field, after?.[field]),
      }));
    }
    if (entity === 'product_prices') {
      const changes: Change[] = [];
      if (differs(before?.warehousePrice, after?.warehousePrice)) {
        changes.push({
          label: t('catalog.product.key.price'),
          from: priceOf(before?.warehousePrice),
          to: priceOf(after?.warehousePrice),
        });
      }
      if (differs(before?.profileId, after?.profileId)) {
        changes.push({
          label: t('catalog.products.filters.fields.profile'),
          from: before?.profileId === undefined ? none : profileOf(before.profileId),
          to: profileOf(after?.profileId),
        });
      }
      if (text(after?.validFrom)) {
        changes.push({ label: t('catalog.product.history.validFrom'), to: text(after?.validFrom) });
      }
      return changes;
    }
    if (entity === 'product_locations') {
      const changes: Change[] = [];
      const homeAfter = homeOf(after);
      if (homeAfter !== undefined && differs(homeOf(before), homeAfter)) {
        changes.push({
          label: t('catalog.product.key.home'),
          from: warehouseOf(homeOf(before)),
          to: warehouseOf(homeAfter),
        });
      }
      for (const [field, label] of [
        ['minQty', 'catalog.product.history.minQty'],
        ['maxQty', 'catalog.product.history.maxQty'],
      ] as const) {
        if (after?.[field] !== undefined && differs(before?.[field], after[field])) {
          changes.push({
            label: t(label),
            from: qtyOf(before?.[field]),
            to: qtyOf(after[field]),
          });
        }
      }
      return changes;
    }
    if (entity === 'product_suppliers' && action === 'UPDATE') {
      if (differs(before?.isMain, after?.isMain)) {
        return [
          {
            label: t(
              after?.isMain === true
                ? 'catalog.product.history.madeMain'
                : 'catalog.product.history.notMain',
            ),
          },
        ];
      }
    }
    return [];
  };

  /** What the headline names beside the action. */
  const subjectOf = (entity: string, before: Payload, after: Payload) => {
    if (entity === 'product_barcodes') return text(after?.code ?? before?.code);
    if (entity === 'product_suppliers') {
      return supplierName(idOf(after?.supplierId ?? before?.supplierId));
    }
    if (entity === 'product_locations' && (after?.warehouseId ?? before?.warehouseId)) {
      return warehouseOf(after?.warehouseId ?? before?.warehouseId);
    }
    return '';
  };

  return (
    <>
      <ProblemAlert problem={problemFromError(history.error)} onRetry={history.refetch} />
      {history.isPending ? (
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('catalog.product.history.empty')}</p>
      ) : (
        <ol className="flex flex-col divide-y divide-border">
          {rows.map((row) => {
            const before = row.before as Payload;
            const after = row.after as Payload;
            const subject = subjectOf(row.entity, before, after);
            return (
              <li key={row.id} className="flex flex-col gap-0.5 py-2 text-[0.8125rem]">
                <span className="font-medium">
                  {t(`catalog.product.history.actions.${row.entity}.${row.action}`, {
                    defaultValue: t('catalog.product.history.changed'),
                  })}
                  {subject ? <span className="ml-1.5 font-normal">{subject}</span> : null}
                </span>
                {changesOf(row.entity, row.action, before, after).map((change) => (
                  <span key={change.label} className="text-muted-foreground">
                    {change.label}
                    {change.to === undefined ? null : ': '}
                    {change.from === undefined ? null : (
                      <>
                        <span className="line-through">{change.from}</span>
                        {' → '}
                      </>
                    )}
                    {change.to === undefined ? null : (
                      <span className="text-foreground">{change.to}</span>
                    )}
                  </span>
                ))}
                <span className="text-xs text-muted-foreground">
                  {row.actorName ?? row.actorUsername ?? row.actorLabel ?? none}
                  {' · '}
                  <span className="font-mono">{formatUbDateTime(Date.parse(row.occurredAt))}</span>
                </span>
              </li>
            );
          })}
        </ol>
      )}
      <LoadMore query={history} />
    </>
  );
}
