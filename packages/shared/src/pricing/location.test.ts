import { describe, expect, it } from 'vitest';
import { Decimal } from '../money';
import { lineBonuses } from './bonus';
import {
  type QuoteContext,
  type QuoteLineInput,
  type QuoteProduct,
  resolveQuote,
  unitPriceTable,
} from './cart';
import type { QuoteProgram } from './discounts';
import {
  applyLocationPricing,
  locationBasePrice,
  type LocationPriceSettings,
  markedUpPrice,
  markedUpRatioPrice,
} from './location';

const d = (n: string | number) => new Decimal(n);
const product: QuoteProduct = {
  categoryId: 1,
  units: [
    { unitId: 1, uomId: 1, factor: d(1), isBase: true },
    { unitId: 2, uomId: 2, factor: d(10), isBase: false },
  ],
  terms: {
    warehousePrice: d(100),
    wholeUomId: 2,
    profile: {
      looseMarkupPct: d(20),
      retailMarkupPct: d(30),
      retailBulkMinQty: null,
      retailBulkMarkupPct: null,
      rounding: 'WHOLE',
    },
  },
};
const setting = (
  pct = '0',
  priceType: LocationPriceSettings['priceType'] = 'ADDITIONAL',
): LocationPriceSettings => ({
  warehouseId: 5,
  priceType,
  markupPct: pct,
  markupAmount: '0',
  rounding: 'WHOLE',
});
const line = (qty = 1, unitId = 1): QuoteLineInput => ({
  productId: 1,
  unitId,
  qty: d(qty),
  qtyBase: d(qty).times(unitId === 2 ? 10 : 1),
});
const program = (
  effect: QuoteProgram['effect'],
  value: number,
  scope: QuoteProgram['scope'] = 'PRODUCT',
): QuoteProgram => ({
  id: 1,
  name: 'Deal',
  scope,
  measure: scope === 'PRODUCT' ? 'QTY' : 'AMOUNT',
  effect,
  productId: scope === 'PRODUCT' ? 1 : null,
  productUnitId: null,
  categoryIds: null,
  countUomId: null,
  steps: [{ threshold: d(effect === 'BONUS' ? 2 : 0), value: d(value) }],
});
const context = (
  rule: LocationPriceSettings | null,
  programs: QuoteProgram[] = [],
): QuoteContext => ({
  list: 'RETAIL',
  products: applyLocationPricing(new Map([[1, product]]), rule),
  programs,
});

describe('supplier base and explicit location prices', () => {
  it('always derives from the canonical base when switching or reapplying locations', () => {
    const once = applyLocationPricing(new Map([[1, product]]), setting('20'));
    expect(applyLocationPricing(once, setting('20')).get(1)?.terms?.warehousePrice.toFixed()).toBe(
      '120',
    );
    expect(
      applyLocationPricing(once, setting('0', 'BASE')).get(1)?.terms?.warehousePrice.toFixed(),
    ).toBe('100');
  });

  it('leaves an unsupported overflowing location price visibly unpriced', () => {
    const own = {
      ...product,
      terms: product.terms ? { ...product.terms, warehousePrice: d('999999999999') } : null,
    };
    const products = applyLocationPricing(new Map([[1, own]]), setting('100'));
    const result = resolveQuote([line()], { list: 'RETAIL', products, programs: [] });
    expect(result.lines[0]).toEqual({ priced: false, problem: 'PRICE_MISSING' });
    expect(lineBonuses([line()], result, [], products)).toEqual([null]);
    const direct = resolveQuote([{ ...line(), locationPricing: setting('100') }], {
      list: 'RETAIL',
      products: new Map([[1, own]]),
      programs: [],
    });
    expect(direct.lines[0]).toEqual({ priced: false, problem: 'PRICE_MISSING' });
  });
  it('rounds a recurring printed ratio once after the supplier uplift', () => {
    expect(markedUpRatioPrice(d(100), d(3), d('0.5'), d(0), 'WHOLE').toFixed()).toBe('34');
    expect(markedUpRatioPrice(d(100), d(3), d('0.5'), d(2), 'WHOLE').toFixed()).toBe('36');
  });

  it('keeps fractional-unit previews on the same normal floor as checkout', () => {
    const fractional = { unitId: 3, uomId: 3, factor: d('0.121'), isBase: false };
    const own = { ...product, units: [...product.units, fractional] };
    const products = applyLocationPricing(new Map([[1, own]]), setting('0', 'BASE'));
    const terms = products.get(1)?.terms;
    if (!terms) throw new Error('missing configured terms');
    expect(
      unitPriceTable(terms, own.units)
        .find((u) => u.unitId === 3)
        ?.retail.toFixed(),
    ).toBe('13');
    expect(
      resolveQuote([{ productId: 1, unitId: 3, qty: d(1), qtyBase: d('0.121') }], {
        list: 'RETAIL',
        products,
        programs: [],
      }).total.toFixed(),
    ).toBe('13');
  });
  it('computes percentage, amount and their ordered combination from the printed price', () => {
    expect(markedUpPrice(d(10000), d(10), d(0), 'WHOLE').toFixed()).toBe('11000');
    expect(markedUpPrice(d(10000), d(0), d(500), 'WHOLE').toFixed()).toBe('10500');
    expect(markedUpPrice(d(10000), d(5), d(200), 'WHOLE').toFixed()).toBe('10700');
    expect(markedUpPrice(d(0), d(10), d(200), 'WHOLE').toFixed()).toBe('200');
  });

  it('never rounds an additional location below its base', () => {
    expect(locationBasePrice(d(107), { ...setting(), rounding: 'DOWN_100' }).toFixed()).toBe('107');
  });

  it('retains legacy profiles when no location was configured', () => {
    expect(resolveQuote([line()], context(null)).total.toFixed()).toBe('130');
  });

  it('uses base for loose pieces and complete packs on both channels', () => {
    for (const list of ['RETAIL', 'WHOLESALE'] as const) {
      const ctx = { ...context(setting('0', 'BASE')), list };
      expect(resolveQuote([line(13)], ctx).total.toFixed()).toBe('1300');
      expect(resolveQuote([line(2, 2)], ctx).total.toFixed()).toBe('2000');
    }
  });

  it('applies the additional rule once instead of stacking the legacy retail uplift', () => {
    expect(
      resolveQuote([line(2)], context({ ...setting('15'), markupAmount: '5' })).total.toFixed(),
    ).toBe('240');
  });

  it('clips percentage, amount and coupon cuts to the normal base floor', () => {
    for (const p of [program('PERCENT', 90), program('AMOUNT', 1000, 'ORDER')]) {
      expect(resolveQuote([line(2)], context(setting('20'), [p])).total.toFixed()).toBe('200');
    }
    expect(
      resolveQuote([line(2)], {
        ...context(setting('20')),
        coupons: [{ code: 'CUT', name: 'Cut', effect: 'AMOUNT', value: d(9999) }],
      }).total.toFixed(),
    ).toBe('200');
  });

  it('does not advertise paid-entry free units below the threshold when the full bonus violates the floor', () => {
    for (const pct of ['0', '20']) {
      const ctx = context(setting(pct), [program('BONUS', 1)]);
      const result = resolveQuote([line()], ctx);
      expect(lineBonuses([line()], result, ctx.programs, ctx.products)).toEqual([null]);
      const full = resolveQuote([line(3)], ctx);
      expect(full.total.toFixed()).toBe(pct === '0' ? '300' : '360');
      expect(lineBonuses([line(3)], full, ctx.programs, ctx.products)).toEqual([null]);
    }
  });

  it('keeps a complete viable N+M and its paid-entry metadata', () => {
    const ctx = context(setting('100'), [program('BONUS', 1)]);
    const probe = resolveQuote([line()], ctx);
    expect(lineBonuses([line()], probe, ctx.programs, ctx.products)[0]?.paidEntry).toBe(true);
    const full = resolveQuote([line(3)], ctx);
    expect(full.total.toFixed()).toBe('400');
    expect(lineBonuses([line(3)], full, ctx.programs, ctx.products)[0]?.freeQty.toFixed()).toBe(
      '1',
    );
  });

  it('supports different locations on two lines of the same product in one order', () => {
    const lines = [
      { ...line(), locationPricing: setting('0', 'BASE') },
      { ...line(), locationPricing: setting('50') },
    ];
    const result = resolveQuote(lines, context(null));
    expect(result.lines.map((r) => (r.priced ? r.total.toFixed() : ''))).toEqual(['100', '150']);
  });

  it('preserves an approved expiry price below the normal base and outside coupons', () => {
    const result = resolveQuote([{ ...line(2), fixedBaseUnitPrice: d(10) }, line()], {
      ...context(setting('20')),
      coupons: [{ code: 'ALL', name: 'All', effect: 'PERCENT', value: d(100) }],
    });
    expect(result.lines.map((r) => (r.priced ? r.total.toFixed() : ''))).toEqual(['20', '100']);
  });
});
