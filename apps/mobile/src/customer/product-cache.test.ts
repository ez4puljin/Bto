import { describe, expect, it } from 'vitest';
import { productsIn, withFavourite } from './product-cache';

const p = (id: number, favourite = false) => ({ id, favourite, name: `P${id}` });

describe('the cached products (♡ everywhere, ADR-0092 #7)', () => {
  const batch = [p(1), p(2)];
  const pages = { pages: [{ data: [p(1)], nextCursor: 'x' }, { data: [p(3)] }], pageParams: [] };
  const home = {
    today: '2026-10-20',
    banners: [{ id: 1 }],
    sections: [
      { key: 'recent', products: [p(1), p(4)] },
      { key: 'new', products: [p(1, false)] },
    ],
  };

  it('finds the products of a batch, pages, the home and a category page', () => {
    expect(productsIn(batch).map((row) => row.id)).toEqual([1, 2]);
    expect(productsIn(pages).map((row) => row.id)).toEqual([1, 3]);
    expect(productsIn(home).map((row) => row.id)).toEqual([1, 4, 1]);
    expect(productsIn(undefined)).toEqual([]);
    expect(productsIn(42)).toEqual([]);
    expect(productsIn({ total: 3 })).toEqual([]);
    expect(productsIn([{ id: 1 }, null, 'x'])).toEqual([]);
  });

  it('marks every copy of the product and leaves the rest alone', () => {
    expect(withFavourite(batch, 2, true)).toEqual([p(1), p(2, true)]);
    const marked = withFavourite(pages, 1, true);
    expect(marked.pages[0]?.data).toEqual([p(1, true)]);
    expect(marked.pages[0]?.nextCursor).toBe('x');
    expect(marked.pages[1]?.data).toEqual([p(3)]);
    const markedHome = withFavourite(home, 1, true);
    expect(markedHome.sections.map((section) => section.products)).toEqual([
      [p(1, true), p(4)],
      [p(1, true)],
    ]);
    expect(markedHome.banners).toBe(home.banners);
    expect(markedHome.today).toBe('2026-10-20');
  });

  it('returns answers without products unchanged', () => {
    expect(withFavourite(undefined, 1, true)).toBeUndefined();
    expect(withFavourite(7, 1, true)).toBe(7);
    const total = { total: 3 };
    expect(withFavourite(total, 1, true)).toBe(total);
  });
});
