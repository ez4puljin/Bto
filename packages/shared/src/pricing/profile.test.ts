import { describe, expect, it } from 'vitest';
import { Decimal } from '../money';
import {
  defaultWholeUomId,
  markedUp,
  type PackUnit,
  perBasePrices,
  priceProfileIssue,
  type PriceProfileValues,
  roundPrice,
  unitPriceOf,
  wholeUnitProblem,
} from './profile';

const d = (value: string | number) => new Decimal(value);

const profile = (fields: Partial<PriceProfileValues> = {}): PriceProfileValues => ({
  looseMarkupPct: d(15),
  retailMarkupPct: d(30),
  retailBulkMinQty: d(24),
  retailBulkMarkupPct: d(20),
  rounding: 'WHOLE',
  ...fields,
});

describe('rounding a derived price', () => {
  it.each([
    ['1000', '33', '1330', '1330', '1350', '1400'],
    ['1010', '5', '1061', '1070', '1100', '1100'],
    ['1234', '12.5', '1388', '1390', '1400', '1400'],
  ])('%s₮ + %s%%: whole, up to 10, 50 and 100', (price, pct, whole, up10, up50, up100) => {
    expect(markedUp(d(price), d(pct), 'WHOLE').toFixed()).toBe(whole);
    expect(markedUp(d(price), d(pct), 'UP_10').toFixed()).toBe(up10);
    expect(markedUp(d(price), d(pct), 'UP_50').toFixed()).toBe(up50);
    expect(markedUp(d(price), d(pct), 'UP_100').toFixed()).toBe(up100);
  });

  it('rounds half up to whole tugriks and leaves an exact multiple where it is', () => {
    expect(roundPrice(d('1060.5'), 'WHOLE').toFixed()).toBe('1061');
    expect(roundPrice(d('1060.49'), 'WHOLE').toFixed()).toBe('1060');
    expect(roundPrice(d('1050'), 'UP_50').toFixed()).toBe('1050');
    expect(roundPrice(d('1050.01'), 'UP_50').toFixed()).toBe('1100');
    expect(roundPrice(d('100'), 'UP_100').toFixed()).toBe('100');
  });
});

describe('prices per base unit', () => {
  it('derives the loose, supermarket and supermarket bulk prices from the warehouse price', () => {
    const prices = perBasePrices(d(1000), profile());
    expect(prices.warehouse.toFixed()).toBe('1000');
    expect(prices.loose.toFixed()).toBe('1150');
    expect(prices.retail.toFixed()).toBe('1300');
    expect(prices.retailBulk?.toFixed()).toBe('1200');
  });

  it('has no bulk price without a threshold', () => {
    const prices = perBasePrices(
      d(1000),
      profile({ retailBulkMinQty: null, retailBulkMarkupPct: null }),
    );
    expect(prices.retailBulk).toBeNull();
  });

  it('prices a unit from its base price, half up for a fractional factor', () => {
    expect(unitPriceOf(d(1150), d(20)).toFixed()).toBe('23000');
    expect(unitPriceOf(d(3333), d('1.5')).toFixed()).toBe('5000');
  });
});

describe('profile values', () => {
  it('accepts markups from 0 to 999.99 with two decimals and an optional bulk pair', () => {
    expect(priceProfileIssue(profile())).toBeNull();
    expect(priceProfileIssue(profile({ looseMarkupPct: d(0) }))).toBeNull();
    expect(priceProfileIssue(profile({ retailMarkupPct: d('999.99') }))).toBeNull();
    expect(
      priceProfileIssue(profile({ retailBulkMinQty: null, retailBulkMarkupPct: null })),
    ).toBeNull();
    expect(priceProfileIssue(profile({ retailBulkMinQty: d('2.5') }))).toBeNull();
  });

  it('refuses markups out of range or with more than two decimals', () => {
    expect(priceProfileIssue(profile({ looseMarkupPct: d(-1) }))).toEqual({
      issue: 'PERCENT_RANGE',
      field: 'looseMarkupPct',
    });
    expect(priceProfileIssue(profile({ retailMarkupPct: d(1000) }))).toEqual({
      issue: 'PERCENT_RANGE',
      field: 'retailMarkupPct',
    });
    expect(priceProfileIssue(profile({ looseMarkupPct: d('1.234') }))).toEqual({
      issue: 'PERCENT_RANGE',
      field: 'looseMarkupPct',
    });
  });

  it('needs the bulk threshold and its markup together, the markup below the retail one', () => {
    expect(priceProfileIssue(profile({ retailBulkMarkupPct: null }))).toEqual({
      issue: 'BULK_PAIR',
      field: 'retailBulkMarkupPct',
    });
    expect(priceProfileIssue(profile({ retailBulkMinQty: null }))).toEqual({
      issue: 'BULK_PAIR',
      field: 'retailBulkMinQty',
    });
    expect(priceProfileIssue(profile({ retailBulkMinQty: d(0) }))).toEqual({
      issue: 'BULK_QTY_RANGE',
      field: 'retailBulkMinQty',
    });
    expect(priceProfileIssue(profile({ retailBulkMinQty: d('1.2345') }))).toEqual({
      issue: 'BULK_QTY_RANGE',
      field: 'retailBulkMinQty',
    });
    expect(priceProfileIssue(profile({ retailBulkMarkupPct: d(30) }))).toEqual({
      issue: 'BULK_NOT_BELOW_RETAIL',
      field: 'retailBulkMarkupPct',
    });
    expect(priceProfileIssue(profile({ retailBulkMarkupPct: d('29.99') }))).toBeNull();
  });

  it('takes a whole amount, a bulk discount in place of the markup and roundings of its own', () => {
    const erxes = profile({
      retailMarkupAmount: d(1000),
      retailBulkMarkupPct: null,
      retailBulkDiscountPct: d(9),
      retailRounding: 'UP_10',
      retailBulkRounding: 'DOWN_10',
    });
    expect(priceProfileIssue(erxes)).toBeNull();
    expect(priceProfileIssue({ ...erxes, retailMarkupAmount: d('0.5') })).toEqual({
      issue: 'AMOUNT_RANGE',
      field: 'retailMarkupAmount',
    });
    expect(priceProfileIssue({ ...erxes, retailMarkupAmount: d(-1) })).toEqual({
      issue: 'AMOUNT_RANGE',
      field: 'retailMarkupAmount',
    });
    expect(priceProfileIssue({ ...erxes, retailBulkMarkupPct: d(5) })).toEqual({
      issue: 'BULK_PAIR',
      field: 'retailBulkDiscountPct',
    });
    expect(priceProfileIssue({ ...erxes, retailBulkDiscountPct: null })).toEqual({
      issue: 'BULK_PAIR',
      field: 'retailBulkMarkupPct',
    });
    expect(priceProfileIssue({ ...erxes, retailBulkMinQty: null })).toEqual({
      issue: 'BULK_PAIR',
      field: 'retailBulkMinQty',
    });
    for (const off of [d(0), d(100), d('1.234')]) {
      expect(priceProfileIssue({ ...erxes, retailBulkDiscountPct: off })).toEqual({
        issue: 'BULK_DISCOUNT_RANGE',
        field: 'retailBulkDiscountPct',
      });
    }
    expect(
      priceProfileIssue({
        ...erxes,
        retailBulkMinQty: null,
        retailBulkDiscountPct: null,
      }),
    ).toEqual({ issue: 'BULK_ROUNDING_WITHOUT_BULK', field: 'retailBulkRounding' });
  });
});

describe('prices the way Erxes counted them (ADR-0207)', () => {
  it('rounds down after rounding up to a whole tugrik, never to nothing', () => {
    expect(roundPrice(d('3707.4'), 'DOWN_10').toFixed()).toBe('3700');
    expect(roundPrice(d('3709'), 'DOWN_10').toFixed()).toBe('3700');
    // 3709.2 is 3710 whole tugriks first, as Erxes counts it.
    expect(roundPrice(d('3709.2'), 'DOWN_10').toFixed()).toBe('3710');
    expect(roundPrice(d('1149'), 'DOWN_50').toFixed()).toBe('1100');
    expect(roundPrice(d('1999'), 'DOWN_100').toFixed()).toBe('1900');
    expect(roundPrice(d('7.2'), 'DOWN_10').toFixed()).toBe('8');
  });

  it('derives the supermarket price and the bulk price off it', () => {
    // «Үндсэн»: +11 % down to 10₮, from 3 pieces 2 % off, down to 10₮ (a real till sale).
    const main = profile({
      looseMarkupPct: d(0),
      retailMarkupPct: d(11),
      retailBulkMinQty: d(3),
      retailBulkMarkupPct: null,
      retailBulkDiscountPct: d(2),
      rounding: 'UP_50',
      retailRounding: 'DOWN_10',
    });
    const prices = perBasePrices(d(3340), main);
    expect(prices.loose.toFixed()).toBe('3350');
    expect(prices.retail.toFixed()).toBe('3700');
    expect(prices.retailBulk?.toFixed()).toBe('3620');
    // «Архи»: +10 % up to 10₮, from 2 pieces 9 % off, down to 10₮.
    const spirits = { ...main, retailMarkupPct: d(10), retailRounding: 'UP_10' as const };
    const both = perBasePrices(d(2950), {
      ...spirits,
      retailBulkMinQty: d(2),
      retailBulkDiscountPct: d(9),
      retailBulkRounding: 'DOWN_10',
    });
    expect(both.retail.toFixed()).toBe('3250');
    expect(both.retailBulk?.toFixed()).toBe('2950');
  });

  it('adds a whole amount after the percentage', () => {
    const flour = profile({
      retailMarkupPct: d(0),
      retailMarkupAmount: d(1000),
      retailBulkMinQty: null,
      retailBulkMarkupPct: null,
      retailRounding: 'DOWN_100',
    });
    expect(perBasePrices(d(45250), flour).retail.toFixed()).toBe('46200');
    expect(perBasePrices(d(45250), flour).loose.toFixed()).toBe('52038');
  });
});

describe('the whole unit', () => {
  const PCS = 1;
  const BLOCK = 2;
  const BOX = 3;
  const SET = 4;
  const pcs: PackUnit = { uomId: PCS, uomCode: 'PCS', isBase: true };
  const block: PackUnit = { uomId: BLOCK, uomCode: 'BLOCK', isBase: false };
  const box: PackUnit = { uomId: BOX, uomCode: 'BOX', isBase: false };
  const set: PackUnit = { uomId: SET, uomCode: null, isBase: false };

  it('must be one of the current pack units when the product has any', () => {
    expect(wholeUnitProblem([pcs, block, box], BOX)).toBeNull();
    expect(wholeUnitProblem([pcs, block, box], BLOCK)).toBeNull();
    expect(wholeUnitProblem([pcs, block, box], null)).toBe('NOT_CHOSEN');
    expect(wholeUnitProblem([pcs, block, box], PCS)).toBe('GONE');
    expect(wholeUnitProblem([pcs, block], BOX)).toBe('GONE');
  });

  it('is not needed for a product without packs', () => {
    expect(wholeUnitProblem([pcs], null)).toBeNull();
    expect(wholeUnitProblem([pcs], BOX)).toBe('GONE');
  });

  it('is proposed as the box, else the only pack unit', () => {
    expect(defaultWholeUomId([pcs, block, box])).toBe(BOX);
    expect(defaultWholeUomId([pcs, block])).toBe(BLOCK);
    expect(defaultWholeUomId([pcs, block, set])).toBeNull();
    expect(defaultWholeUomId([pcs])).toBeNull();
  });
});
