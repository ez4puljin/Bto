import { describe, expect, it } from 'vitest';
import { Decimal } from '../money';
import { type DealProgram, dealLabel, dealOf, dealPercent } from './deals';

const d = (value: string) => new Decimal(value);
const step = (threshold: string, value: string) => ({ threshold: d(threshold), value: d(value) });
const MINUS = String.fromCharCode(0x2212);

const product = (fields: Partial<DealProgram>): DealProgram => ({
  scope: 'PRODUCT',
  measure: 'QTY',
  effect: 'PERCENT',
  validTo: null,
  steps: [step('0', '5')],
  baseUnitName: 'ш',
  thresholdUnit: null,
  programUnit: null,
  ...fields,
});

const label = (program: DealProgram) => {
  const deal = dealOf(program);
  if (!deal) throw new Error('no deal');
  return dealLabel(deal);
};

describe('dealOf / dealLabel (ADR-0092 #3)', () => {
  it('names a percentage without a condition', () => {
    expect(label(product({}))).toBe(`${MINUS}5%`);
    expect(dealOf(product({}))).toMatchObject({ kind: 'DISCOUNT', threshold: null, lastDay: null });
  });

  it('counts a product threshold above one base unit, in the chosen unit when it divides', () => {
    expect(label(product({ steps: [step('10', '5')] }))).toBe(`10+ ш ${MINUS}5%`);
    const box = { name: 'хайрцаг', factor: d('24') };
    expect(label(product({ steps: [step('480', '3')], thresholdUnit: box }))).toBe(
      `20+ хайрцаг ${MINUS}3%`,
    );
    // 30 pieces are not a whole number of boxes: shown in pieces.
    expect(label(product({ steps: [step('30', '3')], thresholdUnit: box }))).toBe(
      `30+ ш ${MINUS}3%`,
    );
    // One base unit (or less) always applies.
    expect(dealOf(product({ steps: [step('1', '5')] }))?.threshold).toBeNull();
  });

  it('writes tugriks off and a new price with thousands, and a pack unit after them', () => {
    expect(label(product({ effect: 'AMOUNT', steps: [step('0', '200')] }))).toBe(`${MINUS}200₮`);
    expect(
      label(
        product({
          effect: 'AMOUNT',
          steps: [step('0', '1500')],
          programUnit: { name: 'хайрцаг', factor: d('20'), isBase: false },
        }),
      ),
    ).toBe(`${MINUS}1,500₮/хайрцаг`);
    expect(
      label(
        product({
          effect: 'PRICE',
          steps: [step('0', '900')],
          programUnit: { name: 'ш', factor: d('1'), isBase: true },
        }),
      ),
    ).toBe('900₮');
  });

  it('names a category threshold in its counted unit or its amount', () => {
    const category: Partial<DealProgram> = { scope: 'CATEGORY', baseUnitName: null };
    expect(
      label(product({ ...category, countUnitName: 'хайрцаг', steps: [step('20', '3')] })),
    ).toBe(`20+ хайрцаг ${MINUS}3%`);
    expect(label(product({ ...category, measure: 'AMOUNT', steps: [step('500000', '3')] }))).toBe(
      `500,000₮+ ${MINUS}3%`,
    );
    expect(label(product({ ...category, measure: 'AMOUNT', steps: [step('0', '2.5')] }))).toBe(
      `${MINUS}2.5%`,
    );
  });

  it('adds a promotion its last day, the day before its end', () => {
    const promotion = product({ validTo: '2026-11-01', steps: [step('0', '10')] });
    expect(dealOf(promotion)).toMatchObject({ kind: 'PROMOTION', lastDay: '2026-10-31' });
    expect(label(promotion)).toBe(`${MINUS}10% · 10/31`);
  });

  it('has no deal without steps', () => {
    expect(dealOf(product({ steps: [] }))).toBeNull();
  });
});

describe('dealPercent', () => {
  it('takes a percentage as it is', () => {
    expect(dealPercent(product({ steps: [step('0', '7.5')] }), null)?.toString()).toBe('7.5');
  });

  it('measures tugriks off and a new price against the unit price', () => {
    const box = { name: 'хайрцаг', factor: d('10'), isBase: false };
    expect(
      dealPercent(
        product({ effect: 'AMOUNT', steps: [step('0', '200')], programUnit: box }),
        d('100'),
      )?.toString(),
    ).toBe('20');
    expect(
      dealPercent(
        product({ effect: 'PRICE', steps: [step('0', '750')], programUnit: box }),
        d('100'),
      )?.toString(),
    ).toBe('25');
  });

  it('cannot tell a category amount off the total, or a price without terms', () => {
    expect(
      dealPercent(
        product({ scope: 'CATEGORY', effect: 'AMOUNT', steps: [step('0', '5000')] }),
        d('100'),
      ),
    ).toBeNull();
    expect(dealPercent(product({ effect: 'AMOUNT', steps: [step('0', '200')] }), null)).toBeNull();
  });
});
