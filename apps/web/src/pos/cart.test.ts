import { act, renderHook } from '@testing-library/react';
import { Decimal } from '@tugeel/shared/money';
import { describe, expect, it } from 'vitest';
import { cartKey, useCart } from './cart';
import { kioskKeys } from './queries';
import { MILK } from './test/fake-edge';

describe('expiry variants in a POS basket', () => {
  it('keeps fresh stock and each special approval separate through edits, selection and wire', () => {
    const { result } = renderHook(() => useCart());
    act(() => {
      result.current.add(MILK, 11);
      result.current.add(MILK, 11, null, 'BTOEXP-7');
      result.current.add(MILK, 11, null, 'BTOEXP-8');
      result.current.add(MILK, 11, null, 'BTOEXP-7');
    });
    expect(result.current.wire).toEqual([
      { productUnitId: 11, qty: '1' },
      { productUnitId: 11, qty: '2', expiryBarcode: 'BTOEXP-7' },
      { productUnitId: 11, qty: '1', expiryBarcode: 'BTOEXP-8' },
    ]);
    act(() => result.current.setQty('11:BTOEXP-7', '5'));
    act(() => result.current.remove('11:BTOEXP-8'));
    expect(result.current.lines.map((line) => [cartKey(line), line.qty])).toEqual([
      [11, '1'],
      ['11:BTOEXP-7', '5'],
    ]);
    act(() => result.current.moveSelection(-1));
    expect(result.current.selected).toBe(11);
  });

  it('retains a parked expiry identity and ignores ordinary bonus paid-entry instructions for it', () => {
    const { result } = renderHook(() => useCart());
    act(() => result.current.add(MILK, 11, { n: new Decimal(1), m: new Decimal(1) }, 'BTOEXP-7'));
    act(() => result.current.add(MILK, 11, { n: new Decimal(1), m: new Decimal(1) }, 'BTOEXP-7'));
    expect(result.current.lines[0]?.qty).toBe('2');
    const parked = result.current.lines;
    act(() => result.current.clear());
    act(() => result.current.load(parked));
    expect(result.current.selected).toBe('11:BTOEXP-7');
    expect(result.current.wire[0]).toEqual({
      productUnitId: 11,
      qty: '2',
      expiryBarcode: 'BTOEXP-7',
    });
    expect(kioskKeys.quote(1, result.current.wire)).not.toEqual(
      kioskKeys.quote(1, [{ productUnitId: 11, qty: '2' }]),
    );
  });
});
