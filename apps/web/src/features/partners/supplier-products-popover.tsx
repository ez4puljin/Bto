import { ExternalLink, ImageOff } from 'lucide-react';
import { Popover } from 'radix-ui';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { LoadMore } from '@/components/list';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { useCategories } from '@/features/catalog/api';
import { categoryPaths } from '@/features/catalog/category-tree';
import { useCurrentPricesOf } from '@/features/pricing/api';
import { formatCount, formatMnt } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { useSupplierProducts } from './api';
import { productCategoryOf } from './supplier-filters';

/**
 * The count of a supplier's products in the list: a click shows them in brief, without leaving the
 * list (ADR-0161 #7). With the list's product category on, the count and the products are that
 * category's. They are read only once opened.
 */
export function SupplierProductCount(props: { supplierId: number; name: string; count: number }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  if (props.count === 0) return <>{formatCount(0)}</>;
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="text-link underline-offset-4 hover:underline"
          aria-label={t('partners.suppliers.brief.open', {
            name: props.name,
            count: formatCount(props.count),
          })}
        >
          {formatCount(props.count)}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        {/* Inside a row that opens its record: a click in here stays in here. */}
        <Popover.Content
          align="end"
          sideOffset={4}
          collisionPadding={8}
          className="z-50 flex max-h-[min(26rem,80vh)] w-[min(32rem,92vw)] flex-col rounded-lg border bg-popover text-popover-foreground shadow-md"
          onClick={(event) => event.stopPropagation()}
        >
          {open ? <Brief supplierId={props.supplierId} count={props.count} /> : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function Brief(props: { supplierId: number; count: number }) {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const productCategoryId = productCategoryOf(params);
  const products = useSupplierProducts(props.supplierId, { productCategoryId });
  const rows = useMemo(
    () => products.data?.pages.flatMap((page) => page.data) ?? [],
    [products.data],
  );
  const ids = useMemo(() => rows.map((row) => row.product.id), [rows]);
  const prices = useCurrentPricesOf(ids, true);
  const priceOf = useMemo(
    () => new Map((prices.data ?? []).map((row) => [row.productId, row.warehousePrice])),
    [prices.data],
  );
  const categories = useCategories();
  const paths = useMemo(() => categoryPaths(categories.data ?? []), [categories.data]);
  const count = formatCount(props.count);
  const chosen = productCategoryId === undefined ? undefined : paths.get(productCategoryId);
  const all = new URLSearchParams({ supplier: String(props.supplierId) });
  if (productCategoryId !== undefined) all.set('category', String(productCategoryId));

  return (
    <>
      <div className="flex items-center gap-3 border-b px-3 py-2">
        <h3 className="min-w-0 flex-1 truncate text-[0.8125rem] font-semibold">
          {chosen
            ? t('partners.suppliers.brief.titleIn', { name: chosen, count })
            : t('partners.suppliers.brief.title', { count })}
        </h3>
        <Link
          to={`/catalog/products?${all.toString()}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 items-center gap-1 text-xs text-link underline-offset-4 hover:underline"
        >
          <ExternalLink aria-hidden className="size-3" />
          {t('partners.suppliers.brief.all')}
        </Link>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ProblemAlert problem={problemFromError(products.error)} onRetry={products.refetch} />
        {products.isPending ? (
          <p className="px-3 py-3 text-sm text-muted-foreground">{t('common.loading')}</p>
        ) : null}
        <ul className="flex flex-col divide-y divide-border/80">
          {rows.map(({ linkId, isMain, product }) => {
            const price = priceOf.get(product.id);
            return (
              <li key={linkId} className="flex items-center gap-3 px-3 py-2">
                {product.thumbUrl ? (
                  <img
                    src={product.thumbUrl}
                    alt=""
                    loading="lazy"
                    className="size-9 shrink-0 rounded-md object-cover"
                  />
                ) : (
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
                    <ImageOff aria-hidden className="size-3.5 text-muted-foreground" />
                  </div>
                )}
                <div className="flex min-w-0 flex-1 flex-col">
                  <Link
                    to={`/catalog/products/${product.id}`}
                    target="_blank"
                    rel="noreferrer"
                    title={product.name}
                    className="truncate text-[0.8125rem] font-medium underline-offset-4 hover:underline"
                  >
                    {product.name}
                  </Link>
                  <span className="truncate text-xs text-muted-foreground">
                    <span className="font-mono">{product.sku}</span>
                    {paths.get(product.categoryId) ? ` · ${paths.get(product.categoryId)}` : ''}
                  </span>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-0.5">
                  <span className="font-mono text-[0.8125rem]">
                    {price === undefined
                      ? t('common.none')
                      : t('pricing.money', { amount: formatMnt(price) })}
                  </span>
                  {product.status === 'ACTIVE' ? null : (
                    <Badge variant="outline">{t(`partners.status.${product.status}`)}</Badge>
                  )}
                  {isMain ? <Badge variant="secondary">{t('partners.supplier.main')}</Badge> : null}
                </div>
              </li>
            );
          })}
        </ul>
        <LoadMore query={products} />
      </div>
    </>
  );
}
