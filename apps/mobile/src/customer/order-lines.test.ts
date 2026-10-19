import { describe, expect, it } from 'vitest';
import { fitReorder, orderDayOf, skippedByReason } from './order-lines';

const entry = (productUnitId: number) => ({
  qty: 1,
  line: {
    productId: productUnitId * 10,
    productUnitId,
    sku: `S${productUnitId}`,
    name: `P${productUnitId}`,
    uomName: 'хайрцаг',
    uomCode: 'BOX',
    factorToBase: '12',
    isBase: false,
    wholesale: '20000',
    thumbUrl: null,
  },
});

describe('«Bto300»: the Orders board’s day headings (ADR-0079 #6)', () => {
  it('names today and yesterday, and dates the rest with their weekday', () => {
    expect(orderDayOf('2026-10-18', '2026-10-18')).toEqual({
      name: 'today',
      day: '10/18',
      weekday: 0,
    });
    expect(orderDayOf('2026-10-17', '2026-10-18')).toEqual({
      name: 'yesterday',
      day: '10/17',
      weekday: 6,
    });
    expect(orderDayOf('2026-10-16', '2026-10-18')).toEqual({
      name: null,
      day: '10/16',
      weekday: 5,
    });
    expect(orderDayOf('2026-10-19', '2026-10-18').name).toBeNull();
    expect(orderDayOf('2026-10-18', null).name).toBeNull();
  });
});

describe('«Bto300»: «Дахин захиалах» into a cart with a line limit', () => {
  it('adds to lines already in the cart and new lines only while there is room', () => {
    const { fits, full } = fitReorder(
      [entry(1), entry(2), entry(3)],
      [{ productId: 20, productUnitId: 2 }],
      2,
    );
    expect(fits.map((line) => line.line.productUnitId)).toEqual([1, 2]);
    expect(full.map((line) => line.line.productUnitId)).toEqual([3]);
  });

  it('keeps one line per product: another unit of a product in the cart or the plan stays out', () => {
    const box = entry(1);
    const piece = { ...entry(9), line: { ...entry(9).line, productId: box.line.productId } };
    const inCart = fitReorder([piece, entry(2)], [{ productId: 10, productUnitId: 1 }], 150);
    expect(inCart.fits.map((line) => line.line.productUnitId)).toEqual([2]);
    expect(inCart.otherUnit.map((line) => line.line.productUnitId)).toEqual([9]);
    const inPlan = fitReorder([box, piece], [], 150);
    expect(inPlan.fits.map((line) => line.line.productUnitId)).toEqual([1]);
    expect(inPlan.otherUnit.map((line) => line.line.productUnitId)).toEqual([9]);
  });

  it('fits everything into a cart with room', () => {
    const { fits, full } = fitReorder([entry(1), entry(2)], [], 150);
    expect(fits).toHaveLength(2);
    expect(full).toEqual([]);
  });

  it('groups what was skipped by reason, named from the answer or the order', () => {
    const names = new Map([
      [7, 'Coca-Cola 0.5л'],
      [8, 'Алтан ус'],
    ]);
    expect(
      skippedByReason(
        [
          { productId: 9, name: 'Талх', reason: 'UNAVAILABLE' },
          { productId: 7, name: null, reason: 'OUT_OF_STOCK' },
          { productId: 7, name: null, reason: 'OUT_OF_STOCK' },
          { productId: 8, name: 'Алтан ус', reason: 'CART_FULL' },
          { productId: 99, name: null, reason: 'UNAVAILABLE' },
        ],
        (id) => names.get(id) ?? null,
      ),
    ).toEqual([
      { reason: 'OUT_OF_STOCK', names: ['Coca-Cola 0.5л'], unnamed: 0 },
      { reason: 'UNAVAILABLE', names: ['Талх'], unnamed: 1 },
      { reason: 'CART_FULL', names: ['Алтан ус'], unnamed: 0 },
    ]);
    expect(skippedByReason([], () => null)).toEqual([]);
  });
});
