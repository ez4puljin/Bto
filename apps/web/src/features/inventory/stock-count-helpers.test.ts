import { describe, expect, it } from 'vitest';
import { groupBySupplier, sheetSearch, signedMnt, sumsOf } from './stock-count-helpers';

const row = (
  lineId: number,
  supplierId: number | null,
  differenceQty: string | null,
  differenceAmount: string | null,
) => ({
  lineId,
  supplierId,
  supplierName: supplierId === null ? null : `S${supplierId}`,
  differenceQty,
  differenceAmount,
});

describe('the count sheet', () => {
  it('sums surpluses and shortages apart, and the net of both', () => {
    expect(
      sumsOf([row(1, 1, '42', '361200'), row(2, 1, '-104', '-153920'), row(3, 1, null, null)]),
    ).toEqual({
      surplusQty: '42',
      surplusAmount: '361200.00',
      shortageQty: '-104',
      shortageAmount: '-153920.00',
      netQty: '-62',
      netAmount: '207280.00',
    });
  });

  it('cuts rows ordered by supplier into one block each, with its own sums', () => {
    const groups = groupBySupplier([
      row(1, 1, '2', '200'),
      row(2, 1, '-1', '-50'),
      row(3, 2, '0', '0'),
      row(4, null, '-3', null),
    ]);
    expect(groups.map((group) => [group.supplierId, group.rows.length, group.netAmount])).toEqual([
      [1, 2, '150.00'],
      [2, 1, '0.00'],
      [null, 1, '0.00'],
    ]);
    expect(groups[2]?.shortageQty).toBe('-3');
  });

  it('signs a money difference and carries the filters to the print page', () => {
    expect(signedMnt('361200.00')).toBe('+361,200');
    expect(signedMnt('-6800.00')).toBe('-6,800');
    expect(signedMnt('0.00')).toBe('0');
    expect(sheetSearch({ filter: 'DIFFERENT', supplierId: 5, q: 'скоч' })).toBe(
      'filter=DIFFERENT&q=%D1%81%D0%BA%D0%BE%D1%87&supplierId=5',
    );
  });
});
