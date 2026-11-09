import type { QueryClient } from '@tanstack/react-query';
import type { LiveStockCustomerItem, LiveStockStaffItem, StockApp } from '@tugeel/shared/sales';
import { type CachedProduct, mapProducts } from '../customer/product-cache';
import type { LiveStockEvent } from './live-stock';

// The live stock in the apps' caches (ADR-0173 #4). A `stock` event patches every cached copy of
// its products in place — the shop's pages, a batch, «Нүүр», a section, a category page — so an
// open screen redraws at once without asking the server; `ready` and `resync` refetch every stock
// query instead (a change may have been missed, or a setting changed what counts).

/** The cache keys that carry stock: every product query, and «Bto300»'s quote (words, backorder). */
const STOCK_KEYS: Record<StockApp, { products: readonly unknown[]; quotes: readonly unknown[][] }> =
  {
    STAFF: { products: ['rep', 'products'], quotes: [] },
    CUSTOMER: { products: ['customer', 'products'], quotes: [['customer', 'quote']] },
  };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** The staff app's products with the event's numbers; the rest of each answer stays as it was. */
export function withStaffStock<T>(data: T, items: ReadonlyMap<number, LiveStockStaffItem>): T {
  return mapProducts(data, (row: CachedProduct) => {
    const item = items.get(row.id);
    if (!item || typeof row.available !== 'string') return row;
    if (row.available === item.available && row.stockBlocked === item.stockBlocked) return row;
    return { ...row, available: item.available, stockBlocked: item.stockBlocked };
  });
}

/**
 * «Bto300»'s products with the event's word, and its number when the office shows numbers; a
 * number the event leaves out is taken off the product (the display went back to words).
 */
export function withCustomerStock<T>(
  data: T,
  items: ReadonlyMap<number, LiveStockCustomerItem>,
): T {
  return mapProducts(data, (row: CachedProduct) => {
    const item = items.get(row.id);
    if (!item || typeof row.stock !== 'string') return row;
    if (row.stock === item.stock && row.available === item.available) return row;
    const next: Record<string, unknown> = { ...row, stock: item.stock };
    if (item.available === undefined) delete next.available;
    else next.available = item.available;
    return next;
  });
}

/** A list filtered to products in stock: patched rows may no longer belong in it. */
const filtersInStock = (key: readonly unknown[]) =>
  key.some((part) => isObject(part) && part.inStock === true);

/**
 * One `stock` event: every cached copy patched; «Bto300»'s quotes refetched (their words and
 * «may backorder» follow the stock); lists filtered to «Зөвхөн байгаа бараа» marked stale without
 * a refetch, so they are asked again when next shown rather than jumping under the finger.
 */
export function applyStockItems(
  client: QueryClient,
  app: StockApp,
  items: readonly (LiveStockStaffItem | LiveStockCustomerItem)[],
): void {
  if (items.length === 0) return;
  const keys = STOCK_KEYS[app];
  const patch =
    app === 'STAFF'
      ? (data: unknown) =>
          withStaffStock(
            data,
            new Map((items as LiveStockStaffItem[]).map((item) => [item.productId, item])),
          )
      : (data: unknown) =>
          withCustomerStock(
            data,
            new Map((items as LiveStockCustomerItem[]).map((item) => [item.productId, item])),
          );
  for (const [key, data] of client.getQueriesData<unknown>({ queryKey: keys.products })) {
    if (data === undefined) continue;
    const next = patch(data);
    if (next !== data) client.setQueryData(key, next);
  }
  for (const quote of keys.quotes) void client.invalidateQueries({ queryKey: quote });
  void client.invalidateQueries({
    queryKey: keys.products,
    predicate: (query) => filtersInStock(query.queryKey),
    refetchType: 'none',
  });
}

/** `ready` and `resync`: every stock query is stale, the ones on screen are asked again. */
export function refetchStock(client: QueryClient, app: StockApp): void {
  const keys = STOCK_KEYS[app];
  void client.invalidateQueries({ queryKey: keys.products });
  for (const quote of keys.quotes) void client.invalidateQueries({ queryKey: quote });
}

/** What the app's cache does with one event of its stream. */
export function applyLiveEvent(
  client: QueryClient,
  app: StockApp,
  event: LiveStockEvent<LiveStockStaffItem | LiveStockCustomerItem>,
): void {
  if (event.type === 'stock') applyStockItems(client, app, event.items);
  else if (event.type === 'ready' || event.type === 'resync') refetchStock(client, app);
}
