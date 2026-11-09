import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { mapProducts } from '../customer/product-cache';
import {
  applyLiveEvent,
  applyStockItems,
  withCustomerStock,
  withStaffStock,
} from './live-stock-cache';

const rep = (id: number, available = '10', stockBlocked = false) => ({
  id,
  name: `P${id}`,
  sellable: true,
  available,
  stockBlocked,
});
const store = (id: number, stock: 'IN' | 'LOW' | 'OUT' = 'IN', available?: string) => ({
  id,
  name: `P${id}`,
  favourite: false,
  stock,
  ...(available !== undefined ? { available } : {}),
});

describe('the cached products patched in place (ADR-0173 #4)', () => {
  const staffItems = new Map([
    [2, { productId: 2, available: '4', stockBlocked: false }],
    [3, { productId: 3, available: '0', stockBlocked: true }],
  ]);

  it('patches a batch, the pages and the sections, and only the products named', () => {
    expect(withStaffStock([rep(1), rep(2)], staffItems)).toEqual([rep(1), rep(2, '4')]);
    const pages = {
      pages: [
        { data: [rep(1), rep(3)], nextCursor: 'x', total: 2 },
        { data: [rep(4)], nextCursor: null },
      ],
      pageParams: [undefined, 'x'],
    };
    const patched = withStaffStock(pages, staffItems);
    expect(patched.pages[0]).toEqual({
      data: [rep(1), rep(3, '0', true)],
      nextCursor: 'x',
      total: 2,
    });
    expect(patched.pages[1]).toBe(pages.pages[1]);
    expect(patched.pageParams).toBe(pages.pageParams);
    const home = {
      banners: [{ id: 2 }],
      sections: [
        { key: 'new', products: [rep(2), rep(5)] },
        { key: 'deals', products: [] },
      ],
    };
    const patchedHome = withStaffStock(home, staffItems);
    expect(patchedHome.sections[0]?.products).toEqual([rep(2, '4'), rep(5)]);
    expect(patchedHome.sections[1]).toBe(home.sections[1]);
    expect(patchedHome.banners).toBe(home.banners);
  });

  it('returns the very same answer when nothing changed', () => {
    const batch = [rep(2, '4'), rep(9)];
    expect(withStaffStock(batch, staffItems)).toBe(batch);
    const pages = { pages: [{ data: [rep(9)] }], pageParams: [] };
    expect(withStaffStock(pages, staffItems)).toBe(pages);
    expect(withStaffStock(undefined, staffItems)).toBeUndefined();
    const total = { total: 3 };
    expect(withStaffStock(total, staffItems)).toBe(total);
    expect(mapProducts([{ id: 'x' }, null, 4], () => ({ id: 0 }))).toEqual([{ id: 'x' }, null, 4]);
  });

  it('gives «Bto300» the word, and the number only when the event carries one', () => {
    const items = new Map([
      [1, { productId: 1, stock: 'LOW' as const, available: '3' }],
      [2, { productId: 2, stock: 'OUT' as const }],
    ]);
    expect(withCustomerStock([store(1), store(2, 'IN', '40'), store(3)], items)).toEqual([
      store(1, 'LOW', '3'),
      store(2, 'OUT'),
      store(3),
    ]);
    const same = [store(1, 'LOW', '3')];
    expect(withCustomerStock(same, items)).toBe(same);
    // A staff product (no word) is never taken for a store's.
    const staff = [rep(1)];
    expect(withCustomerStock(staff, items)).toBe(staff);
  });
});

describe('the live events in the query cache (ADR-0173 #4)', () => {
  function client() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } });
    queryClient.setQueryData(['rep', 'products', { sort: 'NAME' }], {
      pages: [{ data: [rep(1), rep(2)], total: 2 }],
      pageParams: [undefined],
    });
    queryClient.setQueryData(['rep', 'products', { inStock: true, sort: 'NAME' }], {
      pages: [{ data: [rep(2)], total: 1 }],
      pageParams: [undefined],
    });
    queryClient.setQueryData(['rep', 'products', 'of', '2', undefined], [rep(2)]);
    queryClient.setQueryData(['rep', 'quote', 'x'], { lines: [] });
    queryClient.setQueryData(['customer', 'products', 'home'], {
      sections: [{ key: 'new', products: [store(2)] }],
    });
    queryClient.setQueryData(['customer', 'quote', 'x'], { lines: [], stock: [] });
    return queryClient;
  }
  const stale = (queryClient: QueryClient, key: unknown[]) =>
    queryClient.getQueryCache().find({ queryKey: key, exact: true })?.state.isInvalidated;

  it('patches every staff copy, marks in-stock lists stale and leaves the prices alone', () => {
    const queryClient = client();
    applyStockItems(queryClient, 'STAFF', [{ productId: 2, available: '0', stockBlocked: true }]);
    expect(queryClient.getQueryData(['rep', 'products', 'of', '2', undefined])).toEqual([
      rep(2, '0', true),
    ]);
    expect(
      queryClient.getQueryData<{ pages: { data: unknown[] }[] }>([
        'rep',
        'products',
        { sort: 'NAME' },
      ])?.pages[0]?.data,
    ).toEqual([rep(1), rep(2, '0', true)]);
    expect(stale(queryClient, ['rep', 'products', { inStock: true, sort: 'NAME' }])).toBe(true);
    expect(stale(queryClient, ['rep', 'products', { sort: 'NAME' }])).toBe(false);
    expect(stale(queryClient, ['rep', 'quote', 'x'])).toBe(false);
    // «Bto300»'s cache is not the staff app's.
    expect(
      queryClient.getQueryData<{ sections: { products: unknown[] }[] }>([
        'customer',
        'products',
        'home',
      ])?.sections[0]?.products,
    ).toEqual([store(2)]);
  });

  it('patches «Bto300»’s copies and refetches its quotes', () => {
    const queryClient = client();
    applyLiveEvent(queryClient, 'CUSTOMER', {
      type: 'stock',
      items: [{ productId: 2, stock: 'LOW' }],
    });
    expect(
      queryClient.getQueryData<{ sections: { products: unknown[] }[] }>([
        'customer',
        'products',
        'home',
      ])?.sections[0]?.products,
    ).toEqual([store(2, 'LOW')]);
    expect(stale(queryClient, ['customer', 'quote', 'x'])).toBe(true);
    expect(stale(queryClient, ['customer', 'products', 'home'])).toBe(false);
  });

  it('marks every stock query of the app stale on ready and resync, nothing on ping', () => {
    const queryClient = client();
    applyLiveEvent(queryClient, 'STAFF', { type: 'ping' });
    expect(stale(queryClient, ['rep', 'products', { sort: 'NAME' }])).toBe(false);
    applyLiveEvent(queryClient, 'STAFF', { type: 'ready' });
    expect(stale(queryClient, ['rep', 'products', { sort: 'NAME' }])).toBe(true);
    expect(stale(queryClient, ['rep', 'products', 'of', '2', undefined])).toBe(true);
    expect(stale(queryClient, ['customer', 'products', 'home'])).toBe(false);
    applyLiveEvent(queryClient, 'CUSTOMER', { type: 'resync' });
    expect(stale(queryClient, ['customer', 'products', 'home'])).toBe(true);
    expect(stale(queryClient, ['customer', 'quote', 'x'])).toBe(true);
  });
});
