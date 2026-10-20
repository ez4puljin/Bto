import { describe, expect, it } from 'vitest';
import type { StoreQuote } from '../api/customer';
import {
  capitalised,
  checkoutFixes,
  daysAhead,
  emptyKindOf,
  lineDetailOf,
  pickupPlaceOf,
  priceNoteOf,
  quickDays,
  quoteFor,
  quotedLine,
  storeLineOf,
  topStoreCategories,
} from './shop';

const part = (
  productUnitId: number,
  qty: string,
  basis: 'WAREHOUSE' | 'LOOSE',
  unitPrice: string,
): StoreQuote['quote']['lines'][number]['parts'][number] => ({
  productUnitId,
  uomName: productUnitId === 1 ? 'ш' : 'хайрцаг',
  factorSnapshot: productUnitId === 1 ? '1' : '24',
  qty,
  qtyBase: qty,
  basis,
  listPrice: unitPrice,
  unitPrice,
  subtotal: '0',
  discountAmount: '0',
  total: '0',
  applied: [],
});

const quote = (
  lines: { productUnitId: number; qty: string; mayBackorder?: boolean }[],
): StoreQuote => ({
  quote: {
    list: 'WHOLESALE',
    date: '2026-10-19',
    lines: lines.map((line) => ({
      productId: 7,
      productUnitId: line.productUnitId,
      qty: line.qty,
      qtyBase: line.qty,
      priced: true,
      problem: null,
      parts: [],
      subtotal: '0',
      discountAmount: '0',
      total: '0',
    })),
    subtotal: '0',
    discountTotal: '0',
    total: '0',
  },
  stock: lines.map((line) => ({
    productUnitId: line.productUnitId,
    stock: 'LOW',
    mayBackorder: line.mayBackorder ?? false,
  })),
  orderDeals: [],
});

describe('«Bto300»: the shop (ADR-0079 #4)', () => {
  it('offers the top categories in the list’s order', () => {
    expect(
      topStoreCategories([
        { id: 3, parentId: null, name: 'Ус, ундаа' },
        { id: 4, parentId: 3, name: 'Ус' },
        { id: 1, parentId: null, name: 'Дарс' },
      ]),
    ).toEqual([
      { id: 3, name: 'Ус, ундаа' },
      { id: 1, name: 'Дарс' },
    ]);
  });

  it('tells an empty ★ list from a search that finds nothing', () => {
    expect(emptyKindOf({ q: '', categoryIds: [], favourites: true })).toBe('noFavourites');
    expect(emptyKindOf({ q: 'ус', categoryIds: [], favourites: true })).toBe('noMatch');
    expect(emptyKindOf({ q: '', categoryIds: [3], favourites: true })).toBe('noMatch');
    expect(emptyKindOf({ q: '', categoryIds: [], favourites: false })).toBe('noMatch');
  });

  it('makes a cart line of a product in a unit', () => {
    expect(
      storeLineOf(
        { id: 7, sku: '900000002', name: 'Алтан Цэвэр ус 0.33л', thumbUrl: '/t/7.webp' },
        {
          id: 70,
          uomName: 'хайрцаг',
          uomCode: 'BOX',
          factorToBase: '24',
          isBase: false,
          wholesale: '16800',
        },
      ),
    ).toEqual({
      productId: 7,
      productUnitId: 70,
      sku: '900000002',
      name: 'Алтан Цэвэр ус 0.33л',
      uomName: 'хайрцаг',
      uomCode: 'BOX',
      factorToBase: '24',
      isBase: false,
      wholesale: '16800',
      thumbUrl: '/t/7.webp',
    });
  });

  it('notes a whole pack’s pieces and a loose piece', () => {
    const product = { basePrice: '700' };
    expect(
      priceNoteOf(product, {
        isBase: false,
        factorToBase: '24.000000',
        wholesale: '16800',
        basis: 'WAREHOUSE',
      }),
    ).toEqual({ kind: 'pack', n: '24', amount: '700' });
    expect(
      priceNoteOf(product, { isBase: true, factorToBase: '1', wholesale: '800', basis: 'LOOSE' }),
    ).toEqual({ kind: 'loose' });
    expect(
      priceNoteOf(product, {
        isBase: true,
        factorToBase: '1',
        wholesale: '700',
        basis: 'WAREHOUSE',
      }),
    ).toBeNull();
    expect(
      priceNoteOf(product, { isBase: false, factorToBase: '24', wholesale: null, basis: null }),
    ).toBeNull();
    expect(
      priceNoteOf(product, {
        isBase: false,
        factorToBase: '24',
        wholesale: '17000',
        basis: 'MIXED',
      }),
    ).toBeNull();
  });
});

describe('«Bto300»: the quote on a product and in the cart (ADR-0079 #4, #5)', () => {
  it('finds a line’s answer only for its unit and quantity', () => {
    const answer = quote([
      { productUnitId: 70, qty: '3.000' },
      { productUnitId: 11, qty: '12.000', mayBackorder: true },
    ]);
    expect(quotedLine(answer, 11, '12')?.stock).toEqual({
      productUnitId: 11,
      stock: 'LOW',
      mayBackorder: true,
    });
    expect(quotedLine(answer, 70, '3')?.line.productUnitId).toBe(70);
    expect(quotedLine(answer, 70, '4')).toBeNull();
    expect(quotedLine(answer, 71, '3')).toBeNull();
    expect(quotedLine(undefined, 70, '3')).toBeNull();
  });

  it('knows when the quote is the cart’s', () => {
    const answer = quote([{ productUnitId: 70, qty: '3.000' }]);
    expect(quoteFor(answer, [{ productUnitId: 70, qty: '3' }])).toBe(answer);
    expect(quoteFor(answer, [{ productUnitId: 70, qty: '4' }])).toBeNull();
    expect(
      quoteFor(answer, [
        { productUnitId: 70, qty: '3' },
        { productUnitId: 11, qty: '1' },
      ]),
    ).toBeNull();
    expect(quoteFor(answer, [])).toBeNull();
    expect(quoteFor(undefined, [])).toBeNull();
  });

  it('words a cart row in pieces with one piece’s price, or in its parts', () => {
    const product = {
      basePrice: '700',
      units: [
        { id: 1, isBase: true },
        { id: 2, isBase: false },
      ],
    };
    const line = { qty: '3', factorToBase: '24' };
    const priced = (parts: ReturnType<typeof part>[]) => ({
      ...quote([{ productUnitId: 2, qty: '3' }]).quote.lines[0]!,
      parts,
    });
    expect(lineDetailOf(line, product, priced([part(2, '3', 'WAREHOUSE', '16800')]))).toEqual({
      kind: 'pieces',
      pieces: '72',
      perPiece: '700',
    });
    expect(
      lineDetailOf(
        { qty: '5', factorToBase: '1' },
        product,
        priced([part(1, '5', 'LOOSE', '800')]),
      ),
    ).toEqual({ kind: 'pieces', pieces: '5', perPiece: '800' });
    expect(
      lineDetailOf(
        { qty: '28', factorToBase: '1' },
        product,
        priced([part(2, '1.000', 'WAREHOUSE', '16800'), part(1, '4.000', 'LOOSE', '800')]),
      ),
    ).toEqual({
      kind: 'parts',
      parts: [
        { qty: '1', productUnitId: 2, uomName: 'хайрцаг' },
        { qty: '4', productUnitId: 1, uomName: 'ш' },
      ],
    });
    expect(lineDetailOf(line, undefined, undefined)).toEqual({
      kind: 'pieces',
      pieces: '72',
      perPiece: null,
    });
  });
});

describe('«Bto300»: the checkout (ADR-0079 #5)', () => {
  const options = {
    today: '2026-10-19',
    lastDay: '2026-12-18',
    addresses: [
      { id: 5, isDefault: false },
      { id: 6, isDefault: true },
    ],
  };

  it('chooses the default address and today for a new cart', () => {
    expect(
      checkoutFixes({ addressId: null, fulfilment: 'DELIVERY', deliveryDate: null }, options),
    ).toEqual([
      { type: 'address', addressId: 6 },
      { type: 'deliveryDate', date: '2026-10-19' },
    ]);
  });

  it('keeps a live address, a store that picks up, and a day in range', () => {
    expect(
      checkoutFixes({ addressId: 5, fulfilment: 'DELIVERY', deliveryDate: '2026-10-20' }, options),
    ).toEqual([]);
    expect(
      checkoutFixes({ addressId: null, fulfilment: 'PICKUP', deliveryDate: '2026-12-18' }, options),
    ).toEqual([{ type: 'address', addressId: 6 }, { type: 'pickup' }]);
  });

  it('replaces an address no longer live and a day out of range', () => {
    expect(
      checkoutFixes({ addressId: 9, fulfilment: 'DELIVERY', deliveryDate: '2026-10-18' }, options),
    ).toEqual([
      { type: 'address', addressId: 6 },
      { type: 'deliveryDate', date: '2026-10-19' },
    ]);
    expect(
      checkoutFixes({ addressId: 6, fulfilment: 'DELIVERY', deliveryDate: '2026-12-19' }, options),
    ).toEqual([{ type: 'deliveryDate', date: '2026-10-19' }]);
  });

  it('picks up when the store has no address', () => {
    const none = { ...options, addresses: [] };
    expect(
      checkoutFixes({ addressId: null, fulfilment: 'DELIVERY', deliveryDate: '2026-10-19' }, none),
    ).toEqual([{ type: 'pickup' }]);
    expect(
      checkoutFixes({ addressId: null, fulfilment: 'PICKUP', deliveryDate: '2026-10-19' }, none),
    ).toEqual([]);
  });

  it('offers today, tomorrow and the day after, and the days ahead', () => {
    expect(quickDays('2026-10-31', '2026-12-30')).toEqual([
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
    ]);
    expect(quickDays('2026-10-19', '2026-10-20')).toEqual(['2026-10-19', '2026-10-20']);
    expect(daysAhead('2026-10-19', '2026-12-18')).toBe(60);
    expect(daysAhead('2026-10-19', '2026-10-19')).toBe(0);
  });

  it('names where a store picks up', () => {
    expect(pickupPlaceOf(null)).toEqual({ kind: 'none' });
    expect(pickupPlaceOf({ branchName: 'Оргил', warehouses: [] })).toEqual({
      kind: 'branch',
      name: 'Оргил',
    });
    expect(pickupPlaceOf({ branchName: 'Оргил', warehouses: ['Төв агуулах'] })).toEqual({
      kind: 'one',
      name: 'Төв агуулах',
    });
    expect(pickupPlaceOf({ branchName: 'Оргил', warehouses: ['А', 'Б', 'В'] })).toEqual({
      kind: 'more',
      name: 'А',
      n: 2,
    });
  });

  it('capitalises a unit’s word for a button', () => {
    expect(capitalised('хайрцгаар')).toBe('Хайрцгаар');
    expect(capitalised('')).toBe('');
  });
});
