import { describe, expect, it } from 'vitest';
import {
  addProduct,
  itemsOf,
  type LabelLine,
  type LabelProduct,
  listFrom,
  MAX_LABELS,
  removeLine,
  roomLeft,
  setCopies,
  totalLabels,
} from './list';
import { prefsFrom } from './prefs';

const product = (productId: number): LabelProduct => ({
  productId,
  name: `Бараа ${productId}`,
  code: `C${productId}`,
  barcodes: [`49000000000${productId}`],
  unit: 'ш',
  price: '1500',
  bulkQty: null,
  bulkPrice: null,
});

describe('the label list', () => {
  it('adds a product with its copies and merges a second add into the same line', () => {
    const one = addProduct([], product(1), 2).list;
    expect(one).toHaveLength(1);
    expect(one[0]?.copies).toBe(2);
    const two = addProduct(one, product(1), 1).list;
    expect(two).toHaveLength(1);
    expect(two[0]?.copies).toBe(3);
    expect(totalLabels(addProduct(two, product(2)).list)).toBe(4);
  });

  it('keeps a line within 1–20 copies', () => {
    expect(addProduct([], product(1), 99).list[0]?.copies).toBe(20);
    const full = addProduct([], product(1), 20);
    expect(addProduct(full.list, product(1), 1).list[0]?.copies).toBe(20);
    expect(setCopies(full.list, 1, 0).list[0]?.copies).toBe(1);
    expect(setCopies(full.list, 1, 50).list[0]?.copies).toBe(20);
  });

  it('never holds more than 100 labels and says when it left some out', () => {
    let list: LabelLine[] = [];
    for (let id = 1; id <= 5; id += 1) list = addProduct(list, product(id), 20).list;
    expect(totalLabels(list)).toBe(MAX_LABELS);
    expect(roomLeft(list)).toBe(0);
    const more = addProduct(list, product(6), 1);
    expect(more.capped).toBe(true);
    expect(more.list).toHaveLength(5);

    let almost: LabelLine[] = [];
    for (let id = 1; id <= 4; id += 1) almost = addProduct(almost, product(id), 20).list;
    const full = addProduct(almost, product(6), 30);
    expect(full.capped).toBe(false);
    expect(totalLabels(full.list)).toBe(100);
    almost = addProduct(removeLine(almost, 4), product(5), 10).list;
    almost = addProduct(almost, product(6), 5).list;
    const raised = setCopies(almost, 5, 20);
    expect(totalLabels(almost)).toBe(75);
    expect(raised.capped).toBe(false);
    const over = setCopies(addProduct(almost, product(7), 20).list, 5, 20);
    expect(over.capped).toBe(true);
    expect(totalLabels(over.list)).toBe(MAX_LABELS);
    const lowered = setCopies(list, 1, 5);
    expect(lowered.capped).toBe(false);
    expect(totalLabels(lowered.list)).toBe(85);
  });

  it('removes a line and gives the server its items', () => {
    const list = addProduct(addProduct([], product(1), 3).list, product(2), 1).list;
    expect(itemsOf(removeLine(list, 1))).toEqual([{ productId: 2, copies: 1 }]);
  });

  it('comes back from storage as it was, dropping what is broken', () => {
    const list = addProduct(addProduct([], product(1), 3).list, product(2), 2).list;
    expect(listFrom(JSON.parse(JSON.stringify(list)))).toEqual(list);
    expect(listFrom(null)).toEqual([]);
    expect(listFrom('x')).toEqual([]);
    expect(listFrom([{ productId: 'a' }, null, { ...list[0], copies: 500 }])[0]?.copies).toBe(20);
    expect(listFrom([list[0], list[0]])).toHaveLength(1);
    const oversized = Array.from({ length: 10 }, (_, at) => ({ ...product(at + 1), copies: 20 }));
    expect(totalLabels(listFrom(oversized))).toBe(MAX_LABELS);
  });
});

describe('the remembered choices', () => {
  it('reads a till and either printer, and nothing else', () => {
    expect(prefsFrom({ tillId: 3, printer: { kind: 'pc', stationId: 7 } })).toEqual({
      tillId: 3,
      printer: { kind: 'pc', stationId: 7 },
    });
    expect(
      prefsFrom({ tillId: 3, printer: { kind: 'bluetooth', address: 'AA:BB', name: 'P' } }).printer,
    ).toEqual({ kind: 'bluetooth', address: 'AA:BB', name: 'P' });
    expect(prefsFrom({ tillId: 'x', printer: { kind: 'pc' } })).toEqual({
      tillId: null,
      printer: null,
    });
    expect(prefsFrom(null)).toEqual({ tillId: null, printer: null });
  });
});
