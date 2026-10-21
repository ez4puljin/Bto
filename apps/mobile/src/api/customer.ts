import type { components } from '@tugeel/api-client';
import {
  keepPreviousData,
  type QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type { HomeSectionSort, RepProductSort } from '@tugeel/shared/sales';
import { canonical } from '../cart/send';
import type { StoreOrderParams } from '../customer/order-filters';
import { productsIn, withFavourite } from '../customer/product-cache';
import { type ShopChip, shopChipQuery } from '../customer/shop';
import { useCustomer } from '../state/session';
import { unwrap } from './problem';

// «Bto300»'s reads (ADR-0079, ADR-0082; docs/modules/mobile.md §6a): every call goes to
// /customer-app/* with the store's own token; no route takes the store from the phone.

export type StoreMe = components['schemas']['CustomerAppMe'];
export type StoreCheckout = components['schemas']['CustomerAppCheckout'];
export type StoreCreditCheck = components['schemas']['CustomerAppCreditCheck'];
export type StoreContact = components['schemas']['CompanyContact'];
export type StoreCategory = components['schemas']['CustomerAppCategory'];
export type StoreProduct = components['schemas']['CustomerAppProduct'];
export type StoreUnit = components['schemas']['CustomerAppUnit'];
export type StockWord = StoreProduct['stock'];
export type StoreQuote = components['schemas']['CustomerAppQuote'];
export type StoreOrderRow = components['schemas']['CustomerAppOrderRow'];
export type StoreOrder = components['schemas']['CustomerAppOrder'];
export type StoreOrderState = StoreOrderRow['state'];
export type StoreReorder = components['schemas']['CustomerAppReorder'];
export type StoreBalance = components['schemas']['CustomerAppBalance'];
export type StoreInvoice = components['schemas']['CustomerAppInvoice'];
export type StoreInvoiceDetail = components['schemas']['CustomerAppInvoiceDetail'];
export type StorePayment = components['schemas']['CustomerAppPayment'];
export type StoreBankAccount = components['schemas']['CustomerAppBankAccount'];
export type StoreStatement = components['schemas']['CustomerAppStatement'];
export type StoreStatementEntry = components['schemas']['CustomerAppStatementEntry'];
export type StoreDeal = components['schemas']['CustomerAppDeal'];
export type StoreOrderDeal = components['schemas']['CustomerAppOrderDeal'];
export type StoreHome = components['schemas']['CustomerAppHome'];
export type StoreBanner = components['schemas']['CustomerAppBanner'];
export type StoreBannerLink = components['schemas']['CustomerAppBannerLink'];
export type StoreHomeCategory = components['schemas']['CustomerAppHomeCategory'];
export type StoreHomeSection = components['schemas']['CustomerAppHomeSectionRow'];
export type StoreSectionPage = components['schemas']['CustomerAppSectionPage'];
export type StoreCategoryPage = components['schemas']['CustomerAppCategoryPage'];

/** Every cache key of «Bto300» starts here. */
export const STORE_KEY = ['customer'] as const;

const PAGE = 30;

/** The store, its centre, its default address, its term, whether orders are open and «today». */
export function useStoreMe() {
  const { session } = useCustomer();
  return useQuery({
    queryKey: [...STORE_KEY, 'me'],
    queryFn: async () => unwrap(await session.client.GET('/api/v1/customer-app/me')),
    staleTime: 60_000,
  });
}

/** The checkout's choices: the live addresses (default first), the pickup centre, the last day. */
export function useCheckoutOptions() {
  const { session } = useCustomer();
  return useQuery({
    queryKey: [...STORE_KEY, 'checkout'],
    queryFn: async () => unwrap(await session.client.GET('/api/v1/customer-app/checkout')),
  });
}

/**
 * The store's credit state for an amount (ADR-0079 #5): hold, overdue, over the limit — the store
 * may still send. `amount` is the quote's total; null asks nothing.
 */
export function useCreditCheck(amount: string | null) {
  const { session } = useCustomer();
  return useQuery({
    queryKey: [...STORE_KEY, 'credit-check', amount],
    queryFn: async () =>
      unwrap(
        await session.client.GET('/api/v1/customer-app/credit-check', {
          params: { query: { amount: amount ?? '0' } },
        }),
      ),
    enabled: amount !== null,
    placeholderData: keepPreviousData,
  });
}

/** «Холбоо барих» (ADR-0079 #14): the company's contact people, in the admin's order. */
export function useContacts() {
  const { session } = useCustomer();
  return useQuery({
    queryKey: [...STORE_KEY, 'contacts'],
    queryFn: async () => unwrap(await session.client.GET('/api/v1/customer-app/contacts')),
    staleTime: 10 * 60_000,
  });
}

export function useStoreCategories() {
  const { session } = useCustomer();
  return useQuery({
    queryKey: [...STORE_KEY, 'categories'],
    queryFn: async () => unwrap(await session.client.GET('/api/v1/customer-app/categories')),
    staleTime: 10 * 60_000,
  });
}

/**
 * What «Бараа» asks for (ADR-0092 #7): the search, the categories, a chip («♡ Дуртай»,
 * «Хямдралтай», «Шинэ»), «Зөвхөн байгаа бараа» and the order.
 */
export interface StoreShopQuery {
  q: string;
  categoryIds: readonly number[];
  chip: ShopChip;
  inStock: boolean;
  sort: RepProductSort;
}

function shopParams(query: StoreShopQuery) {
  const chip = shopChipQuery(query.chip);
  return {
    ...(query.q ? { q: query.q } : {}),
    ...(query.categoryIds.length > 0 ? { categoryIds: [...query.categoryIds] } : {}),
    ...(chip.favourites ? { favourites: true } : {}),
    ...(chip.deals ? { deals: true } : {}),
    ...(chip.new ? { new: true } : {}),
    ...(query.inStock ? { inStock: true } : {}),
    sort: query.sort,
  };
}

/** The shop page by page; the first page holds the total and the favourites' count. */
export function useStoreProducts(query: StoreShopQuery, enabled = true) {
  const { session } = useCustomer();
  return useInfiniteQuery({
    queryKey: [...STORE_KEY, 'products', shopParams(query)],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      unwrap(
        await session.client.GET('/api/v1/customer-app/products', {
          params: {
            query: {
              ...shopParams(query),
              ...(pageParam ? { cursor: pageParam } : {}),
              limit: PAGE,
            },
          },
        }),
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    enabled,
  });
}

/** How many products a draft of the filter sheet would show («N бараа харуулах»). */
export function useStoreProductCount(query: StoreShopQuery, enabled: boolean) {
  const { session } = useCustomer();
  return useQuery({
    queryKey: [...STORE_KEY, 'products', 'count', shopParams(query)],
    queryFn: async () =>
      unwrap(
        await session.client.GET('/api/v1/customer-app/products', {
          params: { query: { ...shopParams(query), limit: 1 } },
        }),
      ).total,
    enabled,
    placeholderData: keepPreviousData,
  });
}

/**
 * «Нүүр» (ADR-0092 #1, ADR-0093 #5): the banners, the category grid and the sections in their
 * fixed order. Kept under `products` so ♡ and a sent order reach its cards.
 */
export function useStoreHome() {
  const { session } = useCustomer();
  return useQuery({
    queryKey: [...STORE_KEY, 'products', 'home'],
    queryFn: async () => unwrap(await session.client.GET('/api/v1/customer-app/home')),
  });
}

/** What a section's full list asks for (ADR-0093 #6). */
export interface StoreSectionQuery {
  sort: HomeSectionSort;
  categoryIds: readonly number[];
  inStock: boolean;
}

function sectionParams(query: StoreSectionQuery) {
  return {
    ...(query.sort !== 'DEFAULT' ? { sort: query.sort } : {}),
    ...(query.categoryIds.length > 0 ? { categoryIds: [...query.categoryIds] } : {}),
    ...(query.inStock ? { inStock: true } : {}),
  };
}

/** «Хэсгийн бүх бараа» page by page; the first page holds the total. */
export function useStoreSection(key: string, query: StoreSectionQuery) {
  const { session } = useCustomer();
  return useInfiniteQuery({
    queryKey: [...STORE_KEY, 'products', 'section', key, sectionParams(query)],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      unwrap(
        await session.client.GET('/api/v1/customer-app/sections/{key}/products', {
          params: {
            path: { key },
            query: {
              ...sectionParams(query),
              ...(pageParam ? { cursor: pageParam } : {}),
              limit: PAGE,
            },
          },
        }),
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

/** How many products a section's draft filters would show. */
export function useStoreSectionCount(key: string, query: StoreSectionQuery, enabled: boolean) {
  const { session } = useCustomer();
  return useQuery({
    queryKey: [...STORE_KEY, 'products', 'section-count', key, sectionParams(query)],
    queryFn: async () =>
      unwrap(
        await session.client.GET('/api/v1/customer-app/sections/{key}/products', {
          params: { path: { key }, query: { ...sectionParams(query), limit: 1 } },
        }),
      ).total,
    enabled,
    placeholderData: keepPreviousData,
  });
}

/** «Ангиллын хуудас» (ADR-0092 #6): its banners, subcategories, new and discounted products. */
export function useStoreCategoryPage(id: number | null) {
  const { session } = useCustomer();
  return useQuery({
    queryKey: [...STORE_KEY, 'products', 'category', id],
    queryFn: async () =>
      unwrap(
        await session.client.GET('/api/v1/customer-app/categories/{id}/page', {
          params: { path: { id: id ?? 0 } },
        }),
      ),
    enabled: id !== null,
  });
}

/**
 * Products by id as the shop lists them (a product page, the favourites, a notice, the cart, a
 * reorder); only products the shop lists come back. `seed` shows what the lists already hold.
 */
export function useStoreProductsOf(ids: readonly number[], seed?: readonly StoreProduct[]) {
  const { session } = useCustomer();
  const sorted = [...new Set(ids)].sort((a, b) => a - b);
  return useQuery({
    queryKey: [...STORE_KEY, 'products', 'of', sorted.join(',')],
    queryFn: () => storeProductsOf(session.client, sorted),
    enabled: sorted.length > 0,
    ...(seed && seed.length > 0 ? { placeholderData: [...seed] } : {}),
  });
}

type Client = ReturnType<typeof useCustomer>['session']['client'];

/** One batch read (at most 200 ids a call). */
export async function storeProductsOf(
  client: Client,
  ids: readonly number[],
): Promise<StoreProduct[]> {
  const found: StoreProduct[] = [];
  for (let at = 0; at < ids.length; at += 200) {
    const chunk = ids.slice(at, at + 200);
    found.push(
      ...unwrap(
        await client.GET('/api/v1/customer-app/products/batch', {
          params: { query: { productIds: chunk.join(',') } },
        }),
      ),
    );
  }
  return found;
}

/**
 * A product the app's lists already hold (the shop, a section, «Нүүр», a category page, a batch),
 * so its page opens at once.
 */
export function cachedStoreProduct(client: QueryClient, id: number): StoreProduct | undefined {
  for (const [, data] of client.getQueriesData<unknown>({
    queryKey: [...STORE_KEY, 'products'],
  })) {
    const found = productsIn<StoreProduct>(data).find((product) => product.id === id);
    if (found) return found;
  }
  return undefined;
}

/** Sets every cached copy of a product's ♡ at once; the server's answer settles it. */
function markFavourite(client: QueryClient, productId: number, favourite: boolean) {
  for (const [key, data] of client.getQueriesData<unknown>({
    queryKey: [...STORE_KEY, 'products'],
  })) {
    if (data !== undefined) client.setQueryData(key, withFavourite(data, productId, favourite));
  }
}

/** ♡ on a product (ADR-0079 #4, ADR-0092 #7): kept on the server, so a new phone keeps them. */
export function useToggleFavourite() {
  const { session } = useCustomer();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ productId, favourite }: { productId: number; favourite: boolean }) => {
      const params = { params: { path: { productId } } };
      const result = favourite
        ? await session.client.PUT('/api/v1/customer-app/favourites/{productId}', params)
        : await session.client.DELETE('/api/v1/customer-app/favourites/{productId}', params);
      if (!result.response.ok) unwrap(result);
    },
    onMutate: async ({ productId, favourite }) => {
      // A refetch still running from an earlier ★ would land after this one and undo it.
      await queryClient.cancelQueries({ queryKey: [...STORE_KEY, 'products'] });
      markFavourite(queryClient, productId, favourite);
    },
    onError: (_error, { productId, favourite }) =>
      markFavourite(queryClient, productId, !favourite),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: [...STORE_KEY, 'favourites'] });
      await queryClient.invalidateQueries({ queryKey: [...STORE_KEY, 'products'] });
    },
  });
}

/**
 * Lines priced by the server for the store (the app never computes a price, ADR-0006 #6), with
 * each line's stock word and whether it may be backordered («Зарим нь хойшилж магадгүй»).
 */
export function useStoreQuote(lines: readonly { productUnitId: number; qty: string }[]) {
  const { session } = useCustomer();
  return useQuery({
    queryKey: [...STORE_KEY, 'quote', canonical(lines)],
    queryFn: async () =>
      unwrap(
        await session.client.POST('/api/v1/customer-app/quote', {
          body: { lines: [...lines] },
        }),
      ),
    enabled: lines.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

/** The days and filters «Захиалга» asks for. */
export type StoreOrderQuery = { from: string; to: string } & StoreOrderParams;

/**
 * The store's orders from every channel between two Ulaanbaatar days, newest first, with the
 * filters the store chose (who took them, a product, the payment, delivery, the state).
 */
export function useStoreOrders(query: StoreOrderQuery | null) {
  const { session } = useCustomer();
  return useInfiniteQuery({
    queryKey: [...STORE_KEY, 'orders', query],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      unwrap(
        await session.client.GET('/api/v1/customer-app/orders', {
          params: {
            query: {
              ...(query ?? {}),
              ...(pageParam ? { cursor: pageParam } : {}),
              limit: PAGE,
            },
          },
        }),
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: query !== null,
    placeholderData: keepPreviousData,
  });
}

/** How many orders a filter would show (the filter sheet's «N захиалга харуулах»). */
export function useStoreOrderCount(query: StoreOrderQuery, enabled: boolean) {
  const { session } = useCustomer();
  return useQuery({
    queryKey: [...STORE_KEY, 'orders', 'count', query],
    queryFn: async () =>
      unwrap(
        await session.client.GET('/api/v1/customer-app/orders', {
          params: { query: { ...query, limit: 1 } },
        }),
      ).summary?.count ?? null,
    enabled,
    placeholderData: keepPreviousData,
  });
}

/** «ХТ» in the order filter: the reps who took the store's orders, by name. */
export function useStoreOrderReps(enabled = true) {
  const { session } = useCustomer();
  return useQuery({
    queryKey: [...STORE_KEY, 'orders', 'reps'],
    queryFn: async () => unwrap(await session.client.GET('/api/v1/customer-app/orders/reps')).reps,
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useStoreOrder(id: number | null) {
  const { session } = useCustomer();
  return useQuery({
    queryKey: [...STORE_KEY, 'orders', 'one', id],
    queryFn: async () =>
      unwrap(
        await session.client.GET('/api/v1/customer-app/orders/{id}', {
          params: { path: { id: id ?? 0 } },
        }),
      ),
    enabled: id !== null,
  });
}

/**
 * «Дахин захиалах» (ADR-0079 #6): an earlier order's lines that can be ordered today and the
 * products they need for the cart; what was skipped and why.
 */
export function useReorder() {
  const { session } = useCustomer();
  return async (orderId: number) => {
    const reorder = unwrap(
      await session.client.GET('/api/v1/customer-app/orders/{id}/reorder', {
        params: { path: { id: orderId } },
      }),
    );
    const products = await storeProductsOf(session.client, [
      ...new Set(reorder.lines.map((line) => line.productId)),
    ]);
    return { reorder, products };
  };
}

/** «Тооцоо»: the balance, the overdue amount, the limit and what remains, the counts. */
export function useStoreBalance() {
  const { session } = useCustomer();
  return useQuery({
    queryKey: [...STORE_KEY, 'account'],
    queryFn: async () => unwrap(await session.client.GET('/api/v1/customer-app/account')),
  });
}

/** The open invoices, the oldest due first. */
export function useStoreInvoices() {
  const { session } = useCustomer();
  return useQuery({
    queryKey: [...STORE_KEY, 'invoices'],
    queryFn: async () => unwrap(await session.client.GET('/api/v1/customer-app/invoices')),
  });
}

export function useStoreInvoice(id: number | null) {
  const { session } = useCustomer();
  return useQuery({
    queryKey: [...STORE_KEY, 'invoices', 'one', id],
    queryFn: async () =>
      unwrap(
        await session.client.GET('/api/v1/customer-app/invoices/{id}', {
          params: { path: { id: id ?? 0 } },
        }),
      ),
    enabled: id !== null,
  });
}

/** The store's payments, newest first, with the invoices they settled. */
export function useStorePayments() {
  const { session } = useCustomer();
  return useInfiniteQuery({
    queryKey: [...STORE_KEY, 'payments'],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      unwrap(
        await session.client.GET('/api/v1/customer-app/payments', {
          params: { query: { ...(pageParam ? { cursor: pageParam } : {}), limit: PAGE } },
        }),
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/**
 * «Тооцооны хуулга» (ADR-0086): the opening balance, the purchases (Дебит) and the payments and
 * returns (Кредит) of the days asked for, oldest first, the totals and the closing balance.
 */
export function useStoreStatement(range: { from: string; to: string }) {
  const { session } = useCustomer();
  return useQuery({
    queryKey: [...STORE_KEY, 'statement', range.from, range.to],
    queryFn: async () =>
      unwrap(
        await session.client.GET('/api/v1/customer-app/statement', {
          params: { query: { from: range.from, to: range.to } },
        }),
      ),
    placeholderData: keepPreviousData,
  });
}

/** The company's accounts the finance settings show to customers (ADR-0079 #7). */
export function useBankAccounts() {
  const { session } = useCustomer();
  return useQuery({
    queryKey: [...STORE_KEY, 'bank-accounts'],
    queryFn: async () => unwrap(await session.client.GET('/api/v1/customer-app/bank-accounts')),
    staleTime: 10 * 60_000,
  });
}

/** After an order is sent: the orders, the home and the money views read again. */
export async function refreshAfterOrder(client: QueryClient): Promise<void> {
  await client.invalidateQueries({ queryKey: [...STORE_KEY, 'orders'] });
  await client.invalidateQueries({ queryKey: [...STORE_KEY, 'credit-check'] });
  await client.invalidateQueries({ queryKey: [...STORE_KEY, 'statement'] });
  // «Сүүлд захиалсан бараа» on «Нүүр» changes with every order.
  await client.invalidateQueries({ queryKey: [...STORE_KEY, 'products', 'home'] });
}
