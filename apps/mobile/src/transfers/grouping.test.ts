import { describe, expect, it } from 'vitest';
import { inUnit, lineQtyWords, numbersLabel, sectionsByHome, toBase } from './grouping';

describe('request rows by home warehouse (ADR-0116 #2)', () => {
  it('keeps the sections in the order the rows came, the homeless products last', () => {
    const rows = [
      { productId: 1, homeWarehouseId: null, homeWarehouseName: null },
      { productId: 2, homeWarehouseId: 10, homeWarehouseName: 'Төв агуулах' },
      { productId: 3, homeWarehouseId: 11, homeWarehouseName: 'Архины агуулах' },
      { productId: 4, homeWarehouseId: 10, homeWarehouseName: 'Төв агуулах' },
    ];
    const sections = sectionsByHome(rows);
    expect(sections.map((section) => section.homeWarehouseId)).toEqual([10, 11, null]);
    expect(sections[0]?.data.map((row) => row.productId)).toEqual([2, 4]);
    expect(sections[2]?.homeWarehouseName).toBeNull();
  });

  it('gives no section without rows', () => {
    expect(sectionsByHome([])).toEqual([]);
  });
});

describe('a request’s label', () => {
  it('is the one number, or the numbers shortened', () => {
    expect(numbersLabel([])).toBeNull();
    expect(numbersLabel([null])).toBeNull();
    expect(numbersLabel(['TR-2026-000005'])).toBe('TR-2026-000005');
    expect(numbersLabel(['TR-2026-000005', 'TR-2026-000006'])).toBe('TR-…05 · TR-…06');
    expect(numbersLabel(['TR-2026-000005', null])).toBe('TR-2026-000005');
  });
});

describe('a line’s quantities in words', () => {
  const line = {
    requestedQty: '5.000',
    unitName: 'хайрцаг',
    requestFactor: '24.000000',
    baseUnitName: 'ш',
    shippedQtyBase: '96.000',
    countedQtyBase: null,
  };

  it('converts between the request unit and the base unit without floats', () => {
    expect(inUnit('96.000', '24.000000')).toBe('4');
    expect(inUnit('100', '24')).toBe('4.167');
    expect(inUnit('5', '0')).toBe('5');
    expect(toBase('5.000', '24.000000')).toBe('120');
  });

  it('tells what was asked (with its base), what left, and what was counted', () => {
    expect(lineQtyWords(line)).toEqual({
      requested: { qty: '5', unit: 'хайрцаг' },
      requestedBase: { qty: '120', unit: 'ш' },
      shipped: { qty: '4', unit: 'хайрцаг' },
      counted: null,
    });
    expect(
      lineQtyWords({ ...line, requestFactor: '1', unitName: 'ш', countedQtyBase: '0' }),
    ).toEqual({
      requested: { qty: '5', unit: 'ш' },
      requestedBase: null,
      shipped: { qty: '96', unit: 'ш' },
      counted: { qty: '0', unit: 'ш' },
    });
  });
});
