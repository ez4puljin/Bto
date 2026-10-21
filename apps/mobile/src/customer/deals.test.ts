import { describe, expect, it } from 'vitest';
import type { StoreDeal, StoreOrderDeal } from '../api/customer';
import { cardPriceOf, dealSentenceOf, dealToneOf, orderDealHintsOf } from './deals';

const deal = (over: Partial<StoreDeal> = {}): StoreDeal => ({
  kind: 'DISCOUNT',
  label: '−3%',
  programId: 1,
  programName: 'Ус',
  scope: 'PRODUCT',
  effect: 'PERCENT',
  value: '3',
  threshold: null,
  perUnitName: null,
  lastDay: null,
  ...over,
});

describe('discount programs on the cards (ADR-0092 #3, #7)', () => {
  it('paints a promotion orange and a discount red', () => {
    expect(dealToneOf('PROMOTION')).toBe('promotion');
    expect(dealToneOf('DISCOUNT')).toBe('discount');
  });

  it('strikes the regular price through only under a lower deal price', () => {
    expect(cardPriceOf({ basePrice: null, dealPrice: null })).toBeNull();
    expect(cardPriceOf({ basePrice: '2100', dealPrice: null })).toEqual({
      price: '2100',
      old: null,
    });
    expect(cardPriceOf({ basePrice: '2100', dealPrice: '1900' })).toEqual({
      price: '1900',
      old: '2100',
    });
    expect(cardPriceOf({ basePrice: '2100', dealPrice: '2100' })).toEqual({
      price: '2100',
      old: null,
    });
  });
});

describe('the product page sentence', () => {
  it('says a quantity step, its unit and the percentage', () => {
    expect(
      dealSentenceOf(deal({ threshold: { qty: '20.000', unitName: 'хайрцаг', amount: null } })),
    ).toEqual({
      until: null,
      condition: { kind: 'qty', qty: '20', unit: 'хайрцаг', category: false },
      effect: { kind: 'percent', value: '3' },
    });
  });

  it('keeps a quantity without a unit name bare', () => {
    expect(
      dealSentenceOf(deal({ threshold: { qty: '10', unitName: '', amount: null } })).condition,
    ).toEqual({ kind: 'qty', qty: '10', unit: null, category: false });
  });

  it('says a category amount step', () => {
    expect(
      dealSentenceOf(
        deal({ scope: 'CATEGORY', threshold: { qty: null, unitName: null, amount: '500000' } }),
      ).condition,
    ).toEqual({ kind: 'amount', amount: '500,000', category: true });
  });

  it('says tugriks off per pack, a new price, and a promotion last day', () => {
    expect(
      dealSentenceOf(deal({ effect: 'AMOUNT', value: '200', perUnitName: 'хайрцаг' })).effect,
    ).toEqual({ kind: 'amount', value: '200', per: 'хайрцаг' });
    expect(dealSentenceOf(deal({ effect: 'PRICE', value: '16800' })).effect).toEqual({
      kind: 'price',
      value: '16,800',
      per: null,
    });
    const promotion = dealSentenceOf(
      deal({ kind: 'PROMOTION', value: '2.5', lastDay: '2026-10-31' }),
    );
    expect(promotion.until).toBe('10/31');
    expect(promotion.condition).toBeNull();
    expect(promotion.effect).toEqual({ kind: 'percent', value: '2.5' });
  });
});

describe('the cart hint of order amount programs', () => {
  const program = (over: Partial<StoreOrderDeal>): StoreOrderDeal => ({
    programId: 9,
    name: 'Их захиалга',
    effect: 'PERCENT',
    reached: null,
    next: null,
    ...over,
  });

  it('says the next step and what is missing', () => {
    expect(
      orderDealHintsOf([program({ next: { threshold: '500000', value: '3', missing: '120000' } })]),
    ).toEqual([
      { kind: 'next', percent: true, threshold: '500,000', value: '3', missing: '120,000' },
    ]);
  });

  it('says the step reached once the last one is passed, tugriks off as money', () => {
    expect(
      orderDealHintsOf([
        program({
          effect: 'AMOUNT',
          reached: { threshold: '1000000', value: '20000', missing: null },
        }),
      ]),
    ).toEqual([{ kind: 'reached', percent: false, value: '20,000' }]);
  });

  it('prefers the next step over the one reached, and drops an empty program', () => {
    expect(
      orderDealHintsOf([
        program({
          reached: { threshold: '500000', value: '3', missing: null },
          next: { threshold: '1000000', value: '5', missing: '300000' },
        }),
        program({ programId: 10 }),
      ]),
    ).toEqual([
      { kind: 'next', percent: true, threshold: '1,000,000', value: '5', missing: '300,000' },
    ]);
  });
});
