import { describe, expect, it } from 'vitest';
import { Decimal } from '../money';
import { bonusLabel, bonusSplit, bonusTotalFromPaid, lineBonuses } from './bonus';
import { type QuoteLineInput, type QuoteProduct, type QuoteUnit, resolveQuote } from './cart';
import type { QuoteProgram } from './discounts';

const d = (value: string | number) => new Decimal(value);

describe('N+M by the paid quantity', () => {
  it.each([
    // paid, N, M, total sent
    [1, 2, 1, '1'],
    [2, 2, 1, '3'],
    [3, 2, 1, '4'],
    [20, 2, 1, '30'],
    [21, 2, 1, '31'],
    [1, 1, 1, '2'],
    [5, 1, 1, '10'],
    [12, 5, 1, '14'],
    [0, 2, 1, '0'],
  ])('%i paid on %i+%i sends %s', (paid, n, m, total) => {
    expect(bonusTotalFromPaid(d(paid), d(n), d(m)).toFixed()).toBe(total);
  });

  it.each([
    // total, N, M, paid, free
    [30, 2, 1, '20', '10'],
    [3, 2, 1, '2', '1'],
    [2, 2, 1, '2', '0'],
    [31, 2, 1, '21', '10'],
    [10, 1, 1, '5', '5'],
    [14, 5, 1, '12', '2'],
  ])('%i on %i+%i is %s paid and %s free', (total, n, m, paid, free) => {
    const split = bonusSplit(d(total), d(n), d(m));
    expect(split.paid.toFixed()).toBe(paid);
    expect(split.free.toFixed()).toBe(free);
  });

  it('gives back the paid quantity it was sent for, for every N+M up to 5+3', () => {
    for (let n = 1; n <= 5; n += 1) {
      for (let m = 1; m <= 3; m += 1) {
        for (let paid = 1; paid <= 40; paid += 1) {
          const total = bonusTotalFromPaid(d(paid), d(n), d(m));
          expect(bonusSplit(total, d(n), d(m)).paid.toFixed()).toBe(String(paid));
        }
      }
    }
  });

  it('names the program as the badges do', () => {
    expect(bonusLabel(d(2), d(1))).toBe('2+1');
    expect(bonusLabel(d('1.000'), d('1.000'))).toBe('1+1');
  });
});

describe('lineBonuses', () => {
  const pcs: QuoteUnit = { unitId: 11, uomId: 1, factor: d(1), isBase: true };
  const box: QuoteUnit = { unitId: 12, uomId: 2, factor: d(12), isBase: false };
  const other: QuoteUnit = { unitId: 21, uomId: 1, factor: d(1), isBase: true };
  const products = new Map<number, QuoteProduct>([
    [
      1,
      {
        categoryId: 1,
        units: [pcs, box],
        terms: {
          warehousePrice: d(1000),
          wholeUomId: null,
          profile: {
            looseMarkupPct: d(0),
            retailMarkupPct: d(0),
            retailBulkMinQty: null,
            retailBulkMarkupPct: null,
            rounding: 'WHOLE',
          },
        },
      },
    ],
    [
      2,
      {
        categoryId: 1,
        units: [other],
        terms: {
          warehousePrice: d(500),
          wholeUomId: null,
          profile: {
            looseMarkupPct: d(0),
            retailMarkupPct: d(0),
            retailBulkMinQty: null,
            retailBulkMarkupPct: null,
            rounding: 'WHOLE',
          },
        },
      },
    ],
  ]);
  const twoPlusOne: QuoteProgram = {
    id: 5,
    name: '2+1',
    scope: 'PRODUCT',
    measure: 'QTY',
    effect: 'BONUS',
    productId: null,
    productUnitId: null,
    categoryIds: null,
    productIds: new Set([1]),
    countUomId: null,
    steps: [{ threshold: d(2), value: d(1) }],
  };
  const line = (productId: number, of: QuoteUnit, qty: number): QuoteLineInput => ({
    productId,
    unitId: of.unitId,
    qty: d(qty),
    qtyBase: d(qty).times(of.factor),
  });
  const run = (lines: QuoteLineInput[], programs: QuoteProgram[] = [twoPlusOne]) =>
    lineBonuses(
      lines,
      resolveQuote(lines, { list: 'RETAIL', products, programs }),
      programs,
      products,
    ).map((bonus) =>
      bonus
        ? {
            n: bonus.n.toFixed(),
            m: bonus.m.toFixed(),
            free: bonus.freeQty.toFixed(),
            paid: bonus.paidQty.toFixed(),
            amount: bonus.freeAmount.toFixed(),
            paidEntry: bonus.paidEntry,
          }
        : null,
    );

  it('splits 30 pieces of a 2+1 into 20 paid and 10 free, and leaves other products alone', () => {
    expect(run([line(1, pcs, 30), line(2, other, 3)])).toEqual([
      { n: '2', m: '1', free: '10', paid: '20', amount: '10000', paidEntry: true },
      null,
    ]);
  });

  it('knows the program before the first free piece', () => {
    expect(run([line(1, pcs, 1)])).toEqual([
      { n: '2', m: '1', free: '0', paid: '1', amount: '0', paidEntry: true },
    ]);
  });

  it('shows a box line its free part without entering it by the paid quantity', () => {
    // 3 boxes = 36 pieces: 12 free, one box.
    expect(run([line(1, box, 3)])).toEqual([
      { n: '2', m: '1', free: '1', paid: '2', amount: '12000', paidEntry: false },
    ]);
  });

  it('shares the product’s free pieces over its two lines as the engine shares the cut', () => {
    // 1 box + 6 pieces = 18 pieces: 6 free, cut 6,000 split 12,000 : 6,000.
    const [boxes, pieces] = run([line(1, box, 1), line(1, pcs, 6)]);
    expect(boxes).toMatchObject({ free: '0.333', amount: '4000', paidEntry: false });
    expect(pieces).toMatchObject({ free: '2', paid: '4', amount: '2000', paidEntry: false });
  });

  it('has none when a priority program took the line alone', () => {
    const priority: QuoteProgram = {
      ...twoPlusOne,
      id: 9,
      name: 'priority',
      effect: 'PERCENT',
      priority: true,
      steps: [{ threshold: d(0), value: d(10) }],
    };
    expect(run([line(1, pcs, 30)], [twoPlusOne, priority])).toEqual([null]);
  });
});
